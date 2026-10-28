// src/workers/cleanup.job.ts
// Periodic cleanup job that aborts expired R2 uploads stuck in 'uploading' state for > 24 hours.

import { and, eq, lt } from "drizzle-orm";
import { db } from "../db";
import { files } from "../db/schema";
import { storageService } from "../services/storage.service";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function cleanupStuckUploads(cutoffMs = TWENTY_FOUR_HOURS_MS): Promise<number> {
  const cutoffDate = new Date(Date.now() - cutoffMs);

  // Find all uploads that started before cutoff and never completed
  const stuckFiles = await db
    .select()
    .from(files)
    .where(and(eq(files.status, "uploading"), lt(files.createdAt, cutoffDate)));

  let cleanedCount = 0;

  for (const file of stuckFiles) {
    try {
      // 1. If multipart upload was initiated, abort it in R2
      if (file.uploadId) {
        await storageService.abortMultipartUpload(file.r2Key, file.uploadId);
      }

      // 2. Remove any partial single PUT object from R2
      await storageService.deleteObject(file.r2Key);

      // 3. Mark file record as failed
      await db
        .update(files)
        .set({
          status: "failed",
          failureReason: "Upload timed out after exceeding 24 hours threshold",
          updatedAt: new Date(),
        })
        .where(eq(files.id, file.id));

      cleanedCount++;
    } catch (err: unknown) {
      console.error(
        `[CleanupJob] Failed to clean up file ${file.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return cleanedCount;
}

// When executed directly as a scheduled cron task
if (require.main === module) {
  cleanupStuckUploads()
    .then((count) => {
      console.log(`[CleanupJob] Cleaned up ${count} stuck uploads.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[CleanupJob] Cleanup failed:", err);
      process.exit(1);
    });
}

