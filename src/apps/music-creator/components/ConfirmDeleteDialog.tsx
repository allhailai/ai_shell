import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface ConfirmDeleteDialogProps {
  projectName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirms destructive delete — hub-only in M2; Studio unsaved edits are a separate flow (M3).
 * Escape and backdrop click cancel; only the Delete button commits.
 */
export function ConfirmDeleteDialog({
  projectName,
  onConfirm,
  onCancel,
}: ConfirmDeleteDialogProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  // Trap scroll while open — dialog is portaled so it covers the shell canvas.
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
        aria-labelledby="music-creator-delete-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="music-creator-delete-dialog-title" className="music-creator-dialog-title">
          Delete project?
        </h2>
        <p className="music-creator-muted">
          <strong>{projectName}</strong> will be removed from this browser. This cannot be
          undone.
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
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
