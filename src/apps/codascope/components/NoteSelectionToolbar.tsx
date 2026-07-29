/* ── CodaScope: NoteSelectionToolbar ─────────────────────────────────
   Floating toolbar that appears when the user selects text in the
   note's CodeMirror editor. Provides "Edit with Agent" and "Comment"
   actions. Positioned above the text selection.

   Pattern: simplified EditorSelectionToolbar.tsx
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useRef, useState, useLayoutEffect } from "react";
import { IconSparkle, IconAnnotation } from "../components/CodaScopeIcons";

/* ── Types ───────────────────────────────────────────────────────────── */

export interface NoteSelectionRect {
  top: number;
  left: number;
  width: number;
}

export interface NoteSelectionInfo {
  text: string;
  /** Exact CodeMirror source offsets; used to verify marker insertion server-side. */
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  rect: NoteSelectionRect;
}

interface NoteSelectionToolbarProps {
  selectionInfo: NoteSelectionInfo;
  onDismiss: () => void;
  onEditWithAgent: (selectionInfo: NoteSelectionInfo) => void;
  preparingAgentEdit?: boolean;
  /** Called when user clicks "Comment" — creates an annotation at the selection's block */
  onComment?: (selectionInfo: NoteSelectionInfo) => void;
}

/* ── Constants ───────────────────────────────────────────────────────── */

const TOOLBAR_GAP = 8;
const VIEWPORT_PAD = 8;

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteSelectionToolbar({
  selectionInfo,
  onDismiss,
  onEditWithAgent,
  preparingAgentEdit = false,
  onComment,
}: NoteSelectionToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Compute clamped position after first render
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    const { rect } = selectionInfo;

    // Center horizontally on the selection, clamp to viewport
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(VIEWPORT_PAD, Math.min(left, window.innerWidth - tw - VIEWPORT_PAD));

    // Place above the selection; if it would go off-screen top, place below
    let top = rect.top - th - TOOLBAR_GAP;
    if (top < VIEWPORT_PAD) {
      top = rect.top + TOOLBAR_GAP + 20;
    }

    setPos({ top, left });
  }, [selectionInfo]);

  const handleEditWithAgent = useCallback(() => {
    onEditWithAgent(selectionInfo);
  }, [selectionInfo, onEditWithAgent]);

  const handleComment = useCallback(() => {
    if (onComment) {
      onComment(selectionInfo);
    }
    onDismiss();
    window.getSelection()?.removeAllRanges();
  }, [selectionInfo, onComment, onDismiss]);

  return (
    <div
      className="codascope-notes-selection-toolbar"
      ref={toolbarRef}
      style={pos ? { top: pos.top, left: pos.left, opacity: 1 } : { opacity: 0 }}
    >
      <button
        className="codascope-btn codascope-btn-xs codascope-notes-selection-toolbar-btn codascope-notes-selection-toolbar-btn--primary"
        onClick={handleEditWithAgent}
        disabled={preparingAgentEdit}
        type="button"
        aria-label={preparingAgentEdit
          ? "Preparing selected text for Agent"
          : "Edit selected text with Agent"}
        title={preparingAgentEdit ? "Preparing selection…" : "Edit with Agent"}
      >
        <IconSparkle size={13} />
      </button>
      <button
        className="codascope-btn codascope-btn-xs codascope-notes-selection-toolbar-btn"
        onClick={handleComment}
        disabled={preparingAgentEdit}
        type="button"
        aria-label="Add annotation to selected text"
        title="Add annotation"
      >
        <IconAnnotation size={13} />
      </button>
    </div>
  );
}
