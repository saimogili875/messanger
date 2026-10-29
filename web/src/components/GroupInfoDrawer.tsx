// web/src/components/GroupInfoDrawer.tsx
// Information drawer for managing group participants, role assignments, and ownership transfer.

import React, { useState, useEffect } from "react";
import { X, Shield, ShieldAlert, UserMinus, LogOut, UserCheck, Trash2 } from "lucide-react";
import { api } from "../services/api";
import { useChatStore, ChatItem } from "../store/useChatStore";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  chat: ChatItem;
}

interface MemberDetail {
  userId: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
}

export const GroupInfoDrawer: React.FC<Props> = ({ isOpen, onClose, chat }) => {
  const [members, setMembers] = useState<MemberDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentUser = useChatStore((s) => s.currentUser);
  const upsertChat = useChatStore((s) => s.upsertChat);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);

  const myMembership = members.find((m) => m.userId === currentUser?.id);
  const isOwner = myMembership?.role === "owner";
  const isAdmin = isOwner || myMembership?.role === "admin";

  const fetchMembers = async () => {
    if (chat.type !== "group") return;
    setLoading(true);
    try {
      const res = await api.get(`/groups/${chat.id}/members`);
      setMembers(res.data);
    } catch (err: any) {
      setError("Failed to load group members");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMembers();
    }
  }, [isOpen, chat.id]);

  if (!isOpen) return null;

  const handleRoleChange = async (userId: string, newRole: "admin" | "member") => {
    try {
      await api.patch(`/groups/${chat.id}/members/${userId}`, { role: newRole });
      fetchMembers();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update role");
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm("Are you sure you want to remove this member?")) return;
    try {
      await api.delete(`/groups/${chat.id}/members/${userId}`);
      fetchMembers();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to remove member");
    }
  };

  const handleLeaveGroup = async () => {
    if (!currentUser) return;
    if (isOwner) {
      alert("Transfer ownership first before leaving the group.");
      return;
    }
    if (!confirm("Are you sure you want to leave this group?")) return;
    try {
      await api.delete(`/groups/${chat.id}/members/${currentUser.id}`);
      setActiveChatId(null);
      onClose();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to leave group");
    }
  };

  const handleTransferOwnership = async (userId: string) => {
    if (!confirm("Are you sure you want to transfer ownership? You will become an admin.")) return;
    try {
      await api.post(`/groups/${chat.id}/transfer-ownership`, { userId });
      fetchMembers();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to transfer ownership");
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        width: "100%",
        maxWidth: "380px",
        backgroundColor: "var(--bg-sidebar)",
        borderLeft: "1px solid var(--border-subtle)",
        boxShadow: "var(--shadow-lg)",
        zIndex: 90,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <h2 style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>Group Details</h2>
        <button onClick={onClose} style={{ color: "var(--text-muted)" }}>
          <X size={20} />
        </button>
      </div>

      {/* Group Subject */}
      <div style={{ padding: "20px 16px", textAlign: "center", borderBottom: "1px solid var(--border-subtle)" }}>
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "var(--radius-full)",
            backgroundColor: "var(--accent-primary)",
            color: "#ffffff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: "24px",
            marginBottom: "10px",
          }}
        >
          {chat.name.slice(0, 2).toUpperCase()}
        </div>
        <h3 style={{ fontSize: "var(--text-lg)", fontWeight: 600 }}>{chat.name}</h3>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
          Group • {members.length} members
        </span>
      </div>

      {/* Participants */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        <h4 style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "12px" }}>
          Participants ({members.length})
        </h4>

        {loading ? (
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Loading members...</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {members.map((member) => {
              const isSelf = member.userId === currentUser?.id;
              return (
                <div
                  key={member.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    borderRadius: "var(--radius-md)",
                    backgroundColor: "var(--bg-input)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                      style={{
                        width: "34px",
                        height: "34px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: "var(--border-strong)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "12px",
                        fontWeight: 600,
                      }}
                    >
                      {member.displayName.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, display: "block" }}>
                        {member.displayName} {isSelf && "(You)"}
                      </span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          color: member.role === "owner" ? "var(--accent-warning)" : member.role === "admin" ? "var(--accent-primary)" : "var(--text-muted)",
                        }}
                      >
                        {member.role}
                      </span>
                    </div>
                  </div>

                  {/* Actions for admins / owners */}
                  {!isSelf && (
                    <div style={{ display: "flex", gap: "4px" }}>
                      {isOwner && member.role !== "owner" && (
                        <>
                          <button
                            title={member.role === "admin" ? "Demote to Member" : "Promote to Admin"}
                            onClick={() => handleRoleChange(member.userId, member.role === "admin" ? "member" : "admin")}
                            style={{ color: "var(--text-secondary)", padding: "4px" }}
                          >
                            <Shield size={16} />
                          </button>
                          <button
                            title="Transfer Ownership"
                            onClick={() => handleTransferOwnership(member.userId)}
                            style={{ color: "var(--accent-warning)", padding: "4px" }}
                          >
                            <ShieldAlert size={16} />
                          </button>
                        </>
                      )}

                      {isAdmin && (isOwner || member.role === "member") && (
                        <button
                          title="Remove Member"
                          onClick={() => handleRemoveMember(member.userId)}
                          style={{ color: "var(--accent-danger)", padding: "4px" }}
                        >
                          <UserMinus size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer / Leave Group */}
      <div style={{ padding: "16px", borderTop: "1px solid var(--border-subtle)" }}>
        <button
          onClick={handleLeaveGroup}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "10px",
            borderRadius: "var(--radius-md)",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            color: "var(--accent-danger)",
            fontWeight: 600,
            fontSize: "var(--text-sm)",
          }}
        >
          <LogOut size={16} />
          Leave Group
        </button>
      </div>
    </div>
  );
};

