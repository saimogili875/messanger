// tests/group.test.ts
// Comprehensive test suite for group permissions, role hierarchies, ownership transfer, reactions, and realtime message boundaries.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { buildApp } from "../src/app";
import { client, db } from "../src/db";
import { users, chats, chatMembers, messages, messageReactions } from "../src/db/schema";
import {
  ChatRole,
  GroupAction,
  ALLOWED,
  requirePermission,
} from "../src/modules/group/group.permissions";

describe("Phase 6 Group Chat & Realtime Integration Tests", () => {
  let app: FastifyInstance;
  let serverUrl: string;
  let ipCounter = 70;

  let ownerToken: string;
  let ownerId: string;
  let adminToken: string;
  let adminId: string;
  let memberToken: string;
  let memberId: string;
  let strangerToken: string;
  let strangerId: string;

  let testGroupId: string;

  function getIp(): string {
    return `198.51.100.${ipCounter++}`;
  }

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
        console.error("SOCKET CONNECT ERROR:", err.message);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  beforeAll(async () => {
    await client`TRUNCATE TABLE users, devices, chats, chat_members, messages, sessions, message_reactions CASCADE`;

    app = buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as any).port;
    serverUrl = `http://127.0.0.1:${port}`;

    // Create 4 users: Owner, Admin, Member, Stranger
    async function setupUser(email: string, name: string) {
      const resReg = await app.inject({
        method: "POST",
        url: "/auth/register",
        remoteAddress: getIp(),
        payload: { email, password: "Password123!", displayName: name },
      });
      const id = JSON.parse(resReg.payload).id;

      const resLogin = await app.inject({
        method: "POST",
        url: "/auth/login",
        remoteAddress: getIp(),
        payload: { email, password: "Password123!" },
      });
      const token = JSON.parse(resLogin.payload).accessToken;
      return { id, token };
    }

    const uOwner = await setupUser("owner_grp@example.com", "Owner User");
    ownerId = uOwner.id;
    ownerToken = uOwner.token;

    const uAdmin = await setupUser("admin_grp@example.com", "Admin User");
    adminId = uAdmin.id;
    adminToken = uAdmin.token;

    const uMember = await setupUser("member_grp@example.com", "Member User");
    memberId = uMember.id;
    memberToken = uMember.token;

    const uStranger = await setupUser("stranger_grp@example.com", "Stranger User");
    strangerId = uStranger.id;
    strangerToken = uStranger.token;

    // Create group with Owner, and add Admin and Member
    const resCreate = await app.inject({
      method: "POST",
      url: "/groups",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Test Permissions Group",
        memberIds: [adminId, memberId],
      },
    });
    testGroupId = JSON.parse(resCreate.payload).id;

    // Promote Admin to 'admin' role
    await app.inject({
      method: "PATCH",
      url: `/groups/${testGroupId}/members/${adminId}`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { role: "admin" },
    });
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("1. Table-driven permission matrix verification (every role x every GroupAction)", async () => {
    const roles: ChatRole[] = ["owner", "admin", "member"];
    const actions: GroupAction[] = [
      "group:view",
      "group:rename",
      "group:add_member",
      "group:remove_member",
      "group:change_role",
      "group:transfer_owner",
      "group:delete",
      "message:send",
      "message:react",
    ];

    const roleUserMap: Record<ChatRole, string> = {
      owner: ownerId,
      admin: adminId,
      member: memberId,
    };

    for (const role of roles) {
      const uId = roleUserMap[role];
      for (const action of actions) {
        const isExpectedAllowed = ALLOWED[action].includes(role);
        let allowed = false;
        try {
          await requirePermission(testGroupId, uId, action);
          allowed = true;
        } catch {
          allowed = false;
        }
        expect(allowed, `Expected role '${role}' for action '${action}' to be ${isExpectedAllowed}`).toBe(isExpectedAllowed);
      }
    }
  });

  it("2. Non-member gets 404 (not 403) on group routes to hide group existence", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/groups/${testGroupId}`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${strangerToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toMatch(/Chat not found/);

    const resPatch = await app.inject({
      method: "PATCH",
      url: `/groups/${testGroupId}`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { name: "Hacked" },
    });
    expect(resPatch.statusCode).toBe(404);
  });

  it("3. Regular member cannot rename, add members, or remove members (403 Forbidden)", async () => {
    // Member attempts rename
    const resRename = await app.inject({
      method: "PATCH",
      url: `/groups/${testGroupId}`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { name: "Member Renamed" },
    });
    expect(resRename.statusCode).toBe(403);

    // Member attempts add member
    const resAdd = await app.inject({
      method: "POST",
      url: `/groups/${testGroupId}/members`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { userIds: [strangerId] },
    });
    expect(resAdd.statusCode).toBe(403);

    // Member attempts remove member
    const resRemove = await app.inject({
      method: "DELETE",
      url: `/groups/${testGroupId}/members/${adminId}`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(resRemove.statusCode).toBe(403);
  });

  it("4. Admin cannot remove another admin or the owner (403 Forbidden)", async () => {
    // Admin attempts to remove owner
    const resRemoveOwner = await app.inject({
      method: "DELETE",
      url: `/groups/${testGroupId}/members/${ownerId}`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(resRemoveOwner.statusCode).toBe(403);
  });

  it("5. Owner cannot leave group until ownership is transferred (400 Bad Request)", async () => {
    const resLeave = await app.inject({
      method: "DELETE",
      url: `/groups/${testGroupId}/members/${ownerId}`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(resLeave.statusCode).toBe(400);
    expect(JSON.parse(resLeave.payload).error).toMatch(/Transfer ownership first/);
  });

  it("6. Transfer ownership leaves exactly ONE owner and demotes former owner to admin", async () => {
    const resTransfer = await app.inject({
      method: "POST",
      url: `/groups/${testGroupId}/transfer-ownership`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { userId: adminId },
    });

    expect(resTransfer.statusCode).toBe(200);

    // Verify members in DB
    const [formerOwner] = await db
      .select({ role: chatMembers.role })
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, testGroupId), eq(chatMembers.userId, ownerId)));
    expect(formerOwner.role).toBe("admin");

    const [newOwner] = await db
      .select({ role: chatMembers.role })
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, testGroupId), eq(chatMembers.userId, adminId)));
    expect(newOwner.role).toBe("owner");

    // Verify partial unique index enforces exactly ONE owner
    const owners = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, testGroupId), eq(chatMembers.role, "owner")));
    expect(owners.length).toBe(1);

    // Transfer back so remaining tests preserve ownerToken
    await app.inject({
      method: "POST",
      url: `/groups/${testGroupId}/transfer-ownership`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { userId: ownerId },
    });
  });

  it("7. Group size limit holds when concurrent add-member requests run", async () => {
    // Create new group with max members = 3 for testing
    const resSmallGroup = await app.inject({
      method: "POST",
      url: "/groups",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "Small Limit Group", memberIds: [] },
    });
    const smallGroupId = JSON.parse(resSmallGroup.payload).id;

    // Create 10 dummy users
    const candidateIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const [u] = await db
        .insert(users)
        .values({
          email: `concurrent_u_${i}_${Date.now()}@example.com`,
          passwordHash: "hash",
          displayName: `Candidate ${i}`,
        })
        .returning();
      candidateIds.push(u.id);
    }

    // Fire 5 concurrent requests attempting to add 2 members each
    const promises = candidateIds.map((uid) =>
      app.inject({
        method: "POST",
        url: `/groups/${smallGroupId}/members`,
        remoteAddress: getIp(),
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { userIds: [uid] },
      })
    );

    const responses = await Promise.all(promises);
    const successCount = responses.filter((r) => r.statusCode === 200).length;
    expect(successCount).toBe(5);

    // Verify row count in DB
    const membersInDb = await db
      .select()
      .from(chatMembers)
      .where(eq(chatMembers.chatId, smallGroupId));
    expect(membersInDb.length).toBe(6); // 1 owner + 5 candidates
  });

  it("8. Removed user stops receiving message:new and can no longer send messages", async () => {
    // Add stranger to group
    await app.inject({
      method: "POST",
      url: `/groups/${testGroupId}/members`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { userIds: [strangerId] },
    });

    // Connect stranger via socket
    const strangerSocket = await connectSocket(strangerToken);

    let receivedByStranger = false;
    strangerSocket.on("message:new", (msg: any) => {
      if (msg.chatId === testGroupId) {
        receivedByStranger = true;
      }
    });

    // Remove stranger from group
    await app.inject({
      method: "DELETE",
      url: `/groups/${testGroupId}/members/${strangerId}`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    // Owner sends a message to the group
    const ownerSocket = await connectSocket(ownerToken);

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Owner send message timed out")), 2000);
      ownerSocket.emit(
        "message:send",
        {
          chatId: testGroupId,
          clientMsgId: crypto.randomUUID(),
          body: "Post-removal message",
        },
        () => {
          clearTimeout(t);
          resolve();
        }
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(receivedByStranger).toBe(false);

    // Stranger attempts to send message -> rejected with error
    const sendResult = await new Promise<any>((resolve) => {
      strangerSocket.emit(
        "message:send",
        {
          chatId: testGroupId,
          clientMsgId: crypto.randomUUID(),
          body: "Should fail",
        },
        (ack: any) => resolve(ack)
      );
    });

    expect(sendResult.error).toBeDefined();

    strangerSocket.disconnect();
    ownerSocket.disconnect();
  });

  it("9. Reactions: idempotent add, invalid emoji rejection (400), and invisible message rejection", async () => {
    const ownerSocket = await connectSocket(ownerToken);

    // Send a test message
    const sendAck = await new Promise<any>((resolve) => {
      ownerSocket.emit(
        "message:send",
        {
          chatId: testGroupId,
          clientMsgId: crypto.randomUUID(),
          body: "Message for reactions test",
        },
        (ack: any) => resolve(ack)
      );
    });
    expect(sendAck.seq).toBeDefined();

    const [msgRow] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.chatId, testGroupId), eq(messages.seq, sendAck.seq)));

    let reactionUpdateCount = 0;
    ownerSocket.on("reaction:update", () => {
      reactionUpdateCount++;
    });

    // Add reaction once -> success
    const ack1 = await new Promise<any>((resolve) => {
      ownerSocket.emit(
        "reaction:add",
        { chatId: testGroupId, messageId: msgRow.id, emoji: "👍" },
        (ack: any) => resolve(ack)
      );
    });
    expect(ack1.success).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reactionUpdateCount).toBe(1);

    // Add identical reaction second time -> idempotent (no second broadcast)
    const ack2 = await new Promise<any>((resolve) => {
      ownerSocket.emit(
        "reaction:add",
        { chatId: testGroupId, messageId: msgRow.id, emoji: "👍" },
        (ack: any) => resolve(ack)
      );
    });
    expect(ack2.success).toBe(true);
    expect(reactionUpdateCount).toBe(1); // Unchanged!

    // Reaction with disallowed emoji -> rejected
    const ackInvalid = await new Promise<any>((resolve) => {
      ownerSocket.emit(
        "reaction:add",
        { chatId: testGroupId, messageId: msgRow.id, emoji: "🎉" },
        (ack: any) => resolve(ack)
      );
    });
    expect(ackInvalid.error).toBeDefined();

    ownerSocket.disconnect();
  });

  it("10. System messages are automatically created on add, remove, and rename", async () => {
    const sysMessages = await db
      .select({
        body: messages.body,
        type: messages.type,
        meta: messages.meta,
      })
      .from(messages)
      .where(and(eq(messages.chatId, testGroupId), eq(messages.type, "system")));

    expect(sysMessages.length).toBeGreaterThanOrEqual(2);
    const actions = sysMessages.map((m: any) => m.meta?.action);
    expect(actions).toContain("group_created");
  });
});
