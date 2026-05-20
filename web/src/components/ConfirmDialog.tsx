import { useState } from "react";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  destructive,
  onClose,
  onConfirm,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  const handleConfirm = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.55, color: "var(--text)" }}>
        {body}
      </p>
      {err ? (
        <p style={{ fontSize: 12, color: "var(--danger-text)", margin: "8px 0 0" }}>{err}</p>
      ) : null}
      <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button type="button" className="braid-ghost braid-ghost--sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="braid-ghost braid-ghost--sm"
          onClick={handleConfirm}
          disabled={busy}
          style={{
            background: destructive ? "var(--btn-danger-surface)" : "var(--accent)",
            color: destructive ? "var(--danger-text)" : "var(--accent-text)",
          }}
        >
          {busy ? <span className="braid-spinner" /> : confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
