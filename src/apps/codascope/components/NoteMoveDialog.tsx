/* ── CodaScope: NoteMoveDialog ───────────────────────────────────────
   Modal dialog for moving notes between scopes, visibilities, and
   folders. Provides target scope/visibility pickers, folder browser
   within the selected target, and a "Move" button.
   Shows cross-visibility warnings when changing shared↔private.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useMemo } from "react";
import { IconClose, IconFolder, IconWarning } from "./CodaScopeIcons";
import { useCodaScopeStore } from "../useCodaScopeStore";
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
  /** Current folder path. When present, the complete nested tree is moved. */
  fromFolder?: string;
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
  fromFolder,
  fromOpts,
  onMoved,
  onClose,
  bulkNoteIds,
}: NoteMoveDialogProps) {
  const projects = useCodaScopeStore((state) => state.projects);
  const [targetScope, setTargetScope] = useState<NoteScope>(fromScope);
  const [targetVisibility, setTargetVisibility] = useState<NoteVisibility>(fromVisibility);
  const [targetProjectId, setTargetProjectId] = useState(fromOpts.projectId ?? "");
  const [targetEpicId, setTargetEpicId] = useState(fromOpts.epicId ?? "");
  const [epics, setEpics] = useState<Array<{ id: string; title: string }>>([]);
  const [targetFolder, setTargetFolder] = useState("");
  const [folders, setFolders] = useState<NoteFolderEntry[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only scope identifiers belong in resolve options. User identity is always
  // derived by the server from the authenticated session.
  const sourceOpts = useMemo((): Record<string, string> => {
    return {
      projectId: fromOpts.projectId,
      epicId: fromOpts.epicId,
    };
  }, [fromOpts]);

  const targetOpts = useMemo((): Record<string, string> => {
    const opts: Record<string, string> = {};
    if (targetScope !== "codascope" && targetProjectId) opts.projectId = targetProjectId;
    if (targetScope === "epic" && targetEpicId) opts.epicId = targetEpicId;
    return opts;
  }, [targetScope, targetProjectId, targetEpicId]);
  const targetReady = targetScope === "codascope" || Boolean(targetProjectId && (targetScope !== "epic" || targetEpicId));

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
    if (!open || targetScope !== "epic" || !targetProjectId) {
      if (targetScope !== "epic") setEpics([]);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/codascope/projects/${targetProjectId}/epics`);
        if (res.ok) {
          const data = await res.json();
          setEpics(data.epics ?? []);
        }
      } catch { /* best effort */ }
    })();
  }, [open, targetScope, targetProjectId]);

  useEffect(() => {
    if (!open || !targetReady) {
      setFolders([]);
      return;
    }
    setLoadingFolders(true);
    const params = new URLSearchParams();
    if (targetOpts.projectId) params.set("projectId", targetOpts.projectId);
    if (targetOpts.epicId) params.set("epicId", targetOpts.epicId);

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
  }, [open, targetReady, targetScope, targetVisibility, targetOpts]);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setTargetScope(fromScope);
      setTargetVisibility(fromScope === "epic" ? "shared" : fromVisibility);
      setTargetProjectId(fromOpts.projectId ?? "");
      setTargetEpicId(fromOpts.epicId ?? "");
      setTargetFolder("");
      setError(null);
    }
  }, [open, fromScope, fromVisibility, fromOpts]);

  // Compute the destination path
  const destinationPath = useMemo(() => {
    const itemName = (fromFolder ?? fromPath).split("/").pop() ?? fromFolder ?? fromPath;
    return targetFolder ? `${targetFolder}/${itemName}` : itemName;
  }, [fromPath, fromFolder, targetFolder]);

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
            fromOpts: sourceOpts,
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
      } else if (fromFolder) {
        const res = await fetch("/api/codascope/notes/folders/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromScope,
            fromVisibility,
            fromFolder,
            fromOpts: sourceOpts,
            toScope: targetScope,
            toVisibility: targetVisibility,
            toFolder: destinationPath,
            toOpts: targetOpts,
          }),
        });
        if (res.ok) {
          onMoved();
          onClose();
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.message ?? "Folder move failed.");
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
            fromOpts: sourceOpts,
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
  }, [fromScope, fromVisibility, fromPath, fromFolder, sourceOpts, targetScope, targetVisibility, targetOpts, destinationPath, onMoved, onClose, bulkNoteIds]);

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
          <span>Move {fromFolder ? "Folder" : bulkNoteIds?.length ? "Notes" : "Note"}</span>
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-xs"
            onClick={onClose}
            type="button"
          >
            <IconClose size={14} />
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
                  onClick={() => {
                    setTargetScope(opt.value);
                    setTargetFolder("");
                    if (opt.value === "codascope") { setTargetProjectId(""); setTargetEpicId(""); }
                    if (opt.value !== "epic") setTargetEpicId("");
                    if (opt.value === "epic") setTargetVisibility("shared");
                  }}
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {(targetScope === "project" || targetScope === "epic") && (
            <div className="codascope-notes-move-section">
              <label className="codascope-notes-move-label" htmlFor="notes-move-project">Project</label>
              <select id="notes-move-project" className="codascope-notes-select" value={targetProjectId} onChange={(event) => { setTargetProjectId(event.target.value); setTargetEpicId(""); setTargetFolder(""); }}>
                <option value="">Select a project</option>
                {projects.filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
          )}

          {targetScope === "epic" && (
            <div className="codascope-notes-move-section">
              <label className="codascope-notes-move-label" htmlFor="notes-move-epic">Epic</label>
              <select id="notes-move-epic" className="codascope-notes-select" value={targetEpicId} onChange={(event) => { setTargetEpicId(event.target.value); setTargetFolder(""); }} disabled={!targetProjectId}>
                <option value="">Select an epic</option>
                {epics.map((epic) => <option key={epic.id} value={epic.id}>{epic.title}</option>)}
              </select>
            </div>
          )}

          {/* Visibility picker */}
          <div className="codascope-notes-move-section">
            <label className="codascope-notes-move-label">Visibility</label>
            <div className="codascope-notes-move-level-picker">
              {VISIBILITY_OPTIONS.filter((opt) => targetScope !== "epic" || opt.value === "shared").map((opt) => (
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
            disabled={moving || !targetReady}
            type="button"
          >
            {moving ? "Moving…" : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}
