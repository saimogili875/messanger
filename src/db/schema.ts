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
} from "drizzle-orm/pg-core";

// Enum representing the type of chat (direct 1-on-1 or group chat)
export const chatTypeEnum = pgEnum("chat_type", ["direct", "group"]);

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
  // Monotonically increasing sequence number assigned atomically per chat in Postgres
  lastSeq: bigint("last_seq", { mode: "number" }).default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
    lastDeliveredSeq: bigint("last_delivered_seq", { mode: "number" }).default(0).notNull(),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).default(0).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.userId] }),
  ]
);

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
    body: text("body").notNull(),
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
