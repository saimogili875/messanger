// web/src/components/SearchModal.tsx
// Global full-text search modal supporting keyboard shortcut (Cmd+K) and match jump.

import React, { useState, useEffect } from "react";
import { X, Search, MessageSquare } from "lucide-react";
import { api } from "../services/api";
import { useChatStore } from "../store/useChatStore";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface SearchResult {
  id: string;
  chatId: string;
  chatName: string;
  senderName: string;
  snippet: string;
  createdAt: string;
}

export const SearchModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setActiveChatId = useChatStore((s) => s.setActiveChatId);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen) onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;

    setLoading(true);
    setError(null);

    try {
      const res = await api.get(`/search/messages?q=${encodeURIComponent(query.trim())}`);
      setResults(res.data.items || []);
    } catch (err: any) {
      setError(err.response?.data?.message || "Search failed. Please try a different query.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectResult = (chatId: string) => {
    setActiveChatId(chatId);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        zIndex: 100,
        paddingTop: "80px",
        padding: "80px 16px 16px 16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "560px",
          backgroundColor: "var(--bg-card)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
          border: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "80vh",
        }}
      >
        {/* Search Input Bar */}
        <form
          onSubmit={handleSearch}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <Search size={20} style={{ color: "var(--text-muted)" }} />
          <input
            type="text"
            autoFocus
            placeholder="Search all conversations and messages... (Press Enter)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              border: "none",
              backgroundColor: "transparent",
              outline: "none",
              fontSize: "var(--text-base)",
            }}
          />
          <button type="button" onClick={onClose} style={{ color: "var(--text-muted)" }}>
            <X size={20} />
          </button>
        </form>

        {/* Results */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          {loading ? (
            <p style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
              Searching conversations...
            </p>
          ) : error ? (
            <p style={{ color: "var(--accent-danger)", fontSize: "var(--text-xs)", textAlign: "center" }}>{error}</p>
          ) : results.length === 0 ? (
            <p style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
              {query.trim().length >= 2 ? "No matching messages found" : "Type at least 2 characters to search"}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {results.map((r) => (
                <div
                  key={r.id}
                  onClick={() => handleSelectResult(r.chatId)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "var(--radius-md)",
                    backgroundColor: "var(--bg-input)",
                    cursor: "pointer",
                    transition: "var(--transition-fast)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
                    <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--accent-primary)" }}>
                      {r.chatName} • {r.senderName}
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                      {new Date(r.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <p
                    style={{ fontSize: "var(--text-sm)", margin: 0 }}
                    dangerouslySetInnerHTML={{ __html: r.snippet.replace(/<<mark>>/g, "<mark>").replace(/<<\/mark>>/g, "</mark>") }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
