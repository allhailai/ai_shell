/* ── EditorSelectionToolbar ─────────────────────────────────────────
   Floating toolbar that appears when the user selects text in the
   DocumentEditor. Provides "Edit with Agent" and "Comment" actions.
   Positioned directly above the text selection.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useRef, useState, useLayoutEffect } from "react";
import { useShellStore } from "../../../shell/store";
import { useCommandBus } from "../../../shell/hooks";
import { IconSparkle, IconAnnotation } from "./CodaScopeIcons";

export interface SelectionRect {
  top: number;
  left: number;
  width: number;
}

export interface SelectionInfo {
  blockId: string;
  text: string;
  startLine: number;
  endLine: number;
  rect: SelectionRect;
}

interface EditorSelectionToolbarProps {
  selectionInfo: SelectionInfo;
  epicId: string;
  docId: string;
  onComment: (blockId: string) => void;
  onDismiss: () => void;
}

const TOOLBAR_GAP = 8; // px above selection
const VIEWPORT_PAD = 8; // px from viewport edges

export function EditorSelectionToolbar({
  selectionInfo,
  epicId,
  docId,
  onComment,
  onDismiss,
}: EditorSelectionToolbarProps) {
  const commandBus = useCommandBus();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Compute clamped position after first render so we know toolbar width
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    const { rect } = selectionInfo;

    // Center horizontally on the selection, clamp to viewport
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(VIEWPORT_PAD, Math.min(left, window.innerWidth - tw - VIEWPORT_PAD));

    // Place above the selection; if it would go off-screen top, place below instead
    let top = rect.top - th - TOOLBAR_GAP;
    if (top < VIEWPORT_PAD) {
      top = rect.top + TOOLBAR_GAP + 20; // below selection
    }

    setPos({ top, left });
  }, [selectionInfo]);

  const handleEditWithAgent = useCallback(() => {
    // Package selection context and emit to chat
    commandBus?.emit("codascope:design-selection-to-chat", {
      blockId: selectionInfo.blockId,
      text: selectionInfo.text,
      startLine: selectionInfo.startLine,
      endLine: selectionInfo.endLine,
      docId,
      epicId,
    });
    // Open the right panel to the assistant
    useShellStore.getState().openRightPanel("assistant");
    // Clear selection
    onDismiss();
    window.getSelection()?.removeAllRanges();
  }, [selectionInfo, commandBus, docId, epicId, onDismiss]);

  const handleComment = useCallback(() => {
    onComment(selectionInfo.blockId);
    onDismiss();
    window.getSelection()?.removeAllRanges();
  }, [selectionInfo, onComment, onDismiss]);

  return (
    <div
      className="codascope-selection-toolbar"
      ref={toolbarRef}
      style={pos ? { top: pos.top, left: pos.left, opacity: 1 } : { opacity: 0 }}
    >
      <button
        className="codascope-btn codascope-btn-xs codascope-selection-toolbar-btn codascope-selection-toolbar-btn--primary"
        onClick={handleEditWithAgent}
        type="button"
      >
        <IconSparkle size={12} /> Edit with Agent
      </button>
      <button
        className="codascope-btn codascope-btn-xs codascope-selection-toolbar-btn"
        onClick={handleComment}
        type="button"
      >
        <IconAnnotation size={12} /> Comment
      </button>
    </div>
  );
}
