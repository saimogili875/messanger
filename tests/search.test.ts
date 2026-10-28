// tests/search.test.ts
// Integration test suite for full-text search, chat isolation, history boundary enforcement, pagination, and rate limiting.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import crypto from "crypto";
import { buildApp } from "../src/app";
import { client, db } from "../src/db";
import { users, chats, chatMembers, messages } from "../src/db/schema";
import { allocateChatSeq } from "../src/modules/group/group.service";

describe("Phase 6 Full-Text Search Integration Tests", () => {
  let app: FastifyInstance;
  let ipCounter = 40;

  let aliceToken: string;
  let aliceId: string;
  let bobToken: string;
  let bobId: string;
  let charlieToken: string;
  let charlieId: string;

  let sharedChatId: string;
  let privateChatId: string;
  let groupChatId: string;

  function getIp(): string {
    return `198.51.100.${ipCounter++}`;
  }

  beforeAll(async () => {
    // Truncate tables for test database
    await client`TRUNCATE TABLE users, devices, chats, chat_members, messages, sessions, message_reactions CASCADE`;

    app = buildApp();
    await app.ready();

    // Register 3 users: Alice, Bob, Charlie
    const resAlice = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: getIp(),
      payload: { email: "alice_search@example.com", password: "Password123!", displayName: "Alice" },
    });
    aliceId = JSON.parse(resAlice.payload).id;

    const resLoginAlice = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: getIp(),
      payload: { email: "alice_search@example.com", password: "Password123!" },
    });
    aliceToken = JSON.parse(resLoginAlice.payload).accessToken;

    const resBob = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: getIp(),
      payload: { email: "bob_search@example.com", password: "Password123!", displayName: "Bob" },
    });
    bobId = JSON.parse(resBob.payload).id;

    const resLoginBob = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: getIp(),
      payload: { email: "bob_search@example.com", password: "Password123!" },
    });
    bobToken = JSON.parse(resLoginBob.payload).accessToken;

    const resCharlie = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: getIp(),
      payload: { email: "charlie_search@example.com", password: "Password123!", displayName: "Charlie" },
    });
    charlieId = JSON.parse(resCharlie.payload).id;

    const resLoginCharlie = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: getIp(),
      payload: { email: "charlie_search@example.com", password: "Password123!" },
    });
    charlieToken = JSON.parse(resLoginCharlie.payload).accessToken;

    // Chat 1: Shared between Alice and Bob
    const [c1] = await db
      .insert(chats)
      .values({ type: "direct", directKey: `${aliceId}:${bobId}`, lastSeq: 0 })
      .returning();
    sharedChatId = c1.id;
    await db.insert(chatMembers).values([
      { chatId: sharedChatId, userId: aliceId, role: "member", firstVisibleSeq: 0 },
      { chatId: sharedChatId, userId: bobId, role: "member", firstVisibleSeq: 0 },
    ]);

    // Chat 2: Private between Bob and Charlie (Alice is NOT a member)
    const [c2] = await db
      .insert(chats)
      .values({ type: "direct", directKey: `${bobId}:${charlieId}`, lastSeq: 0 })
      .returning();
    privateChatId = c2.id;
    await db.insert(chatMembers).values([
      { chatId: privateChatId, userId: bobId, role: "member", firstVisibleSeq: 0 },
      { chatId: privateChatId, userId: charlieId, role: "member", firstVisibleSeq: 0 },
    ]);

    // Group Chat: Alice and Bob created first; Charlie joins LATER
    const [cg] = await db
      .insert(chats)
      .values({ type: "group", name: "Engineering Team", createdBy: aliceId, lastSeq: 0 })
      .returning();
    groupChatId = cg.id;
    await db.insert(chatMembers).values([
      { chatId: groupChatId, userId: aliceId, role: "owner", firstVisibleSeq: 0 },
      { chatId: groupChatId, userId: bobId, role: "member", firstVisibleSeq: 0 },
    ]);

    // Insert messages into Chat 1 (Alice & Bob)
    const seq1 = await allocateChatSeq(sharedChatId);
    await db.insert(messages).values({
      chatId: sharedChatId,
      senderId: aliceId,
      clientMsgId: crypto.randomUUID(),
      seq: seq1,
      body: "Let us schedule a meeting for tomorrow in Hyderabad",
      type: "user",
      createdAt: new Date("2026-10-01T10:00:00Z"),
    });

    // Insert message into Chat 2 (Bob & Charlie only - top secret)
    const seq2 = await allocateChatSeq(privateChatId);
    await db.insert(messages).values({
      chatId: privateChatId,
      senderId: bobId,
      clientMsgId: crypto.randomUUID(),
      seq: seq2,
      body: "Confidential financial quarterly budget announcement",
      type: "user",
      createdAt: new Date("2026-10-01T11:00:00Z"),
    });

    // Insert message into Group Chat BEFORE Charlie joins (seq 1)
    const seqG1 = await allocateChatSeq(groupChatId);
    await db.insert(messages).values({
      chatId: groupChatId,
      senderId: aliceId,
      clientMsgId: crypto.randomUUID(),
      seq: seqG1,
      body: "Old secret architecture discussion about database replication",
      type: "user",
      createdAt: new Date("2026-10-01T12:00:00Z"),
    });

    // Now Charlie joins Group Chat with firstVisibleSeq = 2
    await db.insert(chatMembers).values({
      chatId: groupChatId,
      userId: charlieId,
      role: "member",
      firstVisibleSeq: seqG1 + 1, // cannot see seqG1
    });

    // Insert message into Group Chat AFTER Charlie joined (seq 2)
    const seqG2 = await allocateChatSeq(groupChatId);
    await db.insert(messages).values({
      chatId: groupChatId,
      senderId: bobId,
      clientMsgId: crypto.randomUUID(),
      seq: seqG2,
      body: "Welcome Charlie to the new database project sprint",
      type: "user",
      createdAt: new Date("2026-10-02T12:00:00Z"),
    });
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("1. Reject queries shorter than 2 characters (400 Bad Request)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/search?q=a",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe("Validation error");
  });

  it("2. Search never returns messages from chats the caller is not a member of", async () => {
    // Alice searches for 'confidential financial', which is only in Chat 2 (Bob & Charlie)
    const res = await app.inject({
      method: "GET",
      url: "/search?q=confidential+financial",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.results.length).toBe(0);

    // Charlie searches for the same keywords in his chat -> should match!
    const resCharlie = await app.inject({
      method: "GET",
      url: "/search?q=confidential+financial",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${charlieToken}` },
    });

    expect(resCharlie.statusCode).toBe(200);
    const bodyCharlie = JSON.parse(resCharlie.payload);
    expect(bodyCharlie.results.length).toBe(1);
    expect(bodyCharlie.results[0].chatId).toBe(privateChatId);
    expect(bodyCharlie.results[0].snippet.toLowerCase()).toContain("<<confidential>>");
  });

  it("3. Search never returns messages from before the user joined (firstVisibleSeq enforcement)", async () => {
    // Charlie searches for 'architecture' (sent at seq 1 before he joined)
    const resCharlieOld = await app.inject({
      method: "GET",
      url: "/search?q=architecture",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${charlieToken}` },
    });

    expect(resCharlieOld.statusCode).toBe(200);
    const bodyOld = JSON.parse(resCharlieOld.payload);
    expect(bodyOld.results.length).toBe(0); // Blocked by firstVisibleSeq

    // Alice (joined from beginning) searches for 'architecture' -> matches
    const resAliceOld = await app.inject({
      method: "GET",
      url: "/search?q=architecture",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    expect(resAliceOld.statusCode).toBe(200);
    const bodyAlice = JSON.parse(resAliceOld.payload);
    expect(bodyAlice.results.length).toBe(1);
    expect(bodyAlice.results[0].chatId).toBe(groupChatId);

    // Charlie searches for 'database' (present in message after he joined) -> matches
    const resCharlieNew = await app.inject({
      method: "GET",
      url: "/search?q=database",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${charlieToken}` },
    });

    expect(resCharlieNew.statusCode).toBe(200);
    const bodyNew = JSON.parse(resCharlieNew.payload);
    expect(bodyNew.results.length).toBe(1);
    expect(bodyNew.results[0].seq).toBe(2);
  });

  it("4. Cursor pagination returns each result exactly once without duplicates", async () => {
    // Insert 5 searchable messages with keyword 'pagination_keyword'
    for (let i = 1; i <= 5; i++) {
      const seq = await allocateChatSeq(sharedChatId);
      await db.insert(messages).values({
        chatId: sharedChatId,
        senderId: aliceId,
        clientMsgId: crypto.randomUUID(),
        seq,
        body: `Testing pagination_keyword message sequence index number ${i}`,
        type: "user",
        createdAt: new Date(`2026-10-03T10:0${i}:00Z`),
      });
    }

    // Page 1: limit 2
    const resP1 = await app.inject({
      method: "GET",
      url: "/search?q=pagination_keyword&limit=2",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    expect(resP1.statusCode).toBe(200);
    const p1 = JSON.parse(resP1.payload);
    expect(p1.results.length).toBe(2);
    expect(p1.nextCursor).toBeDefined();

    // Page 2: with cursor from page 1
    const resP2 = await app.inject({
      method: "GET",
      url: `/search?q=pagination_keyword&limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    expect(resP2.statusCode).toBe(200);
    const p2 = JSON.parse(resP2.payload);
    expect(p2.results.length).toBe(2);
    expect(p2.nextCursor).toBeDefined();

    // Confirm no duplicates between page 1 and page 2
    const p1Ids = p1.results.map((r: any) => r.messageId);
    const p2Ids = p2.results.map((r: any) => r.messageId);
    p1Ids.forEach((id: string) => {
      expect(p2Ids).not.toContain(id);
    });

    // Page 3: final page
    const resP3 = await app.inject({
      method: "GET",
      url: `/search?q=pagination_keyword&limit=2&cursor=${encodeURIComponent(p2.nextCursor)}`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    const p3 = JSON.parse(resP3.payload);
    expect(p3.results.length).toBe(1);
    expect(p3.nextCursor).toBeNull();
  });

  it("5. Search rate limit: 31st request in a minute triggers 429", async () => {
    const ip = getIp();
    let got429 = false;

    // Firing 31 search requests
    for (let reqCount = 1; reqCount <= 31; reqCount++) {
      const res = await app.inject({
        method: "GET",
        url: "/search?q=rate_limit_probe",
        remoteAddress: ip,
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      if (res.statusCode === 429) {
        got429 = true;
        break;
      }
    }

    expect(got429).toBe(true);
  });
});
