import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface ConfirmLeaveStudioDialogProps {
  onStay: () => void;
  onLeaveWithoutSaving: () => void;
}

/**
 * Unsaved Studio edits — app-controlled leave only (All projects, nav Projects).
 * Stay keeps workingCopy; Leave discards in-memory edits (disk unchanged since last Save).
 */
export function ConfirmLeaveStudioDialog({
  onStay,
  onLeaveWithoutSaving,
}: ConfirmLeaveStudioDialogProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onStay();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onStay]);

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
      onClick={onStay}
      role="presentation"
    >
      <div
        className="music-creator-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="music-creator-leave-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="music-creator-leave-dialog-title" className="music-creator-dialog-title">
          Leave without saving?
        </h2>
        <p className="music-creator-muted">
          You have unsaved changes in this project. Stay to keep editing, or leave and discard
          changes that were not saved to this browser.
        </p>
        <div className="music-creator-dialog-actions">
          <button
            type="button"
            className="music-creator-btn music-creator-btn-primary"
            onClick={onStay}
          >
            Stay
          </button>
          <button
            type="button"
            className="music-creator-btn music-creator-btn-secondary"
            onClick={onLeaveWithoutSaving}
          >
            Leave without saving
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
