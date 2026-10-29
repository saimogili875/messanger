// web/src/components/SettingsDrawer.tsx
// Application settings drawer managing appearance, storage quota, and active device sessions.

import React, { useState, useEffect } from "react";
import { X, Moon, Sun, HardDrive, Shield, KeyRound, LogOut, Laptop } from "lucide-react";
import { api, getStoredRefreshToken } from "../services/api";
import { useChatStore } from "../store/useChatStore";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsDrawer: React.FC<Props> = ({ isOpen, onClose }) => {
  const currentUser = useChatStore((s) => s.currentUser);
  const theme = useChatStore((s) => s.theme);
  const setTheme = useChatStore((s) => s.setTheme);
  const logout = useChatStore((s) => s.logout);

  const [storageBytes, setStorageBytes] = useState<number>(0);
  const quotaBytes = 1024 * 1024 * 1024; // 1 GB quota

  useEffect(() => {
    if (isOpen) {
      // In real implementation, can fetch quota usage endpoint
      setStorageBytes(15 * 1024 * 1024); // 15 MB
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleLogout = async () => {
    try {
      const refreshToken = getStoredRefreshToken();
      if (refreshToken) {
        await api.post("/auth/logout", { refreshToken });
      }
    } finally {
      logout();
      onClose();
    }
  };

  const usagePercent = Math.min(100, Math.round((storageBytes / quotaBytes) * 100));

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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <h2 style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>Settings</h2>
        <button onClick={onClose} style={{ color: "var(--text-muted)" }}>
          <X size={20} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "24px" }}>
        {/* Profile Card */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", backgroundColor: "var(--bg-input)", borderRadius: "var(--radius-md)" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--accent-primary)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: "18px",
            }}
          >
            {currentUser?.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h3 style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>{currentUser?.displayName}</h3>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{currentUser?.email}</span>
          </div>
        </div>

        {/* Appearance */}
        <div>
          <h4 style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "8px" }}>
            Appearance
          </h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <button
              onClick={() => setTheme("light")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "10px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-strong)",
                backgroundColor: theme === "light" ? "var(--bg-card-hover)" : "transparent",
                fontWeight: 600,
                fontSize: "var(--text-xs)",
              }}
            >
              <Sun size={16} /> Light
            </button>
            <button
              onClick={() => setTheme("dark")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "10px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-strong)",
                backgroundColor: theme === "dark" ? "var(--bg-card-hover)" : "transparent",
                fontWeight: 600,
                fontSize: "var(--text-xs)",
              }}
            >
              <Moon size={16} /> Dark
            </button>
          </div>
        </div>

        {/* Storage Bar */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
              Cloud Storage Quota
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              {(storageBytes / 1024 / 1024).toFixed(1)} MB / 1 GB
            </span>
          </div>
          <div style={{ height: "6px", backgroundColor: "var(--bg-input)", borderRadius: "3px", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(5, usagePercent)}%`, height: "100%", backgroundColor: "var(--accent-primary)" }} />
          </div>
        </div>

        {/* Security & Extensions */}
        <div>
          <h4 style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "8px" }}>
            Security & Cryptography
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ padding: "10px 12px", borderRadius: "var(--radius-md)", backgroundColor: "var(--bg-input)", opacity: 0.6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>Two-Factor Authentication (2FA)</span>
                <span style={{ fontSize: "10px", backgroundColor: "var(--bg-pill)", padding: "2px 6px", borderRadius: "var(--radius-full)" }}>Coming soon</span>
              </div>
            </div>
            <div style={{ padding: "10px 12px", borderRadius: "var(--radius-md)", backgroundColor: "var(--bg-input)", opacity: 0.6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>End-to-End Encryption (E2EE)</span>
                <span style={{ fontSize: "10px", backgroundColor: "var(--bg-pill)", padding: "2px 6px", borderRadius: "var(--radius-full)" }}>Coming soon</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Logout Footer */}
      <div style={{ padding: "16px", borderTop: "1px solid var(--border-subtle)" }}>
        <button
          onClick={handleLogout}
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
          <LogOut size={16} /> Sign Out
        </button>
      </div>
    </div>
  );
};

