// web/src/components/Sidebar.tsx
// Navigation sidebar with search, conversation listing, and new chat/group creation buttons.

import React from "react";
import { MessageSquarePlus, Users, Search, Sun, Moon, Settings, ShieldCheck } from "lucide-react";
import { useChatStore } from "../store/useChatStore";
import { ChatListItem } from "./ChatListItem";

interface Props {
  onOpenNewChat: () => void;
  onOpenNewGroup: () => void;
  onOpenSettings: () => void;
  onOpenGlobalSearch: () => void;
}

export const Sidebar: React.FC<Props> = ({
  onOpenNewChat,
  onOpenNewGroup,
  onOpenSettings,
  onOpenGlobalSearch,
}) => {
  const currentUser = useChatStore((s) => s.currentUser);
  const theme = useChatStore((s) => s.theme);
  const toggleTheme = useChatStore((s) => s.toggleTheme);
  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const [filterQuery, setFilterQuery] = React.useState("");

  const filteredChats = chats.filter((c) =>
    c.name.toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border-subtle)",
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          backgroundColor: "var(--bg-input)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--accent-primary)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: "var(--text-sm)",
            }}
          >
            {currentUser?.displayName ? currentUser.displayName.slice(0, 2).toUpperCase() : "ME"}
          </div>
          <div>
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, display: "block" }}>
              {currentUser?.displayName || "My Account"}
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              {currentUser?.email}
            </span>
          </div>
        </div>

        {/* Action icons */}
        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
          <button
            title="Search messages (Cmd+K)"
            onClick={onOpenGlobalSearch}
            style={{ color: "var(--text-secondary)" }}
          >
            <Search size={19} />
          </button>
          <button
            title="New Direct Chat"
            onClick={onOpenNewChat}
            style={{ color: "var(--text-secondary)" }}
          >
            <MessageSquarePlus size={19} />
          </button>
          <button
            title="New Group Chat"
            onClick={onOpenNewGroup}
            style={{ color: "var(--text-secondary)" }}
          >
            <Users size={19} />
          </button>
          <button
            title="Toggle Theme"
            onClick={toggleTheme}
            style={{ color: "var(--text-secondary)" }}
          >
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button
            title="Settings"
            onClick={onOpenSettings}
            style={{ color: "var(--text-secondary)" }}
          >
            <Settings size={19} />
          </button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "var(--bg-input)",
            borderRadius: "var(--radius-md)",
            padding: "6px 12px",
          }}
        >
          <Search size={16} style={{ color: "var(--text-muted)" }} />
          <input
            type="text"
            placeholder="Search or start new chat"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            style={{
              width: "100%",
              border: "none",
              backgroundColor: "transparent",
              outline: "none",
              fontSize: "var(--text-sm)",
            }}
          />
        </div>
      </div>

      {/* Conversations Stream */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filteredChats.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-muted)" }}>
            <p style={{ fontSize: "var(--text-sm)" }}>No conversations found</p>
            <button
              onClick={onOpenNewChat}
              style={{
                marginTop: "12px",
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                color: "var(--accent-primary)",
              }}
            >
              Start your first conversation
            </button>
          </div>
        ) : (
          filteredChats.map((chat) => (
            <ChatListItem
              key={chat.id}
              chat={chat}
              isActive={activeChatId === chat.id}
              onSelect={() => setActiveChatId(chat.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
};

