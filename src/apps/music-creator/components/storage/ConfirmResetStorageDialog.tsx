import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface ConfirmResetStorageDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirms wiping music-creator:store to an empty envelope.
 * Used when loadStore fails with corrupt/unreadable data — last-resort recovery for POC.
 */
export function ConfirmResetStorageDialog({
  onConfirm,
  onCancel,
}: ConfirmResetStorageDialogProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div
      className="music-creator-dialog-backdrop"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="music-creator-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="music-creator-reset-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="music-creator-reset-dialog-title" className="music-creator-dialog-title">
          Reset all projects?
        </h2>
        <p className="music-creator-muted">
          This replaces saved projects in this browser with an empty library. Use when storage
          is corrupt or unreadable. This cannot be undone.
        </p>
        <div className="music-creator-dialog-actions">
          <button
            type="button"
            className="music-creator-btn music-creator-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="music-creator-btn music-creator-btn-danger"
            onClick={onConfirm}
          >
            Reset storage
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
