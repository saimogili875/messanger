-- Phase 6: Group chat roles, system messages, and message reactions
DO $$ BEGIN
 CREATE TYPE "chat_role" AS ENUM('owner', 'admin', 'member');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "message_type" AS ENUM('user', 'system');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "name" varchar(100);
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id") ON DELETE set null;
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "chat_members" ADD COLUMN IF NOT EXISTS "role" "chat_role" DEFAULT 'member' NOT NULL;
ALTER TABLE "chat_members" ADD COLUMN IF NOT EXISTS "first_visible_seq" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "chat_members" ADD COLUMN IF NOT EXISTS "added_by" uuid REFERENCES "users"("id") ON DELETE set null;
CREATE INDEX IF NOT EXISTS "chat_members_user_id_idx" ON "chat_members" ("user_id");

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "type" "message_type" DEFAULT 'user' NOT NULL;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "meta" jsonb;

CREATE TABLE IF NOT EXISTS "message_reactions" (
  "message_id" uuid NOT NULL REFERENCES "messages"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "emoji" varchar(16) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);

CREATE INDEX IF NOT EXISTS "message_reactions_message_id_idx" ON "message_reactions" ("message_id");

