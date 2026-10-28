// src/plugins/authenticate.ts
// Hybrid authentication pre-handler verifying JWT access tokens and database session validity.

import { FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { sessions } from "../db/schema";
import { HttpError } from "../modules/auth/auth.service";

const ONE_MINUTE_MS = 60 * 1000;

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  // Step 1: Verify JWT signature and expiration
  try {
    await request.jwtVerify();
  } catch {
    throw new HttpError(401, "Unauthorized");
  }

  const { sub: userId, sid: sessionId } = request.user;
  if (!userId || !sessionId) {
    throw new HttpError(401, "Unauthorized");
  }

  // Step 2: Confirm session exists in PostgreSQL, matches user, and is not revoked/expired
  const [session] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      revokedAt: sessions.revokedAt,
      expiresAt: sessions.expiresAt,
      lastUsedAt: sessions.lastUsedAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (
    !session ||
    session.userId !== userId ||
    session.revokedAt !== null ||
    session.expiresAt <= new Date()
  ) {
    throw new HttpError(401, "Unauthorized");
  }

  // Step 3: Update last_used_at at most once per minute per session to avoid DB write thrashing
  if (Date.now() - session.lastUsedAt.getTime() > ONE_MINUTE_MS) {
    db.update(sessions)
      .set({ lastUsedAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .catch((err) => request.log.error(err, "Failed to update session last_used_at"));
  }
}
