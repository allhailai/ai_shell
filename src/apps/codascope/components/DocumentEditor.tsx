/* ── CodaScope: DocumentEditor Component ─────────────────────────────
   Core document viewing/editing component used for design documents.
   P2a: rendered markdown + edit lock + agent edit trigger.
   P2b will add: annotation gutter, insertion directives.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, useRef } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { MarkdownViewer } from "../../../shared/markdown";
import type { EpicDesignDoc, EditLock } from "../codaScopeTypes";

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

/* ── Component ───────────────────────────────────────────────────────── */

export function DocumentEditor({ epicId, doc, content, onContentChange, onClose }: DocumentEditorProps) {
  const { activeProjectId } = useCodaScopeStore();

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [saving, setSaving] = useState(false);
  const [lock, setLock] = useState<EditLock | null>(null);
  const [lockWarning, setLockWarning] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const lockCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync content when it changes externally
  useEffect(() => {
    if (!editing) setEditContent(content);
  }, [content, editing]);

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

  // Check lock expiry
  useEffect(() => {
    if (!editing || !lock) return;

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
      if (lockCheckRef.current) clearInterval(lockCheckRef.current);
    };
  }, [editing, lock, releaseLock]);

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

  /* ── Word count ──────────────────────────────────────────────────── */

  const displayContent = editing ? editContent : content;
  const wordCount = displayContent.trim() ? displayContent.trim().split(/\s+/).length : 0;
  const lastUpdated = new Date(doc.updatedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

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
          </span>
          {!editing && (
            <button className="codascope-btn codascope-btn-secondary" onClick={startEditing} type="button">
              ✏️ Edit
            </button>
          )}
        </div>
      </div>

      {/* Lock warning */}
      {lockWarning && (
        <div className="codascope-epic-lock-warning">
          ⚠️ Lock expires in less than 1 minute. Save your changes or interact to extend.
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
        <div className="codascope-document-editor-viewer">
          {displayContent ? (
            <MarkdownViewer content={displayContent} />
          ) : (
            <div className="codascope-empty-state">
              <p>This document is empty. Click Edit to start writing, or ask the agent to draft it.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
