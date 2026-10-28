// src/plugins/authenticate.ts
// Authentication pre-handler verifying JWT access tokens from the Authorization header.

import { FastifyRequest, FastifyReply } from "fastify";
import { HttpError } from "../modules/auth/auth.service";

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch (err) {
    throw new HttpError(401, "Unauthorized");
  }
}
