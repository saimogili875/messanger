// src/modules/user/user.routes.ts
// Protected user endpoints requiring a valid JWT access token.

import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
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
};
