// web/src/services/socket.ts
// Realtime Socket.IO client manager with reconnect backoff, token refresh, and IndexedDB outbox drain.

import { io, Socket } from "socket.io-client";
import { getAccessToken, setAccessToken, setStoredRefreshToken, getStoredRefreshToken, api } from "./api";
import { useChatStore, ChatMessage } from "../store/useChatStore";
import {
  getAllPendingMessages,
  removeConfirmedMessage,
  markMessageFailed,
} from "./outbox";

let socketInstance: Socket | null = null;
let reconnectAttempts = 0;
let heartbeatInterval: NodeJS.Timeout | null = null;

// Calculates exponential reconnect backoff with random jitter (1s - 15s)
function getBackoffDelay(): number {
  const base = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 15000);
  const jitter = Math.random() * 1000;
  return base + jitter;
}

export function initSocket(): Socket {
  if (socketInstance) return socketInstance;

  const store = useChatStore.getState();
  store.setConnectionStatus("connecting");

  socketInstance = io("/", {
    auth: (cb) => {
      cb({ token: getAccessToken() });
    },
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
  });

  // Connection established
  socketInstance.on("connect", async () => {
    reconnectAttempts = 0;
    store.setConnectionStatus("connected");

    // Start presence heartbeat
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      socketInstance?.emit("presence:heartbeat");
    }, 25000);

    // 1. Drain offline outbox
    await drainOutbox();

    // 2. Perform sync:request across all loaded chats to backfill missed history
    await syncAllChats();
  });

  // Reconnection and disconnect lifecycle
  socketInstance.on("disconnect", (reason) => {
    store.setConnectionStatus("reconnecting");
    if (heartbeatInterval) clearInterval(heartbeatInterval);
  });

  socketInstance.on("connect_error", async (err: any) => {
    reconnectAttempts++;
    store.setConnectionStatus("reconnecting");

    // Automatic token refresh when server reports TOKEN_EXPIRED
    if (err.message === "TOKEN_EXPIRED" || err.data?.code === "TOKEN_EXPIRED") {
      const refreshToken = getStoredRefreshToken();
      if (refreshToken) {
        try {
          const { data } = await api.post("/auth/refresh", { refreshToken });
          setAccessToken(data.accessToken);
          setStoredRefreshToken(data.refreshToken);

          // Retry socket connection immediately with fresh token
          socketInstance?.connect();
        } catch {
          store.logout();
        }
      }
    }
  });

  // Incoming message handler
  socketInstance.on("message:new", (newMsg: ChatMessage) => {
    const state = useChatStore.getState();
    const currentChat = state.chats.find((c) => c.id === newMsg.chatId);
    const lastSeq = currentChat?.lastSeq || 0;

    // Detect sequence gaps: if incoming seq > lastSeq + 1, sync backfill
    if (newMsg.seq > lastSeq + 1 && lastSeq > 0) {
      syncChatHistory(newMsg.chatId, lastSeq);
    }

    // Add to message stream (Zustand store handles deduplication by clientMsgId and id)
    state.addMessage({ ...newMsg, status: "sent" });

    // Clean outbox confirmed message
    if (newMsg.clientMsgId) {
      removeConfirmedMessage(newMsg.clientMsgId);
    }

    // Auto-send receipts
    const isActiveTab = !document.hidden;
    const isCurrentOpenChat = state.activeChatId === newMsg.chatId;

    if (isActiveTab && isCurrentOpenChat) {
      socketInstance?.emit("receipt:read", {
        chatId: newMsg.chatId,
        upToSeq: newMsg.seq,
      });
    } else {
      socketInstance?.emit("receipt:delivered", {
        chatId: newMsg.chatId,
        upToSeq: newMsg.seq,
      });
    }
  });

  // Receipt progress update
  socketInstance.on("receipt:update", (data: { chatId: string; lastDeliveredSeq: number; lastReadSeq: number }) => {
    useChatStore.getState().updateReceipts(data.chatId, data.lastDeliveredSeq, data.lastReadSeq);
  });

  // Reaction update
  socketInstance.on(
    "reaction:update",
    (data: { chatId: string; messageId: string; emoji: string; count: number; action: "added" | "removed" }) => {
      useChatStore.getState().updateReaction(data.chatId, data.messageId, data.emoji, data.count, data.action);
    }
  );

  // Presence status update
  socketInstance.on("presence:update", (data: { userId: string; status: "online" | "offline"; lastSeenAt?: string }) => {
    useChatStore.getState().setPresenceUser(data.userId, data.status, data.lastSeenAt);
  });

  // Typing indicator update
  socketInstance.on("typing:update", (data: { chatId: string; userId: string; isTyping: boolean }) => {
    useChatStore.getState().setTypingUser(data.chatId, data.userId, data.isTyping);
  });

  // Group metadata updates
  socketInstance.on("group:updated", (data: { chatId: string; name: string }) => {
    const chat = useChatStore.getState().chats.find((c) => c.id === data.chatId);
    if (chat) {
      useChatStore.getState().upsertChat({ ...chat, name: data.name });
    }
  });

  return socketInstance;
}

export function getSocket(): Socket | null {
  return socketInstance;
}

export function closeSocket() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

// Drains pending messages stored in IndexedDB outbox
export async function drainOutbox(): Promise<void> {
  const pending = await getAllPendingMessages();
  if (pending.length === 0 || !socketInstance?.connected) return;

  for (const item of pending) {
    try {
      socketInstance.emit(
        "message:send",
        {
          chatId: item.chatId,
          clientMsgId: item.clientMsgId,
          body: item.body,
          fileId: item.fileId,
          messageType: item.messageType || "text",
        },
        async (ack: any) => {
          if (ack?.error) {
            await markMessageFailed(item.clientMsgId);
            useChatStore.getState().markPendingMessageFailed(item.chatId, item.clientMsgId);
          } else {
            await removeConfirmedMessage(item.clientMsgId);
          }
        }
      );
    } catch {
      break;
    }
  }
}

// Requests missing messages since last known sequence number
export async function syncChatHistory(chatId: string, lastSeq: number): Promise<void> {
  if (!socketInstance?.connected) return;

  socketInstance.emit(
    "sync:request",
    { chats: [{ chatId, lastSeq }] },
    (res: any) => {
      if (res?.chats && Array.isArray(res.chats)) {
        res.chats.forEach((c: any) => {
          if (c.messages?.length > 0) {
            c.messages.forEach((m: ChatMessage) => {
              useChatStore.getState().addMessage(m);
            });
          }
        });
      }
    }
  );
}

// Synchronizes all chats loaded in sidebar
export async function syncAllChats(): Promise<void> {
  const chats = useChatStore.getState().chats;
  if (chats.length === 0 || !socketInstance?.connected) return;

  const payload = chats.map((c) => ({
    chatId: c.id,
    lastSeq: c.lastSeq || 0,
  }));

  socketInstance.emit("sync:request", { chats: payload }, (res: any) => {
    if (res?.chats) {
      res.chats.forEach((c: any) => {
        if (c.messages?.length > 0) {
          c.messages.forEach((m: ChatMessage) => {
            useChatStore.getState().addMessage(m);
          });
        }
      });
    }
  });
}
