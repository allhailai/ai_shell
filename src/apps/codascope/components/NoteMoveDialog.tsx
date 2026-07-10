/* ── CodaScope: NoteMoveDialog ───────────────────────────────────────
   Modal dialog for moving notes between levels and folders.
   Provides a target level picker, folder browser within the selected
   target level, and a "Move" button.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useMemo } from "react";
import { IconFolder } from "./CodaScopeIcons";
import type { NoteLevel, NoteFolderEntry } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface NoteMoveDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Current note level */
  fromLevel: NoteLevel;
  /** Current note path */
  fromPath: string;
  /** Current resolve opts */
  fromOpts: Record<string, string>;
  /** Called after successful move */
  onMoved: () => void;
  /** Called to close the dialog */
  onClose: () => void;
}

/* ── Level options ───────────────────────────────────────────────────── */

const LEVEL_OPTIONS: Array<{ value: NoteLevel; label: string }> = [
  { value: "personal", label: "Personal" },
  { value: "public", label: "Public" },
  { value: "project", label: "Project" },
  { value: "epic", label: "Epic" },
];

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteMoveDialog({
  open,
  fromLevel,
  fromPath,
  fromOpts,
  onMoved,
  onClose,
}: NoteMoveDialogProps) {
  const [targetLevel, setTargetLevel] = useState<NoteLevel>(fromLevel);
  const [targetFolder, setTargetFolder] = useState("");
  const [folders, setFolders] = useState<NoteFolderEntry[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build resolve opts for the target level
  const targetOpts = useMemo((): Record<string, string> => {
    // Inherit project/epic context from the source opts
    return {
      username: fromOpts.username,
      projectId: fromOpts.projectId,
      epicId: fromOpts.epicId,
    };
  }, [fromOpts]);

  // Fetch folders when level changes
  useEffect(() => {
    if (!open) return;
    setLoadingFolders(true);
    const params = new URLSearchParams();
    if (targetOpts.projectId) params.set("projectId", targetOpts.projectId);
    if (targetOpts.epicId) params.set("epicId", targetOpts.epicId);
    if (targetOpts.username) params.set("username", targetOpts.username);

    void (async () => {
      try {
        const res = await fetch(`/api/codascope/notes/${targetLevel}/folders?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setFolders(data.folders ?? []);
        }
      } catch { /* ignore */ }
      setLoadingFolders(false);
    })();
  }, [open, targetLevel, targetOpts]);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setTargetLevel(fromLevel);
      setTargetFolder("");
      setError(null);
    }
  }, [open, fromLevel]);

  // Compute the destination path
  const destinationPath = useMemo(() => {
    const filename = fromPath.split("/").pop() ?? fromPath;
    return targetFolder ? `${targetFolder}/${filename}` : filename;
  }, [fromPath, targetFolder]);

  const handleMove = useCallback(async () => {
    setMoving(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (fromOpts.projectId) params.set("projectId", fromOpts.projectId);
      if (fromOpts.epicId) params.set("epicId", fromOpts.epicId);

      const res = await fetch(`/api/codascope/notes/${fromLevel}/move?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromPath,
          toLevel: targetLevel,
          toPath: destinationPath,
          fromOpts,
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
    } catch {
      setError("Network error.");
    }
    setMoving(false);
  }, [fromLevel, fromPath, fromOpts, targetLevel, destinationPath, targetOpts, onMoved, onClose]);

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
          {/* Level picker */}
          <div className="codascope-notes-move-section">
            <label className="codascope-notes-move-label">Target Level</label>
            <div className="codascope-notes-move-level-picker">
              {LEVEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`codascope-notes-move-level-btn${targetLevel === opt.value ? " codascope-notes-move-level-btn--active" : ""}`}
                  onClick={() => { setTargetLevel(opt.value); setTargetFolder(""); }}
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

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
              {targetLevel} / {destinationPath}
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
