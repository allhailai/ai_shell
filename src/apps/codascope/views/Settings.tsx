/* ── CodaScope: Settings View ─────────────────────────────────────────
   Project settings, repository management, and version management.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useRef } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { FolderPicker } from "../../../shared/folder-picker";
import { IconSettings, IconKey, IconPackage, IconFolderOpen, IconPalette, IconPlus, IconCheck, IconClose, IconRefresh, IconWarning } from "../components/CodaScopeIcons";

export function Settings() {
  const {
    activeProjectId,
    projects,
    setProjects,
    projectsRoot,
    setProjectsRoot,
  } = useCodaScopeStore();

  const project = projects.find((p) => p.id === activeProjectId);
  const [repoPath, setRepoPath] = useState("");
  const [repoName, setRepoName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  // ── Remove confirmation modal state ─────────────────────────────────
  const [pendingRemoveRepo, setPendingRemoveRepo] = useState<{ id: string; name: string } | null>(null);
  const [removeConfirmText, setRemoveConfirmText] = useState("");

  // ── Projects root state ─────────────────────────────────────────────

  const [editingRoot, setEditingRoot] = useState(false);
  const [newRoot, setNewRoot] = useState(projectsRoot);
  const [rootSaving, setRootSaving] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const [showRootFolderPicker, setShowRootFolderPicker] = useState(false);

  // ── Highlight Colors state ──────────────────────────────────────────

  interface HighlightColor {
    name: string;
    label: string;
    cssColor: string;
  }

  const DEFAULT_HIGHLIGHT_PALETTE: HighlightColor[] = [
    { name: "yellow", label: "Yellow", cssColor: "hsla(45, 90%, 55%, 0.5)" },
    { name: "red", label: "Red", cssColor: "hsla(0, 80%, 55%, 0.5)" },
    { name: "green", label: "Green", cssColor: "hsla(140, 70%, 45%, 0.5)" },
  ];

  const [highlightColors, setHighlightColors] = useState<HighlightColor[]>([]);
  const [highlightLoaded, setHighlightLoaded] = useState(false);
  const [highlightSaving, setHighlightSaving] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Load optional highlight colors without treating an unset palette as an error.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/codascope/settings/highlight-colors");
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.colors)) {
            setHighlightColors(data.colors);
          }
        }
      } catch {
        // Network error
      } finally {
        if (!cancelled) setHighlightLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveHighlightColors = useCallback(async (colors: HighlightColor[]) => {
    setHighlightSaving(true);
    try {
      await fetch("/api/secrets/app/codascope/highlight_colors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(colors) }),
      });
    } catch {
      // Silently fail
    } finally {
      setHighlightSaving(false);
    }
  }, []);

  const handleAddHighlightColor = useCallback((hexColor: string) => {
    // Convert hex to a name (use the hex itself as name, sanitized)
    const name = hexColor.replace("#", "").toLowerCase();
    const label = hexColor.toUpperCase();
    const newColor: HighlightColor = {
      name,
      label,
      cssColor: hexColor,
    };
    const updated = [...highlightColors, newColor];
    setHighlightColors(updated);
    saveHighlightColors(updated);
  }, [highlightColors, saveHighlightColors]);

  const handleRemoveHighlightColor = useCallback((index: number) => {
    const updated = highlightColors.filter((_, i) => i !== index);
    setHighlightColors(updated);
    saveHighlightColors(updated);
  }, [highlightColors, saveHighlightColors]);

  // ── API Key state ───────────────────────────────────────────────────

  const [apiKey, setApiKey] = useState("");
  const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyRefreshToken, setApiKeyRefreshToken] = useState(0);
  const [apiKeyStatus, setApiKeyStatus] = useState<{
    state: "idle" | "validating" | "valid" | "error";
    modelCount?: number;
    error?: string;
  }>({ state: "idle" });

  // Load existing key + validate on mount and after save
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/secrets/app/codascope/cursor_api_key");
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (data.value) {
            const val = data.value as string;
            setApiKeyMasked(val.slice(0, 8) + "•".repeat(Math.max(0, val.length - 12)) + val.slice(-4));
            // Auto-validate the existing key
            setApiKeyStatus({ state: "validating" });
            try {
              const vRes = await fetch("/api/codascope/validate-api-key", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: val }),
              });
              if (cancelled) return;
              if (vRes.ok) {
                const vData = await vRes.json();
                if (vData.valid) {
                  setApiKeyStatus({ state: "valid", modelCount: vData.modelCount });
                } else {
                  setApiKeyStatus({ state: "error", error: vData.error });
                }
              } else {
                setApiKeyStatus({ state: "error", error: "Failed to validate key" });
              }
            } catch {
              if (!cancelled) setApiKeyStatus({ state: "error", error: "Network error during validation" });
            }
          } else {
            setApiKeyMasked(null);
            setApiKeyStatus({ state: "idle" });
          }
        } else {
          setApiKeyMasked(null);
          setApiKeyStatus({ state: "idle" });
        }
      } catch {
        if (!cancelled) {
          setApiKeyMasked(null);
          setApiKeyStatus({ state: "idle" });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [apiKeyRefreshToken]);

  const handleSaveApiKey = useCallback(async () => {
    const key = apiKey.trim();
    if (!key) return;

    setApiKeySaving(true);
    setApiKeyStatus({ state: "validating" });

    try {
      // Step 1: Validate the key first
      const vRes = await fetch("/api/codascope/validate-api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });

      if (!vRes.ok) {
        setApiKeyStatus({ state: "error", error: "Validation request failed" });
        return;
      }

      const vData = await vRes.json();

      if (!vData.valid) {
        // Key is invalid — show the error, do NOT save
        setApiKeyStatus({ state: "error", error: vData.error });
        return;
      }

      // Step 2: Key is valid — persist it
      const res = await fetch("/api/secrets/app/codascope/cursor_api_key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: key }),
      });

      if (res.ok) {
        setApiKey("");
        setApiKeyStatus({ state: "valid", modelCount: vData.modelCount });
        setApiKeyRefreshToken((v) => v + 1); // Re-fetch masked value
      } else {
        setApiKeyStatus({ state: "error", error: "Failed to save key" });
      }
    } catch {
      setApiKeyStatus({ state: "error", error: "Network error" });
    } finally {
      setApiKeySaving(false);
    }
  }, [apiKey]);

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

  const handleFolderSelected = useCallback(async (selectedPath: string) => {
    if (!activeProjectId || !selectedPath.trim()) return;
    const name = repoName.trim() || selectedPath.split("/").filter(Boolean).pop() || "repo";
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/repositories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, path: selectedPath.trim() }),
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
      // Fall back to just filling the fields so user can retry manually
      setRepoPath(selectedPath);
      if (!repoName.trim()) {
        const basename = selectedPath.split("/").filter(Boolean).pop() ?? "repo";
        setRepoName(basename);
      }
    }
  }, [activeProjectId, repoName, projects, setProjects]);

  if (!project) {
    return (
      <div className="codascope-empty-state">
        <div className="codascope-empty-state-icon"><IconSettings size={32} /></div>
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

      {/* Cursor API Key */}
      <div id="api-key-section" className="codascope-settings-section">
        <div className="codascope-settings-section-title">
          <IconKey size={14} /> Cursor API Key
          {apiKeyStatus.state === "valid" && (
            <span className="codascope-api-key-badge codascope-api-key-badge--valid">
              <IconCheck size={12} /> Connected · {apiKeyStatus.modelCount} models
            </span>
          )}
          {apiKeyStatus.state === "validating" && (
            <span className="codascope-api-key-badge codascope-api-key-badge--validating">
              <IconRefresh size={12} /> Validating…
            </span>
          )}
          {apiKeyStatus.state === "error" && (
            <span className="codascope-api-key-badge codascope-api-key-badge--error">
              <IconClose size={12} /> Invalid
            </span>
          )}
        </div>
        <div className="codascope-settings-section-desc">
          Required for agent features, the assistant panel, and wiki builds.
        </div>

        {/* Status detail */}
        {apiKeyStatus.state === "error" && apiKeyStatus.error && (
          <div className="codascope-api-key-error">
            {apiKeyStatus.error}
          </div>
        )}

        {apiKeyMasked && (
          <div className="codascope-settings-api-key-current">
            <span className="codascope-settings-api-key-label">Current key:</span>
            <code className="codascope-settings-api-key-value">{apiKeyMasked}</code>
          </div>
        )}
        <div className="codascope-settings-input-row">
          <div className="codascope-settings-flex-1">
            <label className="codascope-form-label" htmlFor="cursor-api-key">
              {apiKeyMasked ? "Replace API Key" : "Enter API Key"}
            </label>
            <input
              className="codascope-form-input"
              id="cursor-api-key"
              type="password"
              placeholder="cur_xxxxxxxxxxxxxxxx"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </div>
          <button
            className="codascope-btn codascope-btn-primary codascope-settings-save-key-btn"
            onClick={handleSaveApiKey}
            disabled={apiKeySaving || !apiKey.trim()}
            type="button"
          >
            {apiKeySaving ? "Validating…" : "Save Key"}
          </button>
        </div>
      </div>

      {/* Projects Root Directory */}
      <div className="codascope-settings-section">
        <div className="codascope-settings-section-title">
          <IconFolderOpen size={14} /> Projects Root Directory
        </div>
        <div className="codascope-settings-section-desc">
          All CodaScope project data (wiki, build logs, code maps, conversations) is stored in this directory.
        </div>
        {!editingRoot ? (
          <div className="codascope-settings-root-display">
            <code className="codascope-settings-api-key-value codascope-settings-flex-1">{projectsRoot || "(not set)"}</code>
            <button
              className="codascope-btn codascope-btn-ghost"
              onClick={() => { setNewRoot(projectsRoot); setEditingRoot(true); setRootError(null); }}
              type="button"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="codascope-settings-root-edit">
            <div className="codascope-settings-root-edit-row">
              <input
                className="codascope-form-input codascope-settings-flex-1"
                id="projects-root-input"
                type="text"
                value={newRoot}
                onChange={(e) => setNewRoot(e.target.value)}
                placeholder="/path/to/codascope_projects"
              />
              <button
                className="codascope-btn codascope-btn-ghost"
                onClick={() => setShowRootFolderPicker(true)}
                type="button"
                title="Browse filesystem"
              >
                <IconFolderOpen size={12} /> Browse
              </button>
            </div>
            {rootError && (
              <div className="codascope-settings-root-error">{rootError}</div>
            )}
            <div className="codascope-settings-root-actions">
              <button
                className="codascope-btn codascope-btn-primary"
                disabled={rootSaving || !newRoot.trim() || newRoot.trim() === projectsRoot}
                onClick={async () => {
                  setRootSaving(true);
                  setRootError(null);
                  try {
                    const res = await fetch("/api/codascope/config", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ projectsRoot: newRoot.trim() }),
                    });
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      throw new Error(data.error ?? "Failed to update");
                    }
                    setProjectsRoot(newRoot.trim());
                    setEditingRoot(false);
                  } catch (err) {
                    setRootError(err instanceof Error ? err.message : "Failed to update");
                  } finally {
                    setRootSaving(false);
                  }
                }}
                type="button"
              >
                {rootSaving ? "Saving…" : "Save"}
              </button>
              <button
                className="codascope-btn codascope-btn-ghost"
                onClick={() => { setEditingRoot(false); setRootError(null); }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Project info */}
      <div className="codascope-settings-section">
        <div className="codascope-settings-section-title">
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
        <div className="codascope-settings-project-actions">
          <button
            className="codascope-btn codascope-btn-primary"
            onClick={handleSaveProject}
            disabled={saving}
            type="button"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <button
            className="codascope-btn codascope-btn-secondary"
            onClick={() => {
              const a = document.createElement("a");
              a.href = `/api/codascope/projects/${activeProjectId}/export`;
              a.download = "";
              document.body.appendChild(a);
              a.click();
              a.remove();
            }}
            type="button"
            title="Download this project as a portable .zip file"
          >
            ↓ Export Project
          </button>
        </div>
      </div>

      {/* Note Highlight Colors */}
      <div className="codascope-settings-section">
        <div className="codascope-settings-section-title">
          <IconPalette size={14} /> Note Highlight Colors
          {highlightSaving && (
            <span className="codascope-api-key-badge codascope-api-key-badge--validating">
              Saving…
            </span>
          )}
        </div>
        <div className="codascope-settings-section-desc">
          Default highlight colors available in the formatting toolbar color picker.
          These colors can be used with the syntax <code>==text=={'{.colorname}'}</code>.
        </div>

        <div className="codascope-settings-highlight-colors">
          {/* Default palette (non-removable) */}
          {DEFAULT_HIGHLIGHT_PALETTE.map((color) => (
            <div
              key={color.name}
              className="codascope-settings-highlight-swatch"
              style={{ backgroundColor: color.cssColor }}
              title={`${color.label} (default)`}
            >
              <span className="codascope-settings-highlight-swatch-label">{color.label.slice(0, 3)}</span>
            </div>
          ))}

          {/* Custom colors (removable) */}
          {highlightLoaded && highlightColors.map((color, index) => (
            <div
              key={`custom-${color.name}`}
              className="codascope-settings-highlight-swatch"
              style={{ backgroundColor: color.cssColor }}
              title={color.label}
            >
              <button
                className="codascope-settings-highlight-swatch-remove"
                onClick={() => handleRemoveHighlightColor(index)}
                type="button"
                title="Remove color"
              >
                ×
              </button>
            </div>
          ))}

          {/* Add color button */}
          <button
            className="codascope-settings-highlight-add-btn"
            onClick={() => colorInputRef.current?.click()}
            type="button"
            title="Add custom highlight color"
          >
            <IconPlus size={14} />
          </button>
          <input
            ref={colorInputRef}
            className="codascope-settings-highlight-color-input"
            type="color"
            value="#ff9900"
            onChange={(e) => handleAddHighlightColor(e.target.value)}
          />
        </div>
      </div>

      {/* Repositories */}
      <div id="repos-section" className="codascope-settings-section">
        <div className="codascope-settings-section-title">
          <IconPackage size={14} /> Repositories ({project.repositories.length})
        </div>

        {project.repositories.map((repo) => (
          <div key={repo.id} className="codascope-settings-repo-row">
            <div>
              <div className="codascope-settings-repo-name">
                {repo.name}
              </div>
              <div className="codascope-settings-repo-path">
                {repo.path}
              </div>
            </div>
            <button
              className="codascope-btn codascope-btn-ghost codascope-settings-repo-remove"
              onClick={() => {
                setPendingRemoveRepo({ id: repo.id, name: repo.name });
                setRemoveConfirmText("");
              }}
              type="button"
            >
              Remove
            </button>
          </div>
        ))}

        {/* Add repo form */}
        <div className="codascope-settings-add-repo-form">
          <div className="codascope-settings-flex-1">
            <label className="codascope-form-label" htmlFor="repo-path">Repository Path</label>
            <div className="codascope-settings-repo-path-input-row">
              <input
                className="codascope-form-input codascope-settings-flex-1"
                id="repo-path"
                type="text"
                placeholder="/path/to/repository"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
              />
              <button
                className="codascope-btn codascope-btn-secondary codascope-settings-browse-btn"
                onClick={() => setShowFolderPicker(true)}
                type="button"
                title="Browse filesystem to select a repository folder"
              >
                <IconFolderOpen size={12} /> Browse
              </button>
            </div>
          </div>
          <div className="codascope-settings-repo-name-col">
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

      {/* Folder Picker for repo */}
      <FolderPicker
        open={showFolderPicker}
        onClose={() => setShowFolderPicker(false)}
        onSelect={handleFolderSelected}
        mode="directory"
        title="Select Repository Folder"
        initialPath={repoPath || undefined}
      />

      {/* Folder Picker for projects root */}
      <FolderPicker
        open={showRootFolderPicker}
        onClose={() => setShowRootFolderPicker(false)}
        onSelect={(selectedPath: string) => {
          setNewRoot(selectedPath);
          setShowRootFolderPicker(false);
        }}
        mode="directory"
        title="Select Projects Root Directory"
        initialPath={newRoot || projectsRoot || undefined}
      />

      {/* ── Remove repository confirmation modal ──────────────────────── */}
      {pendingRemoveRepo && (
        <div
          className="codascope-modal-overlay"
          onClick={() => setPendingRemoveRepo(null)}
        >
          <div
            className="codascope-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="codascope-modal-header">
              <div className="codascope-modal-title codascope-settings-remove-modal-title">
                <IconWarning size={15} /> Remove Repository
              </div>
              <button
                className="codascope-modal-close"
                onClick={() => setPendingRemoveRepo(null)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="codascope-modal-body">
              <p className="codascope-settings-remove-modal-text">
                You are about to remove <strong>{pendingRemoveRepo.name}</strong> from
                this project. This action cannot be undone.
              </p>
              <label
                className="codascope-form-label"
                htmlFor="remove-repo-confirm"
              >
                Type <strong>YES</strong> to confirm
              </label>
              <input
                className="codascope-form-input codascope-settings-remove-confirm-input"
                id="remove-repo-confirm"
                type="text"
                autoFocus
                placeholder="YES"
                value={removeConfirmText}
                onChange={(e) => setRemoveConfirmText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && removeConfirmText === "YES") {
                    handleRemoveRepo(pendingRemoveRepo.id);
                    setPendingRemoveRepo(null);
                  }
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="codascope-modal-footer">
              <button
                className="codascope-btn codascope-btn-ghost"
                onClick={() => setPendingRemoveRepo(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="codascope-btn codascope-btn-danger"
                disabled={removeConfirmText !== "YES"}
                onClick={() => {
                  handleRemoveRepo(pendingRemoveRepo.id);
                  setPendingRemoveRepo(null);
                }}
                type="button"
              >
                Remove Repository
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
