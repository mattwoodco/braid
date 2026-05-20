import type { Session } from "../data/mock";

type Props = {
  sessions: Session[];
  selectedSessionId: string | undefined;
  onSelect: (id: string) => void;
  onNew: () => void;
};

export function SessionTabs({ sessions, selectedSessionId, onSelect, onNew }: Props) {
  return (
    <div className="braid-sheet-tabs">
      <button
        type="button"
        className="braid-sheet-tabs__new"
        onClick={onNew}
        aria-label="Start new session"
        title="Start new session"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <title>New session</title>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <div className="braid-sheet-tabs__scroll">
        {sessions.map((s) => {
          const active = s.id === selectedSessionId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={
                active
                  ? "braid-sheet-tab braid-sheet-tab--active"
                  : "braid-sheet-tab"
              }
              title={s.label ?? s.id}
            >
              <StatusDot status={s.status} />
              <span className="braid-sheet-tab__label">{s.label ?? s.id}</span>
            </button>
          );
        })}
      </div>
    </div>
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
        width: 6,
        height: 6,
        borderRadius: 999,
        background: color,
        boxShadow:
          status === "live"
            ? `0 0 0 2px color-mix(in srgb, ${color} 25%, transparent)`
            : undefined,
        flex: "0 0 auto",
      }}
    />
  );
}
