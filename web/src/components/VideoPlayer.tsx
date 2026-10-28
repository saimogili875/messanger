// web/src/components/VideoPlayer.tsx
// HTML5 video player component with WebP poster frame, HTTP Range seeking support, and clean controls.

import React, { useRef, useState } from "react";

export interface VideoPlayerProps {
  src: string;
  posterUrl?: string;
  mimeType?: string;
  durationSeconds?: number;
  fileName?: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  posterUrl,
  mimeType = "video/mp4",
  durationSeconds,
  fileName,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainderSecs = Math.floor(secs % 60);
    return `${mins}:${remainderSecs < 10 ? "0" : ""}${remainderSecs}`;
  };

  const handlePlayPause = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: "480px",
        borderRadius: "12px",
        overflow: "hidden",
        backgroundColor: "#0f172a",
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
        position: "relative",
      }}
    >
      {fileName && (
        <div
          style={{
            padding: "8px 12px",
            fontSize: "12px",
            color: "#94a3b8",
            backgroundColor: "rgba(15, 23, 42, 0.9)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {fileName}
          {durationSeconds ? ` (${formatDuration(durationSeconds)})` : ""}
        </div>
      )}

      {hasError ? (
        <div
          style={{
            padding: "32px",
            textAlign: "center",
            color: "#ef4444",
            fontSize: "14px",
          }}
        >
          Failed to load video stream or playback URL expired.
        </div>
      ) : (
        <video
          ref={videoRef}
          controls
          preload="metadata"
          poster={posterUrl}
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={() => setHasError(true)}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            maxHeight: "360px",
            backgroundColor: "#000",
          }}
        >
          {/* S3/R2 signed URL supports HTTP 206 Partial Content byte ranges for instant seeking */}
          <source src={src} type={mimeType} />
          Your browser does not support HTML5 video playback.
        </video>
      )}
    </div>
  );
};

