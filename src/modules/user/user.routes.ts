// src/modules/user/user.routes.ts
// Protected user endpoints requiring a valid JWT access token.

import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { eq, and, or, ilike, sql } from "drizzle-orm";
import { authenticate } from "../../plugins/authenticate";
import { db } from "../../db";
import { users } from "../../db/schema";
import { HttpError } from "../auth/auth.service";

export const userRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /me - Retrieve current authenticated user profile
  app.get(
    "/me",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const userId = request.user.sub;

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new HttpError(401, "Unauthorized");
      }

      return reply.status(200).send(user);
    }
  );

  // GET /users/search - Search users by email or display name to initiate chats
  app.get(
    "/users/search",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const q = ((request.query as any)?.q || "").trim();
      if (!q) {
        return reply.status(200).send([]);
      }

      const results = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        })
        .from(users)
        .where(
          and(
            sql`${users.id} != ${request.user.sub}`,
            or(
              ilike(users.email, `%${q}%`),
              ilike(users.displayName, `%${q}%`)
            )
          )
        )
        .limit(10);

      return reply.status(200).send(results);
    }
  );
};

