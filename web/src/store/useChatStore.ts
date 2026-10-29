// web/src/store/useChatStore.ts
// Central Zustand store for reactive state: auth, chats, messages, presence, typing, and themes.

import { create } from "zustand";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  createdAt?: string;
}

export interface ChatItem {
  id: string;
  type: "direct" | "group";
  name: string;
  role: "owner" | "admin" | "member";
  memberCount: number;
  lastMessage?: {
    id: string;
    body: string;
    senderId: string;
    senderName?: string;
    createdAt: string;
    type: string;
  } | null;
  lastSeq: number;
  lastDeliveredSeq: number;
  lastReadSeq: number;
  unreadCount?: number;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  clientMsgId: string;
  seq: number;
  body: string;
  fileId?: string | null;
  messageType: "text" | "image" | "pdf" | "document" | "video";
  type: "user" | "system";
  meta?: any;
  createdAt: string;
  status?: "pending" | "sent" | "delivered" | "read" | "failed";
  reactions?: Record<string, number>; // emoji -> count
}

export type ConnectionStatus = "connected" | "connecting" | "reconnecting" | "offline";

interface ChatState {
  currentUser: UserProfile | null;
  theme: "light" | "dark";
  connectionStatus: ConnectionStatus;
  chats: ChatItem[];
  activeChatId: string | null;
  messages: Record<string, ChatMessage[]>; // chatId -> messages
  presence: Record<string, { status: "online" | "offline"; lastSeenAt?: string }>;
  typing: Record<string, Set<string>>; // chatId -> set of typing userIds
  searchQuery: string;

  setCurrentUser: (user: UserProfile | null) => void;
  setTheme: (theme: "light" | "dark") => void;
  toggleTheme: () => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setChats: (chats: ChatItem[]) => void;
  upsertChat: (chat: ChatItem) => void;
  setActiveChatId: (chatId: string | null) => void;
  setMessages: (chatId: string, messages: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
  markPendingMessageFailed: (chatId: string, clientMsgId: string) => void;
  updateReceipts: (chatId: string, lastDeliveredSeq: number, lastReadSeq: number) => void;
  updateReaction: (chatId: string, messageId: string, emoji: string, count: number, action: "added" | "removed") => void;
  setTypingUser: (chatId: string, userId: string, isTyping: boolean) => void;
  setPresenceUser: (userId: string, status: "online" | "offline", lastSeenAt?: string) => void;
  setSearchQuery: (q: string) => void;
  logout: () => void;
}

const getInitialTheme = (): "light" | "dark" => {
  const saved = localStorage.getItem("theme_pref");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const useChatStore = create<ChatState>((set, get) => ({
  currentUser: null,
  theme: getInitialTheme(),
  connectionStatus: "connecting",
  chats: [],
  activeChatId: null,
  messages: {},
  presence: {},
  typing: {},
  searchQuery: "",

  setCurrentUser: (user) => set({ currentUser: user }),

  setTheme: (theme) => {
    localStorage.setItem("theme_pref", theme);
    document.documentElement.setAttribute("data-theme", theme);
    set({ theme });
  },

  toggleTheme: () => {
    const next = get().theme === "light" ? "dark" : "light";
    get().setTheme(next);
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  setChats: (chats) => set({ chats }),

  upsertChat: (chat) =>
    set((state) => {
      const idx = state.chats.findIndex((c) => c.id === chat.id);
      let updated: ChatItem[];
      if (idx >= 0) {
        updated = [...state.chats];
        updated[idx] = { ...updated[idx], ...chat };
      } else {
        updated = [chat, ...state.chats];
      }
      return { chats: updated };
    }),

  setActiveChatId: (activeChatId) => set({ activeChatId }),

  setMessages: (chatId, newMessages) =>
    set((state) => {
      // Deduplicate by id and clientMsgId, sort strictly by seq
      const map = new Map<string, ChatMessage>();
      newMessages.forEach((m) => {
        const key = m.id || m.clientMsgId;
        map.set(key, m);
      });
      const sorted = Array.from(map.values()).sort((a, b) => a.seq - b.seq);
      return {
        messages: {
          ...state.messages,
          [chatId]: sorted,
        },
      };
    }),

  addMessage: (msg) =>
    set((state) => {
      const current = state.messages[msg.chatId] || [];
      // Deduplicate: check if this message already exists by ID or by clientMsgId
      const existingIdx = current.findIndex(
        (m) => (msg.id && m.id === msg.id) || (msg.clientMsgId && m.clientMsgId === msg.clientMsgId)
      );

      let updated: ChatMessage[];
      if (existingIdx >= 0) {
        updated = [...current];
        updated[existingIdx] = { ...updated[existingIdx], ...msg, status: msg.status || "sent" };
      } else {
        updated = [...current, msg];
      }

      // Keep confirmed messages sorted by seq; pending ones at the bottom
      updated.sort((a, b) => {
        if (a.seq > 0 && b.seq > 0) return a.seq - b.seq;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      // Update chat last message preview in list
      const chatIdx = state.chats.findIndex((c) => c.id === msg.chatId);
      let updatedChats = state.chats;
      if (chatIdx >= 0) {
        updatedChats = [...state.chats];
        updatedChats[chatIdx] = {
          ...updatedChats[chatIdx],
          lastMessage: {
            id: msg.id,
            body: msg.body,
            senderId: msg.senderId,
            senderName: msg.senderName,
            createdAt: msg.createdAt,
            type: msg.type,
          },
          lastSeq: Math.max(updatedChats[chatIdx].lastSeq, msg.seq),
          updatedAt: msg.createdAt,
        };
        // Float active chat to top
        const [moved] = updatedChats.splice(chatIdx, 1);
        updatedChats.unshift(moved);
      }

      return {
        messages: { ...state.messages, [msg.chatId]: updated },
        chats: updatedChats,
      };
    }),

  markPendingMessageFailed: (chatId, clientMsgId) =>
    set((state) => {
      const current = state.messages[chatId] || [];
      const updated = current.map((m) =>
        m.clientMsgId === clientMsgId ? { ...m, status: "failed" as const } : m
      );
      return { messages: { ...state.messages, [chatId]: updated } };
    }),

  updateReceipts: (chatId, lastDeliveredSeq, lastReadSeq) =>
    set((state) => {
      const current = state.messages[chatId] || [];
      const updated = current.map((m) => {
        if (m.seq <= lastReadSeq) {
          return { ...m, status: "read" as const };
        } else if (m.seq <= lastDeliveredSeq) {
          return { ...m, status: "delivered" as const };
        }
        return m;
      });
      return { messages: { ...state.messages, [chatId]: updated } };
    }),

  updateReaction: (chatId, messageId, emoji, count, action) =>
    set((state) => {
      const current = state.messages[chatId] || [];
      const updated = current.map((m) => {
        if (m.id === messageId) {
          const reactions = { ...(m.reactions || {}) };
          if (count > 0) {
            reactions[emoji] = count;
          } else {
            delete reactions[emoji];
          }
          return { ...m, reactions };
        }
        return m;
      });
      return { messages: { ...state.messages, [chatId]: updated } };
    }),

  setTypingUser: (chatId, userId, isTyping) =>
    set((state) => {
      const setOfUsers = new Set(state.typing[chatId] || []);
      if (isTyping) {
        setOfUsers.add(userId);
      } else {
        setOfUsers.delete(userId);
      }
      return {
        typing: {
          ...state.typing,
          [chatId]: setOfUsers,
        },
      };
    }),

  setPresenceUser: (userId, status, lastSeenAt) =>
    set((state) => ({
      presence: {
        ...state.presence,
        [userId]: { status, lastSeenAt },
      },
    })),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  logout: () => {
    set({
      currentUser: null,
      activeChatId: null,
      chats: [],
      messages: {},
      presence: {},
      typing: {},
      connectionStatus: "offline",
    });
  },
}));
