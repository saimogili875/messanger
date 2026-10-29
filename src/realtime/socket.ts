// src/realtime/socket.ts
// Realtime WebSocket server using Socket.IO with hybrid JWT/session auth, room management, and message/reaction routing.

import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import {
  sessions,
  chatMembers,
  messages,
  messageReactions,
  users,
  chats,
} from "../db/schema";
import { env } from "../config/env";
import { redis, createRedisClient } from "../config/redis";
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
  private isClosing = false;
  private pubClient: ReturnType<typeof createRedisClient> | null = null;
  private subClient: ReturnType<typeof createRedisClient> | null = null;
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
          cb(null, true);
        },
        credentials: true,
      },
    });

    // Attach Redis adapter for horizontal scaling (except in unit tests if redis isn't mocked)
    try {
      this.pubClient = createRedisClient();
      this.subClient = createRedisClient();
      this.pubClient.on("error", () => {});
      this.subClient.on("error", () => {});
      this.io.adapter(createAdapter(this.pubClient, this.subClient));
    } catch (err) {
      console.warn("[Socket.IO] Redis adapter init skipped or failed:", err);
    }

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
      } catch (err: any) {
        if (err?.name === "TokenExpiredError") {
          const expiredErr: any = new Error("TOKEN_EXPIRED");
          expiredErr.data = { code: "TOKEN_EXPIRED", message: "Token has expired" };
          return next(expiredErr);
        }
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

      // Presence: increment connection counter and set TTL heartbeat in Redis
      const socketCountKey = `presence:sockets:${userId}`;
      const onlineTtlKey = `presence:online:${userId}`;
      redis
        .incr(socketCountKey)
        .then(async (count) => {
          await redis.set(onlineTtlKey, "1", "EX", 60);
          if (count === 1) {
            // First tab/device connected: broadcast online status to shared chat members
            this.broadcastPresenceToSharedUsers(userId, "online");
          }
        })
        .catch(() => {});

      // Heartbeat event from client to refresh presence TTL
      socket.on("presence:heartbeat", () => {
        redis.set(onlineTtlKey, "1", "EX", 60).catch(() => {});
      });

      // Typing rate limiter per socket
      let lastTypingTime = 0;

      // Ephemeral typing start handler (stored in Redis with 5s TTL)
      socket.on("typing:start", async (data) => {
        try {
          const now = Date.now();
          if (now - lastTypingTime < 500) return; // Debounce rapid triggers
          lastTypingTime = now;

          const parsed = z.object({ chatId: z.string().uuid() }).parse(data);
          await redis.set(`chat:${parsed.chatId}:typing:${userId}`, "1", "EX", 5);

          this.io.to(`chat:${parsed.chatId}`).emit("typing:update", {
            chatId: parsed.chatId,
            userId,
            isTyping: true,
          });
        } catch {}
      });

      // Ephemeral typing stop handler
      socket.on("typing:stop", async (data) => {
        try {
          const parsed = z.object({ chatId: z.string().uuid() }).parse(data);
          await redis.del(`chat:${parsed.chatId}:typing:${userId}`);

          this.io.to(`chat:${parsed.chatId}`).emit("typing:update", {
            chatId: parsed.chatId,
            userId,
            isTyping: false,
          });
        } catch {}
      });

      // Disconnect lifecycle: decrement connection counter and mark offline when last tab closes
      socket.on("disconnect", () => {
        redis
          .decr(socketCountKey)
          .then(async (remaining) => {
            if (remaining <= 0) {
              await redis.del(socketCountKey);
              await redis.del(onlineTtlKey);

              const lastSeenAt = new Date().toISOString();
              this.broadcastPresenceToSharedUsers(userId, "offline", lastSeenAt);
            }
          })
          .catch(() => {});
      });

      // Rate limit tracker for message sending (max 10 messages per second per socket)
      let messageSendCount = 0;
      let windowResetTime = Date.now() + 1000;

      // 1. message:send handler
      socket.on("message:send", async (data, ack) => {
        try {
          const now = Date.now();
          if (now > windowResetTime) {
            messageSendCount = 0;
            windowResetTime = now + 1000;
          }
          messageSendCount++;
          if (messageSendCount > 15) {
            if (typeof ack === "function") {
              ack({ error: "Rate limit exceeded: too many messages sent" });
            }
            return;
          }

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

      // 4. receipt:delivered handler (coalesced 300ms, monotonic, capped at chat.last_seq)
      socket.on("receipt:delivered", async (data) => {
        try {
          const { chatId, upToSeq } = receiptDeliveredSchema.parse(data);

          const [chatRow] = await db
            .select({ lastSeq: chats.lastSeq })
            .from(chats)
            .where(eq(chats.id, chatId))
            .limit(1);

          if (!chatRow) return;

          // Cap delivered seq at actual last_seq of the chat
          const validSeq = Math.min(upToSeq, Number(chatRow.lastSeq));

          await db
            .update(chatMembers)
            .set({
              lastDeliveredSeq: sql`GREATEST(${chatMembers.lastDeliveredSeq}, ${validSeq})`,
            })
            .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)));

          this.scheduleReceiptBroadcast(chatId, userId, { lastDeliveredSeq: validSeq });
        } catch (err) {
          // Ignore receipt processing errors
        }
      });

      // 5. receipt:read handler (coalesced 300ms, monotonic, capped at chat.last_seq)
      socket.on("receipt:read", async (data) => {
        try {
          const { chatId, upToSeq } = receiptReadSchema.parse(data);

          const [chatRow] = await db
            .select({ lastSeq: chats.lastSeq })
            .from(chats)
            .where(eq(chats.id, chatId))
            .limit(1);

          if (!chatRow) return;

          // Cap read seq at actual last_seq of the chat
          const validSeq = Math.min(upToSeq, Number(chatRow.lastSeq));

          await db
            .update(chatMembers)
            .set({
              lastReadSeq: sql`GREATEST(${chatMembers.lastReadSeq}, ${validSeq})`,
              lastDeliveredSeq: sql`GREATEST(${chatMembers.lastDeliveredSeq}, ${validSeq})`,
            })
            .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)));

          this.scheduleReceiptBroadcast(chatId, userId, { lastReadSeq: validSeq, lastDeliveredSeq: validSeq });
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

  // Broadcasts a user's presence state exclusively to other users sharing at least one chat
  private async broadcastPresenceToSharedUsers(
    userId: string,
    status: "online" | "offline",
    lastSeenAt?: string
  ) {
    if (this.isClosing) return;
    try {
      const rows: any = await db.execute(sql`
        SELECT DISTINCT cm2.user_id
        FROM chat_members cm1
        JOIN chat_members cm2 ON cm1.chat_id = cm2.chat_id
        WHERE cm1.user_id = ${userId} AND cm2.user_id != ${userId}
      `);

      if (this.isClosing) return;
      const mutualUserIds = (rows as any[]).map((r) => r.user_id);
      mutualUserIds.forEach((mUid) => {
        try {
          if (!this.isClosing) {
            this.io.to(`user:${mUid}`).emit("presence:update", {
              userId,
              status,
              lastSeenAt,
            });
          }
        } catch {}
      });
    } catch (err) {
      // Ignore broadcast query failures
    }
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
    this.isClosing = true;
    this.receiptCoalesceMap.forEach((entry) => {
      if (entry.timer) clearTimeout(entry.timer);
    });
    this.receiptCoalesceMap.clear();

    await new Promise<void>((resolve) => this.io.close(() => resolve()));

    if (this.pubClient) {
      await this.pubClient.quit().catch(() => {});
      this.pubClient = null;
    }
    if (this.subClient) {
      await this.subClient.quit().catch(() => {});
      this.subClient = null;
    }
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
