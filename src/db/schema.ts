// src/db/schema.ts
// Defines PostgreSQL database tables, relationships, and enums using Drizzle ORM.

import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  pgEnum,
  primaryKey,
  index,
  unique,
  bigint,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";

// Enum representing the type of chat (direct 1-on-1 or group chat)
export const chatTypeEnum = pgEnum("chat_type", ["direct", "group"]);

// Enums for Phase 6 group chat roles and message types
export const chatRoleEnum = pgEnum("chat_role", ["owner", "admin", "member"]);
export const messageTypeEnum = pgEnum("message_type", ["user", "system"]);

// Enums for Phase 4 & Phase 5 media files
export const fileTypeEnum = pgEnum("file_type", ["image", "pdf", "document", "video"]);
export const fileStatusEnum = pgEnum("file_status", [
  "uploading",
  "processing",
  "ready",
  "blocked",
  "failed",
]);

// Users table storing credentials and profile info
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: varchar("display_name", { length: 50 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Devices table tracking active client devices for a user
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceName: varchar("device_name", { length: 100 }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Chats table storing direct or group conversations with monotonic sequence counter
export const chats = pgTable("chats", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: chatTypeEnum("type").notNull(),
  // directKey stores sorted "userIdA:userIdB" for 1-to-1 chats to prevent duplicate chat creation
  directKey: varchar("direct_key", { length: 100 }).unique(),
  name: varchar("name", { length: 100 }), // null for direct chats
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  // Monotonically increasing sequence number assigned atomically per chat in Postgres
  lastSeq: bigint("last_seq", { mode: "number" }).default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Chat members mapping users to chats with delivery and read receipt progress cursors
export const chatMembers = pgTable(
  "chat_members",
  {
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: chatRoleEnum("role").default("member").notNull(),
    firstVisibleSeq: bigint("first_visible_seq", { mode: "number" }).default(0).notNull(),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    lastDeliveredSeq: bigint("last_delivered_seq", { mode: "number" }).default(0).notNull(),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).default(0).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.userId] }),
    index("chat_members_user_id_idx").on(table.userId),
  ]
);

// Files table storing media metadata, Cloudflare R2 keys, and processing status
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileType: fileTypeEnum("file_type").notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    originalName: text("original_name").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256Hash: text("sha256_hash").notNull(),
    status: fileStatusEnum("status").default("uploading").notNull(),
    failureReason: text("failure_reason"),
    r2Key: text("r2_key").unique().notNull(),
    thumbnailR2Key: text("thumbnail_r2_key"),
    mediumR2Key: text("medium_r2_key"),
    previewPdfR2Key: text("preview_pdf_r2_key"),
    transcodedR2Key: text("transcoded_r2_key"),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    pageCount: integer("page_count"),
    uploadId: text("upload_id"),
    uploadPartsCount: integer("upload_parts_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Owner-scoped deduplication index
    index("files_owner_sha256_idx").on(table.ownerId, table.sha256Hash),
    // Cleanup index for stuck/orphan uploads
    index("files_status_created_idx").on(table.status, table.createdAt),
  ]
);

// User storage quotas table enforcing total and daily upload bandwidth caps
export const userStorageQuotas = pgTable("user_storage_quotas", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  storageUsedBytes: bigint("storage_used_bytes", { mode: "number" }).default(0).notNull(),
  dailyUploadBytes: bigint("daily_upload_bytes", { mode: "number" }).default(0).notNull(),
  dailyResetAt: timestamp("daily_reset_at", { withTimezone: true }).defaultNow().notNull(),
});

// Messages table storing chat messages ordered by per-chat sequence number
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientMsgId: uuid("client_msg_id").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    // In Phase 8 this becomes ciphertext, so search must be swappable.
    // Note: search_vector tsvector is generated stored and managed via custom SQL migration
    body: text("body").notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    messageType: varchar("message_type", { length: 20 }).default("text").notNull(),
    type: messageTypeEnum("type").default("user").notNull(),
    meta: jsonb("meta"), // only for system messages
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Ensure strict monotonicity and gap-free sequencing per chat
    unique("messages_chat_id_seq_unique").on(table.chatId, table.seq),
    // Enforce idempotency: same client message ID from sender cannot be inserted twice
    unique("messages_chat_id_sender_client_msg_unique").on(
      table.chatId,
      table.senderId,
      table.clientMsgId
    ),
    // B-tree index for fast range scans when clients sync messages afterSeq
    index("messages_chat_id_seq_idx").on(table.chatId, table.seq),
  ]
);

// Message reactions table mapping emojis to messages by user
export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: varchar("emoji", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
    index("message_reactions_message_id_idx").on(t.messageId),
  ]
);

// Sessions table storing active user sessions, device binding, and refresh token hashes
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .references(() => devices.id, { onDelete: "set null" }),
    refreshTokenHash: text("refresh_token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
  ]
);

// Inferred TypeScript types for selecting and inserting rows
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;

export type ChatMember = typeof chatMembers.$inferSelect;
export type NewChatMember = typeof chatMembers.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;

export type UserStorageQuota = typeof userStorageQuotas.$inferSelect;
export type NewUserStorageQuota = typeof userStorageQuotas.$inferInsert;

export type MessageReaction = typeof messageReactions.$inferSelect;
export type NewMessageReaction = typeof messageReactions.$inferInsert;
export type ChatRole = "owner" | "admin" | "member";
