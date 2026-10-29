// web/src/components/AppLayout.tsx
// Responsive application layout coordinating navigation sidebar, chat viewport, and modal drawers.

import React, { useState, useEffect } from "react";
import { ConnectionBanner } from "./ConnectionBanner";
import { Sidebar } from "./Sidebar";
import { ChatScreen } from "./ChatScreen";
import { NewChatModal } from "./NewChatModal";
import { CreateGroupModal } from "./CreateGroupModal";
import { GroupInfoDrawer } from "./GroupInfoDrawer";
import { SearchModal } from "./SearchModal";
import { SettingsDrawer } from "./SettingsDrawer";
import { FileViewerModal } from "./FileViewerModal";
import { useChatStore } from "../store/useChatStore";
import { api } from "../services/api";

export const AppLayout: React.FC = () => {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const setChats = useChatStore((s) => s.setChats);
  const chats = useChatStore((s) => s.chats);
  const currentChat = chats.find((c) => c.id === activeChatId);

  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [isNewGroupOpen, setIsNewGroupOpen] = useState(false);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [viewerFile, setViewerFile] = useState<{
    fileId: string;
    messageType: string;
    filename: string;
  } | null>(null);

  // Load chat conversations on initial load
  useEffect(() => {
    api
      .get("/chats")
      .then((res) => {
        setChats(res.data);
      })
      .catch((err) => {
        console.error("Failed to load user chats:", err);
      });
  }, [setChats]);

  // Global keyboard shortcut (Cmd+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsGlobalSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        backgroundColor: "var(--bg-app)",
      }}
    >
      {/* Top Reconnect Banner */}
      <ConnectionBanner />

      {/* Main Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        {/* Sidebar */}
        <div
          style={{
            width: "360px",
            minWidth: "300px",
            maxWidth: "420px",
            height: "100%",
            display: "flex",
            flexShrink: 0,
          }}
        >
          <Sidebar
            onOpenNewChat={() => setIsNewChatOpen(true)}
            onOpenNewGroup={() => setIsNewGroupOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenGlobalSearch={() => setIsGlobalSearchOpen(true)}
          />
        </div>

        {/* Chat Screen Viewport */}
        <div style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column" }}>
          <ChatScreen
            onOpenInfo={() => setIsGroupInfoOpen(true)}
            onViewFile={(fileId, messageType, filename) =>
              setViewerFile({ fileId, messageType, filename })
            }
          />
        </div>

        {/* Group Info Drawer */}
        {currentChat && (
          <GroupInfoDrawer
            isOpen={isGroupInfoOpen}
            onClose={() => setIsGroupInfoOpen(false)}
            chat={currentChat}
          />
        )}
      </div>

      {/* Modals & Dialogs */}
      <NewChatModal isOpen={isNewChatOpen} onClose={() => setIsNewChatOpen(false)} />
      <CreateGroupModal isOpen={isNewGroupOpen} onClose={() => setIsNewGroupOpen(false)} />
      <SearchModal isOpen={isGlobalSearchOpen} onClose={() => setIsGlobalSearchOpen(false)} />
      <SettingsDrawer isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <FileViewerModal
        isOpen={!!viewerFile}
        onClose={() => setViewerFile(null)}
        fileId={viewerFile?.fileId || null}
        messageType={viewerFile?.messageType || "document"}
        filename={viewerFile?.filename || "file"}
      />
    </div>
  );
};
