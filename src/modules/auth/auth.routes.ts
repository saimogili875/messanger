// src/modules/auth/auth.routes.ts
// Exposes authentication endpoints for registration, login, token refresh, and logout.

import { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
} from "./auth.schemas";
import { authService } from "./auth.service";
import { redis } from "../../config/redis";
import { env } from "../../config/env";

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /auth/register - Create a new user account
  app.post(
    "/auth/register",
    {
      bodyLimit: 10 * 1024, // 10 KB limit
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = registerSchema.parse(request.body);
      const user = await authService.register(body);
      return reply.status(201).send(user);
    }
  );

  // POST /auth/login - Authenticate with credentials, returning access token, refresh token, and deviceId
  app.post(
    "/auth/login",
    {
      bodyLimit: 10 * 1024,
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const emailLower = body.email.toLowerCase();

      // Per-account rate limiting (max 5 failed attempts per account per minute)
      try {
        const key = `rl:login:acc:${emailLower}`;
        const attempts = await redis.incr(key);
        if (attempts === 1) {
          await redis.expire(key, 60);
        }
        if (attempts > env.LOGIN_RATE_LIMIT_PER_ACCOUNT) {
          const ttl = await redis.ttl(key);
          return reply.status(429).send({
            statusCode: 429,
            error: "Too many requests, please try again later.",
            message: `Too many login attempts for this account. Try again in ${Math.max(1, ttl)} seconds.`,
            retryAfter: Math.max(1, ttl),
          });
        }
      } catch (err) {
        // Fallback to IP rate limiter if Redis is offline
      }

      const userAgent = request.headers["user-agent"];
      const { user, sessionId, deviceId, refreshToken } =
        await authService.login(body, userAgent);

      // Reset account rate limit on successful login
      try {
        await redis.del(`rl:login:acc:${emailLower}`);
      } catch {
        // Ignore redis cleanup error
      }

      // Access JWT payload contains strictly { sub: userId, sid: sessionId } (15-minute expiration)
      const accessToken = app.jwt.sign(
        { sub: user.id, sid: sessionId },
        { expiresIn: "15m" }
      );

      return reply.status(200).send({
        accessToken,
        refreshToken,
        deviceId,
        expiresIn: 900,
      });
    }
  );

  // POST /auth/refresh - Atomically rotate refresh token within the same session
  app.post(
    "/auth/refresh",
    {
      bodyLimit: 10 * 1024,
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = refreshSchema.parse(request.body);
      const { userId, sessionId, newRefreshToken } =
        await authService.rotateRefreshToken(body.refreshToken);

      // New access token maintains the same session ID
      const accessToken = app.jwt.sign(
        { sub: userId, sid: sessionId },
        { expiresIn: "15m" }
      );

      return reply.status(200).send({
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: 900,
      });
    }
  );

  // POST /auth/logout - Revokes active session, immediately invalidating the access token
  app.post(
    "/auth/logout",
    {
      bodyLimit: 10 * 1024,
    },
    async (request, reply) => {
      const body = logoutSchema.parse(request.body);
      await authService.logout(body.refreshToken);
      return reply.status(204).send();
    }
  );
};
