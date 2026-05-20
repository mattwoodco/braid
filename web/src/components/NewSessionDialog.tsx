import { useId, useState } from "react";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  flowName: string;
  onClose: () => void;
  onSubmit: (brief: string) => Promise<void>;
};

export function NewSessionDialog({ open, flowName, onClose, onSubmit }: Props) {
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const briefId = useId();

  const handleSubmit = async () => {
    if (!brief.trim()) return;
    setBusy(true);
    setErr(undefined);
    try {
      await onSubmit(brief);
      setBrief("");
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Start a new ${flowName} session`}>
      <label htmlFor={briefId} style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
        First message to the director
      </label>
      <textarea
        id={briefId}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="Describe what you want this flow to produce…"
        rows={6}
        style={{ width: "100%", fontSize: 13, lineHeight: 1.5, padding: 10, resize: "vertical" }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSubmit();
        }}
        autoFocus
        disabled={busy}
      />
      {err ? (
        <p style={{ fontSize: 12, color: "var(--danger-text)", margin: "8px 0 0" }}>{err}</p>
      ) : (
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0" }}>
          ⌘+Enter to start
        </p>
      )}
      <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button type="button" className="braid-ghost braid-ghost--sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="braid-ghost braid-ghost--sm"
          onClick={handleSubmit}
          disabled={busy || !brief.trim()}
          style={{ background: "var(--accent)", color: "var(--accent-text)" }}
        >
          {busy ? <span className="braid-spinner" /> : "Start session"}
        </button>
      </footer>
    </Modal>
  );
}
