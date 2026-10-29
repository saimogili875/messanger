import dotenv from "dotenv";
dotenv.config();

import postgres from "postgres";

async function listTables() {
  const connectionString =
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("No database URL found in environment.");
    process.exit(1);
  }

  const sql = postgres(connectionString, {
    prepare: !connectionString.includes("-pooler"),
  });

  try {
    const rows = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;

    console.log("Tables in public schema:");
    for (const row of rows) {
      console.log(`- ${row.table_name}`);
    }
  } catch (err) {
    console.error("Failed to query database:", err.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

listTables();
