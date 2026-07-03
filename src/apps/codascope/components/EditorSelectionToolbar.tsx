/* ── EditorSelectionToolbar ─────────────────────────────────────────
   Floating toolbar that appears when the user selects text in the
   DocumentEditor. Provides "Edit with Agent" and "Comment" actions.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useRef } from "react";
import { useShellStore } from "../../../shell/store";
import { useCommandBus } from "../../../shell/hooks";
import { IconSparkle, IconAnnotation } from "./CodaScopeIcons";

export interface SelectionInfo {
  blockId: string;
  text: string;
  startLine: number;
  endLine: number;
}

interface EditorSelectionToolbarProps {
  selectionInfo: SelectionInfo;
  epicId: string;
  docId: string;
  onComment: (blockId: string) => void;
  onDismiss: () => void;
}

export function EditorSelectionToolbar({
  selectionInfo,
  epicId,
  docId,
  onComment,
  onDismiss,
}: EditorSelectionToolbarProps) {
  const commandBus = useCommandBus();
  const toolbarRef = useRef<HTMLDivElement>(null);

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
    <div className="codascope-selection-toolbar" ref={toolbarRef}>
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
