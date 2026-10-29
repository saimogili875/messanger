// web/src/components/ConnectionBanner.tsx
// Displays status alert banners for socket reconnecting and offline states.

import React from "react";
import { AlertCircle, WifiOff } from "lucide-react";
import { useChatStore } from "../store/useChatStore";

export const ConnectionBanner: React.FC = () => {
  const connectionStatus = useChatStore((s) => s.connectionStatus);

  if (connectionStatus === "connected") return null;

  const isReconnecting = connectionStatus === "reconnecting" || connectionStatus === "connecting";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: "6px 12px",
        fontSize: "var(--text-xs)",
        fontWeight: 500,
        backgroundColor: isReconnecting ? "var(--accent-warning)" : "var(--accent-danger)",
        color: "#ffffff",
        transition: "var(--transition-fast)",
        zIndex: 50,
      }}
    >
      {isReconnecting ? (
        <>
          <AlertCircle size={14} />
          <span>Reconnecting to messenger... Messages will send automatically when online.</span>
        </>
      ) : (
        <>
          <WifiOff size={14} />
          <span>Offline. Outbox will queue messages and send once reconnected.</span>
        </>
      )}
    </div>
  );
};
