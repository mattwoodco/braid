import { getTheme, setTheme, type Theme } from "../lib/theme-init";
import { useState } from "react";

type Props = {
  sessionsOpen: boolean;
  eventsOpen: boolean;
  onToggleSessions: () => void;
  onToggleEvents: () => void;
};

const GITHUB_URL = "https://github.com/mattwoodco/braid";

export function FlowNav({
  sessionsOpen,
  eventsOpen,
  onToggleSessions,
  onToggleEvents,
}: Props) {
  const [theme, setLocalTheme] = useState<Theme>(getTheme());
  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setLocalTheme(next);
  };

  return (
    <div className="braid-header">
      <span className="braid-header__brand">
        <span className="braid-header__brand-text">braid</span>
      </span>
      <div style={{ flex: 1 }} />
      <div className="braid-header__actions">
        {sessionsOpen ? (
          <button
            type="button"
            className="braid-icon-btn"
            onClick={onToggleSessions}
            aria-label="Close flows sidebar"
            aria-pressed={sessionsOpen}
            title="Close flows sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>Toggle left sidebar</title>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </button>
        ) : null}
        {eventsOpen ? (
          <button
            type="button"
            className="braid-icon-btn"
            onClick={onToggleEvents}
            aria-label="Close events sidebar"
            aria-pressed={eventsOpen}
            title="Close events sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <title>Toggle right sidebar</title>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M15 4v16" />
            </svg>
          </button>
        ) : null}
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
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="braid-icon-btn"
          aria-label="GitHub repository"
          title="GitHub repository"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <title>GitHub</title>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
    </div>
  );
}
