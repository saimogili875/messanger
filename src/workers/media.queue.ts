// src/workers/media.queue.ts
// Configures and exports the BullMQ queue and Redis client for background media jobs.

import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env";

// Shared Redis client for BullMQ job dispatching
export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
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

