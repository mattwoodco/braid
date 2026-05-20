import type { Flow } from "../data/mock";
import { getTheme, setTheme, type Theme } from "../lib/theme-init";
import { useState } from "react";

type Props = {
  flows: Flow[];
  selectedFlowKey: string;
  onSelectFlow: (key: string) => void;
  onPurgeFlow: (key: string) => void;
};

export function FlowNav({ flows, selectedFlowKey, onSelectFlow, onPurgeFlow }: Props) {
  const [theme, setLocalTheme] = useState<Theme>(getTheme());
  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setLocalTheme(next);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        fontSize: 14,
      }}
    >
      <span
        style={{
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          marginRight: 8,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span aria-hidden style={{ fontSize: 18 }}>🪢</span>
        <span>braid</span>
      </span>
      <nav style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, flexWrap: "wrap" }}>
        {flows.map((f) => {
          const active = f.key === selectedFlowKey;
          return (
            <span
              key={f.key}
              style={{
                display: "inline-flex",
                alignItems: "center",
                background: active ? "var(--btn-surface-hover)" : "transparent",
                borderRadius: 6,
                paddingRight: 2,
              }}
            >
              <button
                type="button"
                onClick={() => onSelectFlow(f.key)}
                className="braid-ghost"
                style={{
                  background: "transparent",
                  color: active ? "var(--text)" : "var(--muted)",
                  fontSize: 13,
                  padding: "6px 8px 6px 12px",
                }}
              >
                {f.name}
              </button>
              <button
                type="button"
                className="braid-icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onPurgeFlow(f.key);
                }}
                aria-label={`Purge ${f.name}`}
                title={`Purge ${f.name}`}
                style={{ width: 22, height: 22, opacity: 0.55 }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <title>Purge flow</title>
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          );
        })}
      </nav>
      <button
        type="button"
        className="braid-icon-btn"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        title={`Theme: ${theme}`}
      >
        {theme === "dark" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <title>Dark</title>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <title>Light</title>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        )}
      </button>
    </div>
  );
}
