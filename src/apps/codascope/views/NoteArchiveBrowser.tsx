/* ── CodaScope: NoteArchiveBrowser ────────────────────────────────────
   Collapsible section showing archived notes with restore capability.
   Embedded in NotesBrowser as a section at the bottom.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
import { IconArchive, IconFile, IconFolder } from "../components/CodaScopeIcons";
import { ConfirmDialog } from "../../../shared/confirm-dialog/ConfirmDialog";
import type { NoteScope, NoteVisibility, NoteArchiveMeta } from "../codaScopeTypes";

/* ── Relative time formatter ─────────────────────────────────────────── */

function relativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/* ── Props ───────────────────────────────────────────────────────────── */

interface NoteArchiveBrowserProps {
  scope: NoteScope;
  visibility: NoteVisibility;
  queryString: string;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteArchiveBrowser({ scope, visibility, queryString }: NoteArchiveBrowserProps) {
  const [archived, setArchived] = useState<NoteArchiveMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<NoteArchiveMeta | null>(null);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);

  // ── Fetch archived notes ──────────────────────────────────────────
  const fetchArchived = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(queryString);
      const res = await fetch(`/api/codascope/notes/${scope}/${visibility}/archive?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setArchived(data.archived ?? []);
      }
    } catch {
      // Silently fail
    }
    setLoading(false);
  }, [scope, visibility, queryString]);

  useEffect(() => {
    void fetchArchived();
  }, [fetchArchived]);

  // ── Restore handler ────────────────────────────────────────────────
  const handleRestore = useCallback(async (noteId: string) => {
    setRestoring(noteId);
    setRestoreResult(null);
    try {
      const params = new URLSearchParams(queryString);
      const res = await fetch(`/api/codascope/notes/${scope}/${visibility}/archive/restore/${noteId}?${params.toString()}`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setRestoreResult(`${confirmRestore?.kind === "folder" ? "Folder" : "Note"} restored to: ${data.restoredPath}`);
        void fetchArchived();
      }
    } catch {
      // Silently fail
    }
    setRestoring(null);
    setConfirmRestore(null);
  }, [scope, visibility, queryString, fetchArchived, confirmRestore]);

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="codascope-notes-archive-loading">
        Loading archive…
      </div>
    );
  }

  if (archived.length === 0) {
    return (
      <div className="codascope-notes-archive-empty">
        <IconArchive size={20} />
        <span>No archived notes or folders.</span>
      </div>
    );
  }

  return (
    <div className="codascope-notes-archive-list">
      {/* Restore success message */}
      {restoreResult && (
        <div className="codascope-notes-archive-toast">
          {restoreResult}
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-xs"
            onClick={() => setRestoreResult(null)}
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}

      {archived.map((meta) => (
          <div key={meta.noteId} className="codascope-notes-archive-item">
            <div className="codascope-notes-archive-item-icon">
              {meta.kind === "folder" ? <IconFolder size={14} /> : <IconFile size={14} />}
          </div>
          <div className="codascope-notes-archive-item-content">
            <div className="codascope-notes-archive-item-title">{meta.title}</div>
            <div className="codascope-notes-archive-item-meta">
              <span>Was at: {meta.originalPath}</span>
              <span className="codascope-notes-archive-item-sep">&middot;</span>
              <span>{relativeTime(meta.archivedAt)}</span>
              {meta.archivedBy && meta.archivedBy !== "default" && (
                <>
                  <span className="codascope-notes-archive-item-sep">&middot;</span>
                  <span>by {meta.archivedBy}</span>
                </>
              )}
              {meta.reason && (
                <>
                  <span className="codascope-notes-archive-item-sep">&middot;</span>
                  <span className="codascope-notes-archive-item-reason">{meta.reason}</span>
                </>
              )}
            </div>
          </div>
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-sm codascope-notes-archive-restore-btn"
            onClick={() => setConfirmRestore(meta)}
            disabled={restoring === meta.noteId}
            type="button"
          >
            {restoring === meta.noteId ? "Restoring…" : "Restore"}
          </button>
        </div>
      ))}

      {/* Restore confirmation dialog */}
      <ConfirmDialog
        open={!!confirmRestore}
        title={`Restore ${confirmRestore?.kind === "folder" ? "Folder" : "Note"}?`}
        message={`Restore "${confirmRestore?.title}" to its original location? If that path is occupied, the restored ${confirmRestore?.kind === "folder" ? "folder" : "note"} will be renamed.`}
        confirmLabel="Restore"
        cancelLabel="Cancel"
        onConfirm={() => confirmRestore && void handleRestore(confirmRestore.noteId)}
        onCancel={() => setConfirmRestore(null)}
      />
    </div>
  );
}
