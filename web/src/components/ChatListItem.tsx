// web/src/components/ChatListItem.tsx
// Renders an individual conversation item in the sidebar list with presence dot and unread badge.

import React from "react";
import { Users, User as UserIcon } from "lucide-react";
import { ChatItem, useChatStore } from "../store/useChatStore";

interface Props {
  chat: ChatItem;
  isActive: boolean;
  onSelect: () => void;
}

export const ChatListItem: React.FC<Props> = ({ chat, isActive, onSelect }) => {
  const presence = useChatStore((s) => s.presence);
  const typing = useChatStore((s) => s.typing[chat.id]);
  const isDirect = chat.type === "direct";

  // Check presence for 1-to-1 chats
  const isOnline = isDirect && presence[chat.id]?.status === "online";
  const hasTyping = typing && typing.size > 0;

  // Format timestamp nicely
  const formatTime = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        cursor: "pointer",
        backgroundColor: isActive ? "var(--bg-card-hover)" : "transparent",
        borderBottom: "1px solid var(--border-subtle)",
        transition: "var(--transition-fast)",
      }}
    >
      {/* Avatar */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "var(--radius-full)",
            backgroundColor: isDirect ? "var(--border-strong)" : "var(--accent-primary)",
            color: isDirect ? "var(--text-primary)" : "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            fontSize: "var(--text-md)",
          }}
        >
          {isDirect ? (
            chat.name ? chat.name.slice(0, 2).toUpperCase() : <UserIcon size={22} />
          ) : (
            chat.name ? chat.name.slice(0, 2).toUpperCase() : <Users size={22} />
          )}
        </div>
        {isOnline && (
          <div
            title="Online"
            style={{
              position: "absolute",
              bottom: "2px",
              right: "2px",
              width: "12px",
              height: "12px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--accent-online)",
              border: "2px solid var(--bg-sidebar)",
            }}
          />
        )}
      </div>

      {/* Details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
          <h3
            style={{
              fontSize: "var(--text-base)",
              fontWeight: 600,
              color: "var(--text-primary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {chat.name || "Conversation"}
          </h3>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", flexShrink: 0 }}>
            {formatTime(chat.lastMessage?.createdAt || chat.updatedAt)}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p
            style={{
              fontSize: "var(--text-sm)",
              color: hasTyping ? "var(--accent-primary)" : "var(--text-secondary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              margin: 0,
              fontStyle: hasTyping ? "italic" : "normal",
            }}
          >
            {hasTyping
              ? "typing..."
              : chat.lastMessage
              ? (chat.lastMessage.senderName ? `${chat.lastMessage.senderName}: ` : "") + chat.lastMessage.body
              : "No messages yet"}
          </p>

          {chat.unreadCount && chat.unreadCount > 0 ? (
            <span
              style={{
                backgroundColor: "var(--accent-primary)",
                color: "#ffffff",
                fontSize: "11px",
                fontWeight: 700,
                borderRadius: "var(--radius-full)",
                padding: "2px 6px",
                minWidth: "18px",
                textAlign: "center",
                marginLeft: "6px",
              }}
            >
              {chat.unreadCount}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};

