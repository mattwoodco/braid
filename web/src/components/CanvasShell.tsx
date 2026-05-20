import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

type Props = {
  sessionsOpen: boolean;
  eventsOpen: boolean;
  onToggleSessions: () => void;
  onToggleEvents: () => void;
  sessions: ReactNode;
  graph: ReactNode;
  events: ReactNode;
  flowNav: ReactNode;
  sessionTabs?: ReactNode;
};

const SESSIONS_WIDTH = 240;
const INSPECTOR_DEFAULT = 320;
const INSPECTOR_MIN = 240;
const INSPECTOR_MAX = 560;
const INSPECTOR_STORAGE_KEY = "braid-web:inspector-width";

function readStored(): number {
  if (typeof window === "undefined") return INSPECTOR_DEFAULT;
  const raw = window.localStorage.getItem(INSPECTOR_STORAGE_KEY);
  if (!raw) return INSPECTOR_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return INSPECTOR_DEFAULT;
  return Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, n));
}

export function CanvasShell({
  sessionsOpen,
  eventsOpen,
  onToggleSessions,
  onToggleEvents,
  sessions,
  graph,
  events,
  flowNav,
  sessionTabs,
}: Props) {
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    setInspectorWidth(readStored());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(INSPECTOR_STORAGE_KEY, String(inspectorWidth));
  }, [inspectorWidth]);

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setResizing(true);
      const startX = e.clientX;
      const startWidth = inspectorWidth;
      const onMove = (ev: PointerEvent) => {
        const dx = startX - ev.clientX;
        const next = Math.min(
          INSPECTOR_MAX,
          Math.max(INSPECTOR_MIN, startWidth + dx),
        );
        setInspectorWidth(next);
      };
      const onUp = (ev: PointerEvent) => {
        setResizing(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        try {
          (e.target as HTMLElement).releasePointerCapture(ev.pointerId);
        } catch {
          /* noop */
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [inspectorWidth],
  );

  const left = sessionsOpen ? `${SESSIONS_WIDTH}px` : "";
  const right = eventsOpen ? `${inspectorWidth}px` : "";
  const gridTemplateColumns = [left, "1fr", right].filter(Boolean).join(" ");

  const handleStyle: CSSProperties = {
    gridColumn: sessionsOpen ? 3 : 2,
    gridRow: 2,
    width: 8,
    alignSelf: "stretch",
    justifySelf: "start",
    marginLeft: -4,
    cursor: "col-resize",
    background: resizing ? "var(--border)" : "transparent",
    zIndex: 5,
    transition: resizing ? undefined : "background 0.12s ease",
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns,
        gridTemplateRows: "48px 1fr",
        height: "100vh",
        width: "100vw",
        background: "var(--bg)",
        color: "var(--text)",
        userSelect: resizing ? "none" : undefined,
      }}
    >
      <div
        style={{
          gridColumn: "1 / -1",
          gridRow: 1,
          position: "relative",
          display: "flex",
          alignItems: "center",
          padding: "10px 24px 0",
          gap: 12,
        }}
      >
        {flowNav}
      </div>

      {sessionsOpen ? (
        <section
          style={{
            gridColumn: 1,
            gridRow: 2,
            overflow: "hidden",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            paddingLeft: 12,
          }}
        >
          {sessions}
        </section>
      ) : null}

      <main
        style={{
          gridColumn:
            eventsOpen && sessionsOpen
              ? "2 / 3"
              : eventsOpen
                ? "1 / 2"
                : sessionsOpen
                  ? 2
                  : 1,
          gridRow: 2,
          position: "relative",
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          padding: eventsOpen ? "0 12px 24px" : "0 24px 24px 12px",
        }}
      >
        {sessionTabs}
        <div className="braid-canvas-frame" style={{ flex: 1, minHeight: 0 }}>
          {!sessionsOpen ? (
            <button
              type="button"
              className="braid-icon-btn"
              onClick={onToggleSessions}
              aria-label="Open flows sidebar"
              title="Open flows sidebar"
              style={{
                position: "absolute",
                top: 12,
                left: 12,
                zIndex: 10,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <title>Open left sidebar</title>
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9 4v16" />
              </svg>
            </button>
          ) : null}
          {!eventsOpen ? (
            <button
              type="button"
              className="braid-icon-btn"
              onClick={onToggleEvents}
              aria-label="Open events sidebar"
              title="Open events sidebar"
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                zIndex: 10,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <title>Open right sidebar</title>
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M15 4v16" />
              </svg>
            </button>
          ) : null}
          {graph}
        </div>
      </main>

      {eventsOpen ? (
        <>
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize events panel"
            aria-valuenow={inspectorWidth}
            aria-valuemin={INSPECTOR_MIN}
            aria-valuemax={INSPECTOR_MAX}
            onPointerDown={onHandlePointerDown}
            className="braid-resize-handle"
            style={handleStyle}
          />
          <aside
            style={{
              gridColumn: sessionsOpen ? 3 : 2,
              gridRow: 2,
              minWidth: 0,
              width: "100%",
              overflow: "auto",
              paddingRight: 12,
            }}
          >
            {events}
          </aside>
        </>
      ) : null}
    </div>
  );
}
