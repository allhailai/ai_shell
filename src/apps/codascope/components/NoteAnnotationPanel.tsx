/* ── CodaScope: NoteAnnotationPanel ──────────────────────────────────
   Collapsible panel on the right side of the NoteEditor that shows
   annotation threads grouped by section/block.

   Features:
   - Thread list grouped by section heading
   - Each thread: root comment + replies, resolve/reopen, delete
   - New comment input at bottom of each thread
   - Panel scrolls to matching thread when gutter marker is clicked
   - Reply composer with markdown support

   This panel lives WITHIN the note editor layout, NOT in the shell's
   right panel (which stays as the chat assistant).
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { MarkdownViewer } from "../../../shared/markdown";
import { IconAnnotation, IconDelete, IconClose, IconCheckmark, IconUndo, IconUser, IconReply } from "./CodaScopeIcons";
import type { AnnotationStatus, NoteAnnotation } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface NoteAnnotationPanelProps {
  /** Note level for API calls */
  level: string;
  /** Note path for API calls */
  notePath: string;
  /** Query params for API calls */
  queryParams: Record<string, string>;
  /** Annotations fetched from server */
  annotations: NoteAnnotation[];
  /** Called when annotations change (create, resolve, delete, reply) */
  onAnnotationsChange: () => void;
  /** Block ID to scroll to (set when gutter marker is clicked) */
  activeBlockId?: string | null;
  /** Called to close the panel */
  onClose: () => void;
}

/* ── Types ───────────────────────────────────────────────────────────── */

interface AnnotationThread {
  root: NoteAnnotation;
  replies: NoteAnnotation[];
}

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteAnnotationPanel({
  level,
  notePath,
  queryParams,
  annotations,
  onAnnotationsChange,
  activeBlockId,
  onClose,
}: NoteAnnotationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const threadRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── Group annotations into threads ──────────────────────────────────
  const threads = useMemo((): AnnotationThread[] => {
    const roots = annotations.filter((a) => !a.parentId);
    return roots.map((root) => ({
      root,
      replies: annotations
        .filter((a) => a.parentId === root.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }));
  }, [annotations]);

  // ── Group threads by section slug ────────────────────────────────────
  const groupedThreads = useMemo(() => {
    const groups = new Map<string, AnnotationThread[]>();
    for (const thread of threads) {
      const section = thread.root.anchor.sectionSlug ?? "root";
      const existing = groups.get(section) ?? [];
      existing.push(thread);
      groups.set(section, existing);
    }
    return groups;
  }, [threads]);

  // ── Scroll to active block when gutter marker is clicked ────────────
  useEffect(() => {
    if (!activeBlockId) return;
    // Find the thread with matching blockId
    const thread = threads.find((t) => t.root.anchor.blockId === activeBlockId);
    if (thread) {
      const el = threadRefs.current.get(thread.root.id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [activeBlockId, threads]);

  // ── API helpers ─────────────────────────────────────────────────────

  const queryString = useMemo(() => new URLSearchParams(queryParams).toString(), [queryParams.projectId, queryParams.epicId]); // eslint-disable-line react-hooks/exhaustive-deps

  const apiBase = useMemo(() => {
    return `/api/codascope/notes/${level}/note/${notePath}/annotations`;
  }, [level, notePath]);

  const updateStatus = useCallback(async (annotationId: string, status: AnnotationStatus) => {
    try {
      await fetch(`${apiBase}/${annotationId}?${queryString}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      onAnnotationsChange();
    } catch { /* ignore */ }
  }, [apiBase, queryString, onAnnotationsChange]);

  const deleteAnnotation = useCallback(async (annotationId: string) => {
    try {
      await fetch(`${apiBase}/${annotationId}?${queryString}`, {
        method: "DELETE",
      });
      onAnnotationsChange();
    } catch { /* ignore */ }
  }, [apiBase, queryString, onAnnotationsChange]);

  const submitReply = useCallback(async (parentAnnotation: NoteAnnotation, body: string) => {
    try {
      await fetch(`${apiBase}?${queryString}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anchor: parentAnnotation.anchor,
          author: "user",
          body,
          parentId: parentAnnotation.id,
        }),
      });
      onAnnotationsChange();
    } catch { /* ignore */ }
  }, [apiBase, queryString, onAnnotationsChange]);

  // ── Thread renderer ─────────────────────────────────────────────────

  const renderThread = (thread: AnnotationThread) => {
    const isResolved = thread.root.status === "resolved" || thread.root.status === "wontfix";
    const totalCount = thread.replies.length + 1;

    return (
      <div
        key={thread.root.id}
        className={`codascope-notes-ann-thread${isResolved ? " codascope-notes-ann-thread--resolved" : ""}`}
        ref={(el) => { if (el) threadRefs.current.set(thread.root.id, el); }}
      >
        {/* Thread header */}
        <div className="codascope-notes-ann-thread-header">
          <span className="codascope-notes-ann-thread-count">
            <IconAnnotation size={11} /> {totalCount}
          </span>
          <div className="codascope-notes-ann-thread-actions">
            {isResolved ? (
              <button
                className="codascope-btn codascope-btn-ghost codascope-btn-xs"
                onClick={() => updateStatus(thread.root.id, "open")}
                type="button"
                title="Reopen"
              >
                <IconUndo size={11} /> Reopen
              </button>
            ) : (
              <button
                className="codascope-btn codascope-btn-ghost codascope-btn-xs"
                onClick={() => updateStatus(thread.root.id, "resolved")}
                type="button"
                title="Resolve"
              >
                <IconCheckmark size={11} /> Resolve
              </button>
            )}
          </div>
        </div>

        {/* Section anchor label */}
        {thread.root.anchor.sectionSlug && thread.root.anchor.sectionSlug !== "root" && (
          <div className="codascope-notes-ann-section-label">
            §{" "}{thread.root.anchor.sectionSlug.replace(/-/g, " ")}
          </div>
        )}

        {/* Root entry */}
        <AnnotationEntry
          annotation={thread.root}
          isReply={false}
          onDelete={() => deleteAnnotation(thread.root.id)}
        />

        {/* Replies */}
        {thread.replies.map((reply) => (
          <AnnotationEntry
            key={reply.id}
            annotation={reply}
            isReply
            onDelete={() => deleteAnnotation(reply.id)}
          />
        ))}

        {/* Reply composer */}
        <ReplyComposer
          onSubmit={(body) => submitReply(thread.root, body)}
        />
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────

  const openCount = threads.filter((t) => t.root.status === "open").length;

  return (
    <div className="codascope-notes-ann-panel" ref={panelRef}>
      {/* Panel header */}
      <div className="codascope-notes-ann-panel-header">
        <span className="codascope-notes-ann-panel-title">
          <IconAnnotation size={13} /> Annotations
          {openCount > 0 && (
            <span className="codascope-notes-ann-panel-badge">{openCount}</span>
          )}
        </span>
        <button
          className="codascope-btn codascope-btn-ghost codascope-btn-xs"
          onClick={onClose}
          type="button"
          title="Close panel"
        >
          <IconClose size={12} />
        </button>
      </div>

      {/* Thread list */}
      <div className="codascope-notes-ann-panel-body">
        {threads.length === 0 ? (
          <div className="codascope-notes-ann-empty">
            <IconAnnotation size={24} />
            <span>No annotations yet</span>
            <span className="codascope-notes-ann-empty-hint">
              Select text and click "Comment" to add one
            </span>
          </div>
        ) : (
          Array.from(groupedThreads.entries()).map(([section, sectionThreads]) => (
            <div key={section} className="codascope-notes-ann-section">
              {sectionThreads.map(renderThread)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function AnnotationEntry({
  annotation,
  isReply,
  onDelete,
}: {
  annotation: NoteAnnotation;
  isReply: boolean;
  onDelete: () => void;
}) {
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <div className={`codascope-notes-ann-entry${isReply ? " codascope-notes-ann-entry--reply" : ""}`}>
      <div className="codascope-notes-ann-entry-header">
        <span className="codascope-notes-ann-entry-author">
          <IconUser size={11} /> {annotation.author}
        </span>
        <span className="codascope-notes-ann-entry-time">{formatTime(annotation.createdAt)}</span>
        <button
          className="codascope-btn codascope-btn-ghost codascope-btn-xs codascope-notes-ann-entry-delete"
          onClick={onDelete}
          type="button"
          title="Delete"
        >
          <IconDelete size={10} />
        </button>
      </div>
      <div className="codascope-notes-ann-entry-body">
        <MarkdownViewer content={annotation.body} />
      </div>
    </div>
  );
}

function ReplyComposer({ onSubmit }: { onSubmit: (body: string) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    await onSubmit(text.trim());
    setText("");
    setOpen(false);
    setSubmitting(false);
  }, [text, onSubmit]);

  if (!open) {
    return (
      <button
        className="codascope-btn codascope-btn-ghost codascope-notes-ann-reply-trigger"
        onClick={() => setOpen(true)}
        type="button"
      >
        <IconReply size={11} /> Reply
      </button>
    );
  }

  return (
    <div className="codascope-notes-ann-reply-composer">
      <textarea
        className="codascope-notes-ann-reply-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a reply…"
        rows={2}
      />
      <div className="codascope-notes-ann-reply-actions">
        <button
          className="codascope-btn codascope-btn-ghost codascope-btn-xs"
          onClick={() => { setOpen(false); setText(""); }}
          disabled={submitting}
          type="button"
        >
          Cancel
        </button>
        <button
          className="codascope-btn codascope-btn-primary codascope-btn-xs"
          onClick={handleSubmit}
          disabled={submitting || !text.trim()}
          type="button"
        >
          {submitting ? "Sending…" : "Reply"}
        </button>
      </div>
    </div>
  );
}
