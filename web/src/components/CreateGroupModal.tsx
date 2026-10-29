// web/src/components/CreateGroupModal.tsx
// Modal for creating new group conversations with member invitations.

import React, { useState } from "react";
import { X, Users, UserPlus } from "lucide-react";
import { api } from "../services/api";
import { useChatStore } from "../store/useChatStore";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateGroupModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [name, setName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberIds, setMemberIds] = useState<Array<{ id: string; email: string; displayName: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upsertChat = useChatStore((s) => s.upsertChat);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);

  if (!isOpen) return null;

  const handleAddMember = async () => {
    if (!memberEmail.trim()) return;
    try {
      const res = await api.get(`/users/search?q=${encodeURIComponent(memberEmail.trim())}`);
      const found = res.data;
      if (!found || found.length === 0) {
        setError("User not found");
        return;
      }
      const user = found[0];
      if (memberIds.some((m) => m.id === user.id)) {
        setError("User already added");
        return;
      }
      setMemberIds([...memberIds, user]);
      setMemberEmail("");
      setError(null);
    } catch {
      setError("Failed to search user");
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await api.post("/groups", {
        name: name.trim(),
        memberIds: memberIds.map((m) => m.id),
      });

      const newGroup = res.data;
      upsertChat(newGroup);
      setActiveChatId(newGroup.id);
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.response?.data?.error || "Failed to create group");
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
          maxWidth: "460px",
          backgroundColor: "var(--bg-card)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: "var(--space-6)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Create New Group</h2>
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

        <form onSubmit={handleCreateGroup} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
              Group Subject / Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Project Developers"
              value={name}
              onChange={(e) => setName(e.target.value)}
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

          <div>
            <label style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
              Add Members by Email
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="email"
                placeholder="colleague@example.com"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-strong)",
                  backgroundColor: "var(--bg-input)",
                  fontSize: "var(--text-sm)",
                }}
              />
              <button
                type="button"
                onClick={handleAddMember}
                style={{
                  padding: "8px 14px",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "var(--bg-input)",
                  border: "1px solid var(--border-strong)",
                  fontSize: "var(--text-sm)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <UserPlus size={16} />
                Add
              </button>
            </div>

            {/* Selected members list */}
            {memberIds.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                {memberIds.map((m) => (
                  <span
                    key={m.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      backgroundColor: "var(--bg-pill)",
                      borderRadius: "var(--radius-full)",
                      padding: "4px 10px",
                      fontSize: "12px",
                    }}
                  >
                    {m.displayName}
                    <button
                      type="button"
                      onClick={() => setMemberIds(memberIds.filter((item) => item.id !== m.id))}
                      style={{ padding: 0, minHeight: 0, minWidth: 0, color: "var(--text-muted)" }}
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "var(--space-2)" }}>
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
              disabled={loading || !name.trim()}
              style={{
                padding: "8px 18px",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--accent-primary)",
                color: "#ffffff",
                fontSize: "var(--text-sm)",
                fontWeight: 600,
              }}
            >
              {loading ? "Creating..." : "Create Group"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
