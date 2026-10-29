// src/db/index.ts
// Initializes and exports the PostgreSQL database client and Drizzle ORM instance.

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { env } from "../config/env";

const connectionString =
  env.NODE_ENV === "test" && env.TEST_DATABASE_URL
    ? env.TEST_DATABASE_URL
    : env.DATABASE_URL;

// Disable prepared statements when connecting through Neon PgBouncer transaction pooler
const isPooled = connectionString.includes("-pooler");

// Connection pool configured via environment connection string
export const client = postgres(connectionString, {
  prepare: !isPooled,
});

// Drizzle ORM database instance with registered schema
export const db = drizzle(client, { schema });
