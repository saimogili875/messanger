// src/shared/protocol.ts
// WebSocket event contract and Zod validation schemas shared between server and web client.

import { z } from "zod";

// Event name constants for type-safe socket emit and listen handlers
export const SOCKET_EVENTS = {
  MESSAGE_SEND: "message:send",
  MESSAGE_ACK: "message:ack",
  MESSAGE_NEW: "message:new",
  RECEIPT_DELIVERED: "receipt:delivered",
  RECEIPT_READ: "receipt:read",
  RECEIPT_UPDATE: "receipt:update",
  TYPING_START: "typing:start",
  TYPING_STOP: "typing:stop",
  TYPING_UPDATE: "typing:update",
  PRESENCE_UPDATE: "presence:update",
  SYNC_REQUEST: "sync:request",
  SYNC_RESPONSE: "sync:response",
  FILE_UPDATE: "file:update",
  GROUP_UPDATED: "group:updated",
  GROUP_MEMBER_ADDED: "group:member_added",
  GROUP_MEMBER_REMOVED: "group:member_removed",
  GROUP_ROLE_CHANGED: "group:role_changed",
  GROUP_DELETED: "group:deleted",
  CHAT_ADDED: "chat:added",
  CHAT_REMOVED: "chat:removed",
  REACTION_ADD: "reaction:add",
  REACTION_REMOVE: "reaction:remove",
  REACTION_UPDATE: "reaction:update",
  ERROR: "error",
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

// 1. message:send (client -> server)
export const messageSendSchema = z
  .object({
    chatId: z.string().uuid("Invalid chat ID"),
    clientMsgId: z.string().uuid("Invalid client message ID"),
    body: z
      .string()
      .trim()
      .max(4000, "Message cannot exceed 4000 characters")
      .default(""),
    fileId: z.string().uuid().optional(),
    messageType: z.enum(["text", "image", "pdf", "document", "video"]).default("text"),
  })
  .refine((data) => data.body.length > 0 || !!data.fileId, {
    message: "Message must contain either text content or a file attachment",
    path: ["body"],
  });
export type MessageSendPayload = z.infer<typeof messageSendSchema>;

// 2. message:ack (server -> client acknowledgement callback)
export const messageAckSuccessSchema = z.object({
  clientMsgId: z.string().uuid(),
  chatId: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  serverTime: z.string(),
});
export const messageAckErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});
export const messageAckSchema = z.union([
  messageAckSuccessSchema,
  messageAckErrorSchema,
]);
export type MessageAckSuccess = z.infer<typeof messageAckSuccessSchema>;
export type MessageAckError = z.infer<typeof messageAckErrorSchema>;
export type MessageAckPayload = z.infer<typeof messageAckSchema>;

// 3. message:new (server -> client broadcast)
export const messageNewSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string().uuid(),
  senderId: z.string().uuid(),
  clientMsgId: z.string().uuid(),
  seq: z.number().int().positive(),
  body: z.string(),
  fileId: z.string().uuid().nullable().optional(),
  messageType: z.string().optional(),
  type: z.enum(["user", "system"]).optional().default("user"),
  meta: z.unknown().optional(),
  senderName: z.string().optional(),
  file: z
    .object({
      id: z.string().uuid(),
      originalName: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      fileType: z.string(),
      width: z.number().nullable().optional(),
      height: z.number().nullable().optional(),
      durationSeconds: z.number().nullable().optional(),
      pageCount: z.number().nullable().optional(),
      status: z.string().optional(),
    })
    .optional(),
  createdAt: z.string(),
});
export type MessageNewPayload = z.infer<typeof messageNewSchema>;

// 4. receipt:delivered (client -> server)
export const receiptDeliveredSchema = z.object({
  chatId: z.string().uuid("Invalid chat ID"),
  upToSeq: z.number().int().nonnegative("Sequence number must be non-negative"),
});
export type ReceiptDeliveredPayload = z.infer<typeof receiptDeliveredSchema>;

// 5. receipt:read (client -> server)
export const receiptReadSchema = z.object({
  chatId: z.string().uuid("Invalid chat ID"),
  upToSeq: z.number().int().nonnegative("Sequence number must be non-negative"),
});
export type ReceiptReadPayload = z.infer<typeof receiptReadSchema>;

// 6. receipt:update (server -> client broadcast)
export const receiptUpdateSchema = z.object({
  chatId: z.string().uuid(),
  userId: z.string().uuid(),
  lastDeliveredSeq: z.number().int().nonnegative(),
  lastReadSeq: z.number().int().nonnegative(),
});
export type ReceiptUpdatePayload = z.infer<typeof receiptUpdateSchema>;

// 7. typing:start (client -> server)
export const typingStartSchema = z.object({
  chatId: z.string().uuid("Invalid chat ID"),
});
export type TypingStartPayload = z.infer<typeof typingStartSchema>;

// 8. typing:stop (client -> server)
export const typingStopSchema = z.object({
  chatId: z.string().uuid("Invalid chat ID"),
});
export type TypingStopPayload = z.infer<typeof typingStopSchema>;

// 9. typing:update (server -> client broadcast)
export const typingUpdateSchema = z.object({
  chatId: z.string().uuid(),
  userId: z.string().uuid(),
  isTyping: z.boolean(),
});
export type TypingUpdatePayload = z.infer<typeof typingUpdateSchema>;

// 10. presence:update (server -> client broadcast)
export const presenceUpdateSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(["online", "offline"]),
  lastSeenAt: z.string().optional(),
});
export type PresenceUpdatePayload = z.infer<typeof presenceUpdateSchema>;

// 11. sync:request (client -> server)
export const syncRequestSchema = z.object({
  chats: z.array(
    z.object({
      chatId: z.string().uuid("Invalid chat ID"),
      lastSeq: z.number().int().nonnegative("Sequence number must be non-negative"),
    })
  ),
});
export type SyncRequestPayload = z.infer<typeof syncRequestSchema>;

// 12. sync:response (server -> client)
export const syncChatResponseSchema = z.object({
  chatId: z.string().uuid(),
  messages: z.array(messageNewSchema),
  hasMore: z.boolean(),
  lastDeliveredSeq: z.number().int().nonnegative(),
  lastReadSeq: z.number().int().nonnegative(),
  lastSeq: z.number().int().nonnegative(),
});
export const syncResponseSchema = z.object({
  chats: z.array(syncChatResponseSchema),
});
export type SyncChatResponse = z.infer<typeof syncChatResponseSchema>;
export type SyncResponsePayload = z.infer<typeof syncResponseSchema>;

// 13. file:update (server -> client broadcast)
export const fileUpdateSchema = z.object({
  fileId: z.string().uuid(),
  status: z.enum(["uploading", "processing", "ready", "blocked", "failed"]),
  failureReason: z.string().optional(),
});
export type FileUpdatePayload = z.infer<typeof fileUpdateSchema>;

// 14. Reactions
export const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
export type AllowedEmoji = (typeof ALLOWED_REACTIONS)[number];

export const reactionSchema = z.object({
  chatId: z.string().uuid("Invalid chat ID"),
  messageId: z.string().uuid("Invalid message ID"),
  emoji: z.enum(ALLOWED_REACTIONS, {
    errorMap: () => ({ message: "Emoji must be one of 👍, ❤️, 😂, 😮, 😢, 🙏" }),
  }),
});
export type ReactionPayload = z.infer<typeof reactionSchema>;

export const reactionUpdateSchema = z.object({
  chatId: z.string().uuid(),
  messageId: z.string().uuid(),
  emoji: z.string(),
  userId: z.string().uuid(),
  action: z.enum(["added", "removed"]),
  count: z.number().int().nonnegative(),
});
export type ReactionUpdatePayload = z.infer<typeof reactionUpdateSchema>;

// 15. Group Realtime Events
export const groupUpdatedSchema = z.object({
  chatId: z.string().uuid(),
  name: z.string(),
});
export type GroupUpdatedPayload = z.infer<typeof groupUpdatedSchema>;

export const groupMemberAddedSchema = z.object({
  chatId: z.string().uuid(),
  members: z.array(
    z.object({
      userId: z.string().uuid(),
      displayName: z.string(),
      role: z.enum(["owner", "admin", "member"]),
    })
  ),
});
export type GroupMemberAddedPayload = z.infer<typeof groupMemberAddedSchema>;

export const groupMemberRemovedSchema = z.object({
  chatId: z.string().uuid(),
  userId: z.string().uuid(),
  reason: z.enum(["removed", "left"]),
});
export type GroupMemberRemovedPayload = z.infer<typeof groupMemberRemovedSchema>;

export const groupRoleChangedSchema = z.object({
  chatId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["owner", "admin", "member"]),
});
export type GroupRoleChangedPayload = z.infer<typeof groupRoleChangedSchema>;

export const groupDeletedSchema = z.object({
  chatId: z.string().uuid(),
});
export type GroupDeletedPayload = z.infer<typeof groupDeletedSchema>;

export const chatRoomEventSchema = z.object({
  chatId: z.string().uuid(),
});
export type ChatRoomEventPayload = z.infer<typeof chatRoomEventSchema>;

// 16. error (server -> client)
export const errorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ErrorPayload = z.infer<typeof errorPayloadSchema>;
