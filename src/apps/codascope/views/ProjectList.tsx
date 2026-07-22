/* ── CodaScope: ProjectList View ──────────────────────────────────────
   Shows the project list as cards, plus first-launch setup wizard
   for configuring the projects root directory.
   Includes project import via drag-and-drop zip upload.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useRef, type DragEvent } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { IconClose, IconFolder, IconArchive, IconFolderOpen, IconRefresh, IconSettings, IconWarning } from "../components/CodaScopeIcons";
import { CodaScopeRepoRemapModal } from "../components/CodaScopeRepoRemapModal";
import { FolderPicker } from "../../../shared/folder-picker";
import { useAuth } from "../../../shell/authContext";

interface ImportState {
  status: "idle" | "dragging" | "uploading" | "success" | "error";
  error?: string;
}

interface ImportResult {
  projectId: string;
  projectName: string;
  needsRepoMapping: boolean;
  unmappedRepos: Array<{ id: string; name: string; path: string }>;
}

export function ProjectList() {
  const { navigate } = useAppSubRoute("codascope");
  const { user } = useAuth();
  const isAdmin = user?.is_admin === true;
  const {
    configured,
    projectsRoot,
    projects,
    setProjectsRoot,
    setConfigured,
    setProjects,
  } = useCodaScopeStore();

  const [setupPath, setSetupPath] = useState("");
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showSetupFolderPicker, setShowSetupFolderPicker] = useState(false);

  // ── Change root directory state ───────────────────────────────────
  const [showChangeRootModal, setShowChangeRootModal] = useState(false);
  const [changeRootConfirmText, setChangeRootConfirmText] = useState("");
  const [showChangeRootPicker, setShowChangeRootPicker] = useState(false);
  const [changeRootSaving, setChangeRootSaving] = useState(false);
  const [changeRootError, setChangeRootError] = useState("");

  // ── Import state ──────────────────────────────────────────────────
  const [importState, setImportState] = useState<ImportState>({ status: "idle" });
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showRemapModal, setShowRemapModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Derived lists ─────────────────────────────────────────────────
  const activeProjects = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => p.archived);

  // ── Setup handler ─────────────────────────────────────────────────

  const handleSetup = useCallback(async () => {
    const path = setupPath.trim();
    if (!path) {
      setError("Please enter a valid directory path.");
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/codascope/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectsRoot: path }),
      });
      if (res.ok) {
        const data = await res.json();
        setProjectsRoot(typeof data.projectsRoot === "string" ? data.projectsRoot : path);
        setConfigured(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to save configuration.");
      }
    } catch {
      setError("Network error. Is the server running?");
    }
  }, [setupPath, setProjectsRoot, setConfigured]);

  // ── Change root directory handler ─────────────────────────────────

  const handleChangeRootConfirm = useCallback(() => {
    setShowChangeRootModal(false);
    setChangeRootConfirmText("");
    setShowChangeRootPicker(true);
  }, []);

  const handleChangeRootSelect = useCallback(async (selectedPath: string) => {
    setShowChangeRootPicker(false);
    setChangeRootSaving(true);
    setChangeRootError("");
    try {
      const res = await fetch("/api/codascope/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectsRoot: selectedPath }),
      });
      if (res.ok) {
        const config = await res.json();
        setProjectsRoot(typeof config.projectsRoot === "string" ? config.projectsRoot : selectedPath);
        // Refresh projects list from new root
        const listRes = await fetch("/api/codascope/projects");
        if (listRes.ok) {
          const data = await listRes.json();
          setProjects(data.projects ?? []);
        } else {
          setProjects([]);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setChangeRootError(data.error ?? "Failed to update root directory.");
      }
    } catch {
      setChangeRootError("Network error. Is the server running?");
    } finally {
      setChangeRootSaving(false);
    }
  }, [setProjectsRoot, setProjects]);

  // ── Create project ────────────────────────────────────────────────

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const handleCreateProject = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch("/api/codascope/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setProjects([...projects, data.project]);
        setNewName("");
        setNewDesc("");
        setShowCreate(false);
        navigate(`project/${data.project.id}/dashboard`);
      }
    } catch {
      // Silently fail
    }
  }, [newName, newDesc, projects, setProjects, navigate]);

  // ── Import handlers ───────────────────────────────────────────────

  const handleImportFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".zip")) {
      setImportState({ status: "error", error: "Please upload a .zip file." });
      return;
    }

    setImportState({ status: "uploading" });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/codascope/projects/import", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Import failed.");
      }

      const data = await res.json();

      // Add the new project to the store
      setProjects([...projects, data.project]);

      if (data.needsRepoMapping) {
        setImportResult({
          projectId: data.project.id,
          projectName: data.project.name,
          needsRepoMapping: true,
          unmappedRepos: data.unmappedRepos ?? [],
        });
        setShowRemapModal(true);
        setImportState({ status: "success" });
      } else {
        setImportState({ status: "success" });
        navigate(`project/${data.project.id}/dashboard`);
      }
    } catch (err) {
      setImportState({
        status: "error",
        error: err instanceof Error ? err.message : "Import failed.",
      });
    }
  }, [projects, setProjects, navigate]);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setImportState({ status: "idle" });

    const file = e.dataTransfer?.files?.[0];
    if (file) {
      handleImportFile(file);
    }
  }, [handleImportFile]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setImportState((prev) => prev.status === "uploading" ? prev : { status: "dragging" });
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setImportState((prev) => prev.status === "uploading" ? prev : { status: "idle" });
  }, []);

  const handleRemapComplete = useCallback(() => {
    setShowRemapModal(false);
    if (importResult) {
      // Refresh projects list
      void (async () => {
        try {
          const res = await fetch("/api/codascope/projects");
          if (res.ok) {
            const data = await res.json();
            setProjects(data.projects ?? []);
          }
        } catch { /* ignore */ }
      })();
      navigate(`project/${importResult.projectId}/dashboard`);
    }
  }, [importResult, setProjects, navigate]);

  // ── Archive handler ───────────────────────────────────────────────

  const handleArchiveToggle = useCallback(async (projectId: string, archived: boolean) => {
    try {
      const res = await fetch(`/api/codascope/projects/${projectId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (res.ok) {
        // Refresh projects list
        const listRes = await fetch("/api/codascope/projects");
        if (listRes.ok) {
          const data = await listRes.json();
          setProjects(data.projects ?? []);
        }
      }
    } catch { /* ignore */ }
  }, [setProjects]);

  const handleRemapClose = useCallback(() => {
    setShowRemapModal(false);
    // Project is created but with unmapped repos — user can fix later via Settings
  }, []);

  // ── Setup wizard (first launch) ───────────────────────────────────

  if (!configured && !isAdmin) {
    return (
      <div className="codascope-page">
        <div className="codascope-empty-state">
          <div className="codascope-empty-state-icon"><IconWarning size={32} /></div>
          <div className="codascope-empty-state-title">CodaScope Is Not Configured</div>
          <div className="codascope-empty-state-text">
            An administrator must configure project storage before CodaScope can be used.
          </div>
        </div>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="codascope-page">
        <div className="codascope-setup">
          <div className="codascope-setup-title">Welcome to CodaScope</div>
          <div className="codascope-setup-desc">
            CodaScope helps you explore, document, and analyze your codebases with AI-powered agents.
            To get started, choose where CodaScope should store its project data.
          </div>

          <div className="codascope-form-group">
            <label className="codascope-form-label" htmlFor="codascope-root-path">
              Projects Root Directory
            </label>
            <div className="codascope-settings-repo-path-input-row">
              <input
                className="codascope-form-input codascope-settings-flex-1"
                id="codascope-root-path"
                type="text"
                placeholder="/path/to/codascope_projects"
                value={setupPath}
                onChange={(e) => setSetupPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSetup()}
              />
              <button
                className="codascope-btn codascope-btn-secondary codascope-settings-browse-btn"
                onClick={() => setShowSetupFolderPicker(true)}
                type="button"
                title="Browse filesystem to select a directory"
              >
                <IconFolderOpen size={12} /> Browse
              </button>
            </div>
            <div className="codascope-form-hint">
              CodaScope will create a <code>codascope_projects</code> folder here for all project data (wiki pages, build logs, etc).
            </div>
          </div>

          {error && (
            <div style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)", marginBottom: "var(--space-4)" }}>
              {error}
            </div>
          )}

          <div className="codascope-form-actions">
            <button className="codascope-btn codascope-btn-primary" onClick={handleSetup} type="button">
              Set Up CodaScope
            </button>
          </div>

          <FolderPicker
            open={showSetupFolderPicker}
            onClose={() => setShowSetupFolderPicker(false)}
            onSelect={(selectedPath: string) => {
              setSetupPath(selectedPath);
              setShowSetupFolderPicker(false);
            }}
            mode="directory"
            title="Select Projects Root Directory"
            initialPath={setupPath || undefined}
          />
        </div>
      </div>
    );
  }

  // ── Project list ──────────────────────────────────────────────────

  return (
    <div className="codascope-page">
      <div className="codascope-page-header">
        <div>
          <div className="codascope-page-title">Projects</div>
          <div className="codascope-page-subtitle">
            {activeProjects.length} active{archivedProjects.length > 0 ? ` • ${archivedProjects.length} archived` : ""}
            {isAdmin ? ` • ${projectsRoot}` : " • storage configured"}
            {isAdmin && (
              <button
                className="codascope-change-root-btn"
                onClick={() => { setShowChangeRootModal(true); setChangeRootConfirmText(""); setChangeRootError(""); }}
                type="button"
                title="Change projects root directory"
              >
                <IconSettings size={11} />
              </button>
            )}
          </div>
          {changeRootError && (
            <div style={{ color: "var(--color-danger)", fontSize: "var(--text-xs)", marginTop: "var(--space-1)" }}>
              {changeRootError}
            </div>
          )}
          {changeRootSaving && (
            <div style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-xs)", marginTop: "var(--space-1)" }}>
              Switching root directory…
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          {archivedProjects.length > 0 && (
            <button
              className={`codascope-btn ${showArchived ? "codascope-btn-secondary" : "codascope-btn-ghost"}`}
              onClick={() => setShowArchived((v) => !v)}
              type="button"
              title={showArchived ? "Hide archived projects" : "Show archived projects"}
            >
              {showArchived ? "Hide Archived" : `Archived (${archivedProjects.length})`}
            </button>
          )}
          <button
            className="codascope-btn codascope-btn-primary"
            onClick={() => setShowCreate(true)}
            type="button"
          >
            + New Project
          </button>
        </div>
      </div>

      {/* Create project form */}
      {showCreate && (
        <div style={{
          padding: "var(--space-5)",
          marginBottom: "var(--space-4)",
          borderRadius: "var(--radius-xl)",
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)",
        }}>
          <div className="codascope-form-group">
            <label className="codascope-form-label" htmlFor="codascope-new-name">Project Name</label>
            <input
              className="codascope-form-input"
              id="codascope-new-name"
              type="text"
              placeholder="My Full-Stack App"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="codascope-form-group">
            <label className="codascope-form-label" htmlFor="codascope-new-desc">Description</label>
            <input
              className="codascope-form-input"
              id="codascope-new-desc"
              type="text"
              placeholder="TypeScript frontend + Elixir backend"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
          </div>
          <div className="codascope-form-actions">
            <button className="codascope-btn codascope-btn-primary" onClick={handleCreateProject} type="button">
              Create Project
            </button>
            <button
              className="codascope-btn codascope-btn-ghost"
              onClick={() => { setShowCreate(false); setNewName(""); setNewDesc(""); }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {activeProjects.length === 0 && archivedProjects.length === 0 ? (
        <div className="codascope-empty-state">
          <div className="codascope-empty-state-icon"><IconFolder size={32} /></div>
          <div className="codascope-empty-state-title">No Projects Yet</div>
          <div className="codascope-empty-state-text">
            Create your first project to start exploring and documenting your codebase.
          </div>
          <button
            className="codascope-btn codascope-btn-primary"
            onClick={() => setShowCreate(true)}
            type="button"
          >
            + Create Project
          </button>
        </div>
      ) : (
        <>
          {activeProjects.length === 0 ? (
            <div className="codascope-empty-state" style={{ marginBottom: "var(--space-4)" }}>
              <div className="codascope-empty-state-title">No Active Projects</div>
              <div className="codascope-empty-state-text">
                All projects are archived. Unarchive one or create a new project.
              </div>
            </div>
          ) : (
            <div className="codascope-cards">
              {activeProjects.map((project) => (
                <div
                  key={project.id}
                  className="codascope-card"
                  onClick={() => navigate(`project/${project.id}/dashboard`)}
                >
                  <div className="codascope-card-title">{project.name}</div>
                  <div className="codascope-card-desc">
                    {project.description || "No description"}
                  </div>
                  <div className="codascope-card-stats">
                    <div className="codascope-card-stat">
                      <div className="codascope-card-stat-value">{project.repositories.length}</div>
                      <div className="codascope-card-stat-label">Repos</div>
                    </div>
                    <div className="codascope-card-stat">
                      <div className="codascope-card-stat-value">{project.wikiPageCount ?? 0}</div>
                      <div className="codascope-card-stat-label">Wiki Pages</div>
                    </div>
                    <div className="codascope-card-stat">
                      <div className="codascope-card-stat-value">{project.epicCount ?? 0}</div>
                      <div className="codascope-card-stat-label">Epics</div>
                    </div>
                  </div>
                  <button
                    className="codascope-card-archive-btn"
                    title="Archive this project"
                    onClick={(e) => { e.stopPropagation(); handleArchiveToggle(project.id, true); }}
                  >
                    <IconArchive size={12} /> Archive
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Archived projects section */}
          {showArchived && archivedProjects.length > 0 && (
            <>
              <div className="codascope-section-divider">
                <span>Archived</span>
              </div>
              <div className="codascope-cards">
                {archivedProjects.map((project) => (
                  <div
                    key={project.id}
                    className="codascope-card codascope-card--archived"
                    onClick={() => navigate(`project/${project.id}/dashboard`)}
                  >
                    <div className="codascope-card-title">{project.name}</div>
                    <div className="codascope-card-desc">
                      {project.description || "No description"}
                    </div>
                    <div className="codascope-card-stats">
                      <div className="codascope-card-stat">
                        <div className="codascope-card-stat-value">{project.repositories.length}</div>
                        <div className="codascope-card-stat-label">Repos</div>
                      </div>
                      <div className="codascope-card-stat">
                        <div className="codascope-card-stat-value">{project.wikiPageCount ?? 0}</div>
                        <div className="codascope-card-stat-label">Wiki Pages</div>
                      </div>
                      <div className="codascope-card-stat">
                        <div className="codascope-card-stat-value">{project.epicCount ?? 0}</div>
                        <div className="codascope-card-stat-label">Epics</div>
                      </div>
                    </div>
                    <button
                      className="codascope-card-archive-btn"
                      title="Unarchive this project"
                      onClick={(e) => { e.stopPropagation(); handleArchiveToggle(project.id, false); }}
                    >
                      <IconArchive size={12} /> Unarchive
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Import project drop zone */}
      <div
        className={`codascope-import-dropzone ${importState.status === "dragging" ? "codascope-import-dropzone--active" : ""} ${importState.status === "uploading" ? "codascope-import-dropzone--uploading" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => importState.status !== "uploading" && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = "";
          }}
        />
        {importState.status === "uploading" ? (
          <>
            <div className="codascope-import-dropzone-icon"><IconRefresh size={20} /></div>
            <div className="codascope-import-dropzone-text">Importing project…</div>
          </>
        ) : importState.status === "error" ? (
          <>
            <div className="codascope-import-dropzone-icon codascope-import-dropzone-icon--error"><IconClose size={20} /></div>
            <div className="codascope-import-dropzone-text codascope-import-dropzone-text--error">
              {importState.error}
            </div>
            <div className="codascope-import-dropzone-hint">Click or drag to try again</div>
          </>
        ) : (
          <>
            <div className="codascope-import-dropzone-icon">↑</div>
            <div className="codascope-import-dropzone-text">Import Project</div>
            <div className="codascope-import-dropzone-hint">
              Drop a CodaScope portable shared bundle here, or click to browse
            </div>
          </>
        )}
      </div>

      {/* Repo remapping modal */}
      {importResult && (
        <CodaScopeRepoRemapModal
          isOpen={showRemapModal}
          onClose={handleRemapClose}
          onComplete={handleRemapComplete}
          projectId={importResult.projectId}
          projectName={importResult.projectName}
          unmappedRepos={importResult.unmappedRepos}
        />
      )}

      {/* ── Change root directory confirmation modal ──────────────────── */}
      {isAdmin && showChangeRootModal && (
        <div
          className="codascope-modal-overlay"
          onClick={() => setShowChangeRootModal(false)}
        >
          <div
            className="codascope-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="codascope-modal-header">
              <div className="codascope-modal-title" style={{ color: "hsl(40, 90%, 64%)" }}>
                <IconWarning size={16} /> Change Projects Root
              </div>
              <button
                className="codascope-modal-close"
                onClick={() => setShowChangeRootModal(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="codascope-modal-body">
              <div className="codascope-change-root-warning">
                <IconWarning size={14} />
                <div>
                  <strong>Existing projects will not be migrated.</strong>
                  <br />
                  Changing the root directory will make all current projects
                  invisible. They will remain on disk at the old location, but CodaScope
                  will only look in the new directory.
                </div>
              </div>
              <p className="codascope-settings-remove-modal-text">
                Current root: <strong>{projectsRoot}</strong>
              </p>
              <label
                className="codascope-form-label"
                htmlFor="change-root-confirm"
              >
                Type <strong>CHANGE</strong> to confirm
              </label>
              <input
                className="codascope-form-input codascope-settings-remove-confirm-input"
                id="change-root-confirm"
                type="text"
                autoFocus
                placeholder="CHANGE"
                value={changeRootConfirmText}
                onChange={(e) => setChangeRootConfirmText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && changeRootConfirmText === "CHANGE") {
                    handleChangeRootConfirm();
                  }
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="codascope-modal-footer">
              <button
                className="codascope-btn codascope-btn-ghost"
                onClick={() => setShowChangeRootModal(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="codascope-btn codascope-btn-danger"
                disabled={changeRootConfirmText !== "CHANGE"}
                onClick={handleChangeRootConfirm}
                type="button"
              >
                Change Root Directory
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Folder picker for changing root */}
      <FolderPicker
        open={isAdmin && showChangeRootPicker}
        onClose={() => setShowChangeRootPicker(false)}
        onSelect={handleChangeRootSelect}
        mode="directory"
        title="Select New Projects Root Directory"
        initialPath={projectsRoot || undefined}
      />
    </div>
  );
}
