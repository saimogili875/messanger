DROP INDEX "messages_chat_id_created_at_idx";--> statement-breakpoint
ALTER TABLE "chat_members" ADD COLUMN "last_delivered_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_members" ADD COLUMN "last_read_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "direct_key" varchar(100);--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "last_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "client_msg_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "seq" bigint NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_chat_id_seq_idx" ON "messages" USING btree ("chat_id","seq");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_direct_key_unique" UNIQUE("direct_key");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_seq_unique" UNIQUE("chat_id","seq");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_sender_client_msg_unique" UNIQUE("chat_id","sender_id","client_msg_id");