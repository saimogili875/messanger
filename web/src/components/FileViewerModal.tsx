// web/src/components/FileViewerModal.tsx
// Modal displaying lightbox images, PDF documents, and HTML5 video streams.

import React, { useState, useEffect } from "react";
import { X, Download } from "lucide-react";
import { api } from "../services/api";
import { DocumentViewer } from "./DocumentViewer";
import { VideoPlayer } from "./VideoPlayer";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  fileId: string | null;
  messageType: string;
  filename: string;
}

export const FileViewerModal: React.FC<Props> = ({
  isOpen,
  onClose,
  fileId,
  messageType,
  filename,
}) => {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !fileId) return;

    let isMounted = true;
    setLoading(true);

    api
      .get(`/files/${fileId}/download`)
      .then((res) => {
        if (isMounted) {
          setDownloadUrl(res.data.downloadUrl);
        }
      })
      .catch((err) => {
        console.error("Failed to retrieve signed download URL:", err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
      setDownloadUrl(null);
    };
  }, [isOpen, fileId]);

  if (!isOpen || !fileId) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        zIndex: 110,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          color: "#ffffff",
        }}
      >
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{filename}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={filename}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#ffffff", display: "flex", alignItems: "center", gap: "6px", fontSize: "var(--text-xs)" }}
            >
              <Download size={18} /> Download
            </a>
          )}
          <button onClick={onClose} style={{ color: "#ffffff" }}>
            <X size={22} />
          </button>
        </div>
      </div>

      {/* Content Canvas */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <p style={{ color: "#ffffff", fontSize: "var(--text-sm)" }}>Loading media preview...</p>
        ) : !downloadUrl ? (
          <p style={{ color: "var(--accent-danger)", fontSize: "var(--text-sm)" }}>Failed to load preview</p>
        ) : messageType === "image" ? (
          <img
            src={downloadUrl}
            alt={filename}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: "var(--radius-md)",
            }}
          />
        ) : messageType === "video" ? (
          <VideoPlayer src={downloadUrl} fileName={filename} />
        ) : (
          <DocumentViewer
            fileName={filename}
            sizeBytes={0}
            fileType={messageType === "pdf" ? "pdf" : "document"}
            downloadUrl={downloadUrl}
            previewUrl={downloadUrl}
          />
        )}
      </div>
    </div>
  );
};
