/* ── CodaScope: Note Create Dialog ───────────────────────────────────
   Makes the destination explicit before content is created. A note or
   folder is always placed by scope, visibility, project/epic, and folder.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { IconClose, IconFile, IconFolder } from "./CodaScopeIcons";
import type { NoteFolderEntry, NoteScope, NoteVisibility } from "../codaScopeTypes";

export interface NoteCreateLocation {
  scope: NoteScope;
  visibility: NoteVisibility;
  queryParams: Record<string, string>;
  path: string;
  isFolder: boolean;
}

interface NoteCreateDialogProps {
  open: boolean;
  initialScope: NoteScope;
  initialVisibility: NoteVisibility;
  initialQueryParams: Record<string, string>;
  initialFolder?: string;
  mode: "note" | "folder";
  onClose: () => void;
  onCreated: (location: NoteCreateLocation) => void;
}

function flattenFolders(folders: NoteFolderEntry[], depth = 0): Array<{ path: string; label: string }> {
  return folders.flatMap((folder) => [
    { path: folder.path, label: `${"  ".repeat(depth)}${folder.name}` },
    ...flattenFolders(folder.subfolders, depth + 1),
  ]);
}

function safeFileName(value: string): string {
  return value.trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "Untitled");
}

export function NoteCreateDialog({
  open,
  initialScope,
  initialVisibility,
  initialQueryParams,
  initialFolder,
  mode,
  onClose,
  onCreated,
}: NoteCreateDialogProps) {
  const projects = useCodaScopeStore((state) => state.projects);
  const [scope, setScope] = useState<NoteScope>(initialScope);
  const [visibility, setVisibility] = useState<NoteVisibility>(initialVisibility);
  const [projectId, setProjectId] = useState(initialQueryParams.projectId ?? "");
  const [epicId, setEpicId] = useState(initialQueryParams.epicId ?? "");
  const [epics, setEpics] = useState<Array<{ id: string; title: string }>>([]);
  const [folders, setFolders] = useState<NoteFolderEntry[]>([]);
  const [folder, setFolder] = useState(initialFolder ?? "");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetQuery = useMemo(() => {
    const next: Record<string, string> = {};
    if (scope !== "codascope" && projectId) next.projectId = projectId;
    if (scope === "epic" && epicId) next.epicId = epicId;
    return next;
  }, [scope, projectId, epicId]);
  const targetQueryString = useMemo(() => new URLSearchParams(targetQuery).toString(), [targetQuery]);
  const folderOptions = useMemo(() => flattenFolders(folders), [folders]);
  const isEpic = scope === "epic";
  const needsProject = scope === "project" || scope === "epic";
  const validDestination = !needsProject || Boolean(projectId && (!isEpic || epicId));

  useEffect(() => {
    if (!open) return;
    setScope(initialScope);
    setVisibility(initialScope === "epic" ? "shared" : initialVisibility);
    setProjectId(initialQueryParams.projectId ?? "");
    setEpicId(initialQueryParams.epicId ?? "");
    setFolder(initialFolder ?? "");
    setName("");
    setError(null);
  }, [open, initialScope, initialVisibility, initialQueryParams, initialFolder]);

  useEffect(() => {
    if (scope === "epic") setVisibility("shared");
  }, [scope]);

  useEffect(() => {
    if (!projectId || scope !== "epic") {
      setEpics([]);
      if (scope !== "epic") setEpicId("");
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/codascope/projects/${projectId}/epics`);
        if (res.ok) {
          const data = await res.json();
          setEpics(data.epics ?? []);
        }
      } catch { /* best effort */ }
    })();
  }, [projectId, scope]);

  useEffect(() => {
    if (!open || !validDestination) {
      setFolders([]);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/codascope/notes/${scope}/${visibility}/folders?${targetQueryString}`);
        if (res.ok) {
          const data = await res.json();
          setFolders(data.folders ?? []);
        }
      } catch { /* best effort */ }
    })();
  }, [open, validDestination, scope, visibility, targetQueryString]);

  const handleScopeChange = useCallback((nextScope: NoteScope) => {
    setScope(nextScope);
    setFolder("");
    if (nextScope === "codascope") {
      setProjectId("");
      setEpicId("");
    }
    if (nextScope !== "epic") setEpicId("");
    if (nextScope === "epic") setVisibility("shared");
  }, []);

  const handleCreate = useCallback(async () => {
    const cleanedName = safeFileName(name || (mode === "note" ? `Untitled ${new Date().toISOString().slice(0, 10)}` : ""));
    if (!cleanedName) {
      setError(`A ${mode === "note" ? "note title" : "folder name"} is required.`);
      return;
    }
    if (!validDestination) {
      setError(isEpic ? "Choose a project and epic." : "Choose a project.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      if (mode === "folder") {
        const folderPath = folder ? `${folder}/${cleanedName}` : cleanedName;
        const res = await fetch(`/api/codascope/notes/${scope}/${visibility}/folders?${targetQueryString}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderPath }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Could not create the folder.");
        onCreated({ scope, visibility, queryParams: targetQuery, path: folderPath, isFolder: true });
      } else {
        const fileName = cleanedName.endsWith(".md") ? cleanedName : `${cleanedName}.md`;
        const notePath = folder ? `${folder}/${fileName}` : fileName;
        const res = await fetch(`/api/codascope/notes/${scope}/${visibility}/note/${notePath}?${targetQueryString}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Could not create the note.");
        onCreated({ scope, visibility, queryParams: targetQuery, path: notePath, isFolder: false });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create this item.");
    }
    setCreating(false);
  }, [name, mode, validDestination, isEpic, folder, scope, visibility, targetQueryString, targetQuery, onCreated]);

  if (!open) return null;

  return (
    <div className="codascope-notes-move-overlay" onClick={onClose}>
      <div className="codascope-notes-move-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="codascope-notes-move-dialog-header">
          <span>{mode === "note" ? "New Note" : "New Folder"}</span>
          <button className="codascope-btn codascope-btn-ghost codascope-btn-xs" onClick={onClose} type="button">
            <IconClose size={14} />
          </button>
        </div>
        <div className="codascope-notes-move-dialog-body">
          <div className="codascope-notes-move-section">
            <label className="codascope-notes-move-label" htmlFor="notes-create-name">{mode === "note" ? "Title" : "Folder name"}</label>
            <div className="codascope-notes-create-name-input">
              {mode === "note" ? <IconFile size={14} /> : <IconFolder size={14} />}
              <input
                id="notes-create-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={mode === "note" ? "Untitled note" : "e.g. Planning"}
                autoFocus
                onKeyDown={(event) => { if (event.key === "Enter") void handleCreate(); }}
              />
            </div>
          </div>

          <div className="codascope-notes-move-section">
            <label className="codascope-notes-move-label">Location</label>
            <div className="codascope-notes-move-level-picker">
              {(["codascope", "project", "epic"] as NoteScope[]).map((option) => (
                <button
                  key={option}
                  className={`codascope-notes-move-level-btn${scope === option ? " codascope-notes-move-level-btn--active" : ""}`}
                  onClick={() => handleScopeChange(option)}
                  type="button"
                >
                  {option === "codascope" ? "CodaScope" : option === "project" ? "Project" : "Epic"}
                </button>
              ))}
            </div>
          </div>

          {needsProject && (
            <div className="codascope-notes-move-section">
              <label className="codascope-notes-move-label" htmlFor="notes-create-project">Project</label>
              <select id="notes-create-project" className="codascope-notes-select" value={projectId} onChange={(event) => { setProjectId(event.target.value); setEpicId(""); setFolder(""); }}>
                <option value="">Select a project</option>
                {projects.filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
          )}

          {isEpic && (
            <div className="codascope-notes-move-section">
              <label className="codascope-notes-move-label" htmlFor="notes-create-epic">Epic</label>
              <select id="notes-create-epic" className="codascope-notes-select" value={epicId} onChange={(event) => { setEpicId(event.target.value); setFolder(""); }} disabled={!projectId}>
                <option value="">Select an epic</option>
                {epics.map((epic) => <option key={epic.id} value={epic.id}>{epic.title}</option>)}
              </select>
            </div>
          )}

          <div className="codascope-notes-move-section">
            <label className="codascope-notes-move-label">Visibility</label>
            <div className="codascope-notes-move-level-picker">
              <button className={`codascope-notes-move-level-btn${visibility === "shared" ? " codascope-notes-move-level-btn--active" : ""}`} onClick={() => setVisibility("shared")} type="button">Shared — anyone</button>
              {!isEpic && <button className={`codascope-notes-move-level-btn${visibility === "private" ? " codascope-notes-move-level-btn--active" : ""}`} onClick={() => setVisibility("private")} type="button">Private — only you</button>}
            </div>
          </div>

          <div className="codascope-notes-move-section">
            <label className="codascope-notes-move-label" htmlFor="notes-create-folder">Folder</label>
            <select id="notes-create-folder" className="codascope-notes-select" value={folder} onChange={(event) => setFolder(event.target.value)} disabled={!validDestination}>
              <option value="">/ (root)</option>
              {folderOptions.map((option) => <option key={option.path} value={option.path}>{option.label}</option>)}
            </select>
          </div>
          {error && <div className="codascope-notes-move-error">{error}</div>}
        </div>
        <div className="codascope-notes-move-dialog-footer">
          <button className="codascope-btn codascope-btn-ghost codascope-btn-sm" onClick={onClose} disabled={creating} type="button">Cancel</button>
          <button className="codascope-btn codascope-btn-primary codascope-btn-sm" onClick={() => void handleCreate()} disabled={creating || !validDestination} type="button">
            {creating ? "Creating…" : mode === "note" ? "Create note" : "Create folder"}
          </button>
        </div>
      </div>
    </div>
  );
}
