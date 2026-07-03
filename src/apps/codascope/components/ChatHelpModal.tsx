/* ── CodaScope: ChatHelpModal ────────────────────────────────────────
   Small modal triggered by `?` icon next to chat input.
   Shows @-mention categories, keyboard shortcuts, attachment instructions,
   and design doc creation tips.
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
          {/* @-Mentions */}
          <section className="codascope-help-modal-section">
            <h4>@ Mentions — Add Context</h4>
            <p className="codascope-help-modal-desc">
              Type <code>@</code> in the chat input to reference context from your project.
              The agent will use these references when crafting its response.
            </p>
            <div className="codascope-help-modal-shortcuts">
              <div className="codascope-help-modal-shortcut">
                <kbd>@wiki/</kbd>
                <span>Reference a wiki page</span>
              </div>
              <div className="codascope-help-modal-shortcut">
                <kbd>@source/</kbd>
                <span>Reference a research source</span>
              </div>
              <div className="codascope-help-modal-shortcut">
                <kbd>@design/</kbd>
                <span>Reference a design document</span>
              </div>
              <div className="codascope-help-modal-shortcut">
                <kbd>@code/</kbd>
                <span>Reference a code repository</span>
              </div>
              <div className="codascope-help-modal-shortcut">
                <kbd>@def</kbd>
                <span>Reference the epic definition</span>
              </div>
            </div>
          </section>

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
                <span>Clear attachments / close picker</span>
              </div>
              <div className="codascope-help-modal-shortcut">
                <kbd>↑ ↓</kbd>
                <span>Navigate @ picker</span>
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

          {/* Design Docs */}
          <section className="codascope-help-modal-section">
            <h4>Design Documents</h4>
            <ul className="codascope-help-modal-list">
              <li>
                <strong>Create</strong> — Ask the agent to create a design document:
                <br />
                <em>"Create a design doc about event store architecture"</em>
              </li>
              <li>
                <strong>Edit</strong> — Ask the agent to modify an existing document:
                <br />
                <em>"Expand the security section of this document"</em>
              </li>
              <li>
                <strong>Reference context</strong> — Use <code>@wiki/</code> and <code>@source/</code> mentions
                to ground design docs in existing knowledge
              </li>
              <li>
                New documents auto-open in the editor when created
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
