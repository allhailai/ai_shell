/* ── CodaScope: EpicDefine View ──────────────────────────────────────
   The Define tab content for an epic. Shows:
   - Rendered definition markdown (using MarkdownViewer)
   - Edit lock indicator
   - "Ask Agent to Edit" button → triggers do_refine_definition chat flow
   - "Re-interview" button → triggers do_interview_epic chat flow
   - Lock-based direct edit mode (textarea)
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, useRef } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { MarkdownViewer } from "../../../shared/markdown";
import type { EpicDesignDetail, EditLock } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface EpicDefineProps {
  epic: EpicDesignDetail;
  setEpic: (e: EpicDesignDetail) => void;
}

/* ── Constants ───────────────────────────────────────────────────────── */

const LOCK_CHECK_INTERVAL_MS = 30_000; // Check lock status every 30s
const LOCK_WARNING_MS = 4 * 60 * 1000; // Warn at 4 minutes
const LOCK_TTL_MS = 5 * 60 * 1000; // Lock expires at 5 minutes

const DEFAULT_DEFINITION_TEMPLATE = `# Goal

What is the high-level goal of this epic?

# Context

What is the current state of this area of the codebase?

# Key Questions

What are the key technical questions or unknowns?

# Scope

What is in scope for this epic?

# Out of Scope

What is explicitly out of scope?

# Constraints

What are the constraints (timeline, team size, backward compatibility, etc.)?

# Success Criteria

What does success look like?
`;

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicDefine({ epic, setEpic }: EpicDefineProps) {
  const { activeProjectId } = useCodaScopeStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(epic.definition);
  const [saving, setSaving] = useState(false);
  const [lockInfo, setLockInfo] = useState<EditLock | null>(null);
  const [lockWarning, setLockWarning] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const lastActivityRef = useRef(Date.now());
  const lockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update draft when epic definition changes externally
  useEffect(() => {
    if (!editing) {
      setDraft(epic.definition);
    }
  }, [epic.definition, editing]);

  // ── Lock status polling ──────────────────────────────────────────────

  const checkLockStatus = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/lock`,
      );
      if (res.ok) {
        const data = await res.json();
        const locks: EditLock[] = data.locks ?? [];
        const definitionLock = locks.find((l) => l.documentId === "definition");
        setLockInfo(definitionLock ?? null);
      }
    } catch { /* ignore */ }
  }, [activeProjectId, epic.id]);

  useEffect(() => {
    checkLockStatus();
    const interval = setInterval(checkLockStatus, LOCK_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkLockStatus]);

  // ── Lock warning timer ─────────────────────────────────────────────

  useEffect(() => {
    if (!editing) {
      setLockWarning(false);
      if (lockTimerRef.current) {
        clearInterval(lockTimerRef.current);
        lockTimerRef.current = null;
      }
      return;
    }

    lockTimerRef.current = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= LOCK_WARNING_MS && idleMs < LOCK_TTL_MS) {
        setLockWarning(true);
      } else if (idleMs >= LOCK_TTL_MS) {
        // Lock expired — exit edit mode
        setEditing(false);
        setLockWarning(false);
        releaseLock();
      } else {
        setLockWarning(false);
      }
    }, 10_000);

    return () => {
      if (lockTimerRef.current) {
        clearInterval(lockTimerRef.current);
        lockTimerRef.current = null;
      }
    };
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lock management ──────────────────────────────────────────────────

  const acquireLock = useCallback(async (): Promise<boolean> => {
    if (!activeProjectId) return false;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/lock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: "definition", lockedBy: "user" }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.error) {
          setLockInfo(data.holder);
          return false;
        }
        setLockInfo(data);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }, [activeProjectId, epic.id]);

  const releaseLock = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/lock`,
        { method: "DELETE" },
      );
      setLockInfo(null);
    } catch { /* ignore */ }
  }, [activeProjectId, epic.id]);

  // ── Edit actions ──────────────────────────────────────────────────────

  const handleStartEdit = useCallback(async () => {
    const acquired = await acquireLock();
    if (acquired) {
      setEditing(true);
      setDraft(epic.definition || DEFAULT_DEFINITION_TEMPLATE);
      lastActivityRef.current = Date.now();
    }
  }, [acquireLock, epic.definition]);

  const handleSave = useCallback(async () => {
    if (!activeProjectId) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/definition`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: draft }),
        },
      );
      if (res.ok) {
        setEpic({ ...epic, definition: draft });
        setEditing(false);
        await releaseLock();
      }
    } catch { /* ignore */ }
    setSaving(false);
  }, [activeProjectId, epic, draft, setEpic, releaseLock]);

  const handleCancel = useCallback(async () => {
    setEditing(false);
    setDraft(epic.definition);
    await releaseLock();
  }, [epic.definition, releaseLock]);

  const handleDraftChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    lastActivityRef.current = Date.now();
    setLockWarning(false);
  }, []);

  // ── Refresh definition from server ────────────────────────────────

  const handleRefresh = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epic.id}/definition`,
      );
      if (res.ok) {
        const data = await res.json();
        const content = data.content ?? "";
        setEpic({ ...epic, definition: content });
        setRefreshKey((k) => k + 1);
      }
    } catch { /* ignore */ }
  }, [activeProjectId, epic, setEpic]);

  // ── No definition yet — empty state ──────────────────────────────────

  if (!epic.definition && !editing) {
    return (
      <div className="codascope-epic-define-empty">
        <div className="codascope-empty-state">
          <div className="codascope-epic-define-empty-icon">📝</div>
          <h3>No definition yet</h3>
          <p>Start by using the chat agent for a guided interview, or write the definition directly.</p>
          <div className="codascope-epic-define-empty-actions">
            <button
              className="codascope-btn codascope-btn-primary"
              onClick={handleStartEdit}
              type="button"
            >
              Start Writing
            </button>
            <span className="codascope-epic-define-empty-hint">
              or ask the agent to <strong>"help me define this epic"</strong> in the chat panel →
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Editing mode ──────────────────────────────────────────────────────

  if (editing) {
    return (
      <div className="codascope-epic-define-editor">
        {lockWarning && (
          <div className="codascope-epic-lock-warning">
            ⚠️ Lock expires in ~1 minute due to inactivity. Continue editing to keep the lock.
          </div>
        )}
        <div className="codascope-epic-define-editor-toolbar">
          <div className="codascope-epic-define-editor-toolbar-left">
            <span className="codascope-epic-define-editor-label">Editing definition</span>
          </div>
          <div className="codascope-epic-define-editor-toolbar-right">
            <button
              className="codascope-btn codascope-btn-ghost"
              onClick={handleCancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className="codascope-btn codascope-btn-primary"
              onClick={handleSave}
              disabled={saving}
              type="button"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        <textarea
          className="codascope-epic-define-textarea"
          value={draft}
          onChange={handleDraftChange}
          spellCheck
          autoFocus
        />
      </div>
    );
  }

  // ── View mode with rendered markdown ──────────────────────────────────

  const isLockedByOther = lockInfo && lockInfo.lockedBy !== "user";

  return (
    <div className="codascope-epic-define-viewer">
      {/* Lock indicator */}
      {isLockedByOther && (
        <div className="codascope-edit-lock-banner">
          <span className="codascope-edit-lock-banner-icon">🔒</span>
          <span>
            <strong>{lockInfo.lockedBy}</strong> is currently editing this definition
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="codascope-epic-define-toolbar">
        <div className="codascope-epic-define-toolbar-left">
          <button
            className="codascope-btn codascope-btn-secondary"
            onClick={handleStartEdit}
            disabled={!!isLockedByOther}
            title={isLockedByOther ? `Locked by ${lockInfo.lockedBy}` : "Edit definition directly"}
            type="button"
          >
            ✏️ Edit
          </button>
          <button
            className="codascope-btn codascope-btn-ghost"
            onClick={handleRefresh}
            title="Refresh from server"
            type="button"
          >
            ↻ Refresh
          </button>
        </div>
        <div className="codascope-epic-define-toolbar-right">
          <span className="codascope-epic-define-hint">
            💡 Use the chat panel to ask the agent to interview, refine, or edit this definition
          </span>
        </div>
      </div>

      {/* Rendered definition */}
      <div className="codascope-definition-viewer" key={refreshKey}>
        <MarkdownViewer content={epic.definition} className="codascope-definition-md" />
      </div>
    </div>
  );
}
