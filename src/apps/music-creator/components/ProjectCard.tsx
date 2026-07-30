import { useEffect, useRef, useState } from "react";
import type { MusicProject } from "../types";
import { formatProjectUpdatedAt } from "../project/formatProject";

export interface ProjectCardProps {
  project: MusicProject;
  actionsDisabled?: boolean;
  onOpen: (projectId: string) => void;
  onRename: (projectId: string, name: string) => void;
  onDuplicate: (projectId: string) => void;
  onDeleteRequest: (project: MusicProject) => void;
}

/**
 * Hub project row — open via main area; rename/duplicate/delete via explicit actions.
 * Rename commits on Enter or blur (plan: hub rename saves immediately to store).
 */
export function ProjectCard({
  project,
  actionsDisabled = false,
  onOpen,
  onRename,
  onDuplicate,
  onDeleteRequest,
}: ProjectCardProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Keep draft in sync when parent refreshes after a successful rename.
  useEffect(() => {
    if (!isRenaming) setDraftName(project.name);
  }, [project.name, isRenaming]);

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  const cancelRename = () => {
    setDraftName(project.name);
    setIsRenaming(false);
  };

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      cancelRename();
      return;
    }
    if (trimmed !== project.name) {
      onRename(project.id, trimmed);
    }
    setIsRenaming(false);
  };

  return (
    <article className="music-creator-project-card">
      {isRenaming ? (
        <div className="music-creator-project-card-rename">
          <label className="music-creator-project-card-rename-label" htmlFor={`rename-${project.id}`}>
            Project name
          </label>
          <input
            id={`rename-${project.id}`}
            ref={renameInputRef}
            type="text"
            className="music-creator-input"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
              }
            }}
            onBlur={commitRename}
            disabled={actionsDisabled}
          />
        </div>
      ) : (
        <button
          type="button"
          className="music-creator-project-card-open"
          onClick={() => onOpen(project.id)}
          disabled={actionsDisabled}
        >
          <span className="music-creator-project-card-name">{project.name}</span>
          <span className="music-creator-project-card-meta">
            {project.tempo} BPM · Updated {formatProjectUpdatedAt(project.updatedAt)}
          </span>
        </button>
      )}

      <div className="music-creator-project-card-actions">
        <button
          type="button"
          className="music-creator-btn music-creator-btn-ghost music-creator-btn-sm"
          onClick={() => setIsRenaming(true)}
          disabled={actionsDisabled || isRenaming}
          aria-label={`Rename ${project.name}`}
        >
          Rename
        </button>
        <button
          type="button"
          className="music-creator-btn music-creator-btn-ghost music-creator-btn-sm"
          onClick={() => onDuplicate(project.id)}
          disabled={actionsDisabled || isRenaming}
          aria-label={`Duplicate ${project.name}`}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="music-creator-btn music-creator-btn-ghost music-creator-btn-sm music-creator-btn-danger-text"
          onClick={() => onDeleteRequest(project)}
          disabled={actionsDisabled || isRenaming}
          aria-label={`Delete ${project.name}`}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
