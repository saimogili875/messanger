// src/workers/media.worker.ts
// Standalone BullMQ worker process that dequeues media processing tasks with low CPU priority.

import { Worker, Job } from "bullmq";
import { MEDIA_QUEUE_NAME } from "./media.queue";
import { mediaProcessor } from "./media.processor";
import { env } from "../config/env";

const redisUrl = new URL(env.REDIS_URL);
const isTls =
  redisUrl.protocol === "rediss:" || env.REDIS_URL.includes("upstash.io");

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || "6379", 10),
  password: redisUrl.password || undefined,
  username: redisUrl.username || undefined,
  tls: isTls ? {} : undefined,
  maxRetriesPerRequest: null,
};

// Start BullMQ worker with low concurrency (1-2 jobs) to preserve host responsiveness
export function startMediaWorker(concurrency = 2): Worker {
  const worker = new Worker<{ fileId: string }>(
    MEDIA_QUEUE_NAME,
    async (job: Job<{ fileId: string }>) => {
      console.log(`[MediaWorker] Processing job ${job.id} for file ${job.data.fileId}`);
      await mediaProcessor.processFile(job.data.fileId);
      console.log(`[MediaWorker] Finished job ${job.id} for file ${job.data.fileId}`);
    },
    {
      connection,
      concurrency,
      lockDuration: 180000, // 3 minutes lock duration for heavy video/document transcoding
    }
  );

  worker.on("completed", (job) => {
    console.log(`[MediaWorker] Job ${job.id} completed successfully`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[MediaWorker] Job ${job?.id} failed with error:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[MediaWorker] Worker connection error:", err.message);
  });

  return worker;
}

// When executed directly (e.g. node dist/workers/media.worker.js in Docker worker container)
if (require.main === module) {
  const worker = startMediaWorker();
  console.log(`[MediaWorker] Started BullMQ worker for queue "${MEDIA_QUEUE_NAME}"`);

  const shutdown = async (signal: string) => {
    console.log(`[MediaWorker] Received ${signal}, closing worker gracefully...`);
    await worker.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

