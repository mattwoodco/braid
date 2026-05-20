import { useEffect } from "react";
import type { SessionFile } from "../data/api";
import { fileRawUrl } from "../data/api";

type Props = {
  file: SessionFile | null;
  onClose: () => void;
};

export function Lightbox({ file, onClose }: Props) {
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, onClose]);

  if (!file) return null;

  const url = file.url ?? fileRawUrl(file.id);
  const isImage = file.mime_type.startsWith("image/");
  const isVideo = file.mime_type.startsWith("video/");
  const isAudio = file.mime_type.startsWith("audio/");
  const isText =
    file.mime_type.startsWith("text/") ||
    file.mime_type.includes("json") ||
    file.mime_type.includes("xml") ||
    file.mime_type.includes("yaml");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.filename}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(0,0,0,0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <div
        style={{
          position: "relative",
          maxWidth: "100%",
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 10,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "#eee",
            fontSize: 13,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file.filename}
          </span>
          <span style={{ fontSize: 11, color: "#999" }}>{file.mime_type}</span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="braid-icon-btn"
            aria-label="Open in new tab"
            title="Open in new tab"
            style={{ color: "#eee" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>open in new tab</title>
              <path d="M14 3h7v7" />
              <path d="M10 14L21 3" />
              <path d="M21 14v7H3V3h7" />
            </svg>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="braid-icon-btn"
            aria-label="Close"
            style={{ color: "#eee" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>close</title>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div
          style={{
            background: "#111",
            borderRadius: 8,
            border: "1px solid #2a2a2a",
            padding: 12,
            overflow: "auto",
            maxHeight: "calc(100vh - 120px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 200,
          }}
        >
          {isImage ? (
            <img
              src={url}
              alt={file.filename}
              style={{ maxWidth: "100%", maxHeight: "calc(100vh - 160px)", display: "block" }}
            />
          ) : isVideo ? (
            // biome-ignore lint/a11y/useMediaCaption: agent-generated content; captions unavailable.
            <video
              src={url}
              controls
              autoPlay
              style={{ maxWidth: "100%", maxHeight: "calc(100vh - 160px)", display: "block" }}
            />
          ) : isAudio ? (
            // biome-ignore lint/a11y/useMediaCaption: agent-generated content; captions unavailable.
            <audio src={url} controls autoPlay style={{ width: "100%" }} />
          ) : isText ? (
            <TextPreview url={url} />
          ) : (
            <div style={{ color: "#bbb", textAlign: "center", padding: 24 }}>
              <p style={{ margin: 0, fontSize: 13 }}>
                Preview not available for <code>{file.mime_type}</code>.
              </p>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="braid-ghost braid-ghost--sm"
                style={{ marginTop: 12, display: "inline-flex" }}
              >
                Open in new tab
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TextPreview({ url }: { url: string }) {
  // Lazy-fetch & render up to ~64KB of text.
  // biome-ignore lint/correctness/useExhaustiveDependencies: url is the only relevant input.
  return (
    <iframe
      src={url}
      title="file preview"
      style={{
        width: "min(900px, 90vw)",
        height: "min(70vh, 800px)",
        background: "#fff",
        border: "none",
        borderRadius: 4,
      }}
    />
  );
}
