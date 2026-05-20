import { useId } from "react";
import type { Session } from "../data/mock";

type Props = {
  sessions: Session[];
  selectedSessionId: string | undefined;
  onSelect: (id: string) => void;
  onRun: () => void;
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function SessionsList({
  sessions,
  selectedSessionId,
  onSelect,
  onRun,
}: Props) {
  const headerId = useId();
  const live = sessions.filter((s) => s.status === "live");
  const past = sessions.filter((s) => s.status !== "live");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
        paddingTop: 8,
        paddingBottom: 12,
        paddingRight: 8,
        minHeight: 0,
      }}
    >
      <button
        type="button"
        onClick={onRun}
        className="braid-ghost braid-ghost--block"
        style={{ fontSize: 13 }}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Start new session
      </button>
      <div style={{ overflow: "auto", display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
        <Group title="Live" sessions={live} selectedSessionId={selectedSessionId} onSelect={onSelect} headerId={`${headerId}-live`} />
        <Group title="Past" sessions={past} selectedSessionId={selectedSessionId} onSelect={onSelect} headerId={`${headerId}-past`} />
      </div>
    </div>
  );
}

function Group({
  title,
  sessions,
  selectedSessionId,
  onSelect,
  headerId,
}: {
  title: string;
  sessions: Session[];
  selectedSessionId: string | undefined;
  onSelect: (id: string) => void;
  headerId: string;
}) {
  if (sessions.length === 0) return null;
  return (
    <section aria-labelledby={headerId}>
      <h3
        id={headerId}
        style={{
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--muted)",
          margin: "0 0 6px 4px",
        }}
      >
        {title}
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {sessions.map((s) => {
          const active = s.id === selectedSessionId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: active ? "var(--row-hover)" : "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <StatusDot status={s.status} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.label ?? s.id}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{timeAgo(s.startedAt)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StatusDot({ status }: { status: Session["status"] }) {
  const color =
    status === "live"
      ? "var(--flow-edge)"
      : status === "failed"
        ? "var(--danger-text)"
        : "var(--success-text)";
  return (
    <span
      aria-label={status}
      style={{
        width: 7,
        height: 7,
        borderRadius: 999,
        background: color,
        boxShadow: status === "live" ? `0 0 0 3px color-mix(in srgb, ${color} 25%, transparent)` : undefined,
        flex: "0 0 auto",
      }}
    />
  );
}
