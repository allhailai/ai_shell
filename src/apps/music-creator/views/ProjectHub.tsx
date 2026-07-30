import { useState } from "react";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog";
import { ProjectCard } from "../components/ProjectCard";
import { ConfirmResetStorageDialog } from "../components/storage/ConfirmResetStorageDialog";
import { LoadWarningsBanner } from "../components/storage/LoadWarningsBanner";
import { LoadingPanel } from "../components/storage/LoadingPanel";
import { StorageRecoveryPanel } from "../components/storage/StorageRecoveryPanel";
import { sortProjectsByUpdatedAt } from "../project/sortProjects";
import type { MusicProject, ProjectLoadWarning, StorageErrorCode } from "../types";

export interface ProjectHubProps {
  flashMessage?: string | null;
  onDismissFlash?: () => void;
  projects: MusicProject[];
  isLoading: boolean;
  loadError: StorageErrorCode | null;
  loadWarnings: ProjectLoadWarning[];
  actionError: string | null;
  onDismissActionError: () => void;
  onCreateProject: () => void;
  onOpenProject: (projectId: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onDuplicateProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onResetStorage: () => void;
  onRepairInvalidProjects: () => void;
}

/**
 * Project Hub — list, CRUD, and storage recovery UX (M2 complete after phase 2.6).
 *
 * States: loading | fatal load error (recovery panel) | warnings + list | empty | populated.
 */
export function ProjectHub({
  flashMessage,
  onDismissFlash,
  projects,
  isLoading,
  loadError,
  loadWarnings,
  actionError,
  onDismissActionError,
  onCreateProject,
  onOpenProject,
  onRenameProject,
  onDuplicateProject,
  onDeleteProject,
  onResetStorage,
  onRepairInvalidProjects,
}: ProjectHubProps) {
  // Local UI-only state — persistence happens in MusicCreatorContent callbacks.
  const [deleteTarget, setDeleteTarget] = useState<MusicProject | null>(null);
  const [resetStorageOpen, setResetStorageOpen] = useState(false);

  const sortedProjects = sortProjectsByUpdatedAt(projects);
  const hasProjects = sortedProjects.length > 0;
  // Disable create + card actions while loading or when storage cannot be read at all.
  const actionsDisabled = isLoading || loadError !== null;

  // loadError = fatal read; actionError = failed write (create/rename/duplicate/delete).
  return (
    <div
      className="music-creator-page music-creator-hub"
      role="region"
      aria-labelledby="music-creator-hub-heading"
    >
      <div className="music-creator-hub-inner">
        {/* Route flash (e.g. project not found) — from MusicCreatorContent */}
        {flashMessage ? (
          <StatusBanner message={flashMessage} onDismiss={onDismissFlash} />
        ) : null}

        {/* Failed write (saveStore) — create, rename, duplicate, delete, reset */}
        {actionError ? (
          <StatusBanner
            message={actionError}
            variant="error"
            onDismiss={onDismissActionError}
          />
        ) : null}

        {/* Non-fatal: some projects on disk failed validation — repair is explicit (phase 2.6) */}
        {!isLoading && loadWarnings.length > 0 && loadError === null ? (
          <LoadWarningsBanner
            warnings={loadWarnings}
            onRepair={onRepairInvalidProjects}
          />
        ) : null}

        <header className="music-creator-hub-header">
          <h1 id="music-creator-hub-heading" className="music-creator-title">
            Music Creator
          </h1>
          <p className="music-creator-subtitle">
            Create short loops with a drum sequencer and a simple melody grid.
          </p>
        </header>

        <div className="music-creator-hub-actions">
          <button
            type="button"
            className="music-creator-btn music-creator-btn-primary"
            onClick={onCreateProject}
            disabled={actionsDisabled}
          >
            New project
          </button>
        </div>

        {isLoading ? <LoadingPanel message="Loading projects…" /> : null}

        {/* Fatal load error — corrupt/unreadable store; reset is last resort */}
        {!isLoading && loadError ? (
          <StorageRecoveryPanel
            errorCode={loadError}
            onResetRequest={() => setResetStorageOpen(true)}
          />
        ) : null}

        {/* Mutually exclusive main content: project list OR empty state (not shown during load/error) */}
        {!isLoading && !loadError && hasProjects ? (
          <section aria-labelledby="music-creator-project-list-heading">
            <h2
              id="music-creator-project-list-heading"
              className="music-creator-section-title"
            >
              Your projects
            </h2>
            <ul className="music-creator-project-list">
              {sortedProjects.map((project) => (
                <li key={project.id}>
                  <ProjectCard
                    project={project}
                    actionsDisabled={actionsDisabled}
                    onOpen={onOpenProject}
                    onRename={onRenameProject}
                    onDuplicate={onDuplicateProject}
                    onDeleteRequest={setDeleteTarget}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!isLoading && !loadError && !hasProjects ? (
          <section
            className="music-creator-empty"
            aria-labelledby="music-creator-empty-heading"
          >
            <div className="music-creator-empty-icon" aria-hidden>
              <EmptyProjectsIcon />
            </div>
            <h2 id="music-creator-empty-heading" className="music-creator-empty-title">
              No saved projects yet
            </h2>
            <p className="music-creator-muted">
              Create a blank project to save it here. Projects are stored in this browser only.
            </p>
          </section>
        ) : null}
      </div>

      {deleteTarget ? (
        <ConfirmDeleteDialog
          projectName={deleteTarget.name}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            onDeleteProject(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      ) : null}

      {resetStorageOpen ? (
        <ConfirmResetStorageDialog
          onCancel={() => setResetStorageOpen(false)}
          onConfirm={() => {
            onResetStorage();
            setResetStorageOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function StatusBanner({
  message,
  variant = "warning",
  onDismiss,
}: {
  message: string;
  variant?: "warning" | "error";
  onDismiss?: () => void;
}) {
  return (
    <div
      className={`music-creator-banner music-creator-banner--${variant}`}
      role="status"
    >
      <p className="music-creator-banner-text">{message}</p>
      {onDismiss ? (
        <button
          type="button"
          className="music-creator-btn music-creator-btn-ghost music-creator-banner-dismiss"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

function EmptyProjectsIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
