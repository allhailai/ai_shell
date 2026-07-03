/* ── CodaScope: DocumentEditor Component ─────────────────────────────
   Core document viewing/editing component used for design documents.
   P2a: rendered markdown + edit lock + agent edit trigger.
   P2b: block-level rendering, annotation gutter, insertion directives,
        text selection toolbar.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { MarkdownViewer } from "../../../shared/markdown";
import { AnnotationThread } from "./AnnotationThread";
import { InsertionPrompt } from "./InsertionPrompt";
import { EditorSelectionToolbar, type SelectionInfo } from "./EditorSelectionToolbar";
import { IconAnnotation, IconCheckmark, IconBolt, IconRefresh, IconWarning } from "./CodaScopeIcons";
import { useCommandBus } from "../../../shell/hooks";
import { useEditorDiff } from "../hooks/useEditorDiff";
import { useEditorResize } from "../hooks/useEditorResize";
import type { EpicDesignDoc, EditLock, Annotation, InsertionDirective, BlockInfo } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface DocumentEditorProps {
  epicId: string;
  doc: EpicDesignDoc;
  content: string;
  contentHash?: string;
  onContentChange: (content: string, contentHash?: string) => void;
  onClose: () => void;
}

/* ── Constants ───────────────────────────────────────────────────────── */

const LOCK_CHECK_INTERVAL_MS = 30_000;
const LOCK_WARNING_MS = 4 * 60 * 1000;
const LOCK_TTL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60_000;



/* ── Component ───────────────────────────────────────────────────────── */

export function DocumentEditor({ epicId, doc, content, contentHash: initialContentHash, onContentChange, onClose }: DocumentEditorProps) {
  const { activeProjectId } = useCodaScopeStore();
  const commandBus = useCommandBus();

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [saving, setSaving] = useState(false);
  const [lock, setLock] = useState<EditLock | null>(null);
  const [lockWarning, setLockWarning] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const lockCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Content hash tracking for optimistic concurrency
  const [contentHash, setContentHash] = useState<string | undefined>(initialContentHash);
  const [conflictData, setConflictData] = useState<{ currentHash: string; currentContent: string } | null>(null);

  // P2b state
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [directives, setDirectives] = useState<InsertionDirective[]>([]);
  const [blocks, setBlocks] = useState<BlockInfo[]>([]);
  const [activeThreadBlockId, setActiveThreadBlockId] = useState<string | null>(null);
  const [insertionBlockId, setInsertionBlockId] = useState<string | null>(null);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Extracted hooks
  const { changedBlockIds, fadingBlockIds, trackContentChange } = useEditorDiff();

  // Resize callback: updates content AND contentHash from server response
  const handleResizeContentChange = useCallback((newContent: string, newHash: string) => {
    setContentHash(newHash);
    onContentChange(newContent, newHash);
  }, [onContentChange]);

  const { handleMermaidResize, handleImageResize } = useEditorResize({
    activeProjectId,
    epicId,
    docId: doc.id,
    onContentChange: handleResizeContentChange,
  });

  // Phase 4: Undo state
  const [lastAgentEditVersion, setLastAgentEditVersion] = useState<number | null>(null);
  const [undoing, setUndoing] = useState(false);

  // Sync content when it changes externally
  useEffect(() => {
    if (!editing) setEditContent(content);
  }, [content, editing]);

  /* ── Block computation ───────────────────────────────────────────── */

  useEffect(() => {
    if (!activeProjectId) return;
    const fetchBlocks = async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epicId}/docs/${doc.id}/blocks`,
        );
        if (res.ok) {
          const data = await res.json();
          const newBlocks = data.blocks ?? [];
          setBlocks(newBlocks);
          trackContentChange(newBlocks, content);
        }
      } catch { /* ignore */ }
    };
    fetchBlocks();
  }, [activeProjectId, epicId, doc.id, content, trackContentChange]);

  /* ── Phase 3: Agent edit refresh via command bus ──────────────────── */

  useEffect(() => {
    if (!commandBus || !activeProjectId) return;
    const unsub = commandBus.on("codascope:design-doc-edited", async (payload: { epicId: string; docId: string; summary?: string }) => {
      if (payload.docId !== doc.id) return;
      // Re-fetch the content from the API
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epicId}/designs/${doc.id}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data.content !== undefined) {
            if (data.contentHash) setContentHash(data.contentHash);
            onContentChange(data.content, data.contentHash);
          }
        }
        // Fetch the latest version list to get the pre-edit version number for undo
        const versionsRes = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epicId}/designs/${doc.id}/versions`,
        );
        if (versionsRes.ok) {
          const versionsData = await versionsRes.json();
          const versions = versionsData.versions ?? [];
          if (versions.length > 0) {
            // The most recent version is the snapshot taken before the agent edit
            setLastAgentEditVersion(versions[versions.length - 1].number);
          }
        }
      } catch { /* ignore */ }
    });
    return unsub;
  }, [commandBus, activeProjectId, epicId, doc.id, onContentChange]);

  /* ── Annotation & directive loading ──────────────────────────────── */

  const loadAnnotations = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/docs/${doc.id}/annotations`,
      );
      if (res.ok) {
        const data = await res.json();
        setAnnotations(data.annotations ?? []);
      }
    } catch { /* ignore */ }
  }, [activeProjectId, epicId, doc.id]);

  const loadDirectives = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/docs/${doc.id}/directives`,
      );
      if (res.ok) {
        const data = await res.json();
        setDirectives(data.directives ?? []);
      }
    } catch { /* ignore */ }
  }, [activeProjectId, epicId, doc.id]);

  useEffect(() => {
    loadAnnotations();
    loadDirectives();
  }, [loadAnnotations, loadDirectives]);

  /* ── Annotation grouping by block ──────────────────────────────── */

  const annotationsByBlock = useMemo(() => {
    const map = new Map<string, { roots: Annotation[]; replies: Map<string, Annotation[]> }>();
    for (const ann of annotations) {
      const blockId = ann.anchor.blockId;
      if (!map.has(blockId)) map.set(blockId, { roots: [], replies: new Map() });
      const group = map.get(blockId)!;
      if (ann.parentId) {
        const existing = group.replies.get(ann.parentId) ?? [];
        existing.push(ann);
        group.replies.set(ann.parentId, existing);
      } else {
        group.roots.push(ann);
      }
    }
    return map;
  }, [annotations]);

  /* ── Directive grouping by location ────────────────────────────── */

  const directivesByBlock = useMemo(() => {
    const map = new Map<string, InsertionDirective[]>();
    for (const dir of directives) {
      const key = dir.blockId ?? `line_${dir.afterLine}`;
      const existing = map.get(key) ?? [];
      existing.push(dir);
      map.set(key, existing);
    }
    return map;
  }, [directives]);

  /* ── Lock management ─────────────────────────────────────────────── */

  const acquireLock = useCallback(async () => {
    if (!activeProjectId) return false;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/epics/${epicId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.id, lockedBy: "user" }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.error) return false;
      setLock(data);
      lastActivityRef.current = Date.now();
      return true;
    } catch {
      return false;
    }
  }, [activeProjectId, epicId, doc.id]);

  const releaseLock = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      await fetch(`/api/codascope/projects/${activeProjectId}/epics/${epicId}/lock`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.id }),
      });
    } catch { /* ignore */ }
    setLock(null);
    setLockWarning(false);
  }, [activeProjectId, epicId, doc.id]);

  // Check lock expiry + heartbeat (P4)
  useEffect(() => {
    if (!editing || !lock || !activeProjectId) return;

    // Server heartbeat — keeps the lock alive on the server
    const heartbeatInterval = setInterval(async () => {
      try {
        await fetch(`/api/codascope/projects/${activeProjectId}/epics/${epicId}/lock/heartbeat`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: doc.id, lockedBy: "user" }),
        });
      } catch { /* best effort */ }
    }, HEARTBEAT_INTERVAL_MS);

    // Client-side expiry check
    lockCheckRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= LOCK_TTL_MS) {
        setEditing(false);
        void releaseLock();
      } else if (elapsed >= LOCK_WARNING_MS) {
        setLockWarning(true);
      }
    }, LOCK_CHECK_INTERVAL_MS);

    return () => {
      clearInterval(heartbeatInterval);
      if (lockCheckRef.current) clearInterval(lockCheckRef.current);
    };
  }, [editing, lock, releaseLock, activeProjectId, epicId, doc.id]);

  // Release lock on unmount
  useEffect(() => {
    return () => {
      if (lock) void releaseLock();
    };
  }, [lock, releaseLock]);

  /* ── Edit mode ───────────────────────────────────────────────────── */

  const startEditing = useCallback(async () => {
    const acquired = await acquireLock();
    if (acquired) {
      setEditing(true);
      setEditContent(content);
    }
  }, [acquireLock, content]);

  const saveAndClose = useCallback(async () => {
    if (!activeProjectId) return;
    setSaving(true);
    setConflictData(null);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/designs/${doc.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: editContent, expectedHash: contentHash }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        setContentHash(data.contentHash);
        onContentChange(editContent, data.contentHash);
        setEditing(false);
        await releaseLock();
      } else if (res.status === 409) {
        // Conflict — document was modified since we loaded it
        const data = await res.json();
        setConflictData({ currentHash: data.currentHash, currentContent: data.currentContent });
      }
    } catch { /* ignore */ }
    setSaving(false);
  }, [activeProjectId, epicId, doc.id, editContent, contentHash, onContentChange, releaseLock]);

  const cancelEditing = useCallback(async () => {
    setEditing(false);
    setEditContent(content);
    await releaseLock();
  }, [content, releaseLock]);

  const handleTextareaInput = useCallback(() => {
    lastActivityRef.current = Date.now();
    setLockWarning(false);
  }, []);

  // Phase 4: Batch execute all pending directives
  const [batchExecuting, setBatchExecuting] = useState(false);

  // Phase 4: Count directives ready for batch apply
  const readyToApplyCount = useMemo(() => {
    return directives.filter((d) => d.status === "pending" && d.generatedContent).length;
  }, [directives]);

  const executeBatchDirectives = useCallback(async () => {
    if (!activeProjectId || batchExecuting) return;
    setBatchExecuting(true);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/docs/${doc.id}/directives/batch`,
        { method: "POST" },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.content !== undefined) {
          onContentChange(data.content);
        }
        // Reload directives
        await loadDirectives();
      }
    } catch { /* ignore */ }
    setBatchExecuting(false);
  }, [activeProjectId, epicId, doc.id, batchExecuting, onContentChange, loadDirectives]);

  /* ── Phase 4: Undo last agent change ─────────────────────────────── */

  const handleUndo = useCallback(async () => {
    if (!activeProjectId || !lastAgentEditVersion || undoing) return;
    setUndoing(true);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/designs/${doc.id}/revert/${lastAgentEditVersion}`,
        { method: "POST" },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.content !== undefined) {
          onContentChange(data.content);
        }
        setLastAgentEditVersion(null);
      }
    } catch { /* ignore */ }
    setUndoing(false);
  }, [activeProjectId, epicId, doc.id, lastAgentEditVersion, undoing, onContentChange]);

  /* ── Mermaid & image resize persistence (via useEditorResize hook) ── */

  /* ── Create annotation on block ──────────────────────────────────── */

  const [commentBlockId, setCommentBlockId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  const handleAddComment = useCallback(async (blockId: string) => {
    if (!activeProjectId || !commentText.trim()) return;
    setCommentSubmitting(true);
    const block = blocks.find((b) => b.blockId === blockId);
    try {
      await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/docs/${doc.id}/annotations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            anchor: {
              blockId,
              sectionSlug: block?.sectionSlug ?? "root",
              anchorText: (block?.content ?? "").slice(0, 100),
              lineNumber: block?.lineStart ?? 0,
            },
            author: "user",
            body: commentText.trim(),
          }),
        },
      );
      setCommentText("");
      setCommentBlockId(null);
      await loadAnnotations();
    } catch { /* ignore */ }
    setCommentSubmitting(false);
  }, [activeProjectId, epicId, doc.id, commentText, blocks, loadAnnotations]);

  /* ── Selection detection ──────────────────────────────────────────── */

  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !viewerRef.current) {
      setSelectionInfo(null);
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      setSelectionInfo(null);
      return;
    }

    // Find the block containing the selection
    const anchorNode = selection.anchorNode;
    if (!anchorNode) { setSelectionInfo(null); return; }

    let blockEl = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
    while (blockEl && !blockEl.getAttribute?.("data-block-id")) {
      blockEl = blockEl.parentElement;
    }

    if (!blockEl) { setSelectionInfo(null); return; }

    const blockId = blockEl.getAttribute("data-block-id") ?? "";
    const block = blocks.find((b) => b.blockId === blockId);

    setSelectionInfo({
      blockId,
      text,
      startLine: block?.lineStart ?? 0,
      endLine: block?.lineEnd ?? 0,
    });
  }, [blocks]);

  useEffect(() => {
    document.addEventListener("mouseup", handleTextSelection);
    return () => document.removeEventListener("mouseup", handleTextSelection);
  }, [handleTextSelection]);

  /* ── Word count ──────────────────────────────────────────────────── */

  const displayContent = editing ? editContent : content;
  const wordCount = displayContent.trim() ? displayContent.trim().split(/\s+/).length : 0;
  const lastUpdated = new Date(doc.updatedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const openAnnotationCount = annotations.filter((a) => a.status === "open" && !a.parentId).length;
  const pendingDirectiveCount = directives.filter((d) => d.status === "pending").length;

  /* ── Render blocks with annotation gutter ────────────────────────── */

  const renderBlockView = () => {
    if (!displayContent) {
      return (
        <div className="codascope-empty-state">
          <p>This document is empty. Click Edit to start writing, or ask the agent to draft it.</p>
        </div>
      );
    }

    // Count mermaid fences and images in a block's content
    const countMermaidFences = (text: string): number => {
      const matches = text.match(/^[ \t]*(?:`{3,}|~{3,})\s*mermaid/gm);
      return matches ? matches.length : 0;
    };
    const countImages = (text: string): number => {
      const matches = text.match(/!\[[^\]]*\]\([^)]+\)/g);
      return matches ? matches.length : 0;
    };

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
          const openCount = rootAnnotations.filter((a) => a.status === "open").length;
          const blockDirs = directivesByBlock.get(block.blockId) ?? [];
          const isThreadOpen = activeThreadBlockId === block.blockId;
          const isInsertionOpen = insertionBlockId === block.blockId;
          const isHovered = hoveredBlockId === block.blockId;
          const isCommentOpen = commentBlockId === block.blockId;

          const isChanged = changedBlockIds.has(block.blockId);
          const isFading = fadingBlockIds.has(block.blockId);

          // Offset-adjusted resize callbacks for this block
          const offsets = blockOffsets[idx];
          const blockMermaidResize = (withinBlockIndex: number, height: number) =>
            handleMermaidResize(offsets.mermaid + withinBlockIndex, height);
          const blockImageResize = (withinBlockIndex: number, width: number, height: number) =>
            handleImageResize(offsets.image + withinBlockIndex, width, height);

          return (
            <div key={block.blockId}>
              {/* Block with gutter */}
              <div
                className={`codascope-document-block${isHovered ? " codascope-document-block--hover" : ""}${isChanged ? " codascope-document-block--changed" : ""}${isFading ? " codascope-fade-out" : ""}`}
                data-block-id={block.blockId}
                onMouseEnter={() => setHoveredBlockId(block.blockId)}
                onMouseLeave={() => setHoveredBlockId(null)}
              >
                {/* Main content */}
                <div className="codascope-document-block-content">
                  <MarkdownViewer
                    content={block.content}
                    onMermaidResize={blockMermaidResize}
                    onImageResize={blockImageResize}
                  />
                </div>

                {/* Annotation gutter */}
                <div className="codascope-annotation-gutter">
                  {openCount > 0 && (
                    <button
                      className="codascope-annotation-gutter-icon"
                      onClick={() => setActiveThreadBlockId(isThreadOpen ? null : block.blockId)}
                      title={`${openCount} open comment${openCount > 1 ? "s" : ""}`}
                      type="button"
                    >
                      <IconAnnotation size={12} /> {openCount}
                    </button>
                  )}
                  {rootAnnotations.length > 0 && openCount === 0 && (
                    <button
                      className="codascope-annotation-gutter-icon codascope-annotation-gutter-icon--resolved"
                      onClick={() => setActiveThreadBlockId(isThreadOpen ? null : block.blockId)}
                      title={`${rootAnnotations.length} resolved`}
                      type="button"
                    >
                      <IconCheckmark size={12} />
                    </button>
                  )}
                  {isHovered && rootAnnotations.length === 0 && (
                    <button
                      className="codascope-annotation-gutter-icon codascope-annotation-gutter-icon--add"
                      onClick={() => setCommentBlockId(isCommentOpen ? null : block.blockId)}
                      title="Add comment"
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
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Write a comment…"
                    rows={2}
                    autoFocus
                  />
                  <div className="codascope-annotation-thread-reply-actions">
                    <button
                      className="codascope-btn codascope-btn-ghost codascope-btn-xs"
                      onClick={() => { setCommentBlockId(null); setCommentText(""); }}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="codascope-btn codascope-btn-primary codascope-btn-xs"
                      onClick={() => handleAddComment(block.blockId)}
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
                  projectId={activeProjectId!}
                  epicId={epicId}
                  onUpdate={loadAnnotations}
                  onClose={() => setActiveThreadBlockId(null)}
                />
              ))}

              {/* Existing directives for this block */}
              {blockDirs.map((dir) => (
                <InsertionPrompt
                  key={dir.id}
                  projectId={activeProjectId!}
                  epicId={epicId}
                  documentId={doc.id}
                  afterLine={dir.afterLine}
                  blockId={dir.blockId}
                  existingDirective={dir}
                  defaultType={dir.type}
                  startLine={dir.startLine}
                  endLine={dir.endLine}
                  onUpdate={() => { loadDirectives(); loadAnnotations(); }}
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
                      projectId={activeProjectId!}
                      epicId={epicId}
                      documentId={doc.id}
                      afterLine={block.lineEnd}
                      blockId={block.blockId}
                      onUpdate={() => { loadDirectives(); }}
                      onClose={() => setInsertionBlockId(null)}
                    />
                  ) : (
                    <button
                      className="codascope-document-block-insert-btn"
                      onClick={() => setInsertionBlockId(block.blockId)}
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
            onMermaidResize={handleMermaidResize}
            onImageResize={handleImageResize}
          />
        )}
      </div>
    );
  };



  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="codascope-document-editor">
      {/* Header toolbar */}
      <div className="codascope-document-editor-toolbar">
        <div className="codascope-document-editor-toolbar-left">
          <button className="codascope-btn codascope-btn-ghost" onClick={onClose} type="button">
            ← Back
          </button>
          <h2 className="codascope-document-editor-title">{doc.title}</h2>
          {doc.template && (
            <span className="codascope-document-editor-template-badge">{doc.template}</span>
          )}
        </div>
        <div className="codascope-document-editor-toolbar-right">
          <span className="codascope-document-editor-meta">
            {wordCount.toLocaleString()} words · Updated {lastUpdated}
            {openAnnotationCount > 0 && (
              <span className="codascope-document-editor-annotation-count">
                · <IconAnnotation size={12} /> {openAnnotationCount}
              </span>
            )}
            {pendingDirectiveCount > 0 && (
              <span className="codascope-document-editor-directive-count">
                · <IconBolt size={12} /> {pendingDirectiveCount} pending
              </span>
            )}
          </span>
          {lastAgentEditVersion && !editing && (
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-undo"
              onClick={handleUndo}
              disabled={undoing}
              type="button"
              title="Revert to the version before the last agent edit"
            >
              <IconRefresh size={12} /> {undoing ? "Undoing…" : "Undo"}
            </button>
          )}
          {!editing && (
            <button className="codascope-btn codascope-btn-secondary" onClick={startEditing} type="button">
              ✏️ Edit
            </button>
          )}
        </div>
      </div>

      {/* Lock warning (P4: heartbeat-aware) */}
      {lockWarning && (
        <div className="codascope-lock-heartbeat-warning">
          <span className="codascope-lock-heartbeat-warning-icon">⚠️</span>
          Lock expires in less than 1 minute. Save your changes or type to extend.
        </div>
      )}

      {/* Conflict resolution banner */}
      {conflictData && (
        <div className="codascope-conflict-banner">
          <div className="codascope-conflict-banner-text">
            <IconWarning size={14} />
            <span>This document was modified by another user or agent. Your save was blocked to prevent overwriting their changes.</span>
          </div>
          <div className="codascope-conflict-banner-actions">
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-sm"
              type="button"
              onClick={() => {
                // Reload: accept the server version
                setEditContent(conflictData.currentContent);
                setContentHash(conflictData.currentHash);
                onContentChange(conflictData.currentContent, conflictData.currentHash);
                setConflictData(null);
                setEditing(false);
                void releaseLock();
              }}
            >
              Reload
            </button>
            <button
              className="codascope-btn codascope-btn-danger codascope-btn-sm"
              type="button"
              onClick={async () => {
                // Force save: retry without expectedHash
                setConflictData(null);
                setSaving(true);
                try {
                  const res = await fetch(
                    `/api/codascope/projects/${activeProjectId}/epics/${epicId}/designs/${doc.id}`,
                    {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ content: editContent }),
                    },
                  );
                  if (res.ok) {
                    const data = await res.json();
                    setContentHash(data.contentHash);
                    onContentChange(editContent, data.contentHash);
                    setEditing(false);
                    await releaseLock();
                  }
                } catch { /* ignore */ }
                setSaving(false);
              }}
            >
              Force Save
            </button>
          </div>
        </div>
      )}

      {/* Phase 4: Batch directive execution bar */}
      {readyToApplyCount > 0 && !editing && (
        <div className="codascope-batch-directive-bar">
          <span>
            <span className="codascope-batch-directive-bar-count">{readyToApplyCount}</span>
            {" "}directive{readyToApplyCount !== 1 ? "s" : ""} ready to apply
          </span>
          <button
            className="codascope-btn codascope-btn-primary codascope-btn-sm"
            onClick={executeBatchDirectives}
            disabled={batchExecuting}
            type="button"
          >
            <IconBolt size={12} />
            {batchExecuting ? "Applying…" : "Apply All"}
          </button>
        </div>
      )}

      {/* Content area */}
      {editing ? (
        <div className="codascope-document-editor-edit-area">
          <div className="codascope-document-editor-edit-toolbar">
            <span className="codascope-document-editor-edit-label">Editing</span>
            <div className="codascope-document-editor-edit-actions">
              <button
                className="codascope-btn codascope-btn-ghost"
                onClick={cancelEditing}
                disabled={saving}
                type="button"
              >
                Cancel
              </button>
              <button
                className="codascope-btn codascope-btn-primary"
                onClick={saveAndClose}
                disabled={saving}
                type="button"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          <textarea
            className="codascope-document-editor-textarea"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onInput={handleTextareaInput}
            spellCheck
          />
        </div>
      ) : (
        <div className="codascope-document-editor-viewer" ref={viewerRef}>
          {renderBlockView()}
        </div>
      )}

      {/* Selection toolbar */}
      {selectionInfo && !editing && (
        <EditorSelectionToolbar
          selectionInfo={selectionInfo}
          epicId={epicId}
          docId={doc.id}
          onComment={(blockId) => setCommentBlockId(blockId)}
          onDismiss={() => setSelectionInfo(null)}
        />
      )}
    </div>
  );
}
