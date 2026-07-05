/* ── CodaScope: DocumentBlockRenderer ────────────────────────────────
   Renders the block-level view of a design document with annotation
   gutter, insertion triggers, and diff highlighting.

   Extracted from DocumentEditor to reduce component complexity.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback } from "react";
import { MarkdownViewer } from "../../../shared/markdown";
import { AnnotationThread } from "./AnnotationThread";
import { InsertionPrompt } from "./InsertionPrompt";
import { IconAnnotation, IconCheckmark } from "./CodaScopeIcons";
import type { Annotation, InsertionDirective, BlockInfo } from "../codaScopeTypes";

/* ── Types ───────────────────────────────────────────────────────────── */

interface AnnotationGroup {
  roots: Annotation[];
  replies: Map<string, Annotation[]>;
}

interface DocumentBlockRendererProps {
  /** The rendered document content (view mode) */
  displayContent: string;
  /** Computed block breakdown of the document */
  blocks: BlockInfo[];
  /** Annotations grouped by block ID */
  annotationsByBlock: Map<string, AnnotationGroup>;
  /** Directives grouped by block ID */
  directivesByBlock: Map<string, InsertionDirective[]>;
  /** Block IDs with open annotation threads */
  openThreadBlockIds: Set<string>;
  /** Toggle a thread open/closed */
  onToggleThread: (blockId: string) => void;
  /** Currently hovered block ID */
  hoveredBlockId: string | null;
  /** Set hovered block */
  onHoverBlock: (blockId: string | null) => void;
  /** Block ID with an open inline comment box */
  commentBlockId: string | null;
  /** Toggle comment box on a block */
  onToggleComment: (blockId: string | null) => void;
  /** Current comment text */
  commentText: string;
  /** Update comment text */
  onCommentTextChange: (text: string) => void;
  /** Submit a comment on a block */
  onSubmitComment: (blockId: string) => void;
  /** Whether a comment is currently being submitted */
  commentSubmitting: boolean;
  /** Block IDs that have recently changed (diff highlight) */
  changedBlockIds: Set<string>;
  /** Block IDs fading out from diff highlight */
  fadingBlockIds: Set<string>;
  /** Currently open insertion prompt block ID */
  insertionBlockId: string | null;
  /** Set insertion block ID */
  onSetInsertionBlockId: (blockId: string | null) => void;
  /** Whether the editor is in edit mode */
  editing: boolean;
  /** Project/epic/doc context for API calls */
  activeProjectId: string;
  epicId: string;
  docId: string;
  /** Callback to reload annotations */
  onReloadAnnotations: () => void;
  /** Callback to reload directives */
  onReloadDirectives: () => void;
  /** Callback for wiki link navigation */
  onWikiLink: (topic: string) => void;
  /** Mermaid diagram resize handler */
  onMermaidResize: (index: number, height: number) => void;
  /** Image resize handler */
  onImageResize: (index: number, width: number, height: number) => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Count mermaid code fences in a block's content */
function countMermaidFences(text: string): number {
  const matches = text.match(/^[ \t]*(?:`{3,}|~{3,})\s*mermaid/gm);
  return matches ? matches.length : 0;
}

/** Count markdown images in a block's content */
function countImages(text: string): number {
  const matches = text.match(/!\[[^\]]*\]\([^)]+\)/g);
  return matches ? matches.length : 0;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function DocumentBlockRenderer({
  displayContent,
  blocks,
  annotationsByBlock,
  directivesByBlock,
  openThreadBlockIds,
  onToggleThread,
  hoveredBlockId,
  onHoverBlock,
  commentBlockId,
  onToggleComment,
  commentText,
  onCommentTextChange,
  onSubmitComment,
  commentSubmitting,
  changedBlockIds,
  fadingBlockIds,
  insertionBlockId,
  onSetInsertionBlockId,
  editing,
  activeProjectId,
  epicId,
  docId,
  onReloadAnnotations,
  onReloadDirectives,
  onWikiLink,
  onMermaidResize,
  onImageResize,
}: DocumentBlockRendererProps) {

  // Toggle thread helper
  const toggleThread = useCallback((blockId: string) => {
    onToggleThread(blockId);
  }, [onToggleThread]);

  if (!displayContent) {
    return (
      <div className="codascope-empty-state">
        <p>This document is empty. Click Edit to start writing, or ask the agent to draft it.</p>
      </div>
    );
  }

  // Pre-compute cumulative offsets for each block
  let mermaidOffset = 0;
  let imageOffset = 0;
  const blockOffsets = blocks.map((block) => {
    const offset = { mermaid: mermaidOffset, image: imageOffset };
    mermaidOffset += countMermaidFences(block.content);
    imageOffset += countImages(block.content);
    return offset;
  });

  return (
    <div className="codascope-document-blocks">
      {blocks.map((block, idx) => {
        const blockAnns = annotationsByBlock.get(block.blockId);
        const rootAnnotations = blockAnns?.roots ?? [];
        const totalCount = rootAnnotations.length + rootAnnotations.reduce((sum, r) => sum + (blockAnns?.replies.get(r.id)?.length ?? 0), 0);
        const blockDirs = directivesByBlock.get(block.blockId) ?? [];
        const isThreadOpen = openThreadBlockIds.has(block.blockId);
        const isInsertionOpen = insertionBlockId === block.blockId;
        const isHovered = hoveredBlockId === block.blockId;
        const isCommentOpen = commentBlockId === block.blockId;

        const isChanged = changedBlockIds.has(block.blockId);
        const isFading = fadingBlockIds.has(block.blockId);

        // Offset-adjusted resize callbacks for this block
        const offsets = blockOffsets[idx];
        const blockMermaidResize = (withinBlockIndex: number, height: number) =>
          onMermaidResize(offsets.mermaid + withinBlockIndex, height);
        const blockImageResize = (withinBlockIndex: number, width: number, height: number) =>
          onImageResize(offsets.image + withinBlockIndex, width, height);

        return (
          <div key={block.blockId}>
            {/* Block with gutter */}
            <div
              className={`codascope-document-block${isHovered ? " codascope-document-block--hover" : ""}${isChanged ? " codascope-document-block--changed" : ""}${isFading ? " codascope-fade-out" : ""}`}
              data-block-id={block.blockId}
              onMouseEnter={() => onHoverBlock(block.blockId)}
              onMouseLeave={() => onHoverBlock(null)}
            >
              {/* Main content */}
              <div className="codascope-document-block-content">
                <MarkdownViewer
                  content={block.content}
                  onWikiLink={onWikiLink}
                  onMermaidResize={blockMermaidResize}
                  onImageResize={blockImageResize}
                />
              </div>

              {/* Annotation gutter */}
              <div className="codascope-annotation-gutter">
                {rootAnnotations.length > 0 && rootAnnotations.some((a) => a.status === "open") && (
                  <button
                    className="codascope-annotation-gutter-icon"
                    onClick={() => toggleThread(block.blockId)}
                    title={`${totalCount} comment${totalCount > 1 ? "s" : ""}`}
                    type="button"
                  >
                    <IconAnnotation size={12} /> {totalCount}
                  </button>
                )}
                {rootAnnotations.length > 0 && !rootAnnotations.some((a) => a.status === "open") && (
                  <button
                    className="codascope-annotation-gutter-icon codascope-annotation-gutter-icon--resolved"
                    onClick={() => toggleThread(block.blockId)}
                    title={`${rootAnnotations.length} resolved`}
                    type="button"
                  >
                    <IconCheckmark size={12} />
                  </button>
                )}
                {isHovered && rootAnnotations.length === 0 && (
                  <button
                    className="codascope-annotation-gutter-icon codascope-annotation-gutter-icon--add"
                    onClick={() => onToggleComment(isCommentOpen ? null : block.blockId)}
                    data-tooltip="Add comment"
                    type="button"
                  >
                    +
                  </button>
                )}
              </div>
            </div>

            {/* Inline comment input */}
            {isCommentOpen && (
              <div className="codascope-annotation-thread codascope-annotation-thread--new">
                <textarea
                  className="codascope-annotation-thread-reply-input"
                  value={commentText}
                  onChange={(e) => onCommentTextChange(e.target.value)}
                  placeholder="Write a comment…"
                  rows={2}
                  autoFocus
                />
                <div className="codascope-annotation-thread-reply-actions">
                  <button
                    className="codascope-btn codascope-btn-ghost codascope-btn-xs"
                    onClick={() => { onToggleComment(null); onCommentTextChange(""); }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="codascope-btn codascope-btn-primary codascope-btn-xs"
                    onClick={() => onSubmitComment(block.blockId)}
                    disabled={commentSubmitting || !commentText.trim()}
                    type="button"
                  >
                    {commentSubmitting ? "Posting…" : "Comment"}
                  </button>
                </div>
              </div>
            )}

            {/* Inline annotation thread */}
            {isThreadOpen && rootAnnotations.map((root) => (
              <AnnotationThread
                key={root.id}
                annotation={root}
                replies={blockAnns?.replies.get(root.id) ?? []}
                projectId={activeProjectId}
                epicId={epicId}
                onUpdate={onReloadAnnotations}
                onClose={() => onToggleThread(block.blockId)}
              />
            ))}

            {/* Existing directives for this block */}
            {blockDirs.map((dir) => (
              <InsertionPrompt
                key={dir.id}
                projectId={activeProjectId}
                epicId={epicId}
                documentId={docId}
                afterLine={dir.afterLine}
                blockId={dir.blockId}
                existingDirective={dir}
                defaultType={dir.type}
                startLine={dir.startLine}
                endLine={dir.endLine}
                onUpdate={() => { onReloadDirectives(); onReloadAnnotations(); }}
                onClose={() => {}}
              />
            ))}

            {/* Insertion trigger between blocks */}
            {!editing && idx < blocks.length - 1 && (
              <div
                className={`codascope-document-block-insert-trigger${isInsertionOpen ? " codascope-document-block-insert-trigger--active" : ""}`}
              >
                {isInsertionOpen ? (
                  <InsertionPrompt
                    projectId={activeProjectId}
                    epicId={epicId}
                    documentId={docId}
                    afterLine={block.lineEnd}
                    blockId={block.blockId}
                    onUpdate={() => { onReloadDirectives(); }}
                    onClose={() => onSetInsertionBlockId(null)}
                  />
                ) : (
                  <button
                    className="codascope-document-block-insert-btn"
                    onClick={() => onSetInsertionBlockId(block.blockId)}
                    title="Insert content here"
                    type="button"
                  >
                    +
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Fallback: if no blocks, render entire content */}
      {blocks.length === 0 && (
        <MarkdownViewer
          content={displayContent}
          onWikiLink={onWikiLink}
          onMermaidResize={onMermaidResize}
          onImageResize={onImageResize}
        />
      )}
    </div>
  );
}
