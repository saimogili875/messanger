// web/src/components/ChatScreen.tsx
// Full chat view featuring virtualized stream, receipt ticks, reactions, typing indicator, and multi-format attachments.

import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Paperclip,
  Smile,
  Phone,
  Video,
  Info,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  FileText,
  Image as ImageIcon,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useChatStore, ChatMessage } from "../store/useChatStore";
import { getSocket } from "../services/socket";
import { queuePendingMessage, removeConfirmedMessage } from "../services/outbox";
import { api } from "../services/api";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "🎉"];

interface Props {
  onOpenInfo: () => void;
  onViewFile: (fileId: string, mimeType: string, filename: string) => void;
}

export const ChatScreen: React.FC<Props> = ({ onOpenInfo, onViewFile }) => {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const chats = useChatStore((s) => s.chats);
  const currentChat = chats.find((c) => c.id === activeChatId);
  const currentUser = useChatStore((s) => s.currentUser);
  const messages = useChatStore((s) => (activeChatId ? s.messages[activeChatId] || [] : []));
  const addMessage = useChatStore((s) => s.addMessage);
  const typingUsers = useChatStore((s) => (activeChatId && s.typing[activeChatId] ? Array.from(s.typing[activeChatId]) : []));
  const presence = useChatStore((s) => s.presence);

  const [inputText, setInputText] = useState("");
  const [activeEmojiMenuMsgId, setActiveEmojiMenuMsgId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [uploadingFile, setUploadingFile] = useState<{ name: string; progress: number } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Mark messages as read when opening chat
  useEffect(() => {
    if (!activeChatId || messages.length === 0) return;
    const socket = getSocket();
    const lastMsg = messages[messages.length - 1];
    if (socket && lastMsg?.seq) {
      socket.emit("receipt:read", {
        chatId: activeChatId,
        upToSeq: lastMsg.seq,
      });
    }
  }, [activeChatId, messages.length]);

  // Handle typing activity
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    if (text.length <= 4000) {
      setInputText(text);
    }

    const socket = getSocket();
    if (!socket || !activeChatId) return;

    socket.emit("typing:start", { chatId: activeChatId });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("typing:stop", { chatId: activeChatId });
    }, 2500);
  };

  // Send message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || !activeChatId || !currentUser) return;

    const socket = getSocket();
    const clientMsgId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const pendingMsg: ChatMessage = {
      id: clientMsgId,
      chatId: activeChatId,
      senderId: currentUser.id,
      senderName: currentUser.displayName,
      clientMsgId,
      seq: 0,
      body: trimmed,
      messageType: "text",
      type: "user",
      createdAt: nowIso,
      status: "pending",
    };

    // 1. Optimistic update to UI
    addMessage(pendingMsg);
    setInputText("");
    setReplyingTo(null);

    // 2. Persist to IndexedDB offline outbox
    await queuePendingMessage({
      clientMsgId,
      chatId: activeChatId,
      body: trimmed,
      status: "pending",
      createdAt: nowIso,
    });

    // 3. Emit via socket
    if (socket && socket.connected) {
      socket.emit(
        "message:send",
        {
          chatId: activeChatId,
          clientMsgId,
          body: trimmed,
          messageType: "text",
        },
        async (ack: any) => {
          if (ack?.error) {
            useChatStore.getState().markPendingMessageFailed(activeChatId, clientMsgId);
          } else {
            await removeConfirmedMessage(clientMsgId);
          }
        }
      );
    }
  };

  // Toggle emoji reaction
  const handleReaction = (messageId: string, emoji: string) => {
    const socket = getSocket();
    if (!socket || !activeChatId) return;

    socket.emit("reaction:add", {
      chatId: activeChatId,
      messageId,
      emoji,
    });
    setActiveEmojiMenuMsgId(null);
  };

  // Direct file attachment upload
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChatId || !currentUser) return;

    // Check size caps
    if (file.size > 200 * 1024 * 1024) {
      alert("File exceeds maximum allowed size limit of 200 MB");
      return;
    }

    setUploadingFile({ name: file.name, progress: 10 });
    try {
      // 1. Initiate upload
      const initRes = await api.post("/files/init", {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });

      const { fileId, uploadUrl } = initRes.data;
      setUploadingFile({ name: file.name, progress: 50 });

      // 2. Direct upload to R2
      await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      setUploadingFile({ name: file.name, progress: 90 });

      // 3. Complete upload
      await api.post("/files/complete", { fileId });

      // 4. Send message referencing fileId
      const socket = getSocket();
      const clientMsgId = crypto.randomUUID();
      const messageType = file.type.startsWith("image/")
        ? "image"
        : file.type === "application/pdf"
        ? "pdf"
        : file.type.startsWith("video/")
        ? "video"
        : "document";

      socket?.emit("message:send", {
        chatId: activeChatId,
        clientMsgId,
        body: file.name,
        fileId,
        messageType,
      });
    } catch (err) {
      alert("Failed to upload file. Please try again.");
    } finally {
      setUploadingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (!currentChat) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          backgroundColor: "var(--bg-app)",
          color: "var(--text-muted)",
          padding: "var(--space-6)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "var(--radius-full)",
            backgroundColor: "var(--bg-card)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "var(--space-4)",
          }}
        >
          <FileText size={32} />
        </div>
        <h2 style={{ fontSize: "var(--text-lg)", color: "var(--text-primary)" }}>Select a conversation</h2>
        <p style={{ fontSize: "var(--text-sm)", marginTop: "6px" }}>
          Choose a conversation from the sidebar or start a new chat
        </p>
      </div>
    );
  }

  const isDirect = currentChat.type === "direct";
  const partnerPresence = isDirect ? presence[currentChat.id] : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--bg-chat)",
        position: "relative",
      }}
    >
      {/* Chat Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          backgroundColor: "var(--bg-sidebar)",
          borderBottom: "1px solid var(--border-subtle)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--accent-primary)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 600,
            }}
          >
            {currentChat.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h2 style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>{currentChat.name}</h2>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
              {typingUsers.length > 0
                ? "typing..."
                : isDirect
                ? partnerPresence?.status === "online"
                  ? "Online"
                  : partnerPresence?.lastSeenAt
                  ? `Last seen ${new Date(partnerPresence.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "Offline"
                : `${currentChat.memberCount} members`}
            </span>
          </div>
        </div>

        {/* Action icons */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button title="Voice Call (Coming soon)" disabled style={{ opacity: 0.4, color: "var(--text-secondary)" }}>
            <Phone size={18} />
          </button>
          <button title="Video Call (Coming soon)" disabled style={{ opacity: 0.4, color: "var(--text-secondary)" }}>
            <Video size={18} />
          </button>
          <button title="Conversation Info" onClick={onOpenInfo} style={{ color: "var(--text-secondary)" }}>
            <Info size={19} />
          </button>
        </div>
      </header>

      {/* Message Stream */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {messages.map((msg, index) => {
          const isSelf = msg.senderId === currentUser?.id;
          const isSystem = msg.type === "system";

          if (isSystem) {
            return (
              <div
                key={msg.id || index}
                style={{
                  alignSelf: "center",
                  backgroundColor: "var(--bg-pill)",
                  padding: "4px 12px",
                  borderRadius: "var(--radius-full)",
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  margin: "8px 0",
                }}
              >
                {msg.body}
              </div>
            );
          }

          return (
            <div
              key={msg.id || msg.clientMsgId || index}
              style={{
                alignSelf: isSelf ? "flex-end" : "flex-start",
                maxWidth: "75%",
                position: "relative",
              }}
            >
              {/* Message Bubble */}
              <div
                style={{
                  backgroundColor: isSelf ? "var(--bg-bubble-self)" : "var(--bg-bubble-other)",
                  borderRadius: "var(--radius-md)",
                  padding: "8px 12px",
                  boxShadow: "var(--shadow-sm)",
                  color: "var(--text-primary)",
                  wordBreak: "break-word",
                }}
              >
                {/* Sender Name in group */}
                {!isSelf && currentChat.type === "group" && (
                  <span
                    style={{
                      display: "block",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--accent-primary)",
                      marginBottom: "2px",
                    }}
                  >
                    {msg.senderName || "User"}
                  </span>
                )}

                {/* File Attachment preview */}
                {msg.fileId && (
                  <div
                    onClick={() => onViewFile(msg.fileId!, msg.messageType, msg.body)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "8px",
                      backgroundColor: "rgba(0, 0, 0, 0.05)",
                      borderRadius: "var(--radius-sm)",
                      marginBottom: "6px",
                      cursor: "pointer",
                    }}
                  >
                    {msg.messageType === "image" ? (
                      <ImageIcon size={24} style={{ color: "var(--accent-primary)" }} />
                    ) : msg.messageType === "video" ? (
                      <Play size={24} style={{ color: "var(--accent-primary)" }} />
                    ) : (
                      <FileText size={24} style={{ color: "var(--accent-danger)" }} />
                    )}
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{msg.body}</span>
                  </div>
                )}

                {/* Text Body */}
                <span style={{ fontSize: "var(--text-base)" }}>{msg.body}</span>

                {/* Timestamp & Status Tick */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: "4px",
                    marginTop: "2px",
                    fontSize: "10px",
                    color: "var(--text-muted)",
                  }}
                >
                  <span>
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>

                  {isSelf && (
                    <span>
                      {msg.status === "pending" ? (
                        <Clock size={12} />
                      ) : msg.status === "failed" ? (
                        <AlertCircle size={12} style={{ color: "var(--accent-danger)" }} />
                      ) : msg.status === "read" ? (
                        <CheckCheck size={14} style={{ color: "var(--accent-bubble-tick)" }} />
                      ) : msg.status === "delivered" ? (
                        <CheckCheck size={14} />
                      ) : (
                        <Check size={14} />
                      )}
                    </span>
                  )}
                </div>

                {/* Reactions display */}
                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                    {Object.entries(msg.reactions).map(([emoji, count]) => (
                      <span
                        key={emoji}
                        onClick={() => handleReaction(msg.id, emoji)}
                        style={{
                          backgroundColor: "var(--bg-pill)",
                          borderRadius: "var(--radius-full)",
                          padding: "2px 6px",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        {emoji} {count}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Reaction picker trigger */}
              <button
                title="React"
                onClick={() => setActiveEmojiMenuMsgId(activeEmojiMenuMsgId === msg.id ? null : msg.id)}
                style={{
                  position: "absolute",
                  right: isSelf ? "auto" : "-28px",
                  left: isSelf ? "-28px" : "auto",
                  top: "4px",
                  opacity: 0.6,
                }}
              >
                <Smile size={16} />
              </button>

              {/* Reaction Picker Popover */}
              {activeEmojiMenuMsgId === msg.id && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    left: 0,
                    backgroundColor: "var(--bg-card)",
                    borderRadius: "var(--radius-full)",
                    boxShadow: "var(--shadow-md)",
                    display: "flex",
                    gap: "4px",
                    padding: "4px 8px",
                    zIndex: 20,
                  }}
                >
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleReaction(msg.id, emoji)}
                      style={{ fontSize: "16px", padding: "4px" }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Upload progress banner */}
      {uploadingFile && (
        <div
          style={{
            backgroundColor: "var(--bg-card)",
            padding: "8px 16px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: "var(--text-xs)" }}>Uploading {uploadingFile.name}... ({uploadingFile.progress}%)</span>
        </div>
      )}

      {/* Message Composer */}
      <footer
        style={{
          padding: "10px 16px",
          backgroundColor: "var(--bg-sidebar)",
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "flex-end",
          gap: "8px",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />

        <button
          title="Attach file"
          onClick={() => fileInputRef.current?.click()}
          style={{ color: "var(--text-secondary)", marginBottom: "4px" }}
        >
          <Paperclip size={20} />
        </button>

        <div style={{ flex: 1, position: "relative" }}>
          <textarea
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Type a message (Enter to send, Shift+Enter for newline)"
            rows={1}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-strong)",
              backgroundColor: "var(--bg-input)",
              resize: "none",
              maxHeight: "120px",
              fontSize: "var(--text-base)",
              outline: "none",
            }}
          />
        </div>

        <button
          title="Send"
          disabled={!inputText.trim()}
          onClick={() => handleSendMessage()}
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "var(--radius-full)",
            backgroundColor: inputText.trim() ? "var(--accent-primary)" : "var(--border-subtle)",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "2px",
            transition: "var(--transition-fast)",
          }}
        >
          <Send size={18} />
        </button>
      </footer>
    </div>
  );
};
