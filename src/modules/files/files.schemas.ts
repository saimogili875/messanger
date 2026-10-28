// src/modules/files/files.schemas.ts
// Request validation schemas for file upload initialization, completion, and media queries.

import { z } from "zod";
import { ALLOWED_MIME_TYPES } from "../../services/file-validator.service";

const allowedMimeKeys = Object.keys(ALLOWED_MIME_TYPES) as [string, ...string[]];

export const fileInitSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1, "File name is required")
    .max(255, "File name must not exceed 255 characters"),
  mimeType: z.enum(allowedMimeKeys, {
    errorMap: () => ({
      message:
        "Unsupported MIME type. Allowed types: JPEG, PNG, WebP, GIF, PDF, DOCX, XLSX, PPTX, MP4, MOV, WebM",
    }),
  }),
  sizeBytes: z
    .number()
    .int("File size must be an integer")
    .positive("File size must be greater than 0"),
  sha256Hash: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{64}$/, "SHA-256 hash must be a 64-character hex string"),
});

export type FileInitInput = z.infer<typeof fileInitSchema>;

export const fileCompleteSchema = z.object({
  fileId: z.string().uuid("Invalid file ID"),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        etag: z.string().min(1),
      })
    )
    .optional(),
});

export type FileCompleteInput = z.infer<typeof fileCompleteSchema>;

export const fileIdParamSchema = z.object({
  fileId: z.string().uuid("Invalid file ID"),
});

export type FileIdParam = z.infer<typeof fileIdParamSchema>;

