// src/modules/auth/auth.service.ts
// Business logic for user registration, credential verification, and refresh token rotation.

import crypto from "crypto";
import argon2 from "argon2";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../db";
import { users, refreshTokens, User } from "../../db/schema";
import { RegisterInput, LoginInput } from "./auth.schemas";

// Standard application error containing HTTP status code
export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

// Pre-computed argon2id hash of a dummy password to ensure constant-time response for unknown emails
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$eW91cnNhbHRoZXJlMTIzNA$e8aW0M5Q9N7aP6iO3g0tL2m1K9j8H7g6F5e4D3c2B1A";

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

  // Verifies credentials and creates a persistent refresh token row
  async login(input: LoginInput): Promise<{ user: Omit<User, "passwordHash">; refreshToken: string }> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (!user) {
      // Run dummy argon2 verify to prevent user enumeration via timing analysis
      await argon2.verify(DUMMY_HASH, input.password).catch(() => false);
      throw new HttpError(401, "Invalid credentials");
    }

    const passwordValid = await argon2.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      throw new HttpError(401, "Invalid credentials");
    }

    // Generate random refresh token and store only its SHA-256 hash
    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt,
      },
      refreshToken: rawRefreshToken,
    };
  }

  // Rotates refresh tokens inside a single database transaction
  async rotateRefreshToken(rawRefreshToken: string): Promise<{ userId: string; newRefreshToken: string }> {
    const tokenHash = hashToken(rawRefreshToken);

    const [tokenRecord] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    // Reject if token is missing, already revoked, or expired
    if (!tokenRecord || tokenRecord.revokedAt !== null || tokenRecord.expiresAt <= new Date()) {
      throw new HttpError(401, "Invalid or expired refresh token");
    }

    const newRawRefreshToken = generateRefreshToken();
    const newTokenHash = hashToken(newRawRefreshToken);
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    // Atomically revoke the old token and issue the new token
    await db.transaction(async (tx) => {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.id, tokenRecord.id));

      await tx.insert(refreshTokens).values({
        userId: tokenRecord.userId,
        tokenHash: newTokenHash,
        expiresAt: newExpiresAt,
      });
    });

    return {
      userId: tokenRecord.userId,
      newRefreshToken: newRawRefreshToken,
    };
  }

  // Revokes a refresh token on logout (always safe and silent)
  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);

    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
  }
}

export const authService = new AuthService();
