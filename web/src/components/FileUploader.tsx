// web/src/components/FileUploader.tsx
// Direct client-to-R2 file upload component with SHA-256 calculation, progress bar, and size validation.

import React, { useState, useRef } from "react";

export interface FileUploaderProps {
  apiBaseUrl?: string;
  accessToken: string;
  onUploadComplete: (fileId: string) => void;
  onError?: (errorMessage: string) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  apiBaseUrl = "",
  accessToken,
  onUploadComplete,
  onError,
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Computes SHA-256 hex string using standard browser Web Crypto API
  const calculateSha256 = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(digest));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      setProgress(5);
      setStatusText("Calculating checksum...");

      // 1. Client-side size validation
      const sizeMB = file.size / (1024 * 1024);
      if (file.type.startsWith("image/") && sizeMB > 20) {
        throw new Error("Image exceeds 20 MB size limit");
      }
      if (file.type === "application/pdf" && sizeMB > 50) {
        throw new Error("PDF exceeds 50 MB size limit");
      }
      if (
        (file.name.endsWith(".docx") ||
          file.name.endsWith(".xlsx") ||
          file.name.endsWith(".pptx")) &&
        sizeMB > 50
      ) {
        throw new Error("Document exceeds 50 MB size limit");
      }
      if (file.type.startsWith("video/") && sizeMB > 200) {
        throw new Error("Video exceeds 200 MB size limit");
      }

      // 2. Calculate SHA-256
      const sha256Hash = await calculateSha256(file);
      setProgress(15);
      setStatusText("Initializing upload...");

      // 3. Request presigned upload URL from backend
      const initRes = await fetch(`${apiBaseUrl}/files/init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          sha256Hash,
        }),
      });

      if (!initRes.ok) {
        const errData = await initRes.json().catch(() => ({}));
        throw new Error(errData.error || `Upload init failed (${initRes.status})`);
      }

      const initData = await initRes.json();

      // Deduplication shortcut: if file already exists on server, no upload is needed!
      if (initData.deduplicated) {
        setProgress(100);
        setStatusText("Completed (deduplicated)");
        setIsUploading(false);
        onUploadComplete(initData.fileId);
        return;
      }

      setStatusText("Uploading directly to R2 storage...");
      setProgress(25);

      // 4. Perform direct single PUT or multipart upload to R2
      if (!initData.isMultipart) {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", initData.uploadUrl, true);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable) {
              const percent = 25 + Math.round((evt.loaded / evt.total) * 60);
              setProgress(percent);
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Direct upload failed with status ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error("Direct R2 upload network error"));
          xhr.send(file);
        });

        // 5. Complete single upload
        setStatusText("Finalizing upload...");
        setProgress(90);

        const completeRes = await fetch(`${apiBaseUrl}/files/complete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ fileId: initData.fileId }),
        });

        if (!completeRes.ok) {
          throw new Error("Failed to finalize upload on server");
        }

        setProgress(100);
        setStatusText("Upload complete!");
        onUploadComplete(initData.fileId);
      } else {
        // Multipart upload
        const partSize = 5 * 1024 * 1024;
        const uploadedParts: Array<{ partNumber: number; etag: string }> = [];

        for (let i = 0; i < initData.parts.length; i++) {
          const partInfo = initData.parts[i];
          const start = i * partSize;
          const end = Math.min(start + partSize, file.size);
          const chunk = file.slice(start, end);

          const putRes = await fetch(partInfo.url, {
            method: "PUT",
            body: chunk,
          });

          if (!putRes.ok) {
            throw new Error(`Failed to upload part ${partInfo.partNumber}`);
          }

          const etag = putRes.headers.get("ETag") || `"${i + 1}"`;
          uploadedParts.push({
            partNumber: partInfo.partNumber,
            etag: etag.replace(/["']/g, ""),
          });

          setProgress(25 + Math.round(((i + 1) / initData.parts.length) * 60));
        }

        setStatusText("Finalizing multipart upload...");
        const completeRes = await fetch(`${apiBaseUrl}/files/complete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            fileId: initData.fileId,
            parts: uploadedParts,
          }),
        });

        if (!completeRes.ok) {
          throw new Error("Failed to finalize multipart upload");
        }

        setProgress(100);
        setStatusText("Upload complete!");
        onUploadComplete(initData.fileId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setStatusText(msg);
      onError?.(msg);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div
      style={{
        border: "2px dashed #cbd5e1",
        borderRadius: "12px",
        padding: "20px",
        textAlign: "center",
        backgroundColor: "#f8fafc",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        disabled={isUploading}
        onChange={handleFileSelect}
        style={{ display: "none" }}
        accept="image/*,video/*,application/pdf,.docx,.xlsx,.pptx"
      />

      <button
        type="button"
        disabled={isUploading}
        onClick={() => fileInputRef.current?.click()}
        style={{
          padding: "8px 16px",
          backgroundColor: "#2563eb",
          color: "#ffffff",
          borderRadius: "6px",
          border: "none",
          fontWeight: 600,
          cursor: isUploading ? "not-allowed" : "pointer",
        }}
      >
        {isUploading ? "Uploading..." : "Select Attachment (Image, PDF, Doc, Video)"}
      </button>

      {isUploading && (
        <div style={{ marginTop: "12px" }}>
          <div
            style={{
              width: "100%",
              height: "8px",
              backgroundColor: "#e2e8f0",
              borderRadius: "4px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                backgroundColor: "#2563eb",
                transition: "width 0.2s ease",
              }}
            />
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
            {statusText} ({progress}%)
          </div>
        </div>
      )}
    </div>
  );
};

