// src/db/index.ts
// Initializes and exports the PostgreSQL database client and Drizzle ORM instance.

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { env } from "../config/env";

// Connection pool configured via environment connection string
export const client = postgres(env.DATABASE_URL);

// Drizzle ORM database instance with registered schema
export const db = drizzle(client, { schema });
