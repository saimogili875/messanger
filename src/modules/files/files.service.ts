// src/modules/files/files.service.ts
// Business logic for file upload initialization, storage quota enforcement, deduplication, and secure download signing.

import crypto from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import { files, userStorageQuotas, messages, chatMembers } from "../../db/schema";
import { env } from "../../config/env";
import { storageService } from "../../services/storage.service";
import { mediaQueue } from "../../workers/media.queue";
import { ALLOWED_MIME_TYPES } from "../../services/file-validator.service";
import { HttpError } from "../auth/auth.service";
import { FileInitInput, FileCompleteInput } from "./files.schemas";

const MULTIPART_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10 MB threshold for multipart upload
const MULTIPART_CHUNK_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB part size

export class FilesService {
  // Initiates direct client-to-R2 upload with size caps, quota verification, and SHA-256 deduplication
  async initUpload(userId: string, input: FileInitInput) {
    const mimeMeta = ALLOWED_MIME_TYPES[input.mimeType as keyof typeof ALLOWED_MIME_TYPES];
    if (!mimeMeta) {
      throw new HttpError(400, "Unsupported MIME type");
    }

    const { fileType } = mimeMeta;

    // 1. Enforce per-type size caps
    if (fileType === "image" && input.sizeBytes > env.IMAGE_MAX_SIZE_BYTES) {
      throw new HttpError(
        400,
        `Image size exceeds maximum limit of ${Math.round(env.IMAGE_MAX_SIZE_BYTES / (1024 * 1024))} MB`
      );
    }
    if (fileType === "pdf" && input.sizeBytes > env.PDF_MAX_SIZE_BYTES) {
      throw new HttpError(
        400,
        `PDF size exceeds maximum limit of ${Math.round(env.PDF_MAX_SIZE_BYTES / (1024 * 1024))} MB`
      );
    }
    if (fileType === "document" && input.sizeBytes > env.DOCUMENT_MAX_SIZE_BYTES) {
      throw new HttpError(
        400,
        `Document size exceeds maximum limit of ${Math.round(env.DOCUMENT_MAX_SIZE_BYTES / (1024 * 1024))} MB`
      );
    }
    if (fileType === "video" && input.sizeBytes > env.VIDEO_MAX_SIZE_BYTES) {
      throw new HttpError(
        400,
        `Video size exceeds maximum limit of ${Math.round(env.VIDEO_MAX_SIZE_BYTES / (1024 * 1024))} MB`
      );
    }

    // 2. Fetch or create user quota row and enforce total and daily bandwidth limits
    const now = new Date();
    const [existingQuota] = await db
      .select()
      .from(userStorageQuotas)
      .where(eq(userStorageQuotas.userId, userId))
      .limit(1);

    let quota = existingQuota;
    if (!quota) {
      const [newQuota] = await db
        .insert(userStorageQuotas)
        .values({
          userId,
          storageUsedBytes: 0,
          dailyUploadBytes: 0,
          dailyResetAt: now,
        })
        .returning();
      quota = newQuota;
    } else {
      // Check if daily window has passed (> 24 hours)
      const hoursSinceReset =
        (now.getTime() - new Date(quota.dailyResetAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceReset >= 24) {
        const [resetQuota] = await db
          .update(userStorageQuotas)
          .set({
            dailyUploadBytes: 0,
            dailyResetAt: now,
          })
          .where(eq(userStorageQuotas.userId, userId))
          .returning();
        quota = resetQuota;
      }
    }

    if (quota.storageUsedBytes + input.sizeBytes > env.USER_STORAGE_QUOTA_BYTES) {
      throw new HttpError(
        400,
        `Storage quota exceeded. Your current limit is ${Math.round(env.USER_STORAGE_QUOTA_BYTES / (1024 * 1024))} MB`
      );
    }

    if (quota.dailyUploadBytes + input.sizeBytes > env.USER_DAILY_UPLOAD_LIMIT_BYTES) {
      throw new HttpError(
        400,
        `Daily upload bandwidth exceeded. Limit is ${Math.round(env.USER_DAILY_UPLOAD_LIMIT_BYTES / (1024 * 1024))} MB per 24 hours`
      );
    }

    // 3. Owner-scoped deduplication: reuse ready file if user uploaded identical content before
    const normalizedHash = input.sha256Hash.toLowerCase();
    const [existingFile] = await db
      .select()
      .from(files)
      .where(
        and(
          eq(files.ownerId, userId),
          eq(files.sha256Hash, normalizedHash),
          eq(files.status, "ready")
        )
      )
      .limit(1);

    if (existingFile) {
      return {
        deduplicated: true,
        fileId: existingFile.id,
        status: existingFile.status,
        originalName: existingFile.originalName,
        sizeBytes: existingFile.sizeBytes,
        fileType: existingFile.fileType,
      };
    }

    // 4. Generate unique Cloudflare R2 storage key
    const sanitizedFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const r2Key = `uploads/${userId}/${crypto.randomUUID()}-${sanitizedFileName}`;

    // 5. Handle multipart vs single PUT upload
    if (input.sizeBytes > MULTIPART_THRESHOLD_BYTES) {
      const uploadId = await storageService.createMultipartUpload(r2Key, input.mimeType);
      const partCount = Math.ceil(input.sizeBytes / MULTIPART_CHUNK_SIZE_BYTES);
      const partUrls = await storageService.getPresignedPartUrls(r2Key, uploadId, partCount);

      const [newFile] = await db
        .insert(files)
        .values({
          ownerId: userId,
          fileType,
          mimeType: input.mimeType,
          originalName: input.fileName,
          sizeBytes: input.sizeBytes,
          sha256Hash: normalizedHash,
          status: "uploading",
          r2Key,
          uploadId,
          uploadPartsCount: partCount,
        })
        .returning();

      return {
        deduplicated: false,
        fileId: newFile.id,
        isMultipart: true,
        uploadId,
        parts: partUrls,
        status: "uploading",
      };
    } else {
      const uploadUrl = await storageService.getPresignedPutUrl(r2Key, input.mimeType);

      const [newFile] = await db
        .insert(files)
        .values({
          ownerId: userId,
          fileType,
          mimeType: input.mimeType,
          originalName: input.fileName,
          sizeBytes: input.sizeBytes,
          sha256Hash: normalizedHash,
          status: "uploading",
          r2Key,
        })
        .returning();

      return {
        deduplicated: false,
        fileId: newFile.id,
        isMultipart: false,
        uploadUrl,
        status: "uploading",
      };
    }
  }

  // Completes client upload, updates user storage quotas, and queues media for worker processing
  async completeUpload(userId: string, input: FileCompleteInput) {
    const [file] = await db
      .select()
      .from(files)
      .where(eq(files.id, input.fileId))
      .limit(1);

    if (!file) {
      throw new HttpError(404, "File not found");
    }

    if (file.ownerId !== userId) {
      throw new HttpError(403, "Access denied: you do not own this file");
    }

    if (file.status === "ready") {
      return { fileId: file.id, status: file.status };
    }

    if (file.status !== "uploading") {
      throw new HttpError(400, `Cannot complete upload: file is currently in '${file.status}' state`);
    }

    // Complete multipart upload in R2 if applicable
    if (file.uploadId) {
      if (!input.parts || input.parts.length === 0) {
        throw new HttpError(400, "Multipart upload completion requires uploaded parts list");
      }
      await storageService.completeMultipartUpload(file.r2Key, file.uploadId, input.parts);
    }

    // Update status to processing
    await db
      .update(files)
      .set({
        status: "processing",
        updatedAt: new Date(),
      })
      .where(eq(files.id, file.id));

    // Atomically increment user storage and daily bandwidth quotas
    await db
      .update(userStorageQuotas)
      .set({
        storageUsedBytes: sql`${userStorageQuotas.storageUsedBytes} + ${file.sizeBytes}`,
        dailyUploadBytes: sql`${userStorageQuotas.dailyUploadBytes} + ${file.sizeBytes}`,
      })
      .where(eq(userStorageQuotas.userId, userId));

    // Enqueue file for background antivirus scanning and processing
    await mediaQueue.add("process", { fileId: file.id });

    return {
      fileId: file.id,
      status: "processing",
    };
  }

  // Verifies user is file owner or participant in a chat containing this file
  async verifyFileAccess(userId: string, fileId: string) {
    const [file] = await db
      .select()
      .from(files)
      .where(eq(files.id, fileId))
      .limit(1);

    if (!file) {
      throw new HttpError(404, "File not found");
    }

    // Owner always has access
    if (file.ownerId === userId) {
      return file;
    }

    // Check if user is a member of any chat where a message references this file
    const [membership] = await db
      .select({ chatId: messages.chatId })
      .from(messages)
      .innerJoin(chatMembers, eq(messages.chatId, chatMembers.chatId))
      .where(and(eq(messages.fileId, fileId), eq(chatMembers.userId, userId)))
      .limit(1);

    if (!membership) {
      throw new HttpError(403, "Access denied: you are not authorized to access this file");
    }

    return file;
  }

  // Generates short-lived (~5 min) signed download URL with Content-Disposition: attachment
  async getDownloadUrl(userId: string, fileId: string) {
    const file = await this.verifyFileAccess(userId, fileId);

    if (file.status !== "ready") {
      throw new HttpError(400, `File is not ready for download (current status: ${file.status})`);
    }

    const downloadUrl = await storageService.getPresignedDownloadUrl(
      file.r2Key,
      file.originalName,
      file.mimeType,
      true,
      300
    );

    return {
      fileId: file.id,
      downloadUrl,
      fileName: file.originalName,
      fileType: file.fileType,
      sizeBytes: file.sizeBytes,
    };
  }

  // Generates short-lived signed preview URL (inline PDF or WebP or transcoded MP4)
  async getPreviewUrl(userId: string, fileId: string) {
    const file = await this.verifyFileAccess(userId, fileId);

    if (file.status !== "ready") {
      throw new HttpError(400, `File is not ready for preview (current status: ${file.status})`);
    }

    let targetKey = file.r2Key;
    let targetMime = file.mimeType;
    let previewName = file.originalName;

    if (file.fileType === "document" && file.previewPdfR2Key) {
      targetKey = file.previewPdfR2Key;
      targetMime = "application/pdf";
      previewName = `${file.originalName.replace(/\.[^.]+$/, "")}.pdf`;
    } else if (file.fileType === "video" && file.transcodedR2Key) {
      targetKey = file.transcodedR2Key;
      targetMime = "video/mp4";
      previewName = "video.mp4";
    }

    const previewUrl = await storageService.getPresignedDownloadUrl(
      targetKey,
      previewName,
      targetMime,
      false,
      300
    );

    return {
      fileId: file.id,
      previewUrl,
      fileType: file.fileType,
      mimeType: targetMime,
    };
  }

  // Generates short-lived signed thumbnail URL for quick chat display
  async getThumbnailUrl(userId: string, fileId: string) {
    const file = await this.verifyFileAccess(userId, fileId);

    if (file.status !== "ready") {
      throw new HttpError(400, `File is not ready (current status: ${file.status})`);
    }

    const thumbnailKey = file.thumbnailR2Key || file.r2Key;
    const thumbnailUrl = await storageService.getPresignedDownloadUrl(
      thumbnailKey,
      "thumbnail.webp",
      "image/webp",
      false,
      300
    );

    return {
      fileId: file.id,
      thumbnailUrl,
    };
  }

  // Returns current file metadata and processing state
  async getFileStatus(userId: string, fileId: string) {
    const file = await this.verifyFileAccess(userId, fileId);

    return {
      id: file.id,
      status: file.status,
      failureReason: file.failureReason,
      originalName: file.originalName,
      fileType: file.fileType,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      width: file.width,
      height: file.height,
      durationSeconds: file.durationSeconds,
      pageCount: file.pageCount,
      createdAt: file.createdAt,
    };
  }
}

export const filesService = new FilesService();

