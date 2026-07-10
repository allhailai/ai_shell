/* ── CodaScope: NoteInsertionPrompt ──────────────────────────────────
   Simplified floating panel for requesting agent-generated content at
   an insertion point in the note editor.

   Positioned via coordinates from CM's coordsAtPos.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useRef } from "react";
import { useCommandBus } from "../../../shell/hooks";
import { useShellStore } from "../../../shell/store";
import { IconInsert, IconRewrite, IconExpand, IconClose } from "../components/CodaScopeIcons";
import type { NoteLevel } from "../codaScopeTypes";
import type { EditorView } from "@codemirror/view";

/* ── Types ───────────────────────────────────────────────────────────── */

type PromptType = "insert" | "rewrite" | "expand";

interface NoteInsertionPromptProps {
  /** Line number after which to insert content */
  afterLine: number;
  /** Absolute top position (px) */
  top: number;
  /** Absolute left position (px) */
  left: number;
  /** Note level */
  level: NoteLevel;
  /** Note file path */
  notePath: string;
  /** CM editor view reference (for inserting content) */
  editorView: EditorView | null;
  /** Close callback */
  onClose: () => void;
}

/* ── Type options ────────────────────────────────────────────────────── */

const TYPE_OPTIONS: { value: PromptType; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { value: "insert", label: "Insert", Icon: IconInsert },
  { value: "rewrite", label: "Rewrite", Icon: IconRewrite },
  { value: "expand", label: "Expand", Icon: IconExpand },
];

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteInsertionPrompt({
  afterLine,
  top,
  left,
  level,
  notePath,
  editorView: _editorView,
  onClose,
}: NoteInsertionPromptProps) {
  const [type, setType] = useState<PromptType>("insert");
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const commandBus = useCommandBus();
  const promptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (promptRef.current && !promptRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid catching the click that opened the prompt
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Submit handler
  const handleSubmit = useCallback(() => {
    if (!instruction.trim()) return;
    setSubmitting(true);

    const typeLabel = type === "insert" ? "Insert" : type === "rewrite" ? "Rewrite" : "Expand";
    const prompt = `${typeLabel} content after line ${afterLine} in note "${notePath}":\n\n${instruction.trim()}`;

    // Emit to the assistant chat with note context
    commandBus?.emit("codascope:note-insertion-to-chat", {
      type,
      afterLine,
      instruction: instruction.trim(),
      notePath,
      level,
    });

    // Open the assistant panel and pre-fill the prompt
    useShellStore.getState().openRightPanel("assistant");
    commandBus?.emit("codascope:assistant-prefill", { prompt });

    onClose();
  }, [instruction, type, afterLine, notePath, level, commandBus, onClose]);

  // Clamp position to viewport
  const clampedTop = Math.max(8, Math.min(top, window.innerHeight - 200));
  const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - 360));

  return (
    <div
      className="codascope-notes-insertion-prompt"
      ref={promptRef}
      style={{ top: clampedTop, left: clampedLeft }}
    >
      {/* Header: type selector + close */}
      <div className="codascope-notes-insertion-prompt-header">
        <div className="codascope-notes-insertion-prompt-type-selector">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`codascope-btn codascope-btn-xs${type === opt.value ? " codascope-btn-primary" : " codascope-btn-ghost"}`}
              onClick={() => setType(opt.value)}
              type="button"
            >
              <opt.Icon size={12} /> {opt.label}
            </button>
          ))}
        </div>
        <button
          className="codascope-btn codascope-btn-ghost codascope-btn-xs"
          onClick={onClose}
          type="button"
          title="Cancel"
        >
          <IconClose size={12} />
        </button>
      </div>

      {/* Instruction input */}
      <textarea
        ref={inputRef}
        className="codascope-notes-insertion-prompt-input"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={`What should the agent ${type === "insert" ? "write" : type === "rewrite" ? "rewrite" : "expand on"}?`}
        rows={2}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />

      {/* Actions */}
      <div className="codascope-notes-insertion-prompt-actions">
        <button
          className="codascope-btn codascope-btn-ghost codascope-btn-xs"
          onClick={onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className="codascope-btn codascope-btn-primary codascope-btn-xs"
          onClick={handleSubmit}
          disabled={submitting || !instruction.trim()}
          type="button"
        >
          {submitting ? "Sending…" : "Send to Agent"}
        </button>
      </div>
    </div>
  );
}
