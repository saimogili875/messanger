// web/src/App.tsx
// Root application component managing authentication state and realtime socket initialization.

import React, { useEffect, useState } from "react";
import { useChatStore } from "./store/useChatStore";
import { AuthScreen } from "./components/AuthScreen";
import { AppLayout } from "./components/AppLayout";
import { initSocket, closeSocket } from "./services/socket";
import { api, getStoredRefreshToken } from "./services/api";

export const App: React.FC = () => {
  const currentUser = useChatStore((s) => s.currentUser);
  const setCurrentUser = useChatStore((s) => s.setCurrentUser);
  const theme = useChatStore((s) => s.theme);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Apply initial theme attribute on mount
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Check existing session on boot
  useEffect(() => {
    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) {
      setCheckingAuth(false);
      return;
    }

    api
      .get("/me")
      .then((res) => {
        setCurrentUser(res.data);
      })
      .catch(() => {
        setCurrentUser(null);
      })
      .finally(() => {
        setCheckingAuth(false);
      });
  }, [setCurrentUser]);

  // Initialize socket when authenticated
  useEffect(() => {
    if (currentUser) {
      initSocket();
    } else {
      closeSocket();
    }
    return () => {
      closeSocket();
    };
  }, [currentUser]);

  if (checkingAuth) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          backgroundColor: "var(--bg-app)",
          color: "var(--text-muted)",
          fontSize: "var(--text-sm)",
        }}
      >
        Initializing messenger...
      </div>
    );
  }

  return currentUser ? <AppLayout /> : <AuthScreen />;
};

