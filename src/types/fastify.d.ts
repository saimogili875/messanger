// src/types/fastify.d.ts
// Augments Fastify types with JWT payload and user definitions.

import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; sid: string };
    user: { sub: string; sid: string };
  }
}
