/* ── CodaScope: AnnotationThread Component ───────────────────────────
   Renders an inline annotation thread alongside a document block.
   Supports markdown body, reply chain, resolve/reopen, and delete.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import { MarkdownViewer } from "../../../shared/markdown";
import { IconAnnotation, IconDelete, IconClose, IconCheckmark, IconUndo, IconUser, IconAgent, IconReply } from "./CodaScopeIcons";
import type { Annotation, AnnotationStatus } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface AnnotationThreadProps {
  /** Root annotation (top-level, not a reply) */
  annotation: Annotation;
  /** All replies to this annotation */
  replies: Annotation[];
  /** Project ID for API calls */
  projectId: string;
  /** Epic ID for API calls */
  epicId: string;
  /** Called when annotation state changes (resolve, delete, reply) */
  onUpdate: () => void;
  /** Called when user clicks close */
  onClose: () => void;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function AnnotationThread({
  annotation,
  replies,
  projectId,
  epicId,
  onUpdate,
  onClose,
}: AnnotationThreadProps) {
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showReplyInput, setShowReplyInput] = useState(false);

  /* ── Actions ──────────────────────────────────────────────────────── */

  const updateStatus = useCallback(async (status: AnnotationStatus) => {
    try {
      await fetch(`/api/codascope/projects/${projectId}/epics/${epicId}/annotations/${annotation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      onUpdate();
    } catch { /* ignore */ }
  }, [projectId, epicId, annotation.id, onUpdate]);

  const deleteAnnotation = useCallback(async (annId: string) => {
    try {
      await fetch(`/api/codascope/projects/${projectId}/epics/${epicId}/annotations/${annId}`, {
        method: "DELETE",
      });
      onUpdate();
    } catch { /* ignore */ }
  }, [projectId, epicId, onUpdate]);

  const submitReply = useCallback(async () => {
    if (!replyText.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`/api/codascope/projects/${projectId}/epics/${epicId}/docs/${annotation.documentId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anchor: annotation.anchor,
          author: "user",
          body: replyText.trim(),
          parentId: annotation.id,
          documentVersion: annotation.documentVersion,
        }),
      });
      setReplyText("");
      setShowReplyInput(false);
      onUpdate();
    } catch { /* ignore */ }
    setSubmitting(false);
  }, [projectId, epicId, annotation, replyText, onUpdate]);

  /* ── Time formatting ─────────────────────────────────────────────── */

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  /* ── Render a single annotation entry ────────────────────────────── */

  const renderEntry = (ann: Annotation, isReply: boolean) => (
    <div key={ann.id} className={`codascope-annotation-thread-entry${isReply ? " codascope-annotation-thread-entry--reply" : ""}`}>
      <div className="codascope-annotation-thread-header">
        <span className="codascope-annotation-thread-author">
          {ann.author === "user" ? <IconUser size={12} /> : <IconAgent size={12} />} {ann.author}
        </span>
        <span className="codascope-annotation-thread-time">{formatTime(ann.createdAt)}</span>
        {!isReply && (
          <span className={`codascope-annotation-thread-status codascope-annotation-thread-status--${ann.status}`}>
            {ann.status}
          </span>
        )}
      </div>
      <div className="codascope-annotation-thread-body">
        <MarkdownViewer content={ann.body} />
      </div>
      <div className="codascope-annotation-thread-entry-actions">
        <button
          className="codascope-btn codascope-btn-ghost codascope-btn-xs"
          onClick={() => deleteAnnotation(ann.id)}
          type="button"
          title="Delete"
        >
          <IconDelete size={12} />
        </button>
      </div>
    </div>
  );

  /* ── Render ──────────────────────────────────────────────────────── */

  const isResolved = annotation.status === "resolved" || annotation.status === "wontfix";
  const threadCount = replies.length + 1;

  return (
    <div className="codascope-annotation-thread">
      {/* Header */}
      <div className="codascope-annotation-thread-toolbar">
        <span className="codascope-annotation-thread-count">
          <IconAnnotation size={12} /> {threadCount} {threadCount === 1 ? "comment" : "comments"}
        </span>
        <div className="codascope-annotation-thread-toolbar-actions">
          {isResolved ? (
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-xs"
              onClick={() => updateStatus("open")}
              type="button"
            >
              <IconUndo size={12} /> Reopen
            </button>
          ) : (
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-xs"
              onClick={() => updateStatus("resolved")}
              type="button"
            >
              <IconCheckmark size={12} /> Resolve
            </button>
          )}
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-xs"
            onClick={onClose}
            type="button"
          >
            <IconClose size={12} />
          </button>
        </div>
      </div>

      {/* Thread entries */}
      <div className="codascope-annotation-thread-entries">
        {renderEntry(annotation, false)}
        {replies.map((reply) => renderEntry(reply, true))}
      </div>

      {/* Reply composer */}
      {showReplyInput ? (
        <div className="codascope-annotation-thread-reply">
          <textarea
            className="codascope-annotation-thread-reply-input"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write a reply…"
            rows={2}
          />
          <div className="codascope-annotation-thread-reply-actions">
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-xs"
              onClick={() => { setShowReplyInput(false); setReplyText(""); }}
              disabled={submitting}
              type="button"
            >
              Cancel
            </button>
            <button
              className="codascope-btn codascope-btn-primary codascope-btn-xs"
              onClick={submitReply}
              disabled={submitting || !replyText.trim()}
              type="button"
            >
              {submitting ? "Sending…" : "Reply"}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="codascope-btn codascope-btn-ghost codascope-annotation-thread-reply-trigger"
          onClick={() => setShowReplyInput(true)}
          type="button"
        >
          <IconReply size={12} /> Reply
        </button>
      )}
    </div>
  );
}
