/* ── CodaScope: DocumentEditor Component ─────────────────────────────
   Core document viewing/editing component used for design documents.
   P2a: rendered markdown + edit lock + agent edit trigger.
   P2b: block-level rendering, annotation gutter, insertion directives,
        text selection toolbar.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { useShellStore } from "../../../shell/store";
import { MarkdownViewer } from "../../../shared/markdown";
import { AnnotationThread } from "./AnnotationThread";
import { InsertionPrompt } from "./InsertionPrompt";
import { IconAnnotation, IconCheckmark, IconBolt, IconSparkle, IconRefresh } from "./CodaScopeIcons";
import { useCommandBus } from "../../../shell/hooks";
import type { EpicDesignDoc, EditLock, Annotation, InsertionDirective, BlockInfo } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface DocumentEditorProps {
  epicId: string;
  doc: EpicDesignDoc;
  content: string;
  onContentChange: (content: string) => void;
  onClose: () => void;
}

/* ── Constants ───────────────────────────────────────────────────────── */

const LOCK_CHECK_INTERVAL_MS = 30_000;
const LOCK_WARNING_MS = 4 * 60 * 1000;
const LOCK_TTL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60_000;

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Simple string hash for diff comparison (djb2 algorithm) */
function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function DocumentEditor({ epicId, doc, content, onContentChange, onClose }: DocumentEditorProps) {
  const { activeProjectId } = useCodaScopeStore();
  const commandBus = useCommandBus();

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [saving, setSaving] = useState(false);
  const [lock, setLock] = useState<EditLock | null>(null);
  const [lockWarning, setLockWarning] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const lockCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // P2b state
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [directives, setDirectives] = useState<InsertionDirective[]>([]);
  const [blocks, setBlocks] = useState<BlockInfo[]>([]);
  const [activeThreadBlockId, setActiveThreadBlockId] = useState<string | null>(null);
  const [insertionBlockId, setInsertionBlockId] = useState<string | null>(null);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [selectionInfo, setSelectionInfo] = useState<{
    blockId: string;
    text: string;
    startLine: number;
    endLine: number;
  } | null>(null);
  const selectionToolbarRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Phase 3: Diff highlighting state
  const [changedBlockIds, setChangedBlockIds] = useState<Set<string>>(new Set());
  const [fadingBlockIds, setFadingBlockIds] = useState<Set<string>>(new Set());
  const previousContentRef = useRef<string>("");
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

          // Phase 3: Diff highlighting — compare with previous content
          if (previousContentRef.current && previousContentRef.current !== content) {
            const oldBlockHashes = new Map<string, number>();
            // Simple hash per block from previous render's blocks
            const oldLines = previousContentRef.current.split("\n");
            for (const block of newBlocks) {
              const blockContent = oldLines.slice(block.lineStart - 1, block.lineEnd).join("\n");
              oldBlockHashes.set(block.blockId, simpleHash(blockContent));
            }
            const changed = new Set<string>();
            for (const block of newBlocks) {
              const newBlockContent = content.split("\n").slice(block.lineStart - 1, block.lineEnd).join("\n");
              const newHash = simpleHash(newBlockContent);
              const oldHash = oldBlockHashes.get(block.blockId);
              if (oldHash !== undefined && oldHash !== newHash) {
                changed.add(block.blockId);
              }
            }
            // Also mark any blocks that exist in new but not old
            if (changed.size > 0) {
              setChangedBlockIds(changed);
              setFadingBlockIds(new Set());
              // Start fade-out timer
              if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
              fadeTimerRef.current = setTimeout(() => {
                setFadingBlockIds(changed);
                // After transition completes, clear everything
                setTimeout(() => {
                  setChangedBlockIds(new Set());
                  setFadingBlockIds(new Set());
                }, 1000);
              }, 5000);
            }
          }
          previousContentRef.current = content;
        }
      } catch { /* ignore */ }
    };
    fetchBlocks();
  }, [activeProjectId, epicId, doc.id, content]);

  // Cleanup fade timer on unmount
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

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
            onContentChange(data.content);
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
        onContentChange(editContent);
        setEditing(false);
        await releaseLock();
      }
    } catch { /* ignore */ }
    setSaving(false);
  }, [activeProjectId, epicId, doc.id, editContent, onContentChange, releaseLock]);

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

  /* ── Mermaid & image resize persistence ───────────────────────────── */

  /**
   * When user drags a mermaid resize handle, update the markdown source
   * with {height=N} on the corresponding fence line and auto-save.
   */
  const handleMermaidResize = useCallback(async (index: number, height: number) => {
    if (!activeProjectId) return;
    const roundedHeight = Math.round(height);
    let mermaidIdx = 0;
    const lines = content.split("\n");
    let updated = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fenceMatch = line.match(/^(\s*(`{3,}|~{3,})\s*mermaid)\s*(?:\{height=\d+\})?\s*$/);
      if (fenceMatch) {
        if (mermaidIdx === index) {
          // Replace or insert {height=N}
          lines[i] = `${fenceMatch[1]} {height=${roundedHeight}}`;
          updated = true;
          break;
        }
        mermaidIdx++;
      }
    }
    if (!updated) return;
    const newContent = lines.join("\n");
    onContentChange(newContent);
    // Persist to server
    try {
      await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/designs/${doc.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent }),
        },
      );
    } catch { /* best effort */ }
  }, [activeProjectId, epicId, doc.id, content, onContentChange]);

  /**
   * When user drags an image resize handle, update the markdown source
   * with |WxH in the alt text (Obsidian convention) and auto-save.
   */
  const handleImageResize = useCallback(async (index: number, width: number, height: number) => {
    if (!activeProjectId) return;
    const rw = Math.round(width);
    const rh = Math.round(height);
    // Find the Nth image in the markdown
    let imgIdx = 0;
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    let newContent = content;
    const replacements: { from: number; to: number; replacement: string }[] = [];

    while ((match = imgRegex.exec(content)) !== null) {
      if (imgIdx === index) {
        const fullMatch = match[0];
        let alt = match[1];
        const url = match[2];
        // Strip existing |WxH from alt
        alt = alt.replace(/\|\d+x\d+$/, "").trim();
        const newTag = `![${alt}|${rw}x${rh}](${url})`;
        replacements.push({ from: match.index, to: match.index + fullMatch.length, replacement: newTag });
        break;
      }
      imgIdx++;
    }

    if (replacements.length === 0) return;
    // Apply replacements (only one for now)
    const r = replacements[0];
    newContent = content.slice(0, r.from) + r.replacement + content.slice(r.to);
    onContentChange(newContent);
    // Persist to server
    try {
      await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/designs/${doc.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent }),
        },
      );
    } catch { /* best effort */ }
  }, [activeProjectId, epicId, doc.id, content, onContentChange]);

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

  /* ── Selection toolbar ───────────────────────────────────────────── */

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
                    onMermaidResize={handleMermaidResize}
                    onImageResize={handleImageResize}
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

  /* ── Selection toolbar ───────────────────────────────────────────── */

  const handleEditWithAgent = useCallback(() => {
    if (!selectionInfo) return;
    // Package selection context and emit to chat
    commandBus?.emit("codascope:design-selection-to-chat", {
      blockId: selectionInfo.blockId,
      text: selectionInfo.text,
      startLine: selectionInfo.startLine,
      endLine: selectionInfo.endLine,
      docId: doc.id,
      epicId,
    });
    // Open the right panel to the assistant
    useShellStore.getState().openRightPanel("assistant");
    // Clear selection
    setSelectionInfo(null);
    window.getSelection()?.removeAllRanges();
  }, [selectionInfo, commandBus, doc.id, epicId]);

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
        <div className="codascope-selection-toolbar" ref={selectionToolbarRef}>
          <button
            className="codascope-btn codascope-btn-xs codascope-selection-toolbar-btn codascope-selection-toolbar-btn--primary"
            onClick={handleEditWithAgent}
            type="button"
          >
            <IconSparkle size={12} /> Edit with Agent
          </button>
          <button
            className="codascope-btn codascope-btn-xs codascope-selection-toolbar-btn"
            onClick={() => {
              setCommentBlockId(selectionInfo.blockId);
              setSelectionInfo(null);
              window.getSelection()?.removeAllRanges();
            }}
            type="button"
          >
            <IconAnnotation size={12} /> Comment
          </button>
        </div>
      )}
    </div>
  );
}
