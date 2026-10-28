// src/modules/chat/chat.service.ts
// Message history retrieval enforcing first_visible_seq visibility rules and chat inbox listing without N+1 queries.

import { eq, and, gt, sql, desc, asc } from "drizzle-orm";
import { db } from "../../db";
import { chats, chatMembers, messages, users, Message } from "../../db/schema";
import { HttpError } from "../auth/auth.service";

export interface VisibleMessageItem {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  clientMsgId: string;
  seq: number;
  body: string;
  fileId: string | null;
  messageType: string;
  type: "user" | "system";
  meta: unknown;
  createdAt: Date;
}

// Retrieves messages strictly after afterSeq and respecting the member's first_visible_seq boundary
// Loads sender display names in ONE query to prevent N+1 database roundtrips
export async function getVisibleMessages(
  chatId: string,
  userId: string,
  afterSeq = 0,
  limit = 50
): Promise<VisibleMessageItem[]> {
  const boundedLimit = Math.min(Math.max(limit, 1), 100);

  // Require active membership
  const [member] = await db
    .select({
      firstVisibleSeq: chatMembers.firstVisibleSeq,
    })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
    .limit(1);

  if (!member) {
    throw new HttpError(404, "Chat not found");
  }

  // Calculate starting sequence: must be strictly greater than afterSeq AND >= firstVisibleSeq
  const minSeq = Math.max(afterSeq + 1, member.firstVisibleSeq);

  const rows = await db
    .select({
      id: messages.id,
      chatId: messages.chatId,
      senderId: messages.senderId,
      senderName: users.displayName,
      clientMsgId: messages.clientMsgId,
      seq: messages.seq,
      body: messages.body,
      fileId: messages.fileId,
      messageType: messages.messageType,
      type: messages.type,
      meta: messages.meta,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(users, eq(messages.senderId, users.id))
    .where(and(eq(messages.chatId, chatId), sql`${messages.seq} >= ${minSeq}`))
    .orderBy(asc(messages.seq))
    .limit(boundedLimit);

  return rows as VisibleMessageItem[];
}

export class ChatService {
  // Lists all chats the user belongs to, including group/direct metadata and latest visible preview
  async listMyChats(userId: string) {
    // 1. Fetch user's chat memberships with chat metadata
    const chatList = await db
      .select({
        chatId: chats.id,
        type: chats.type,
        name: chats.name,
        lastSeq: chats.lastSeq,
        updatedAt: chats.updatedAt,
        role: chatMembers.role,
        firstVisibleSeq: chatMembers.firstVisibleSeq,
        lastDeliveredSeq: chatMembers.lastDeliveredSeq,
        lastReadSeq: chatMembers.lastReadSeq,
      })
      .from(chatMembers)
      .innerJoin(chats, eq(chatMembers.chatId, chats.id))
      .where(eq(chatMembers.userId, userId))
      .orderBy(desc(chats.updatedAt));

    if (chatList.length === 0) {
      return [];
    }

    // 2. Fetch member counts and preview messages in single batched queries
    const chatIds = chatList.map((c) => c.chatId);

    // Member count per chat
    const counts = await db
      .select({
        chatId: chatMembers.chatId,
        count: sql<number>`count(*)::int`,
      })
      .from(chatMembers)
      .where(sql`${chatMembers.chatId} IN ${chatIds}`)
      .groupBy(chatMembers.chatId);

    const countMap = new Map(counts.map((c) => [c.chatId, c.count]));

    // Fetch latest user message for each chat respecting firstVisibleSeq
    const previews = await Promise.all(
      chatList.map(async (chat) => {
        const [lastMsg] = await db
          .select({
            id: messages.id,
            seq: messages.seq,
            body: messages.body,
            senderId: messages.senderId,
            senderName: users.displayName,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .innerJoin(users, eq(messages.senderId, users.id))
          .where(
            and(
              eq(messages.chatId, chat.chatId),
              eq(messages.type, "user"),
              sql`${messages.seq} >= ${chat.firstVisibleSeq}`
            )
          )
          .orderBy(desc(messages.seq))
          .limit(1);

        return {
          chatId: chat.chatId,
          lastMessage: lastMsg
            ? {
                id: lastMsg.id,
                seq: lastMsg.seq,
                body: lastMsg.body,
                senderId: lastMsg.senderId,
                senderName: lastMsg.senderName,
                createdAt: lastMsg.createdAt.toISOString(),
              }
            : null,
        };
      })
    );

    const previewMap = new Map(previews.map((p) => [p.chatId, p.lastMessage]));

    return chatList.map((c) => ({
      id: c.chatId,
      name: c.name || "Direct Chat",
      type: c.type,
      role: c.role,
      memberCount: countMap.get(c.chatId) || 1,
      lastSeq: c.lastSeq,
      lastDeliveredSeq: c.lastDeliveredSeq,
      lastReadSeq: c.lastReadSeq,
      lastMessage: previewMap.get(c.chatId) || null,
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  // Creates or returns an existing 1-on-1 direct chat between two users
  async createOrGetDirectChat(userId: string, recipientId: string) {
    if (userId === recipientId) {
      throw new HttpError(400, "Cannot create direct chat with yourself");
    }

    const [recipient] = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, recipientId))
      .limit(1);

    if (!recipient) {
      throw new HttpError(404, "Recipient user not found");
    }

    const sortedIds = [userId, recipientId].sort();
    const directKey = `${sortedIds[0]}:${sortedIds[1]}`;

    const [existing] = await db
      .select()
      .from(chats)
      .where(eq(chats.directKey, directKey))
      .limit(1);

    if (existing) {
      return { id: existing.id, type: "direct", name: recipient.displayName };
    }

    const chat = await db.transaction(async (tx) => {
      const [newChat] = await tx
        .insert(chats)
        .values({
          type: "direct",
          directKey,
          lastSeq: 0,
        })
        .returning();

      await tx.insert(chatMembers).values([
        { chatId: newChat.id, userId, role: "member", firstVisibleSeq: 0 },
        { chatId: newChat.id, userId: recipientId, role: "member", firstVisibleSeq: 0 },
      ]);

      return newChat;
    });

    return { id: chat.id, type: "direct", name: recipient.displayName };
  }
}

export const chatService = new ChatService();

