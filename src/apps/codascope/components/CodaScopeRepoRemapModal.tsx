/* ── CodaScope: Repo Remap Modal ──────────────────────────────────────
   Modal shown after importing a project when some repository paths
   don't exist on the current machine. Allows users to remap each
   repo to a local directory using the shared FolderPicker.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import { FolderPicker } from "../../../shared/folder-picker";
import { IconFolderOpen, IconCheck, IconWarning } from "./CodaScopeIcons";

interface UnmappedRepo {
  id: string;
  name: string;
  path: string;
}

interface RepoRemapModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  projectId: string;
  projectName: string;
  unmappedRepos: UnmappedRepo[];
}

export function CodaScopeRepoRemapModal({
  isOpen,
  onClose,
  onComplete,
  projectId,
  projectName,
  unmappedRepos,
}: RepoRemapModalProps) {
  // Track mapping state for each repo
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [savedRepos, setSavedRepos] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [activePicker, setActivePicker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allMapped = unmappedRepos.every((r) => savedRepos.has(r.id));

  const handlePathSelected = useCallback((repoId: string, selectedPath: string) => {
    setMappings((prev) => ({ ...prev, [repoId]: selectedPath }));
    setActivePicker(null);
  }, []);

  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    setError(null);

    try {
      // Save each mapping that hasn't been saved yet
      for (const repo of unmappedRepos) {
        const newPath = mappings[repo.id];
        if (!newPath || savedRepos.has(repo.id)) continue;

        const res = await fetch(`/api/codascope/projects/${projectId}/repositories/${repo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: newPath }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Failed to remap ${repo.name}`);
        }

        setSavedRepos((prev) => new Set([...prev, repo.id]));
      }

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save mappings");
    } finally {
      setSaving(false);
    }
  }, [unmappedRepos, mappings, savedRepos, projectId, onComplete]);

  if (!isOpen) return null;

  const mappedCount = unmappedRepos.filter(
    (r) => savedRepos.has(r.id) || !!mappings[r.id],
  ).length;

  return (
    <div className="codascope-modal-overlay" onClick={onClose}>
      <div
        className="codascope-modal codascope-remap-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="codascope-modal-header">
          <div className="codascope-modal-title">
            Map Repositories — {projectName}
          </div>
          <button
            className="codascope-modal-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="codascope-modal-body">
          <p className="codascope-remap-desc">
            Portable bundles do not contain source-machine repository paths.
            Map each repository to a local directory to enable full functionality.
          </p>

          <div className="codascope-remap-progress">
            {mappedCount} / {unmappedRepos.length} mapped
          </div>

          <div className="codascope-remap-list">
            {unmappedRepos.map((repo) => {
              const isSaved = savedRepos.has(repo.id);
              const newPath = mappings[repo.id];

              return (
                <div
                  key={repo.id}
                  className={`codascope-remap-item ${isSaved ? "codascope-remap-item--mapped" : ""}`}
                >
                  <div className="codascope-remap-item-header">
                    <div className="codascope-remap-item-status">
                      {isSaved ? (
                        <IconCheck size={14} />
                      ) : newPath ? (
                        <span className="codascope-remap-item-ready">●</span>
                      ) : (
                        <IconWarning size={14} />
                      )}
                    </div>
                    <div className="codascope-remap-item-info">
                      <div className="codascope-remap-item-name">{repo.name}</div>
                      <div className="codascope-remap-item-original">
                        {repo.path ? <>Previous path: <code>{repo.path}</code></> : "Local path required"}
                      </div>
                    </div>
                  </div>

                  {!isSaved && (
                    <div className="codascope-remap-item-action">
                      {newPath ? (
                        <div className="codascope-remap-item-newpath">
                          <code>{newPath}</code>
                          <button
                            className="codascope-btn codascope-btn-ghost codascope-remap-change-btn"
                            onClick={() => setActivePicker(repo.id)}
                            type="button"
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <button
                          className="codascope-btn codascope-btn-secondary"
                          onClick={() => setActivePicker(repo.id)}
                          type="button"
                        >
                          <IconFolderOpen size={12} /> Browse
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="codascope-remap-error">{error}</div>
          )}
        </div>

        <div className="codascope-modal-footer">
          <button
            className="codascope-btn codascope-btn-ghost"
            onClick={onClose}
            type="button"
          >
            {allMapped ? "Close" : "Skip (Fix Later)"}
          </button>
          {!allMapped && (
            <button
              className="codascope-btn codascope-btn-primary"
              onClick={handleSaveAll}
              disabled={saving || mappedCount === 0 || mappedCount === savedRepos.size}
              type="button"
            >
              {saving ? "Saving…" : `Save ${mappedCount - savedRepos.size} Mapping${mappedCount - savedRepos.size !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </div>

      {/* Folder picker overlay */}
      {activePicker && (
        <FolderPicker
          open={true}
          onClose={() => setActivePicker(null)}
          onSelect={(selectedPath: string) => handlePathSelected(activePicker, selectedPath)}
          mode="directory"
          title={`Select Local Path for "${unmappedRepos.find((r) => r.id === activePicker)?.name ?? "Repository"}"`}
        />
      )}
    </div>
  );
}
