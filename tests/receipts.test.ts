// tests/receipts.test.ts
// Tests verifying that delivery and read receipt cursors only move forward and are capped at chat.last_seq.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import crypto from "crypto";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { eq, and } from "drizzle-orm";
import { buildApp } from "../src/app";
import { client, db } from "../src/db";
import { users, chats, chatMembers, messages } from "../src/db/schema";
import { allocateChatSeq } from "../src/modules/group/group.service";

describe("Monotonic Capped Receipt Cursor Tests", () => {
  let app: FastifyInstance;
  let serverUrl: string;
  let senderToken: string;
  let senderId: string;
  let recipientToken: string;
  let recipientId: string;
  let chatId: string;

  function connectSocket(token: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const s = ioClient(serverUrl, {
        auth: { token },
        transports: ["websocket", "polling"],
        reconnection: false,
      });
      const timer = setTimeout(() => reject(new Error("Socket connect timed out")), 4000);
      s.on("connect", () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.on("connect_error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  beforeAll(async () => {
    await client`TRUNCATE TABLE users, devices, chats, chat_members, messages, sessions, message_reactions, used_refresh_tokens CASCADE`;

    app = buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as any).port;
    serverUrl = `http://127.0.0.1:${port}`;

    async function registerUser(email: string, name: string) {
      const reg = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email, password: "Password123!", displayName: name },
      });
      const id = JSON.parse(reg.payload).id;
      const log = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password: "Password123!" },
      });
      const token = JSON.parse(log.payload).accessToken;
      return { id, token };
    }

    const u1 = await registerUser("sender_rcpt@example.com", "Sender");
    senderId = u1.id;
    senderToken = u1.token;

    const u2 = await registerUser("recipient_rcpt@example.com", "Recipient");
    recipientId = u2.id;
    recipientToken = u2.token;

    // Create direct chat
    const chatRes = await app.inject({
      method: "POST",
      url: "/chats/direct",
      headers: { authorization: `Bearer ${senderToken}` },
      payload: { recipientId },
    });
    chatId = JSON.parse(chatRes.payload).id;

    // Insert 5 test messages (seq 1 to 5)
    for (let i = 1; i <= 5; i++) {
      const seq = await allocateChatSeq(chatId);
      await db.insert(messages).values({
        chatId,
        senderId,
        clientMsgId: crypto.randomUUID(),
        seq,
        body: `Message ${i}`,
        type: "user",
      });
    }
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("1. Delivered cursor moves forward to valid seq", async () => {
    const socket = await connectSocket(recipientToken);

    socket.emit("receipt:delivered", { chatId, upToSeq: 3 });
    await new Promise((resolve) => setTimeout(resolve, 350));

    const [member] = await db
      .select({ lastDeliveredSeq: chatMembers.lastDeliveredSeq })
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, recipientId)));

    expect(member.lastDeliveredSeq).toBe(3);
    socket.disconnect();
  });

  it("2. Delivered cursor never moves backwards when a smaller seq is received", async () => {
    const socket = await connectSocket(recipientToken);

    socket.emit("receipt:delivered", { chatId, upToSeq: 1 });
    await new Promise((resolve) => setTimeout(resolve, 350));

    const [member] = await db
      .select({ lastDeliveredSeq: chatMembers.lastDeliveredSeq })
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, recipientId)));

    expect(member.lastDeliveredSeq).toBe(3); // Preserved at 3!
    socket.disconnect();
  });

  it("3. Delivered and read cursors are capped at actual chat.last_seq when client sends an absurdly high seq", async () => {
    const socket = await connectSocket(recipientToken);

    // Send absurd seq: 999999 (while actual chat last_seq is 5)
    socket.emit("receipt:delivered", { chatId, upToSeq: 999999 });
    socket.emit("receipt:read", { chatId, upToSeq: 999999 });
    await new Promise((resolve) => setTimeout(resolve, 350));

    const [member] = await db
      .select({
        lastDeliveredSeq: chatMembers.lastDeliveredSeq,
        lastReadSeq: chatMembers.lastReadSeq,
      })
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, recipientId)));

    // Both must be capped at 5!
    expect(member.lastDeliveredSeq).toBe(5);
    expect(member.lastReadSeq).toBe(5);
    socket.disconnect();
  });
});
