// src/app.ts
// Builds and configures the Fastify application instance without binding to a network port.

import fastify, { FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health";

export function buildApp(): FastifyInstance {
  const app = fastify({
    logger: true,
  });

  // Register routes
  app.register(healthRoutes);

  return app;
}

