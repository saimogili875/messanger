// src/app.ts
// Builds and configures the Fastify application instance with plugins, rate limiting, and routes.

import fastify, { FastifyInstance, FastifyError } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyJwt from "@fastify/jwt";
import fastifyRateLimit from "@fastify/rate-limit";
import fs from "fs";
import path from "path";
import { ZodError } from "zod";
import { env } from "./config/env";
import { HttpError } from "./modules/auth/auth.service";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./modules/auth/auth.routes";
import { userRoutes } from "./modules/user/user.routes";
import { filesRoutes } from "./modules/files/files.routes";
import { groupRoutes } from "./modules/group/group.routes";
import { chatRoutes } from "./modules/chat/chat.routes";
import { searchRoutes } from "./modules/search/search.routes";
import { initRealtimeManager } from "./realtime/socket";

export function buildApp(): FastifyInstance {
  const app = fastify({
    trustProxy: env.TRUST_PROXY,
    logger: {
      level: env.NODE_ENV === "test" ? "silent" : "info",
      redact: [
        "req.headers.authorization",
        "req.body.password",
        "req.body.refreshToken",
      ],
    },
  });

  // Security headers with Helmet: permit SPA scripts, styles, and socket connections
  app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "wss:", "ws:", "https:"],
      },
    },
  });

  // Strict CORS: allow only configured browser origins, Render deployed host, or non-browser clients
  app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow non-browser requests with no Origin header (e.g. mobile clients, curl)
      if (!origin) {
        return cb(null, true);
      }
      // Check against explicit whitelist or deployed Render domain
      if (
        env.CORS_ORIGINS.length === 0 ||
        env.CORS_ORIGINS.includes(origin) ||
        origin.includes("onrender.com")
      ) {
        return cb(null, true);
      }
      return cb(new Error("Not allowed by CORS"), false);
    },
    allowedHeaders: ["Authorization", "Content-Type"],
    methods: ["GET", "POST", "OPTIONS"],
  });

  // Register JWT plugin with secret from validated environment
  app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
  });

  // Global rate limiter (100 requests per minute per IP)
  app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: "Too many requests, please try again later.",
    }),
  });

  // Global error handler
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    // Return structured 400 for Zod validation failures
    if (error instanceof ZodError) {
      const details = error.errors.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));
      return reply.status(400).send({
        error: "Validation error",
        details,
      });
    }

    // Return application-specific HTTP error status and message
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        error: error.message,
      });
    }

    const statusCode =
      "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    const errorCode =
      "code" in error && typeof error.code === "string" ? error.code : undefined;

    // Rate limit 429 response
    if (
      statusCode === 429 ||
      errorCode === "FST_ERR_RATE_LIMIT" ||
      errorCode === "FST_RATE_LIMIT" ||
      ("error" in error &&
        typeof (error as Record<string, unknown>).error === "string" &&
        String((error as Record<string, unknown>).error)
          .toLowerCase()
          .includes("too many")) ||
      ("message" in error &&
        typeof error.message === "string" &&
        error.message.toLowerCase().includes("too many"))
    ) {
      return reply.status(429).send({
        error: "Too many requests, please try again later.",
      });
    }

    // Fastify JWT authentication failure (e.g., token expired, bad signature)
    if (
      statusCode === 401 ||
      (errorCode && errorCode.startsWith("FST_JWT_"))
    ) {
      return reply.status(401).send({
        error: "Unauthorized",
      });
    }

    // CORS rejection error
    if (error.message === "Not allowed by CORS") {
      return reply.status(403).send({
        error: "Not allowed by CORS",
      });
    }

    // Client HTTP errors with explicit status code
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: error.message,
      });
    }

    // Unhandled server errors (redact internal error details from public responses)
    request.log.error(error);
    return reply.status(500).send({
      error: "Internal server error",
    });
  });

  // Register application routes
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(userRoutes);
  app.register(filesRoutes);
  app.register(groupRoutes);
  app.register(chatRoutes);
  app.register(searchRoutes);

  // Initialize Socket.IO server on Fastify's underlying HTTP server
  const realtime = initRealtimeManager(app.server);

  app.addHook("onClose", async () => {
    await realtime.close();
  });

  // Serve React Web UI if web/dist exists
  const webDistPath = path.resolve(process.cwd(), "web/dist");
  if (fs.existsSync(webDistPath)) {
    const mimeTypes: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    };

    app.get("/assets/*", async (request, reply) => {
      const assetFile = (request.params as any)["*"];
      const filePath = path.join(webDistPath, "assets", assetFile);
      if (filePath.startsWith(path.join(webDistPath, "assets")) && fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        reply.type(mimeTypes[ext] || "application/octet-stream");
        return reply.send(fs.createReadStream(filePath));
      }
      return reply.status(404).send("Not found");
    });

    app.get("/", async (_request, reply) => {
      reply.type("text/html; charset=utf-8");
      return reply.send(fs.createReadStream(path.join(webDistPath, "index.html")));
    });

    // Fallback: serve index.html for SPA client-side routes unless it's an API route
    app.setNotFoundHandler(async (request, reply) => {
      const isApiRoute =
        request.url.startsWith("/auth") ||
        request.url.startsWith("/chats") ||
        request.url.startsWith("/users") ||
        request.url.startsWith("/files") ||
        request.url.startsWith("/groups") ||
        request.url.startsWith("/search") ||
        request.url.startsWith("/health") ||
        request.url.startsWith("/socket.io");

      if (isApiRoute) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: `Route ${request.method}:${request.url} not found`,
        });
      }

      reply.type("text/html; charset=utf-8");
      return reply.send(fs.createReadStream(path.join(webDistPath, "index.html")));
    });
  }

  return app;
}
