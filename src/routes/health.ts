// src/routes/health.ts
// Health check route used by load balancers and monitoring to verify service readiness.

import { FastifyInstance, FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/health", async (_request, reply) => {
    return reply.status(200).send({ status: "ok" });
  });
};

