import { useId } from "react";
import type { Flow } from "../data/mock";

type Props = {
  flows: Flow[];
  selectedFlowKey: string | undefined;
  onSelect: (key: string) => void;
  onPurge: (key: string) => void;
};

export function FlowsList({ flows, selectedFlowKey, onSelect, onPurge }: Props) {
  const headerId = useId();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        height: "100%",
        paddingTop: 32.4,
        paddingBottom: 12,
        paddingRight: 8,
        minHeight: 0,
      }}
    >
      <h3
        id={headerId}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        Flows
      </h3>
      <ul
        aria-labelledby={headerId}
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflow: "auto",
          minHeight: 0,
        }}
      >
        {flows.map((f) => {
          const active = f.key === selectedFlowKey;
          return (
            <li key={f.key}>
              <div
                className="braid-flow-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  borderRadius: 8,
                  background: active ? "var(--row-hover)" : "transparent",
                  paddingRight: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(f.key)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textAlign: "left",
                    padding: "8px 10px",
                    background: "transparent",
                    color: active ? "var(--text)" : "var(--muted)",
                    fontSize: 13,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.name}
                </button>
                <button
                  type="button"
                  className="braid-icon-btn braid-flow-row__purge"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPurge(f.key);
                  }}
                  aria-label={`Purge ${f.name}`}
                  title={`Purge ${f.name}`}
                  style={{ width: 22, height: 22 }}
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <title>Purge flow</title>
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
