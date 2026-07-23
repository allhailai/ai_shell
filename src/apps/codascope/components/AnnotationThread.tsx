/* ── CodaScope: AnnotationThread Component ───────────────────────────
   Renders an inline annotation thread alongside a document block.
   Supports markdown body, reply chain, resolve/reopen, and delete.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import { MarkdownViewer } from "../../../shared/markdown";
import { IconAnnotation, IconDelete, IconClose, IconCheckmark, IconUndo, IconUser, IconAgent, IconReply } from "./CodaScopeIcons";
import type { Annotation, AnnotationStatus, BlockInfo } from "../codaScopeTypes";

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
  onClose?: () => void;
  /** Current authenticated username, used only to decide whether to show delete. */
  currentUsername: string | null;
  /** Current blocks and hash enable explicit recovery for detached root threads. */
  reattachBlocks?: BlockInfo[];
  contentHash?: string;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function AnnotationThread({
  annotation,
  replies,
  projectId,
  epicId,
  onUpdate,
  onClose,
  currentUsername,
  reattachBlocks = [],
  contentHash,
}: AnnotationThreadProps) {
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState(reattachBlocks[0]?.blockId ?? "");
  const [requestError, setRequestError] = useState<string | null>(null);

  /* ── Actions ──────────────────────────────────────────────────────── */

  const updateStatus = useCallback(async (status: AnnotationStatus) => {
    setRequestError(null);
    try {
      const response = await fetch(`/api/codascope/projects/${projectId}/epics/${epicId}/annotations/${annotation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Could not update annotation status.");
      onUpdate();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not update annotation status.");
    }
  }, [projectId, epicId, annotation.id, onUpdate]);

  const deleteAnnotation = useCallback(async (annId: string) => {
    setRequestError(null);
    try {
      const response = await fetch(`/api/codascope/projects/${projectId}/epics/${epicId}/annotations/${annId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not delete annotation.");
      onUpdate();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not delete annotation.");
    }
  }, [projectId, epicId, onUpdate]);

  const submitReply = useCallback(async () => {
    if (!replyText.trim()) return;
    setSubmitting(true);
    setRequestError(null);
    try {
      const response = await fetch(`/api/codascope/projects/${projectId}/epics/${epicId}/docs/${annotation.documentId}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: replyText.trim(),
          parentId: annotation.id,
          documentVersion: annotation.documentVersion,
        }),
      });
      if (!response.ok) throw new Error("Could not add reply.");
      setReplyText("");
      setShowReplyInput(false);
      onUpdate();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not add reply.");
    }
    setSubmitting(false);
  }, [projectId, epicId, annotation, replyText, onUpdate]);

  const reattach = useCallback(async () => {
    if (!selectedBlockId || !contentHash) {
      setRequestError("Select a current document block before reattaching.");
      return;
    }
    setRequestError(null);
    try {
      const response = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/docs/${annotation.documentId}/annotations/${annotation.id}/reattach`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetBlockId: selectedBlockId, contentHash }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(response.status === 409
          ? "The document changed. Reload it before reattaching this annotation."
          : result.message ?? "Could not reattach annotation.");
      }
      onUpdate();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not reattach annotation.");
    }
  }, [selectedBlockId, contentHash, projectId, epicId, annotation.documentId, annotation.id, onUpdate]);

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
        {!ann.deletedAt && (
          <span className="codascope-annotation-thread-author">
            {annotationProvenance(ann) === "agent" ? <IconAgent size={12} /> : <IconUser size={12} />} {ann.author}
          </span>
        )}
        {ann.deletedAt && <span className="codascope-annotation-thread-author">Deleted comment</span>}
        <span className="codascope-annotation-thread-time">{formatTime(ann.createdAt)}</span>
        {!isReply && (
          <span className={`codascope-annotation-thread-status codascope-annotation-thread-status--${ann.status}`}>
            {ann.status}
          </span>
        )}
      </div>
      <div className="codascope-annotation-thread-body">
        {ann.deletedAt
          ? <p className="codascope-annotation-thread-tombstone">Comment deleted</p>
          : <MarkdownViewer content={ann.body} />}
      </div>
      <div className="codascope-annotation-thread-entry-actions">
        {canDeleteAnnotation(ann, currentUsername) && (
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-xs"
            onClick={() => deleteAnnotation(ann.id)}
            type="button"
            title="Delete"
          >
            <IconDelete size={12} />
          </button>
        )}
      </div>
    </div>
  );

  /* ── Render ──────────────────────────────────────────────────────── */

  const isResolved = annotation.status === "resolved" || annotation.status === "wontfix";
  const threadCount = replies.length + 1;
  const detached = annotation.attachmentState !== "attached";

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
            <>
              <button
                className="codascope-btn codascope-btn-ghost codascope-btn-xs"
                onClick={() => updateStatus("resolved")}
                type="button"
              >
                <IconCheckmark size={12} /> Resolve
              </button>
              <button
                className="codascope-btn codascope-btn-ghost codascope-btn-xs"
                onClick={() => updateStatus("wontfix")}
                type="button"
              >
                <IconClose size={12} /> Won&apos;t fix
              </button>
            </>
          )}
          {onClose && (
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-xs"
              onClick={onClose}
              type="button"
            >
              <IconClose size={12} />
            </button>
          )}
        </div>
      </div>

      {requestError && <p className="codascope-annotation-thread-error">{requestError}</p>}

      {detached && (
        <div className="codascope-annotation-thread-recovery">
          <strong>{annotation.attachmentState === "needs_review" ? "Needs review" : "Orphaned"}</strong>
          <p>The stored block is no longer present. Choose the intended current block to reattach this thread.</p>
          <div className="codascope-annotation-thread-recovery-actions">
            <select value={selectedBlockId} onChange={(event) => setSelectedBlockId(event.target.value)}>
              <option value="">Select a block</option>
              {reattachBlocks.map((block) => (
                <option key={block.blockId} value={block.blockId}>
                  {block.sectionSlug} — {block.content.replace(/\s+/g, " ").slice(0, 90)}
                </option>
              ))}
            </select>
            <button
              className="codascope-btn codascope-btn-primary codascope-btn-xs"
              onClick={reattach}
              disabled={!selectedBlockId || !contentHash}
              type="button"
            >
              Reattach
            </button>
          </div>
        </div>
      )}

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

export function canDeleteAnnotation(annotation: Annotation, currentUsername: string | null): boolean {
  return Boolean(currentUsername)
    && !annotation.deletedAt
    && annotation.ownership === "owned"
    && annotation.author === currentUsername;
}

export function annotationProvenance(annotation: Annotation): "user" | "agent" {
  return annotation.origin;
}

export function annotationNeedsReview(annotation: Annotation): boolean {
  return annotation.attachmentState === "needs_review" || annotation.attachmentState === "orphaned";
}

export function annotationDisplayBody(annotation: Annotation): string {
  return annotation.deletedAt ? "Comment deleted" : annotation.body;
}
