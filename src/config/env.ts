// src/config/env.ts
// Loads environment variables from .env (or .env.test) and validates them at startup using Zod.

import dotenv from "dotenv";
import { z } from "zod";

// Load test environment file if NODE_ENV is set to test, otherwise load standard .env
if (process.env.NODE_ENV === "test") {
  dotenv.config({ path: ".env.test" });
} else {
  dotenv.config();
}

// Schema defining the required environment configuration
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL connection URL"),
  TEST_DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters long"),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((val) =>
      val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  // Redis configuration for BullMQ background workers and caching
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  // ClamAV antivirus daemon configuration
  CLAMAV_HOST: z.string().default("127.0.0.1"),
  CLAMAV_PORT: z.coerce.number().default(3310),
  // Cloudflare R2 object storage credentials (S3 API compatible)
  R2_ACCOUNT_ID: z.string().default("local-test-account"),
  R2_ACCESS_KEY_ID: z.string().default("local-test-key"),
  R2_SECRET_ACCESS_KEY: z.string().default("local-test-secret"),
  R2_BUCKET_NAME: z.string().default("messenger-media"),
  R2_PUBLIC_DOMAIN: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  // Phase 5 media size, duration, and conversion limits
  VIDEO_MAX_DURATION_SECONDS: z.coerce.number().default(600), // Max 10 minutes
  DOCUMENT_MAX_SIZE_BYTES: z.coerce.number().default(50 * 1024 * 1024), // 50 MB
  VIDEO_MAX_SIZE_BYTES: z.coerce.number().default(200 * 1024 * 1024), // 200 MB
  IMAGE_MAX_SIZE_BYTES: z.coerce.number().default(20 * 1024 * 1024), // 20 MB
  PDF_MAX_SIZE_BYTES: z.coerce.number().default(50 * 1024 * 1024), // 50 MB
  USER_STORAGE_QUOTA_BYTES: z.coerce.number().default(1024 * 1024 * 1024), // 1 GB per user
  USER_DAILY_UPLOAD_LIMIT_BYTES: z.coerce.number().default(500 * 1024 * 1024), // 500 MB per day
  LIBREOFFICE_TIMEOUT_MS: z.coerce.number().default(120000), // 120 seconds conversion timeout
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  // Phase 6 group chat & search configuration
  MAX_GROUP_MEMBERS: z.coerce.number().default(256),
  SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().default(30),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
export type Env = z.infer<typeof envSchema>;
