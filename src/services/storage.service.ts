// src/services/storage.service.ts
// Cloudflare R2 object storage service handling presigned direct uploads, downloads, and worker I/O.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";

export interface PresignedPartUrl {
  partNumber: number;
  url: string;
}

export class StorageService {
  private s3: S3Client;
  private bucket: string;

  // In-memory mock storage map for isolated tests when dummy credentials are used
  private mockStore = new Map<string, { buffer: Buffer; contentType: string }>();

  constructor() {
    const endpoint =
      env.R2_ENDPOINT ||
      `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

    this.s3 = new S3Client({
      region: "auto",
      endpoint,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    });
    this.bucket = env.R2_BUCKET_NAME;
  }

  // Strictly isolates mock storage to NODE_ENV=test only; never triggered by dummy env values
  private isTestOrMock(): boolean {
    return env.NODE_ENV === "test";
  }

  // Generates a short-lived (~15 min) presigned URL for direct client-to-R2 single PUT upload
  async getPresignedPutUrl(
    key: string,
    mimeType: string,
    expiresIn = 900
  ): Promise<string> {
    if (this.isTestOrMock()) {
      return `https://mock-r2.local/${this.bucket}/${key}?mock-upload=true`;
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  // Initiates an S3 multipart upload for larger media/documents
  async createMultipartUpload(
    key: string,
    mimeType: string
  ): Promise<string> {
    if (this.isTestOrMock()) {
      return `mock-upload-id-${Date.now()}`;
    }

    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });
    const res = await this.s3.send(command);
    return res.UploadId!;
  }

  // Generates presigned URLs for each part in a multipart upload
  async getPresignedPartUrls(
    key: string,
    uploadId: string,
    partCount: number,
    expiresIn = 900
  ): Promise<PresignedPartUrl[]> {
    if (this.isTestOrMock()) {
      return Array.from({ length: partCount }, (_, i) => ({
        partNumber: i + 1,
        url: `https://mock-r2.local/${this.bucket}/${key}?uploadId=${uploadId}&partNumber=${i + 1}`,
      }));
    }

    const promises = Array.from({ length: partCount }, async (_, i) => {
      const partNumber = i + 1;
      const command = new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      });
      const url = await getSignedUrl(this.s3, command, { expiresIn });
      return { partNumber, url };
    });

    return Promise.all(promises);
  }

  // Finalizes multipart upload in R2
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>
  ): Promise<void> {
    if (this.isTestOrMock()) {
      return;
    }

    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({
          PartNumber: p.partNumber,
          ETag: p.etag,
        })),
      },
    });
    await this.s3.send(command);
  }

  // Aborts an in-progress multipart upload to free up allocated storage
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    if (this.isTestOrMock()) {
      return;
    }

    try {
      const command = new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      });
      await this.s3.send(command);
    } catch {
      // Ignore if upload already finished or aborted
    }
  }

  // Generates a ~5 minute signed GET URL with safe Content-Disposition headers
  async getPresignedDownloadUrl(
    key: string,
    originalName: string,
    mimeType: string,
    isAttachment = true,
    expiresIn = 300 // 5 minutes default
  ): Promise<string> {
    if (this.isTestOrMock()) {
      return `https://mock-r2.local/${this.bucket}/${key}?expiresIn=${expiresIn}&filename=${encodeURIComponent(originalName)}`;
    }

    const sanitizedName = originalName.replace(/["\r\n\\]/g, "_");
    const disposition = isAttachment
      ? `attachment; filename="${sanitizedName}"`
      : "inline";

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: disposition,
      ResponseContentType: mimeType,
    });

    return getSignedUrl(this.s3, command, { expiresIn });
  }

  // Uploads a processed buffer (e.g., thumbnail, transcoded MP4, preview PDF) directly to R2
  async putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
    if (this.isTestOrMock()) {
      this.mockStore.set(key, { buffer, contentType });
      return;
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });
    await this.s3.send(command);
  }

  // Downloads an object buffer from R2 for worker inspection and processing
  async getObject(key: string): Promise<Buffer> {
    if (this.isTestOrMock()) {
      const item = this.mockStore.get(key);
      if (item) return item.buffer;
      return Buffer.from("mock-object-content");
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const res = await this.s3.send(command);
    const byteArray = await res.Body!.transformToByteArray();
    return Buffer.from(byteArray);
  }

  // Deletes an object from R2 (e.g. on virus detection or orphan cleanup)
  async deleteObject(key: string): Promise<void> {
    if (this.isTestOrMock()) {
      this.mockStore.delete(key);
      return;
    }

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.s3.send(command);
  }
}

export const storageService = new StorageService();
