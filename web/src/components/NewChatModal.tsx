// web/src/components/NewChatModal.tsx
// Modal for finding contacts and initiating direct 1-to-1 conversations.

import React, { useState } from "react";
import { X, Search, User } from "lucide-react";
import { api } from "../services/api";
import { useChatStore } from "../store/useChatStore";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const NewChatModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upsertChat = useChatStore((s) => s.upsertChat);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);

  if (!isOpen) return null;

  const handleStartChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientEmail.trim()) return;

    setLoading(true);
    setError(null);

    try {
      // Find user or search
      const userRes = await api.get(`/users/search?q=${encodeURIComponent(recipientEmail.trim())}`);
      const foundUsers = userRes.data;

      if (!foundUsers || foundUsers.length === 0) {
        setError("No user found with that email address");
        return;
      }

      const target = foundUsers[0];
      const chatRes = await api.post("/chats/direct", { recipientId: target.id });
      const newChat = chatRes.data;

      upsertChat(newChat);
      setActiveChatId(newChat.id);
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.response?.data?.error || "Failed to start direct conversation");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "var(--space-4)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          backgroundColor: "var(--bg-card)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: "var(--space-6)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>New Direct Chat</h2>
          <button onClick={onClose} style={{ color: "var(--text-muted)" }}>
            <X size={20} />
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: "var(--radius-md)",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              color: "var(--accent-danger)",
              fontSize: "var(--text-xs)",
              marginBottom: "var(--space-3)",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleStartChat} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
              Recipient Email
            </label>
            <input
              type="email"
              required
              placeholder="friend@example.com"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-strong)",
                backgroundColor: "var(--bg-input)",
                fontSize: "var(--text-sm)",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 16px",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "8px 18px",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--accent-primary)",
                color: "#ffffff",
                fontSize: "var(--text-sm)",
                fontWeight: 600,
              }}
            >
              {loading ? "Starting..." : "Start Chat"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

