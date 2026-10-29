// src/workers/media.queue.ts
// Configures and exports the BullMQ queue and Redis client for background media jobs.

import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env";

// Shared Redis client for BullMQ job dispatching with mandatory maxRetriesPerRequest: null
const isTls =
  env.REDIS_URL.startsWith("rediss://") || env.REDIS_URL.includes("upstash.io");

export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  tls: isTls ? {} : undefined,
});

export interface MediaJobData {
  fileId: string;
}

export const MEDIA_QUEUE_NAME = "media-processing";

export const mediaQueue = new Queue<MediaJobData>(MEDIA_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

