// src/realtime/socket.ts
// Realtime WebSocket server using Socket.IO with hybrid JWT/session auth, room management, and message/reaction routing.

import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import {
  sessions,
  chatMembers,
  messages,
  messageReactions,
  users,
} from "../db/schema";
import { env } from "../config/env";
import {
  messageSendSchema,
  reactionSchema,
  receiptDeliveredSchema,
  receiptReadSchema,
  syncRequestSchema,
} from "../shared/protocol";
import { requirePermission, requireMember } from "../modules/group/group.permissions";
import { allocateChatSeq } from "../modules/group/group.service";
import { getVisibleMessages } from "../modules/chat/chat.service";

export interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    sessionId: string;
  };
}

export class RealtimeManager {
  public io: SocketIOServer;
  private receiptCoalesceMap = new Map<
    string,
    { chatId: string; userId: string; lastDeliveredSeq?: number; lastReadSeq?: number; timer?: NodeJS.Timeout }
  >();

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: (origin, cb) => {
          if (!origin || env.CORS_ORIGINS.length === 0 || env.CORS_ORIGINS.includes(origin)) {
            return cb(null, true);
          }
          cb(new Error("CORS rejection"));
        },
        credentials: true,
      },
    });

    this.setupAuthMiddleware();
    this.setupConnectionHandlers();
  }

  // Socket authentication middleware: verifies JWT access token and active database session
  private setupAuthMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const authHeader = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
        if (!authHeader) {
          return next(new Error("Unauthorized: missing token"));
        }

        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        const payload = jwt.verify(token, env.JWT_SECRET) as { sub?: string; sid?: string };

        if (!payload.sub || !payload.sid) {
          return next(new Error("Unauthorized: invalid token payload"));
        }

        // Confirm session in PostgreSQL
        const [session] = await db
          .select({
            id: sessions.id,
            userId: sessions.userId,
            revokedAt: sessions.revokedAt,
            expiresAt: sessions.expiresAt,
          })
          .from(sessions)
          .where(eq(sessions.id, payload.sid))
          .limit(1);

        if (
          !session ||
          session.userId !== payload.sub ||
          session.revokedAt !== null ||
          session.expiresAt <= new Date()
        ) {
          return next(new Error("Unauthorized: session invalid or revoked"));
        }

        socket.data.userId = payload.sub;
        socket.data.sessionId = payload.sid;
        next();
      } catch (err: unknown) {
        next(new Error("Unauthorized: authentication failed"));
      }
    });
  }

  // Socket connection and room joining lifecycle
  private setupConnectionHandlers() {
    this.io.on("connection", (rawSocket) => {
      const socket = rawSocket as AuthenticatedSocket;
      const userId = socket.data.userId;

      // Join individual user room for private notifications (e.g. chat:added, chat:removed)
      socket.join(`user:${userId}`);

      // Auto-join all chat rooms user is currently an active member of (asynchronously without blocking listener registration)
      db.select({ chatId: chatMembers.chatId })
        .from(chatMembers)
        .where(eq(chatMembers.userId, userId))
        .then((memberships) => {
          memberships.forEach((m) => socket.join(`chat:${m.chatId}`));
        })
        .catch((err) => {
          console.error(`[Socket] Failed to join initial chat rooms for user ${userId}:`, err);
        });

      // 1. message:send handler
      socket.on("message:send", async (data, ack) => {
        try {
          const parsed = messageSendSchema.parse(data);
          const { chatId, clientMsgId, body, fileId, messageType } = parsed;

          // Check sender membership and message permissions
          const { member } = await requirePermission(chatId, userId, "message:send");

          // Atomically increment chat sequence counter in Postgres
          const seq = await allocateChatSeq(chatId);

          const [senderUser] = await db
            .select({ displayName: users.displayName })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          const [newMsg] = await db
            .insert(messages)
            .values({
              chatId,
              senderId: userId,
              clientMsgId,
              seq,
              body,
              fileId: fileId || null,
              messageType,
              type: "user",
            })
            .returning();

          const serverTime = newMsg.createdAt.toISOString();

          // Acknowledge back to sender
          if (typeof ack === "function") {
            ack({
              clientMsgId,
              chatId,
              seq,
              serverTime,
            });
          }

          // Broadcast message:new to all sockets in the chat room
          this.io.to(`chat:${chatId}`).emit("message:new", {
            id: newMsg.id,
            chatId: newMsg.chatId,
            senderId: newMsg.senderId,
            senderName: senderUser?.displayName || "User",
            clientMsgId: newMsg.clientMsgId,
            seq: newMsg.seq,
            body: newMsg.body,
            fileId: newMsg.fileId,
            messageType: newMsg.messageType,
            type: newMsg.type,
            createdAt: serverTime,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Failed to send message";
          if (typeof ack === "function") {
            ack({ error: message });
          }
        }
      });

      // 2. reaction:add handler
      socket.on("reaction:add", async (data, ack) => {
        try {
          const parsed = reactionSchema.parse(data);
          const { chatId, messageId, emoji } = parsed;

          const { member } = await requirePermission(chatId, userId, "message:react");

          // Message must belong to this chat and be >= member's firstVisibleSeq
          const [targetMsg] = await db
            .select({ id: messages.id, seq: messages.seq })
            .from(messages)
            .where(and(eq(messages.id, messageId), eq(messages.chatId, chatId)))
            .limit(1);

          if (!targetMsg || targetMsg.seq < member.firstVisibleSeq) {
            if (typeof ack === "function") {
              ack({ error: "Message not found" });
            }
            return;
          }

          // Insert reaction idempotently
          const inserted = await db
            .insert(messageReactions)
            .values({
              messageId,
              userId,
              emoji,
            })
            .onConflictDoNothing()
            .returning();

          if (inserted.length === 0) {
            // Already reacted: ack ok but do not broadcast duplicate event
            if (typeof ack === "function") ack({ success: true });
            return;
          }

          // Count total reactions for this emoji on the message
          const [countRes] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(messageReactions)
            .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.emoji, emoji)));

          const count = countRes?.count || 1;

          if (typeof ack === "function") ack({ success: true, count });

          this.io.to(`chat:${chatId}`).emit("reaction:update", {
            chatId,
            messageId,
            emoji,
            userId,
            action: "added",
            count,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Failed to add reaction";
          if (typeof ack === "function") ack({ error: message });
        }
      });

      // 3. reaction:remove handler
      socket.on("reaction:remove", async (data, ack) => {
        try {
          const parsed = reactionSchema.parse(data);
          const { chatId, messageId, emoji } = parsed;

          await requirePermission(chatId, userId, "message:react");

          const deleted = await db
            .delete(messageReactions)
            .where(
              and(
                eq(messageReactions.messageId, messageId),
                eq(messageReactions.userId, userId),
                eq(messageReactions.emoji, emoji)
              )
            )
            .returning();

          if (deleted.length === 0) {
            if (typeof ack === "function") ack({ success: true });
            return;
          }

          const [countRes] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(messageReactions)
            .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.emoji, emoji)));

          const count = countRes?.count || 0;

          if (typeof ack === "function") ack({ success: true, count });

          this.io.to(`chat:${chatId}`).emit("reaction:update", {
            chatId,
            messageId,
            emoji,
            userId,
            action: "removed",
            count,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Failed to remove reaction";
          if (typeof ack === "function") ack({ error: message });
        }
      });

      // 4. receipt:delivered handler (coalesced 300ms)
      socket.on("receipt:delivered", async (data) => {
        try {
          const { chatId, upToSeq } = receiptDeliveredSchema.parse(data);

          await db
            .update(chatMembers)
            .set({
              lastDeliveredSeq: sql`GREATEST(${chatMembers.lastDeliveredSeq}, ${upToSeq})`,
            })
            .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)));

          this.scheduleReceiptBroadcast(chatId, userId, { lastDeliveredSeq: upToSeq });
        } catch (err) {
          // Ignore receipt processing errors
        }
      });

      // 5. receipt:read handler (coalesced 300ms)
      socket.on("receipt:read", async (data) => {
        try {
          const { chatId, upToSeq } = receiptReadSchema.parse(data);

          await db
            .update(chatMembers)
            .set({
              lastReadSeq: sql`GREATEST(${chatMembers.lastReadSeq}, ${upToSeq})`,
              lastDeliveredSeq: sql`GREATEST(${chatMembers.lastDeliveredSeq}, ${upToSeq})`,
            })
            .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)));

          this.scheduleReceiptBroadcast(chatId, userId, { lastReadSeq: upToSeq, lastDeliveredSeq: upToSeq });
        } catch (err) {
          // Ignore receipt processing errors
        }
      });

      // 6. sync:request handler
      socket.on("sync:request", async (data, ack) => {
        try {
          const { chats: requestedChats } = syncRequestSchema.parse(data);

          const chatResponses = await Promise.all(
            requestedChats.map(async (rc) => {
              const messagesList = await getVisibleMessages(rc.chatId, userId, rc.lastSeq, 100);

              const [member] = await db
                .select({
                  lastDeliveredSeq: chatMembers.lastDeliveredSeq,
                  lastReadSeq: chatMembers.lastReadSeq,
                })
                .from(chatMembers)
                .where(and(eq(chatMembers.chatId, rc.chatId), eq(chatMembers.userId, userId)))
                .limit(1);

              return {
                chatId: rc.chatId,
                messages: messagesList.map((m) => ({
                  id: m.id,
                  chatId: m.chatId,
                  senderId: m.senderId,
                  senderName: m.senderName,
                  clientMsgId: m.clientMsgId,
                  seq: m.seq,
                  body: m.body,
                  fileId: m.fileId,
                  messageType: m.messageType,
                  type: m.type,
                  meta: m.meta,
                  createdAt: m.createdAt.toISOString(),
                })),
                hasMore: messagesList.length >= 100,
                lastDeliveredSeq: member?.lastDeliveredSeq || 0,
                lastReadSeq: member?.lastReadSeq || 0,
                lastSeq: messagesList.length > 0 ? messagesList[messagesList.length - 1].seq : rc.lastSeq,
              };
            })
          );

          if (typeof ack === "function") {
            ack({ chats: chatResponses });
          }
        } catch (err: unknown) {
          if (typeof ack === "function") {
            ack({ error: err instanceof Error ? err.message : "Sync failed" });
          }
        }
      });
    });
  }

  // Coalesces rapid receipt cursor updates per user/chat within 300 ms window
  private scheduleReceiptBroadcast(
    chatId: string,
    userId: string,
    update: { lastDeliveredSeq?: number; lastReadSeq?: number }
  ) {
    const key = `${chatId}:${userId}`;
    const existing = this.receiptCoalesceMap.get(key) || { chatId, userId };

    if (update.lastDeliveredSeq !== undefined) {
      existing.lastDeliveredSeq = Math.max(existing.lastDeliveredSeq || 0, update.lastDeliveredSeq);
    }
    if (update.lastReadSeq !== undefined) {
      existing.lastReadSeq = Math.max(existing.lastReadSeq || 0, update.lastReadSeq);
    }

    if (existing.timer) {
      clearTimeout(existing.timer);
    }

    existing.timer = setTimeout(() => {
      this.receiptCoalesceMap.delete(key);
      this.io.to(`chat:${chatId}`).emit("receipt:update", {
        chatId,
        userId,
        lastDeliveredSeq: existing.lastDeliveredSeq || 0,
        lastReadSeq: existing.lastReadSeq || 0,
      });
    }, 300);

    this.receiptCoalesceMap.set(key, existing);
  }

  // Makes all sockets belonging to a user join a specific chat room
  public joinChatRoom(userId: string, chatId: string) {
    this.io.in(`user:${userId}`).socketsJoin(`chat:${chatId}`);
  }

  // Removes all sockets belonging to a user from a chat room
  public leaveChatRoom(userId: string, chatId: string) {
    this.io.in(`user:${userId}`).socketsLeave(`chat:${chatId}`);
  }

  // Emits an event to a user's private notification room
  public emitToUser(userId: string, event: string, payload: any) {
    this.io.to(`user:${userId}`).emit(event, payload);
  }

  // Emits an event to all connected members of a chat room
  public emitToChat(chatId: string, event: string, payload: any) {
    this.io.to(`chat:${chatId}`).emit(event, payload);
  }

  public async close() {
    this.receiptCoalesceMap.forEach((entry) => {
      if (entry.timer) clearTimeout(entry.timer);
    });
    this.receiptCoalesceMap.clear();
    await new Promise<void>((resolve) => this.io.close(() => resolve()));
  }
}

let realtimeManagerInstance: RealtimeManager | null = null;

export function initRealtimeManager(server: HttpServer): RealtimeManager {
  realtimeManagerInstance = new RealtimeManager(server);
  return realtimeManagerInstance;
}

export function getRealtimeManager(): RealtimeManager | null {
  return realtimeManagerInstance;
}
