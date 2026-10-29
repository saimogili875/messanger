CREATE TABLE IF NOT EXISTS "used_refresh_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "used_refresh_tokens_session_id_idx" ON "used_refresh_tokens" ("session_id");

