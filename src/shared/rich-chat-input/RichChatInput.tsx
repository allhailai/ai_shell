/* ── AIShell Shared: RichChatInput ────────────────────────────────────
   A rich chat input surface with:
   - Growing textarea (1 row → max height → internal scroll)
   - Image paste & drag-and-drop
   - Attachment chips above the textarea
   - Keyboard shortcuts (Enter=send, Shift+Enter=newline, Escape=clear)
   - @ detection for context injection (callback only)
   ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, useCallback } from "react";

/* ── Types ───────────────────────────────────────────────────────── */

export type ChatAttachment = {
  id: string;
  type: "image" | "selection" | "reference";
  label: string;
  preview?: string; // thumbnail URL for images, text preview for selections
  metadata?: Record<string, unknown>;
};

export interface RichChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onAtTrigger?: (position: { top: number; left: number }) => void;
  onImagePaste?: (file: File) => void;
  onImageDrop?: (file: File) => void;
  attachments?: ChatAttachment[];
  onRemoveAttachment?: (id: string) => void;
  onClearAttachments?: () => void;
  placeholder?: string;
  disabled?: boolean;
  maxHeightPercent?: number; // default 40
  sendDisabled?: boolean;
  sendIcon?: React.ReactNode;
}

/* ── Accepted image types ────────────────────────────────────────── */

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

function isValidImage(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.has(file.type) && file.size <= MAX_IMAGE_SIZE;
}

/* ── Component ───────────────────────────────────────────────────── */

export function RichChatInput({
  value,
  onChange,
  onSend,
  onAtTrigger,
  onImagePaste,
  onImageDrop,
  attachments = [],
  onRemoveAttachment,
  onClearAttachments,
  placeholder = "Message the agent...",
  disabled = false,
  maxHeightPercent = 40,
  sendDisabled = false,
  sendIcon,
}: RichChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  /* ── Auto-resize textarea ─────────────────────────────────────── */

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset to get accurate scrollHeight
    textarea.style.height = "auto";

    // Calculate max height: % of viewport height (avoids circular parent sizing)
    const viewportHeight = window.innerHeight;
    const maxHeight = Math.max(120, Math.min((viewportHeight * maxHeightPercent) / 100, 400));

    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, [maxHeightPercent]);

  // Run after React commits DOM changes (synchronous, before paint)
  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  /* ── Keyboard handling ────────────────────────────────────────── */

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!sendDisabled && !disabled) {
          onSend();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClearAttachments?.();
      }
    },
    [onSend, onClearAttachments, sendDisabled, disabled],
  );

  /* ── Input change with @ detection ────────────────────────────── */

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      // Immediately adjust height for responsive feel
      requestAnimationFrame(adjustHeight);

      // Detect @ trigger
      if (onAtTrigger && textareaRef.current) {
        const pos = e.target.selectionStart;
        if (pos > 0 && newValue[pos - 1] === "@") {
          // Check if preceded by whitespace or start-of-input
          if (pos === 1 || /\s/.test(newValue[pos - 2])) {
            const textarea = textareaRef.current;
            const rect = textarea.getBoundingClientRect();
            // Approximate cursor position (top of textarea for simplicity)
            onAtTrigger({
              top: rect.top - 8,
              left: rect.left + 12,
            });
          }
        }
      }
    },
    [onChange, onAtTrigger, adjustHeight],
  );

  /* ── Paste handler (images) ───────────────────────────────────── */

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onImagePaste || !e.clipboardData?.files?.length) return;

      for (const file of Array.from(e.clipboardData.files)) {
        if (isValidImage(file)) {
          e.preventDefault();
          onImagePaste(file);
          return;
        }
      }
    },
    [onImagePaste],
  );

  /* ── Drag & drop handlers ─────────────────────────────────────── */

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer?.types?.includes("Files")) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragOver(false);

      if (!onImageDrop || !e.dataTransfer?.files?.length) return;

      for (const file of Array.from(e.dataTransfer.files)) {
        if (isValidImage(file)) {
          onImageDrop(file);
        }
      }
    },
    [onImageDrop],
  );

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <div
      ref={containerRef}
      className={`shared-rich-input-container ${isDragOver ? "shared-rich-input-container--drag-over" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="shared-rich-input-attachments">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className={`shared-rich-input-chip shared-rich-input-chip--${attachment.type}`}
            >
              {attachment.type === "image" && attachment.preview && (
                <img
                  className="shared-rich-input-chip-thumb"
                  src={attachment.preview}
                  alt={attachment.label}
                />
              )}
              {attachment.type === "reference" && (
                <span className="shared-rich-input-chip-icon">@</span>
              )}
              {attachment.type === "selection" && (
                <span className="shared-rich-input-chip-icon">✂</span>
              )}
              <span className="shared-rich-input-chip-label">
                {attachment.label}
              </span>
              {attachment.type === "selection" && attachment.preview && (
                <span className="shared-rich-input-chip-preview" title={attachment.preview}>
                  {attachment.preview}
                </span>
              )}
              {onRemoveAttachment && (
                <button
                  className="shared-rich-input-chip-remove"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  type="button"
                  aria-label={`Remove ${attachment.label}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Drag overlay */}
      {isDragOver && (
        <div className="shared-rich-input-drop-overlay">
          <span className="shared-rich-input-drop-overlay-text">
            Drop image here
          </span>
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        className="shared-rich-input-textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
        rows={1}
        disabled={disabled}
      />
    </div>
  );
}
