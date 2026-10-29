// drizzle.config.ts
// Configuration for drizzle-kit migrations and schema introspection.

import dotenv from "dotenv";
dotenv.config();

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Direct/unpooled connection required for DDL migrations on Neon
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "",
  },
  verbose: true,
  strict: true,
});

