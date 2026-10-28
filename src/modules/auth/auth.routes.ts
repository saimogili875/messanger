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

  // POST /auth/login - Authenticate with email & password, returning access + refresh tokens
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
      const { user, refreshToken } = await authService.login(body);

      // Issue 15-minute JWT containing ONLY sub (user id), iat, and exp
      const accessToken = app.jwt.sign(
        { sub: user.id },
        { expiresIn: "15m" }
      );

      return reply.status(200).send({
        accessToken,
        refreshToken,
        expiresIn: 900,
      });
    }
  );

  // POST /auth/refresh - Exchange a valid refresh token for a new access + refresh pair
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
      const { userId, newRefreshToken } = await authService.rotateRefreshToken(
        body.refreshToken
      );

      const accessToken = app.jwt.sign(
        { sub: userId },
        { expiresIn: "15m" }
      );

      return reply.status(200).send({
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: 900,
      });
    }
  );

  // POST /auth/logout - Invalidate a refresh token
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
