// src/modules/auth/auth.service.ts
// Business logic for user registration, hybrid session management, and atomic token rotation.

import crypto from "crypto";
import argon2 from "argon2";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "../../db";
import { users, sessions, devices, User } from "../../db/schema";
import { RegisterInput, LoginInput } from "./auth.schemas";

// Standard application error containing HTTP status code
export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

// Generate a real argon2id hash at startup with identical options to register
// This promise is awaited on unknown-email login paths to eliminate timing differences
const dummyHashPromise = argon2.hash(crypto.randomBytes(16).toString("hex"), {
  type: argon2.argon2id,
});

// Refresh token validity duration: 7 days
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Computes SHA-256 hash of a raw refresh token for safe database storage
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Generates a cryptographically secure 48-byte random hex string (96 characters)
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export class AuthService {
  // Registers a new user with an argon2id hashed password
  async register(input: RegisterInput): Promise<Omit<User, "passwordHash">> {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (existing.length > 0) {
      throw new HttpError(409, "Email already registered");
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });

    const [newUser] = await db
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        displayName: input.displayName,
      })
      .returning({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        createdAt: users.createdAt,
      });

    return newUser;
  }

  // Verifies credentials, records device activity, and creates a new session
  async login(
    input: LoginInput,
    userAgentHeader?: string
  ): Promise<{
    user: Omit<User, "passwordHash">;
    sessionId: string;
    deviceId: string;
    refreshToken: string;
  }> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (!user) {
      // Run argon2 verify against real startup-computed dummy hash to prevent email enumeration via timing
      const dummyHash = await dummyHashPromise;
      await argon2.verify(dummyHash, input.password).catch(() => false);
      throw new HttpError(401, "Invalid credentials");
    }

    const passwordValid = await argon2.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      throw new HttpError(401, "Invalid credentials");
    }

    // Resolve device name from input, User-Agent, or fallback
    const resolvedDeviceName =
      input.deviceName?.trim() ||
      userAgentHeader?.slice(0, 100).trim() ||
      "Unknown device";

    // Find or create device record for the user
    const [existingDevice] = await db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.userId, user.id),
          eq(devices.deviceName, resolvedDeviceName)
        )
      )
      .limit(1);

    let deviceId: string;
    if (existingDevice) {
      await db
        .update(devices)
        .set({ lastSeenAt: new Date() })
        .where(eq(devices.id, existingDevice.id));
      deviceId = existingDevice.id;
    } else {
      const [newDevice] = await db
        .insert(devices)
        .values({
          userId: user.id,
          deviceName: resolvedDeviceName,
          lastSeenAt: new Date(),
        })
        .returning({ id: devices.id });
      deviceId = newDevice.id;
    }

    // Generate random refresh token and store only its SHA-256 hash in a new session
    const rawRefreshToken = generateRefreshToken();
    const refreshTokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    const [newSession] = await db
      .insert(sessions)
      .values({
        userId: user.id,
        deviceId,
        refreshTokenHash,
        userAgent: userAgentHeader || null,
        expiresAt,
        lastUsedAt: new Date(),
      })
      .returning({ id: sessions.id });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt,
      },
      sessionId: newSession.id,
      deviceId,
      refreshToken: rawRefreshToken,
    };
  }

  // Atomically rotates the refresh token within the same session using a single SQL UPDATE
  async rotateRefreshToken(
    rawRefreshToken: string
  ): Promise<{ userId: string; sessionId: string; newRefreshToken: string }> {
    const oldRefreshTokenHash = hashToken(rawRefreshToken);
    const newRawRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashToken(newRawRefreshToken);
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    // Atomic update: only one concurrent request can match the old hash
    const [updatedSession] = await db
      .update(sessions)
      .set({
        refreshTokenHash: newRefreshTokenHash,
        lastUsedAt: new Date(),
        expiresAt: newExpiresAt,
      })
      .where(
        and(
          eq(sessions.refreshTokenHash, oldRefreshTokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date())
        )
      )
      .returning({
        id: sessions.id,
        userId: sessions.userId,
      });

    if (!updatedSession) {
      throw new HttpError(401, "Invalid or expired refresh token");
    }

    return {
      userId: updatedSession.userId,
      sessionId: updatedSession.id,
      newRefreshToken: newRawRefreshToken,
    };
  }

  // Revokes the session associated with the refresh token on logout
  async logout(rawRefreshToken: string): Promise<void> {
    const refreshTokenHash = hashToken(rawRefreshToken);

    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.refreshTokenHash, refreshTokenHash),
          isNull(sessions.revokedAt)
        )
      );
  }
}

export const authService = new AuthService();
