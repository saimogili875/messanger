// scripts/loadtest-group.ts
// Realtime load test simulating 50 concurrent group chat users measuring ack/delivery latency and sequence integrity.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { buildApp } from "../src/app";
import { client, db } from "../src/db";
import { users, sessions, chats, chatMembers, messages } from "../src/db/schema";
import { env } from "../src/config/env";
import { groupService } from "../src/modules/group/group.service";

interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

function calculateStats(samples: number[]): LatencyStats {
  if (samples.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const min = Math.round(sorted[0] * 100) / 100;
  const max = Math.round(sorted[sorted.length - 1] * 100) / 100;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = Math.round((sum / sorted.length) * 100) / 100;

  const p50 = Math.round(sorted[Math.floor(sorted.length * 0.5)] * 100) / 100;
  const p95 = Math.round(sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)] * 100) / 100;
  const p99 = Math.round(sorted[Math.min(Math.floor(sorted.length * 0.99), sorted.length - 1)] * 100) / 100;

  return { count: sorted.length, min, max, mean, p50, p95, p99 };
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let userCount = 50;
  let durationSeconds = 12; // Default for test suite / CI; can pass --seconds 120
  let intervalMs = 2000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--users" && args[i + 1]) {
      userCount = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--seconds" && args[i + 1]) {
      durationSeconds = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--interval" && args[i + 1]) {
      intervalMs = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { userCount, durationSeconds, intervalMs };
}

async function runGroupLoadTest() {
  const { userCount, durationSeconds, intervalMs } = parseArgs();

  console.log("=================================================");
  console.log("Phase 6 Realtime Group Chat Load Benchmark");
  console.log(`Users: ${userCount} | Duration: ${durationSeconds}s | Interval: ${intervalMs}ms`);
  console.log("=================================================\n");

  // 1. Boot test Fastify server on an ephemeral port
  const app = buildApp();
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  const serverPort = (app.server.address() as any).port;
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  console.log(`✓ Realtime server listening on ${serverUrl}`);

  // 2. Direct database inserts for 50 users (hash password once)
  console.log(`1. Generating ${userCount} test users directly in PostgreSQL...`);
  const passwordHash = await argon2.hash("Password123!", { type: argon2.argon2id });

  const testUserRows: Array<{ id: string; email: string; token: string }> = [];

  for (let i = 0; i < userCount; i++) {
    const userId = crypto.randomUUID();
    const email = `loadtest_u${i}_${Date.now()}@example.com`;

    await db.insert(users).values({
      id: userId,
      email,
      passwordHash,
      displayName: `User ${i}`,
    });

    const sessionId = crypto.randomUUID();
    const refreshHash = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.insert(sessions).values({
      id: sessionId,
      userId,
      refreshTokenHash: refreshHash,
      expiresAt,
    });

    const token = jwt.sign({ sub: userId, sid: sessionId }, env.JWT_SECRET, {
      expiresIn: "15m",
    });

    testUserRows.push({ id: userId, email, token });
  }
  console.log(`✓ Created ${testUserRows.length} users with active sessions and JWTs.`);

  // 3. User 0 creates group and adds other 49 members
  console.log("2. Creating 50-member group via GroupService...");
  const memberIds = testUserRows.slice(1).map((u) => u.id);
  const group = await groupService.createGroup(testUserRows[0].id, {
    name: "Realtime 50 Group Benchmark",
    memberIds,
  });
  const chatId = group.id;
  console.log(`✓ Group created: "${group.name}" (ID: ${chatId})`);

  // 4. Connect all 50 users via WebSocket
  console.log("3. Connecting all 50 clients to WebSocket server...");
  const sockets: ClientSocket[] = [];

  const connectPromises = testUserRows.map(
    (user, idx) =>
      new Promise<ClientSocket>((resolve, reject) => {
        const socket = ioClient(serverUrl, {
          auth: { token: user.token },
          transports: ["websocket"],
          reconnection: false,
        });

        const timer = setTimeout(() => {
          reject(new Error(`User ${idx} connection timed out`));
        }, 5000);

        socket.on("connect", () => {
          clearTimeout(timer);
          resolve(socket);
        });

        socket.on("connect_error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      })
  );

  const connectedSockets = await Promise.all(connectPromises);
  sockets.push(...connectedSockets);
  console.log(`✓ All ${sockets.length} sockets connected and authenticated.`);

  // 5. Setup message tracking data structures
  const ackLatencies: number[] = [];
  const deliveryLatencies: number[] = [];

  let totalSent = 0;
  let totalAcked = 0;
  let totalReceived = 0;

  // Track received message IDs per client to detect duplicates and gap errors
  const clientReceivedMap = new Map<number, Set<string>>();
  const clientSequences = new Map<number, number[]>();

  for (let i = 0; i < userCount; i++) {
    clientReceivedMap.set(i, new Set());
    clientSequences.set(i, []);
  }

  // Register message:new listener on all sockets
  sockets.forEach((socket, clientIndex) => {
    socket.on("message:new", (msg: any) => {
      if (msg.chatId !== chatId || msg.type !== "user") return;

      totalReceived++;
      const recvTime = performance.now();

      // Check duplicates
      const receivedSet = clientReceivedMap.get(clientIndex)!;
      if (receivedSet.has(msg.id)) {
        console.error(`[Duplicate] Client ${clientIndex} received message ${msg.id} twice!`);
      }
      receivedSet.add(msg.id);

      // Track sequence ordering
      const seqList = clientSequences.get(clientIndex)!;
      seqList.push(msg.seq);

      // Delivery latency: measure only on clients other than the sender
      if (msg.senderId !== testUserRows[clientIndex].id) {
        if (msg.body.startsWith("LT|")) {
          const parts = msg.body.split("|");
          const sendTs = parseFloat(parts[3]);
          if (!isNaN(sendTs)) {
            const latency = Date.now() - sendTs;
            deliveryLatencies.push(latency);
          }
        }
      }
    });
  });

  // 6. Run load test message send loops
  console.log(`4. Starting message send loop for ${durationSeconds} seconds (every ${intervalMs}ms)...`);
  const startTime = Date.now();
  const stopTime = startTime + durationSeconds * 1000;

  let messageCounter = 0;
  const sendIntervals: NodeJS.Timeout[] = [];

  testUserRows.forEach((user, userIdx) => {
    const socket = sockets[userIdx];
    const timer = setInterval(() => {
      if (Date.now() >= stopTime) return;

      const n = ++messageCounter;
      const sendTimestamp = Date.now();
      const body = `LT|${userIdx}|${n}|${sendTimestamp}`;
      const clientMsgId = crypto.randomUUID();

      totalSent++;
      const sendStart = performance.now();

      socket.emit(
        "message:send",
        {
          chatId,
          clientMsgId,
          body,
        },
        (ack: any) => {
          const ackEnd = performance.now();
          if (ack && !ack.error) {
            totalAcked++;
            ackLatencies.push(ackEnd - sendStart);
          } else {
            console.error(`[Ack Error] User ${userIdx} message ${n} failed:`, ack?.error);
          }
        }
      );
    }, intervalMs);

    sendIntervals.push(timer);
  });

  // Wait until test duration completes
  await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000 + 500));

  // Clear timers
  sendIntervals.forEach((t) => clearInterval(t));
  console.log(`✓ Finished sending. Total sent: ${totalSent}. Waiting 5 seconds for in-flight deliveries...`);

  // Wait 5 seconds for in-flight messages to arrive
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 7. Verify message receipt and integrity
  console.log("5. Verifying message delivery, duplicates, and sequence continuity...");

  let duplicateCount = 0;
  let gapErrors = 0;
  let lostMessages = 0;

  // Expected delivery count per non-sending client is totalSent (or totalSent - user's own sent if checking others)
  // Each client should have received all messages
  clientSequences.forEach((seqs, clientIdx) => {
    // Check duplicates in set
    const uniqueCount = clientReceivedMap.get(clientIdx)!.size;
    if (seqs.length !== uniqueCount) {
      duplicateCount += seqs.length - uniqueCount;
    }

    // Check monotonic increasing sequence without gaps
    const sortedSeqs = [...seqs].sort((a, b) => a - b);
    for (let k = 1; k < sortedSeqs.length; k++) {
      if (sortedSeqs[k] <= sortedSeqs[k - 1]) {
        console.error(`Client ${clientIdx} sequence inversion or duplicate: ${sortedSeqs[k]} <= ${sortedSeqs[k - 1]}`);
      }
      if (sortedSeqs[k] > sortedSeqs[k - 1] + 1) {
        gapErrors++;
      }
    }

    // Verify lost messages
    const receivedFromOthers = uniqueCount;
    if (receivedFromOthers < totalSent) {
      lostMessages += totalSent - receivedFromOthers;
    }
  });

  // Calculate latency percentiles
  const ackStats = calculateStats(ackLatencies);
  const deliveryStats = calculateStats(deliveryLatencies);

  const isPass =
    lostMessages === 0 &&
    duplicateCount === 0 &&
    ackStats.p95 < 500 &&
    deliveryStats.p95 < 500;

  // Print summary report
  console.log("\n=================================================");
  console.log("REALTIME BENCHMARK RESULTS:");
  console.log(`Total Messages Sent:      ${totalSent}`);
  console.log(`Total Messages Acked:     ${totalAcked}`);
  console.log(`Lost Messages:            ${lostMessages}`);
  console.log(`Duplicate Messages:       ${duplicateCount}`);
  console.log(`Sequence Gap Errors:      ${gapErrors}`);
  console.log("-------------------------------------------------");
  console.log(`Ack Latency (p50 / p95):  ${ackStats.p50} ms / ${ackStats.p95} ms (max: ${ackStats.max} ms)`);
  console.log(`Delivery Latency (p50/p95): ${deliveryStats.p50} ms / ${deliveryStats.p95} ms (max: ${deliveryStats.max} ms)`);
  console.log("-------------------------------------------------");
  console.log(`BENCHMARK OVERALL STATUS:  ${isPass ? "PASS ✅" : "FAIL ❌"}`);
  console.log("=================================================\n");

  // Save report artifact to docs/phase6-loadtest.json
  const report = {
    timestamp: new Date().toISOString(),
    config: { userCount, durationSeconds, intervalMs },
    metrics: {
      totalSent,
      totalAcked,
      lostMessages,
      duplicateCount,
      gapErrors,
      ackLatencyMs: ackStats,
      deliveryLatencyMs: deliveryStats,
      status: isPass ? "PASS" : "FAIL",
    },
  };

  const docsDir = path.join(process.cwd(), "docs");
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(docsDir, "phase6-loadtest.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("✓ Saved docs/phase6-loadtest.json");

  // Close all sockets and server
  sockets.forEach((s) => s.disconnect());
  await app.close();
  await client.end();
  process.exit(isPass ? 0 : 1);
}

runGroupLoadTest().catch((err) => {
  console.error("Load test failed with unhandled exception:", err);
  process.exit(1);
});

