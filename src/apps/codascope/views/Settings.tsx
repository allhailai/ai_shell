/* ── CodaScope: Settings View ─────────────────────────────────────────
   Project settings, repository management, and version management.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { FolderPicker } from "../../../shared/folder-picker";

export function Settings() {
  const {
    activeProjectId,
    projects,
    setProjects,
  } = useCodaScopeStore();

  const project = projects.find((p) => p.id === activeProjectId);
  const [repoPath, setRepoPath] = useState("");
  const [repoName, setRepoName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  // ── Add repository ────────────────────────────────────────────────

  const handleAddRepo = useCallback(async () => {
    if (!activeProjectId || !repoPath.trim()) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/repositories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: repoName.trim() || repoPath.split("/").pop() || "repo",
          path: repoPath.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const updated = projects.map((p) =>
          p.id === activeProjectId
            ? { ...p, repositories: [...p.repositories, data.repository] }
            : p,
        );
        setProjects(updated);
        setRepoPath("");
        setRepoName("");
      }
    } catch {
      // Silently fail
    }
  }, [activeProjectId, repoPath, repoName, projects, setProjects]);

  // ── Remove repository ─────────────────────────────────────────────

  const handleRemoveRepo = useCallback(async (repoId: string) => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/repositories/${repoId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const updated = projects.map((p) =>
          p.id === activeProjectId
            ? { ...p, repositories: p.repositories.filter((r) => r.id !== repoId) }
            : p,
        );
        setProjects(updated);
      }
    } catch {
      // Silently fail
    }
  }, [activeProjectId, projects, setProjects]);

  // ── Save project settings ─────────────────────────────────────────

  const [editName, setEditName] = useState(project?.name ?? "");
  const [editDesc, setEditDesc] = useState(project?.description ?? "");

  const handleSaveProject = useCallback(async () => {
    if (!activeProjectId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() }),
      });
      if (res.ok) {
        const updated = projects.map((p) =>
          p.id === activeProjectId
            ? { ...p, name: editName.trim(), description: editDesc.trim() }
            : p,
        );
        setProjects(updated);
      }
    } catch {
      // Silently fail
    } finally {
      setSaving(false);
    }
  }, [activeProjectId, editName, editDesc, projects, setProjects]);

  // ── Folder picker selection handler ───────────────────────────────

  const handleFolderSelected = useCallback((selectedPath: string) => {
    setRepoPath(selectedPath);
    // Auto-suggest a name from the folder basename if name is empty
    if (!repoName.trim()) {
      const basename = selectedPath.split("/").filter(Boolean).pop() ?? "repo";
      setRepoName(basename);
    }
  }, [repoName]);

  if (!project) {
    return (
      <div className="codascope-empty-state">
        <div className="codascope-empty-state-icon">⚙️</div>
        <div className="codascope-empty-state-title">No Project Selected</div>
        <div className="codascope-empty-state-text">
          Select a project to manage its settings.
        </div>
      </div>
    );
  }

  return (
    <div className="codascope-page">
      <div className="codascope-page-header">
        <div className="codascope-page-title">Settings</div>
      </div>

      {/* Project info */}
      <div style={{
        padding: "var(--space-5)",
        marginBottom: "var(--space-6)",
        borderRadius: "var(--radius-xl)",
        background: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border-primary)",
      }}>
        <div style={{
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--color-text-primary)",
          marginBottom: "var(--space-4)",
        }}>
          Project Details
        </div>
        <div className="codascope-form-group">
          <label className="codascope-form-label" htmlFor="settings-name">Name</label>
          <input
            className="codascope-form-input"
            id="settings-name"
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
        </div>
        <div className="codascope-form-group">
          <label className="codascope-form-label" htmlFor="settings-desc">Description</label>
          <input
            className="codascope-form-input"
            id="settings-desc"
            type="text"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
          />
        </div>
        <button
          className="codascope-btn codascope-btn-primary"
          onClick={handleSaveProject}
          disabled={saving}
          type="button"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>

      {/* Repositories */}
      <div style={{
        padding: "var(--space-5)",
        marginBottom: "var(--space-6)",
        borderRadius: "var(--radius-xl)",
        background: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border-primary)",
      }}>
        <div style={{
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--color-text-primary)",
          marginBottom: "var(--space-4)",
        }}>
          Repositories ({project.repositories.length})
        </div>

        {project.repositories.map((repo) => (
          <div key={repo.id} style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "var(--space-3) var(--space-4)",
            marginBottom: "var(--space-2)",
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-tertiary)",
          }}>
            <div>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)", color: "var(--color-text-primary)" }}>
                {repo.name}
              </div>
              <div style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>
                {repo.path}
              </div>
            </div>
            <button
              className="codascope-btn codascope-btn-ghost"
              style={{ fontSize: "var(--text-xs)", color: "var(--color-danger)" }}
              onClick={() => handleRemoveRepo(repo.id)}
              type="button"
            >
              Remove
            </button>
          </div>
        ))}

        {/* Add repo form */}
        <div style={{
          display: "flex",
          gap: "var(--space-3)",
          marginTop: "var(--space-4)",
          alignItems: "flex-end",
        }}>
          <div style={{ flex: 1 }}>
            <label className="codascope-form-label" htmlFor="repo-path">Repository Path</label>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <input
                className="codascope-form-input"
                id="repo-path"
                type="text"
                placeholder="/path/to/repository"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="codascope-btn codascope-btn-secondary"
                onClick={() => setShowFolderPicker(true)}
                type="button"
                title="Browse filesystem to select a repository folder"
                style={{ whiteSpace: "nowrap", flexShrink: 0 }}
              >
                📂 Browse
              </button>
            </div>
          </div>
          <div style={{ width: "200px" }}>
            <label className="codascope-form-label" htmlFor="repo-name">Name (optional)</label>
            <input
              className="codascope-form-input"
              id="repo-name"
              type="text"
              placeholder="frontend"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
            />
          </div>
          <button
            className="codascope-btn codascope-btn-secondary"
            onClick={handleAddRepo}
            disabled={!repoPath.trim()}
            type="button"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Folder Picker dialog */}
      <FolderPicker
        open={showFolderPicker}
        onClose={() => setShowFolderPicker(false)}
        onSelect={handleFolderSelected}
        mode="directory"
        title="Select Repository Folder"
        initialPath={repoPath || undefined}
      />
    </div>
  );
}
