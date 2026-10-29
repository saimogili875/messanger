// src/config/redis.ts
// Shared Redis connection instances for caching, rate limiting, and Socket.IO clustering.

import IORedis from "ioredis";
import { env } from "./env";

export function createRedisClient(): IORedis {
  const isTls =
    env.REDIS_URL.startsWith("rediss://") || env.REDIS_URL.includes("upstash.io");

  const client = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: isTls ? {} : undefined,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
  });

  client.on("error", (err) => {
    if (env.NODE_ENV !== "test") {
      console.error("[Redis Error]:", err.message);
    }
  });

  return client;
}

export const redis = createRedisClient();

