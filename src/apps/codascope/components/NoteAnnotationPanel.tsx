/* ── CodaScope: Note Annotation Panel ─────────────────────────────────
   Thread UI for durable inline annotation anchors. Attached threads are
   ordered by validated marker positions; unresolved threads remain visible
   as recovery work, never as a deceptively placed in-note pin.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownViewer, type InlineAnnotationAnchorItem } from "../../../shared/markdown";
import { IconAnnotation, IconChevronDown, IconChevronUp, IconClose, IconCheckmark, IconDelete, IconReply, IconUndo, IconUser, IconWarning } from "./CodaScopeIcons";
import type { AnnotationStatus, InlineAnnotationAnchor, NoteAnnotation } from "../codaScopeTypes";
import type { NoteSelectionInfo } from "./NoteSelectionToolbar";

interface NoteAnnotationPanelProps {
  scope: string;
  visibility: string;
  notePath: string;
  queryParams: Record<string, string>;
  annotations: NoteAnnotation[];
  inlineAnnotationAnchors: InlineAnnotationAnchorItem[];
  onAnnotationsChange: () => void;
  onAnnotationMutation: (result: { content?: string; contentHash?: string }) => void;
  activeAnnotationId?: string | null;
  pendingAnnotation?: NoteSelectionInfo | null;
  currentSelection?: NoteSelectionInfo | null;
  expectedHash: string | null;
  onPendingAnnotationDismiss?: () => void;
  onNavigateAnnotation?: (direction: "previous" | "next") => void;
  onClose: () => void;
}

interface AnnotationThread {
  root: NoteAnnotation;
  replies: NoteAnnotation[];
}

export function NoteAnnotationPanel({
  scope,
  visibility,
  notePath,
  queryParams,
  annotations,
  inlineAnnotationAnchors,
  onAnnotationsChange,
  onAnnotationMutation,
  activeAnnotationId,
  pendingAnnotation,
  currentSelection,
  expectedHash,
  onPendingAnnotationDismiss,
  onNavigateAnnotation,
  onClose,
}: NoteAnnotationPanelProps) {
  const threadRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [requestError, setRequestError] = useState<string | null>(null);
  const queryString = useMemo(() => new URLSearchParams(queryParams).toString(), [queryParams.projectId, queryParams.epicId]); // eslint-disable-line react-hooks/exhaustive-deps
  const apiBase = useMemo(() => `/api/codascope/notes/${scope}/${visibility}/note/${notePath}/annotations`, [scope, visibility, notePath]);

  const threads = useMemo((): AnnotationThread[] => {
    const order = new Map(inlineAnnotationAnchors.map((anchor, index) => [anchor.annotationId, index]));
    return annotations
      .filter((annotation) => !annotation.parentId && !annotation.archivedAt)
      .map((root) => ({
        root,
        replies: annotations.filter((annotation) => annotation.parentId === root.id && !annotation.archivedAt)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      }))
      .sort((a, b) => (order.get(a.root.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.root.id) ?? Number.MAX_SAFE_INTEGER)
        || a.root.createdAt.localeCompare(b.root.createdAt));
  }, [annotations, inlineAnnotationAnchors]);

  useEffect(() => {
    if (!activeAnnotationId) return;
    threadRefs.current.get(activeAnnotationId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeAnnotationId, threads]);

  const updateStatus = useCallback(async (annotationId: string, status: AnnotationStatus) => {
    setRequestError(null);
    try {
      const response = await fetch(`${apiBase}/${annotationId}?${queryString}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Could not update annotation status.");
      onAnnotationsChange();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not update annotation status.");
    }
  }, [apiBase, queryString, onAnnotationsChange]);

  const archiveThread = useCallback(async (annotationId: string) => {
    setRequestError(null);
    try {
      const params = new URLSearchParams(queryString);
      if (expectedHash) params.set("expectedHash", expectedHash);
      const response = await fetch(`${apiBase}/${annotationId}?${params.toString()}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "Could not archive annotation.");
      onAnnotationMutation(result);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not archive annotation.");
    }
  }, [apiBase, queryString, expectedHash, onAnnotationMutation]);

  const submitReply = useCallback(async (parentId: string, body: string) => {
    setRequestError(null);
    try {
      const response = await fetch(`${apiBase}?${queryString}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, parentId }),
      });
      if (!response.ok) throw new Error("Could not add reply.");
      onAnnotationsChange();
      return true;
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not add reply.");
      return false;
    }
  }, [apiBase, queryString, onAnnotationsChange]);

  const submitAnnotation = useCallback(async (selection: NoteSelectionInfo, body: string) => {
    if (!expectedHash) return false;
    setRequestError(null);
    try {
      const response = await fetch(`${apiBase}?${queryString}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectionStart: selection.from,
          selectionEnd: selection.to,
          selectedText: selection.text,
          expectedHash,
          body,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "Could not add annotation. Reload if the note changed.");
      onAnnotationMutation(result);
      onPendingAnnotationDismiss?.();
      return true;
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not add annotation.");
      return false;
    }
  }, [apiBase, queryString, expectedHash, onAnnotationMutation, onPendingAnnotationDismiss]);

  const reattach = useCallback(async (annotationId: string) => {
    if (!currentSelection || !expectedHash) {
      setRequestError("Select the intended text in the note before reattaching this thread.");
      return;
    }
    setRequestError(null);
    try {
      const response = await fetch(`${apiBase}/${annotationId}/reattach?${queryString}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectionStart: currentSelection.from,
          selectionEnd: currentSelection.to,
          selectedText: currentSelection.text,
          expectedHash,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "Could not reattach annotation. Reload if the note changed.");
      onAnnotationMutation(result);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not reattach annotation.");
    }
  }, [apiBase, queryString, currentSelection, expectedHash, onAnnotationMutation]);

  return (
    <aside className="codascope-notes-annotation-panel">
      <div className="codascope-notes-annotation-panel-header">
        <div className="codascope-notes-annotation-panel-title">
          <IconAnnotation size={15} />
          <span>Annotations</span>
          <span className="codascope-notes-ann-panel-count">{threads.length}</span>
        </div>
        <div className="codascope-notes-annotation-panel-actions">
          <button
            className="codascope-notes-annotation-panel-nav"
            disabled={inlineAnnotationAnchors.length === 0}
            onClick={() => onNavigateAnnotation?.("previous")}
            type="button"
            title="Previous annotation"
            aria-label="Previous annotation"
          >
            <IconChevronUp size={14} />
          </button>
          <button
            className="codascope-notes-annotation-panel-nav"
            disabled={inlineAnnotationAnchors.length === 0}
            onClick={() => onNavigateAnnotation?.("next")}
            type="button"
            title="Next annotation"
            aria-label="Next annotation"
          >
            <IconChevronDown size={14} />
          </button>
          <button className="codascope-notes-annotation-panel-close" onClick={onClose} type="button" title="Close annotations" aria-label="Close annotations">
            <IconClose size={13} />
          </button>
        </div>
      </div>

      {requestError && <p className="codascope-notes-ann-recovery-error"><IconWarning size={12} /> {requestError}</p>}

      <div className="codascope-notes-annotation-panel-content">
        {pendingAnnotation && (
          <NewAnnotationComposer
            selectedText={pendingAnnotation.text}
            onCancel={() => onPendingAnnotationDismiss?.()}
            onSubmit={(body) => submitAnnotation(pendingAnnotation, body)}
          />
        )}

        {threads.length === 0 && !pendingAnnotation ? (
          <div className="codascope-notes-ann-empty">Select text in the note and choose Add annotation to start a thread.</div>
        ) : threads.map((thread) => (
          <ThreadCard
            key={thread.root.id}
            thread={thread}
            active={thread.root.id === activeAnnotationId}
            currentSelectionAvailable={Boolean(currentSelection && expectedHash)}
            onArchive={() => archiveThread(thread.root.id)}
            onReattach={() => reattach(thread.root.id)}
            onStatus={(status) => updateStatus(thread.root.id, status)}
            onReply={(body) => submitReply(thread.root.id, body)}
            setRef={(element) => { if (element) threadRefs.current.set(thread.root.id, element); }}
          />
        ))}
      </div>
    </aside>
  );
}

function ThreadCard({
  thread,
  active,
  currentSelectionAvailable,
  onArchive,
  onReattach,
  onStatus,
  onReply,
  setRef,
}: {
  thread: AnnotationThread;
  active: boolean;
  currentSelectionAvailable: boolean;
  onArchive: () => void;
  onReattach: () => void;
  onStatus: (status: AnnotationStatus) => void;
  onReply: (body: string) => Promise<boolean>;
  setRef: (element: HTMLDivElement | null) => void;
}) {
  const resolved = thread.root.status === "resolved" || thread.root.status === "wontfix";
  const anchor = inlineAnchor(thread.root);
  const unresolved = !anchor || anchor.attachmentState !== "attached";
  const stateLabel = !anchor ? "Legacy anchor needs review" : anchor.attachmentState.replace("_", " ");

  return (
    <div className={`codascope-notes-ann-thread${resolved ? " codascope-notes-ann-thread--resolved" : ""}${active ? " codascope-notes-ann-thread--active" : ""}`} ref={setRef}>
      <div className="codascope-notes-ann-thread-header">
        <span className="codascope-notes-ann-thread-count"><IconAnnotation size={11} /> {thread.replies.length + 1}</span>
        <div className="codascope-notes-ann-thread-actions">
          {resolved ? (
            <button className="codascope-btn codascope-btn-ghost codascope-btn-xs" onClick={() => onStatus("open")} type="button"><IconUndo size={11} /> Reopen</button>
          ) : (
            <button className="codascope-btn codascope-btn-ghost codascope-btn-xs" onClick={() => onStatus("resolved")} type="button"><IconCheckmark size={11} /> Resolve</button>
          )}
        </div>
      </div>

      {anchor && <blockquote className="codascope-notes-ann-thread-quote">{anchor.quote}</blockquote>}
      {unresolved && (
        <div className="codascope-notes-ann-recovery">
          <div><IconWarning size={12} /> <strong>{stateLabel}</strong></div>
          {anchor && <p>…{anchor.prefix.slice(-60)}<mark>{anchor.quote}</mark>{anchor.suffix.slice(0, 60)}…</p>}
          <p>{currentSelectionAvailable ? "Use the selected source text to reattach this thread." : "Select the intended source text, then choose Reattach."}</p>
          <div className="codascope-notes-ann-recovery-actions">
            <button className="codascope-btn codascope-btn-primary codascope-btn-xs" onClick={onReattach} type="button">Reattach</button>
            <button className="codascope-btn codascope-btn-ghost codascope-btn-xs" onClick={onArchive} type="button">Archive</button>
            <button className="codascope-btn codascope-btn-ghost codascope-btn-xs" onClick={onArchive} type="button">Delete</button>
          </div>
        </div>
      )}

      <AnnotationEntry annotation={thread.root} onArchive={onArchive} />
      {thread.replies.map((reply) => <AnnotationEntry key={reply.id} annotation={reply} onArchive={onArchive} reply />)}
      {!unresolved && <ReplyComposer onSubmit={onReply} />}
    </div>
  );
}

function NewAnnotationComposer({ selectedText, onCancel, onSubmit }: { selectedText: string; onCancel: () => void; onSubmit: (body: string) => Promise<boolean> }) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!body.trim()) return;
    setSubmitting(true);
    if (await onSubmit(body.trim())) setBody("");
    setSubmitting(false);
  };
  return (
    <div className="codascope-notes-ann-new-composer">
      <span className="codascope-notes-ann-new-composer-label">New annotation</span>
      <blockquote className="codascope-notes-ann-new-composer-quote">{selectedText}</blockquote>
      <textarea className="codascope-notes-ann-reply-input" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a comment…" rows={3} />
      <div className="codascope-notes-ann-reply-actions">
        <button className="codascope-btn codascope-btn-ghost codascope-btn-xs" onClick={onCancel} disabled={submitting} type="button">Cancel</button>
        <button className="codascope-btn codascope-btn-primary codascope-btn-xs" onClick={submit} disabled={submitting || !body.trim()} type="button">{submitting ? "Adding…" : "Add annotation"}</button>
      </div>
    </div>
  );
}

function AnnotationEntry({ annotation, onArchive, reply = false }: { annotation: NoteAnnotation; onArchive: () => void; reply?: boolean }) {
  return (
    <div className={`codascope-notes-ann-entry${reply ? " codascope-notes-ann-entry--reply" : ""}`}>
      <div className="codascope-notes-ann-entry-header">
        <span className="codascope-notes-ann-entry-author"><IconUser size={11} /> {annotation.author}</span>
        <span className="codascope-notes-ann-entry-time">{new Date(annotation.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        {!reply && <button className="codascope-btn codascope-btn-ghost codascope-btn-xs codascope-notes-ann-entry-delete" onClick={onArchive} type="button" title="Archive thread"><IconDelete size={10} /></button>}
      </div>
      <div className="codascope-notes-ann-entry-body"><MarkdownViewer content={annotation.body} /></div>
    </div>
  );
}

function ReplyComposer({ onSubmit }: { onSubmit: (body: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!body.trim()) return;
    setSubmitting(true);
    if (await onSubmit(body.trim())) { setBody(""); setOpen(false); }
    setSubmitting(false);
  };
  if (!open) return <button className="codascope-btn codascope-btn-ghost codascope-btn-xs codascope-notes-ann-reply-toggle" onClick={() => setOpen(true)} type="button"><IconReply size={11} /> Reply</button>;
  return (
    <div className="codascope-notes-ann-reply-composer">
      <textarea className="codascope-notes-ann-reply-input" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a reply…" rows={2} autoFocus />
      <div className="codascope-notes-ann-reply-actions">
        <button className="codascope-btn codascope-btn-ghost codascope-btn-xs" onClick={() => setOpen(false)} disabled={submitting} type="button">Cancel</button>
        <button className="codascope-btn codascope-btn-primary codascope-btn-xs" onClick={submit} disabled={submitting || !body.trim()} type="button">{submitting ? "Sending…" : "Reply"}</button>
      </div>
    </div>
  );
}

function inlineAnchor(annotation: NoteAnnotation): InlineAnnotationAnchor | null {
  return (annotation.anchor as InlineAnnotationAnchor).kind === "range" ? annotation.anchor as InlineAnnotationAnchor : null;
}
