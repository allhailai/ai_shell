/* ── Shared: ConfirmDialog ────────────────────────────────────────────
   A reusable confirmation modal built on the native <dialog> element.
   Uses showModal() for proper focus trapping and Esc-to-close.

   Usage:
     <ConfirmDialog
       open={showConfirm}
       title="Archive Epic?"
       message="You can restore it later from the archive."
       confirmLabel="Archive"
       cancelLabel="Cancel"
       variant="default"           // 'default' | 'danger'
       onConfirm={() => doArchive()}
       onCancel={() => setShowConfirm(false)}
     />
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useCallback } from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Sync open state with the native dialog
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Handle native close events (Esc key, light-dismiss)
  const handleClose = useCallback(() => {
    onCancel();
  }, [onCancel]);

  // Handle backdrop clicks for light-dismiss fallback
  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (!dialog || e.target !== dialog) return;

    // Check if click was outside the dialog content box
    const rect = dialog.getBoundingClientRect();
    const isDialogContent = (
      rect.top <= e.clientY &&
      e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX &&
      e.clientX <= rect.left + rect.width
    );

    if (!isDialogContent) {
      dialog.close();
    }
  }, []);

  const handleConfirm = useCallback(() => {
    dialogRef.current?.close();
    onConfirm();
  }, [onConfirm]);

  const handleCancel = useCallback(() => {
    dialogRef.current?.close();
    onCancel();
  }, [onCancel]);

  return (
    <dialog
      ref={dialogRef}
      className="shared-confirm-dialog"
      onClose={handleClose}
      onClick={handleBackdropClick}
      aria-labelledby="shared-confirm-dialog-title"
    >
      <div className="shared-confirm-dialog-content">
        <h3 id="shared-confirm-dialog-title" className="shared-confirm-dialog-title">
          {title}
        </h3>
        {message && (
          <p className="shared-confirm-dialog-message">{message}</p>
        )}
        <div className="shared-confirm-dialog-actions">
          <button
            className="shared-confirm-dialog-btn shared-confirm-dialog-btn--cancel"
            onClick={handleCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={`shared-confirm-dialog-btn shared-confirm-dialog-btn--confirm ${variant === "danger" ? "shared-confirm-dialog-btn--danger" : ""}`}
            onClick={handleConfirm}
            type="button"
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
