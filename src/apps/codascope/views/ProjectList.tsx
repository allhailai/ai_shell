/* ── CodaScope: ProjectList View ──────────────────────────────────────
   Shows the project list as cards, plus first-launch setup wizard
   for configuring the projects root directory.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { IconFolder } from "../components/CodaScopeIcons";

export function ProjectList() {
  const { navigate } = useAppSubRoute("codascope");
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
        setProjectsRoot(path);
        setConfigured(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to save configuration.");
      }
    } catch {
      setError("Network error. Is the server running?");
    }
  }, [setupPath, setProjectsRoot, setConfigured]);

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

  // ── Setup wizard (first launch) ───────────────────────────────────

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
            <input
              className="codascope-form-input"
              id="codascope-root-path"
              type="text"
              placeholder="/path/to/codascope_projects"
              value={setupPath}
              onChange={(e) => setSetupPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSetup()}
            />
            <div className="codascope-form-hint">
              CodaScope will create a <code>codascope_projects</code> folder here for all project data (wiki pages, quality reports, etc).
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
            {projects.length} project{projects.length !== 1 ? "s" : ""} • {projectsRoot}
          </div>
        </div>
        <button
          className="codascope-btn codascope-btn-primary"
          onClick={() => setShowCreate(true)}
          type="button"
        >
          + New Project
        </button>
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

      {projects.length === 0 ? (
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
        <div className="codascope-cards">
          {projects.map((project) => (
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
                  <div className="codascope-card-stat-value">{project.conceptCount ?? 0}</div>
                  <div className="codascope-card-stat-label">Concepts</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
