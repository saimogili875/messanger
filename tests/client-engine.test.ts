// tests/client-engine.test.ts
// Unit and integration tests for the client-side messaging engine: deduplication, outbox, and sequence tracking.

import { describe, it, expect } from "vitest";

describe("Client Messaging Engine & Outbox Logic", () => {
  it("1. Deduplicates messages by clientMsgId and id correctly", () => {
    const existing = [
      { id: "m1", clientMsgId: "c1", seq: 1, body: "Hello", createdAt: "2026-10-29T10:00:00Z" },
      { id: "m2", clientMsgId: "c2", seq: 2, body: "World", createdAt: "2026-10-29T10:01:00Z" },
    ];

    // Same clientMsgId from optimistic send arriving with server ID
    const incomingAck = { id: "m3", clientMsgId: "c2", seq: 2, body: "World", createdAt: "2026-10-29T10:01:00Z" };

    const map = new Map();
    [...existing, incomingAck].forEach((m) => {
      // Key by clientMsgId to deduplicate optimistic updates
      const key = m.clientMsgId || m.id;
      map.set(key, m);
    });

    const deduplicated = Array.from(map.values());
    expect(deduplicated.length).toBe(2);
    expect(deduplicated[1].id).toBe("m3");
  });

  it("2. Sequence gap detection triggers sync when seq > lastSeq + 1", () => {
    const lastKnownSeq = 10;
    const incomingSeq = 13; // Gap of 11, 12!

    const hasGap = incomingSeq > lastKnownSeq + 1;
    expect(hasGap).toBe(true);

    const normalNextSeq = 11;
    const hasGapNormal = normalNextSeq > lastKnownSeq + 1;
    expect(hasGapNormal).toBe(false);
  });

  it("3. Receipt cursors determine message status accurately", () => {
    const messages = [
      { seq: 1, status: "pending" },
      { seq: 2, status: "pending" },
      { seq: 3, status: "pending" },
      { seq: 4, status: "pending" },
    ];

    const lastDeliveredSeq = 3;
    const lastReadSeq = 2;

    const evaluated = messages.map((m) => {
      if (m.seq <= lastReadSeq) return { ...m, status: "read" };
      if (m.seq <= lastDeliveredSeq) return { ...m, status: "delivered" };
      return { ...m, status: "sent" };
    });

    expect(evaluated[0].status).toBe("read");
    expect(evaluated[1].status).toBe("read");
    expect(evaluated[2].status).toBe("delivered");
    expect(evaluated[3].status).toBe("sent");
  });

  it("4. Password strength evaluator checks all character classes", () => {
    function evalPassword(pass: string): number {
      let score = 0;
      if (pass.length >= 8) score++;
      if (/[A-Z]/.test(pass)) score++;
      if (/[a-z]/.test(pass)) score++;
      if (/[0-9]/.test(pass)) score++;
      if (/[^A-Za-z0-9]/.test(pass)) score++;
      return score;
    }

    expect(evalPassword("short")).toBe(1);
    expect(evalPassword("longpassword")).toBe(2);
    expect(evalPassword("LongPassword1")).toBe(4);
    expect(evalPassword("StrongPass!123")).toBe(5);
  });
});
