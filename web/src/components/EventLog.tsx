import { useEffect, useId, useRef, useState } from "react";
import type { Agent, FlowEvent } from "../data/mock";
import { type SessionFile, fileRawUrl } from "../data/api";
import { EventPayload } from "./EventPayload";

type Props = {
  agent: Agent | undefined;
  events: FlowEvent[];
  files?: SessionFile[];
  onOpenFile?: (file: SessionFile) => void;
};

const TYPE_COLOR: Record<FlowEvent["type"], string> = {
  brief: "var(--accent)",
  agent: "var(--text)",
  tool: "var(--link-muted)",
  outcome: "var(--success-text)",
  error: "var(--danger-text)",
  sentinel: "var(--muted)",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtSize(n: number | undefined): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function EventLog({ agent, events, files = [], onOpenFile }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        paddingTop: 8,
        paddingLeft: 4,
      }}
    >
      <header style={{ paddingBottom: 8 }}>
        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Events
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
          {agent?.name ?? "—"}
        </div>
      </header>
      {files.length > 0 ? <FilesStrip files={files} onOpenFile={onOpenFile} /> : null}
      <div
        ref={ref}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingBottom: 16,
        }}
      >
        {events.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, paddingTop: 12 }}>
            No events yet for this agent.
          </div>
        ) : (
          events.map((e) => (
            <article
              key={e.id}
              style={{
                padding: "8px 10px",
                background: "var(--panel-muted)",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <header style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                  {fmtTime(e.ts)}
                </span>
                <span
                  style={{
                    color: TYPE_COLOR[e.type],
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    fontWeight: 600,
                  }}
                >
                  {e.type}
                </span>
              </header>
              <EventPayload text={e.payload} />
            </article>
          ))
        )}
      </div>
    </div>
  );
}

const FILES_OPEN_KEY = "braid-web:files-open";

function FilesStrip({
  files,
  onOpenFile,
}: {
  files: SessionFile[];
  onOpenFile?: (f: SessionFile) => void;
}) {
  const headingId = useId();
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(FILES_OPEN_KEY) !== "0";
  });
  useEffect(() => {
    window.localStorage.setItem(FILES_OPEN_KEY, open ? "1" : "0");
  }, [open]);

  return (
    <section
      aria-label="Session files"
      style={{
        padding: "8px 4px 12px",
        borderBottom: "1px solid var(--border)",
        marginBottom: 8,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={headingId}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          background: "transparent",
          padding: 0,
          marginBottom: open ? 6 : 0,
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--muted)",
          cursor: "pointer",
        }}
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.12s ease",
            flex: "0 0 auto",
          }}
          aria-hidden
        >
          <title>toggle</title>
          <path d="M4 2l4 4-4 4" />
        </svg>
        <span>Files ({files.length})</span>
      </button>
      <div
        id={headingId}
        hidden={!open}
        style={{ display: open ? "flex" : "none", flexDirection: "column", gap: 4 }}
      >
        {files.map((f) => {
          const isImage = f.mime_type.startsWith("image/");
          const isVideo = f.mime_type.startsWith("video/");
          const url = f.url ?? fileRawUrl(f.id);
          const icon = isVideo ? "▶" : isImage ? null : "⎙";
          return (
            <div
              key={f.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 4,
                borderRadius: 6,
                fontSize: 12,
                color: "var(--text)",
              }}
            >
              <button
                type="button"
                onClick={() => onOpenFile?.(f)}
                title={`${f.mime_type}${f.size_bytes ? ` · ${fmtSize(f.size_bytes)}` : ""}${f.source === "external" ? " · external" : ""}`}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 0,
                  background: "transparent",
                  color: "var(--text)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {isImage ? (
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    style={{
                      width: 28,
                      height: 28,
                      objectFit: "cover",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      flex: "0 0 auto",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--panel-muted)",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      fontSize: isVideo ? 12 : 11,
                      color: isVideo ? "var(--accent)" : "var(--muted)",
                      flex: "0 0 auto",
                    }}
                  >
                    {icon}
                  </span>
                )}
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.filename}
                </span>
                {f.source === "external" ? (
                  <span
                    style={{
                      fontSize: 9,
                      color: "var(--muted)",
                      border: "1px solid var(--border)",
                      borderRadius: 3,
                      padding: "1px 4px",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      flex: "0 0 auto",
                    }}
                  >
                    ext
                  </span>
                ) : null}
                {f.size_bytes ? (
                  <span style={{ color: "var(--muted)", fontSize: 10 }}>{fmtSize(f.size_bytes)}</span>
                ) : null}
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="braid-icon-btn"
                aria-label={`Open ${f.filename} in new tab`}
                title="Open in new tab"
                style={{ width: 22, height: 22, flex: "0 0 auto" }}
                onClick={(e) => e.stopPropagation()}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <title>open in new tab</title>
                  <path d="M14 3h7v7" />
                  <path d="M10 14L21 3" />
                  <path d="M21 14v7H3V3h7" />
                </svg>
              </a>
            </div>
          );
        })}
      </div>
    </section>
  );
}
