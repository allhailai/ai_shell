/* ── CodaScope: ChatHelpModal ────────────────────────────────────────
   Small modal triggered by `?` icon next to chat input.
   Shows keyboard shortcuts, attachment instructions, and context hints.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef } from "react";

interface ChatHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChatHelpModal({ isOpen, onClose }: ChatHelpModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // Close on click outside
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <div className="codascope-help-modal-backdrop" onClick={handleBackdropClick}>
      <div className="codascope-help-modal" ref={modalRef}>
        <div className="codascope-help-modal-header">
          <h3>Chat Help</h3>
          <button
            className="codascope-help-modal-close"
            onClick={onClose}
            type="button"
            aria-label="Close help"
          >
            ×
          </button>
        </div>

        <div className="codascope-help-modal-body">
          {/* Keyboard Shortcuts */}
          <section className="codascope-help-modal-section">
            <h4>Keyboard Shortcuts</h4>
            <div className="codascope-help-modal-shortcuts">
              <div className="codascope-help-modal-shortcut">
                <kbd>Enter</kbd>
                <span>Send message</span>
              </div>
              <div className="codascope-help-modal-shortcut">
                <kbd>Shift + Enter</kbd>
                <span>New line</span>
              </div>
              <div className="codascope-help-modal-shortcut">
                <kbd>Escape</kbd>
                <span>Clear attachments</span>
              </div>
            </div>
          </section>

          {/* Attachments */}
          <section className="codascope-help-modal-section">
            <h4>Attachments</h4>
            <ul className="codascope-help-modal-list">
              <li>
                <strong>Paste images</strong> — Cmd/Ctrl+V to paste an image from your clipboard
              </li>
              <li>
                <strong>Drag & drop</strong> — Drag image files directly into the chat input
              </li>
              <li>
                Supported formats: PNG, JPEG, GIF, WebP (max 5MB)
              </li>
            </ul>
          </section>

          {/* Context */}
          <section className="codascope-help-modal-section">
            <h4>Context</h4>
            <ul className="codascope-help-modal-list">
              <li>
                <strong>@ mentions</strong> — Type <code>@</code> to reference wiki pages, sources, and more
                <span className="codascope-help-modal-coming-soon">Coming soon</span>
              </li>
              <li>
                The assistant automatically includes context from your current view
              </li>
            </ul>
          </section>

          {/* Design Docs */}
          <section className="codascope-help-modal-section">
            <h4>Design Documents</h4>
            <ul className="codascope-help-modal-list">
              <li>
                Ask the assistant to <strong>create design documents</strong> — just describe what you need
              </li>
              <li>
                Reference your epic's wiki and research for grounded content
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
