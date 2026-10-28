// src/modules/search/search.routes.ts
// Authenticated and rate-limited full-text search endpoint across all visible messages.

import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "../../plugins/authenticate";
import { env } from "../../config/env";
import { searchProvider } from "./search.provider";

const searchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, "Search query must be at least 2 characters")
    .max(100, "Search query cannot exceed 100 characters"),
  chatId: z.string().uuid("Invalid chat ID").optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
  cursor: z.string().optional(),
});

export const searchRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /search - Full-text search with cursor pagination and per-user rate limit
  app.get(
    "/search",
    {
      preHandler: [authenticate],
      config: {
        rateLimit: {
          max: env.SEARCH_RATE_LIMIT_PER_MINUTE,
          timeWindow: "1 minute",
          keyGenerator: (request) => request.user?.sub || request.ip,
        },
      },
    },
    async (request, reply) => {
      const { q, chatId, limit, cursor } = searchQuerySchema.parse(request.query);
      const result = await searchProvider.search({
        userId: request.user.sub,
        q,
        chatId,
        cursor,
        limit,
      });

      return reply.status(200).send(result);
    }
  );
};

