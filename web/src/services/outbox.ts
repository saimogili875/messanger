// web/src/services/outbox.ts
// Offline outbox engine using IndexedDB (idb) for robust pending message storage and retry.

import { openDB, DBSchema, IDBPDatabase } from "idb";

export interface OutboxItem {
  clientMsgId: string;
  chatId: string;
  body: string;
  fileId?: string;
  messageType?: "text" | "image" | "pdf" | "document" | "video";
  status: "pending" | "sending" | "failed";
  createdAt: string;
}

interface MessengerDB extends DBSchema {
  outbox: {
    key: string; // clientMsgId
    value: OutboxItem;
    indexes: {
      by_chat: string;
      by_status: string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<MessengerDB>> | null = null;

function getDb(): Promise<IDBPDatabase<MessengerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MessengerDB>("messenger_offline_store", 1, {
      upgrade(db) {
        const store = db.createObjectStore("outbox", { keyPath: "clientMsgId" });
        store.createIndex("by_chat", "chatId");
        store.createIndex("by_status", "status");
      },
    });
  }
  return dbPromise;
}

// Persists a pending message to IndexedDB before socket transmission
export async function queuePendingMessage(item: OutboxItem): Promise<void> {
  const db = await getDb();
  await db.put("outbox", item);
}

// Retrieves all unsent or pending messages for retry upon reconnection
export async function getAllPendingMessages(): Promise<OutboxItem[]> {
  const db = await getDb();
  return db.getAllFromIndex("outbox", "by_status", "pending");
}

// Retrieves pending messages for a specific chat
export async function getPendingForChat(chatId: string): Promise<OutboxItem[]> {
  const db = await getDb();
  return db.getAllFromIndex("outbox", "by_chat", chatId);
}

// Deletes a message from the outbox after confirmed server acknowledgment
export async function removeConfirmedMessage(clientMsgId: string): Promise<void> {
  const db = await getDb();
  await db.delete("outbox", clientMsgId);
}

// Marks an outbox item as failed when retry bounds are exhausted
export async function markMessageFailed(clientMsgId: string): Promise<void> {
  const db = await getDb();
  const item = await db.get("outbox", clientMsgId);
  if (item) {
    item.status = "failed";
    await db.put("outbox", item);
  }
}

// Clears all outbox messages
export async function clearAllOutbox(): Promise<void> {
  const db = await getDb();
  await db.clear("outbox");
}

