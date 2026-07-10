/* ── CodaScope: NoteSelectionToolbar ─────────────────────────────────
   Floating toolbar that appears when the user selects text in the
   note's CodeMirror editor. Provides "Edit with Agent" and "Comment"
   actions. Positioned above the text selection.

   Pattern: simplified EditorSelectionToolbar.tsx
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useRef, useState, useLayoutEffect } from "react";
import { useShellStore } from "../../../shell/store";
import { useCommandBus } from "../../../shell/hooks";
import { IconSparkle, IconAnnotation } from "../components/CodaScopeIcons";

/* ── Types ───────────────────────────────────────────────────────────── */

export interface NoteSelectionRect {
  top: number;
  left: number;
  width: number;
}

export interface NoteSelectionInfo {
  text: string;
  startLine: number;
  endLine: number;
  rect: NoteSelectionRect;
}

interface NoteSelectionToolbarProps {
  selectionInfo: NoteSelectionInfo;
  notePath: string;
  noteLevel: string;
  onDismiss: () => void;
  /** Called when user clicks "Comment" — creates an annotation at the selection's block */
  onComment?: (selectionInfo: NoteSelectionInfo) => void;
}

/* ── Constants ───────────────────────────────────────────────────────── */

const TOOLBAR_GAP = 8;
const VIEWPORT_PAD = 8;

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteSelectionToolbar({
  selectionInfo,
  notePath,
  noteLevel,
  onDismiss,
  onComment,
}: NoteSelectionToolbarProps) {
  const commandBus = useCommandBus();
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
    // Package selection context and emit to chat
    commandBus?.emit("codascope:note-selection-to-chat", {
      text: selectionInfo.text,
      startLine: selectionInfo.startLine,
      endLine: selectionInfo.endLine,
      notePath,
      noteLevel,
    });
    // Open the right panel to the assistant
    useShellStore.getState().openRightPanel("assistant");
    // Clear selection
    onDismiss();
    window.getSelection()?.removeAllRanges();
  }, [selectionInfo, commandBus, notePath, noteLevel, onDismiss]);

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
        type="button"
      >
        <IconSparkle size={12} /> Edit with Agent
      </button>
      <button
        className="codascope-btn codascope-btn-xs codascope-notes-selection-toolbar-btn"
        onClick={handleComment}
        type="button"
      >
        <IconAnnotation size={12} /> Comment
      </button>
    </div>
  );
}
