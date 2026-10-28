CREATE TYPE "public"."file_type" AS ENUM('image', 'pdf', 'document', 'video');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('uploading', 'processing', 'ready', 'blocked', 'failed');--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"file_type" "file_type" NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"original_name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256_hash" text NOT NULL,
	"status" "file_status" DEFAULT 'uploading' NOT NULL,
	"failure_reason" text,
	"r2_key" text NOT NULL,
	"thumbnail_r2_key" text,
	"medium_r2_key" text,
	"preview_pdf_r2_key" text,
	"transcoded_r2_key" text,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"page_count" integer,
	"upload_id" text,
	"upload_parts_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_r2_key_unique" UNIQUE("r2_key")
);
--> statement-breakpoint
CREATE TABLE "user_storage_quotas" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"storage_used_bytes" bigint DEFAULT 0 NOT NULL,
	"daily_upload_bytes" bigint DEFAULT 0 NOT NULL,
	"daily_reset_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "message_type" varchar(20) DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_storage_quotas" ADD CONSTRAINT "user_storage_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_owner_sha256_idx" ON "files" USING btree ("owner_id","sha256_hash");--> statement-breakpoint
CREATE INDEX "files_status_created_idx" ON "files" USING btree ("status","created_at");
