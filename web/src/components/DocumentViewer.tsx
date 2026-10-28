// web/src/components/DocumentViewer.tsx
// Document attachment card displaying metadata, original download button, and inline PDF preview modal.

import React, { useState } from "react";

export interface DocumentViewerProps {
  fileName: string;
  sizeBytes: number;
  fileType: "document" | "pdf";
  downloadUrl: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  pageCount?: number;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  fileName,
  sizeBytes,
  fileType,
  downloadUrl,
  previewUrl,
  thumbnailUrl,
  pageCount,
}) => {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getDocBadgeColor = () => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "pdf":
        return "#ef4444"; // red
      case "docx":
      case "doc":
        return "#2563eb"; // blue
      case "xlsx":
      case "xls":
        return "#16a34a"; // green
      case "pptx":
      case "ppt":
        return "#ea580c"; // orange
      default:
        return "#64748b";
    }
  };

  const ext = (fileName.split(".").pop() || "doc").toUpperCase();

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: "10px",
        padding: "12px",
        maxWidth: "380px",
        backgroundColor: "#ffffff",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt="Thumbnail"
            style={{
              width: "48px",
              height: "64px",
              objectFit: "cover",
              borderRadius: "4px",
              border: "1px solid #cbd5e1",
            }}
          />
        ) : (
          <div
            style={{
              width: "48px",
              height: "56px",
              backgroundColor: getDocBadgeColor(),
              color: "#fff",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
              fontSize: "12px",
            }}
          >
            {ext}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "#1e293b",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={fileName}
          >
            {fileName}
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
            {formatSize(sizeBytes)} {pageCount ? `• ${pageCount} pages` : ""}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: "8px",
          marginTop: "12px",
          borderTop: "1px solid #f1f5f9",
          paddingTop: "8px",
        }}
      >
        {previewUrl && (
          <button
            onClick={() => setIsPreviewOpen(true)}
            style={{
              flex: 1,
              padding: "6px 12px",
              fontSize: "12px",
              fontWeight: 500,
              color: "#2563eb",
              backgroundColor: "#eff6ff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Preview
          </button>
        )}

        <a
          href={downloadUrl}
          download={fileName}
          style={{
            flex: 1,
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 500,
            color: "#ffffff",
            backgroundColor: "#2563eb",
            borderRadius: "6px",
            textAlign: "center",
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          Download Original
        </a>
      </div>

      {/* PDF preview modal dialog */}
      {isPreviewOpen && previewUrl && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "850px",
              height: "90vh",
              backgroundColor: "#fff",
              borderRadius: "12px",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                borderBottom: "1px solid #e2e8f0",
              }}
            >
              <span style={{ fontWeight: 600, color: "#1e293b" }}>{fileName} (Preview)</span>
              <button
                onClick={() => setIsPreviewOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "18px",
                  cursor: "pointer",
                  color: "#64748b",
                }}
              >
                ✕
              </button>
            </div>
            <iframe
              src={previewUrl}
              title="PDF Document Preview"
              style={{
                flex: 1,
                width: "100%",
                border: "none",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

