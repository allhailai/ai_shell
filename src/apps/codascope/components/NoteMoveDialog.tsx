/* ── CodaScope: NoteMoveDialog ───────────────────────────────────────
   Modal dialog for moving notes between scopes, visibilities, and
   folders. Provides target scope/visibility pickers, folder browser
   within the selected target, and a "Move" button.
   Shows cross-visibility warnings when changing shared↔private.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useMemo } from "react";
import { IconFolder, IconWarning } from "./CodaScopeIcons";
import type { NoteScope, NoteVisibility, NoteFolderEntry } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface NoteMoveDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Current note scope */
  fromScope: NoteScope;
  /** Current note visibility */
  fromVisibility: NoteVisibility;
  /** Current note path */
  fromPath: string;
  /** Current resolve opts */
  fromOpts: Record<string, string>;
  /** Called after successful move */
  onMoved: () => void;
  /** Called to close the dialog */
  onClose: () => void;
  /** Optional: note IDs for bulk move. When provided, uses bulk/move API. */
  bulkNoteIds?: string[];
}

/* ── Scope & visibility options ──────────────────────────────────────── */

const SCOPE_OPTIONS: Array<{ value: NoteScope; label: string }> = [
  { value: "codascope", label: "CodaScope" },
  { value: "project", label: "Project" },
  { value: "epic", label: "Epic" },
];

const VISIBILITY_OPTIONS: Array<{ value: NoteVisibility; label: string }> = [
  { value: "shared", label: "Shared" },
  { value: "private", label: "Private" },
];

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteMoveDialog({
  open,
  fromScope,
  fromVisibility,
  fromPath,
  fromOpts,
  onMoved,
  onClose,
  bulkNoteIds,
}: NoteMoveDialogProps) {
  const [targetScope, setTargetScope] = useState<NoteScope>(fromScope);
  const [targetVisibility, setTargetVisibility] = useState<NoteVisibility>(fromVisibility);
  const [targetFolder, setTargetFolder] = useState("");
  const [folders, setFolders] = useState<NoteFolderEntry[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build resolve opts for the target
  const targetOpts = useMemo((): Record<string, string> => {
    // Inherit project/epic context from the source opts
    return {
      username: fromOpts.username,
      projectId: fromOpts.projectId,
      epicId: fromOpts.epicId,
    };
  }, [fromOpts]);

  // Cross-visibility warning
  const visibilityWarning = useMemo((): string | null => {
    if (fromVisibility === targetVisibility) return null;
    if (fromVisibility === "shared" && targetVisibility === "private") {
      return "Moving to private will remove access for other users.";
    }
    if (fromVisibility === "private" && targetVisibility === "shared") {
      return "Moving to shared will make this note visible to all team members.";
    }
    return null;
  }, [fromVisibility, targetVisibility]);

  // Fetch folders when scope/visibility changes
  useEffect(() => {
    if (!open) return;
    setLoadingFolders(true);
    const params = new URLSearchParams();
    if (targetOpts.projectId) params.set("projectId", targetOpts.projectId);
    if (targetOpts.epicId) params.set("epicId", targetOpts.epicId);
    if (targetOpts.username) params.set("username", targetOpts.username);

    void (async () => {
      try {
        const res = await fetch(`/api/codascope/notes/${targetScope}/${targetVisibility}/folders?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setFolders(data.folders ?? []);
        }
      } catch { /* ignore */ }
      setLoadingFolders(false);
    })();
  }, [open, targetScope, targetVisibility, targetOpts]);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setTargetScope(fromScope);
      setTargetVisibility(fromVisibility);
      setTargetFolder("");
      setError(null);
    }
  }, [open, fromScope, fromVisibility]);

  // Compute the destination path
  const destinationPath = useMemo(() => {
    const filename = fromPath.split("/").pop() ?? fromPath;
    return targetFolder ? `${targetFolder}/${filename}` : filename;
  }, [fromPath, targetFolder]);

  const handleMove = useCallback(async () => {
    setMoving(true);
    setError(null);
    try {
      if (bulkNoteIds && bulkNoteIds.length > 0) {
        // Bulk move
        const res = await fetch("/api/codascope/notes/bulk/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            noteIds: bulkNoteIds,
            fromScope,
            fromVisibility,
            fromOpts,
            toScope: targetScope,
            toVisibility: targetVisibility,
            toOpts: targetOpts,
            toFolder: targetFolder,
          }),
        });

        if (res.ok) {
          onMoved();
          onClose();
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.message ?? "Bulk move failed.");
        }
      } else {
        // Single note move
        const res = await fetch("/api/codascope/notes/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromScope,
            fromVisibility,
            fromPath,
            fromOpts,
            toScope: targetScope,
            toVisibility: targetVisibility,
            toPath: destinationPath,
            toOpts: targetOpts,
          }),
        });

        if (res.ok) {
          onMoved();
          onClose();
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.message ?? "Move failed.");
        }
      }
    } catch {
      setError("Network error.");
    }
    setMoving(false);
  }, [fromScope, fromVisibility, fromPath, fromOpts, targetScope, targetVisibility, destinationPath, targetOpts, onMoved, onClose]);

  if (!open) return null;

  const renderFolderTree = (folderList: NoteFolderEntry[], depth = 0): React.ReactNode => {
    return folderList.map((folder) => (
      <div key={folder.path}>
        <button
          className={`codascope-notes-move-folder-item${targetFolder === folder.path ? " codascope-notes-move-folder-item--selected" : ""}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => setTargetFolder(folder.path)}
          type="button"
        >
          <IconFolder size={12} />
          <span>{folder.name}</span>
          <span className="codascope-notes-move-folder-count">{folder.noteCount}</span>
        </button>
        {folder.subfolders.length > 0 && renderFolderTree(folder.subfolders, depth + 1)}
      </div>
    ));
  };

  return (
    <div className="codascope-notes-move-overlay" onClick={onClose}>
      <div className="codascope-notes-move-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="codascope-notes-move-dialog-header">
          <span>Move Note</span>
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-xs"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="codascope-notes-move-dialog-body">
          {/* Scope picker */}
          <div className="codascope-notes-move-section">
            <label className="codascope-notes-move-label">Target Scope</label>
            <div className="codascope-notes-move-level-picker">
              {SCOPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`codascope-notes-move-level-btn${targetScope === opt.value ? " codascope-notes-move-level-btn--active" : ""}`}
                  onClick={() => { setTargetScope(opt.value); setTargetFolder(""); }}
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Visibility picker */}
          <div className="codascope-notes-move-section">
            <label className="codascope-notes-move-label">Visibility</label>
            <div className="codascope-notes-move-level-picker">
              {VISIBILITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`codascope-notes-move-level-btn${targetVisibility === opt.value ? " codascope-notes-move-level-btn--active" : ""}`}
                  onClick={() => { setTargetVisibility(opt.value); setTargetFolder(""); }}
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cross-visibility warning */}
          {visibilityWarning && (
            <div className="codascope-notes-move-warning">
              <IconWarning size={13} />
              <span>{visibilityWarning}</span>
            </div>
          )}

          {/* Folder browser */}
          <div className="codascope-notes-move-section">
            <label className="codascope-notes-move-label">Target Folder</label>
            <div className="codascope-notes-move-folder-list">
              {/* Root option */}
              <button
                className={`codascope-notes-move-folder-item${targetFolder === "" ? " codascope-notes-move-folder-item--selected" : ""}`}
                onClick={() => setTargetFolder("")}
                type="button"
              >
                <IconFolder size={12} />
                <span>/ (root)</span>
              </button>
              {loadingFolders ? (
                <div className="codascope-notes-move-loading">Loading…</div>
              ) : (
                renderFolderTree(folders)
              )}
            </div>
          </div>

          {/* Destination preview */}
          <div className="codascope-notes-move-section">
            <label className="codascope-notes-move-label">Destination</label>
            <div className="codascope-notes-move-destination">
              {targetScope} / {targetVisibility} / {destinationPath}
            </div>
          </div>

          {error && (
            <div className="codascope-notes-move-error">{error}</div>
          )}
        </div>

        <div className="codascope-notes-move-dialog-footer">
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-sm"
            onClick={onClose}
            disabled={moving}
            type="button"
          >
            Cancel
          </button>
          <button
            className="codascope-btn codascope-btn-primary codascope-btn-sm"
            onClick={handleMove}
            disabled={moving}
            type="button"
          >
            {moving ? "Moving…" : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}
