import { useCallback, useEffect, useState } from "react";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import { LoadingPanel } from "./components/storage/LoadingPanel";
import { createEmptyProject } from "./project/createProject";
import { duplicateProject, renameProject, commitStudioProject } from "./project/projectUtils";
import { isKnownProjectId, registerSessionProjectId } from "./routing/projectRoute";
import { loadStore, resetStore, saveStore } from "./storage/storage";
import type {
  MusicCreatorStoreEnvelope,
  MusicProject,
  ProjectLoadWarning,
  StorageErrorCode,
} from "./types";
import { ProjectHub } from "./views/ProjectHub";
import { Studio, type StudioSaveResult } from "./views/Studio";

const APP_ID = "music-creator";

/** In-memory snapshot of localStorage after loadStore (validated projects only). */
interface HubStoreState {
  envelope: MusicCreatorStoreEnvelope;
  warnings: ProjectLoadWarning[];
}

/**
 * Main router: Project Hub vs Studio workspace.
 * URL-driven via useAppSubRoute (preserves shell query params).
 *
 * Owns store load, hub CRUD, and recovery actions (reset / repair invalid entries).
 */
export function MusicCreatorContent() {
  const { segments, replace, navigate } = useAppSubRoute(APP_ID);

  // --- React state (hub + routing) ---
  // hubFlashMessage: one-shot banner after redirect (e.g. "Project not found")
  // storeState: last successful loadStore result (valid projects + load warnings)
  // storeLoadError: fatal load failure code — blocks CRUD until reset/fix
  // actionError: failed save — from saveStore message
  const [hubFlashMessage, setHubFlashMessage] = useState<string | null>(null);
  const [storeState, setStoreState] = useState<HubStoreState | null>(null);
  const [storeLoadError, setStoreLoadError] = useState<StorageErrorCode | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // URL segments: "" | "projects" → hub; "studio" / <id> → studio
  const section = segments[0] ?? "";
  const studioProjectId = section === "studio" ? (segments[1] ?? "") : "";

  /** Re-read localStorage; returns LoadedStore data or null on fatal error. */
  const refreshStore = useCallback(() => {
    const result = loadStore();
    if (result.ok) {
      setStoreState({
        envelope: result.data.envelope,
        warnings: result.data.warnings,
      });
      setStoreLoadError(null);
      return result.data;
    }

    setStoreState(null);
    setStoreLoadError(result.code);
    return null;
  }, []);

  // True once the first loadStore attempt finished (success or fatal error).
  const storeReady = storeState !== null || storeLoadError !== null;

  useEffect(() => {
    refreshStore();
  }, [refreshStore]);

  // Redirect unknown studio ids — but only after store load to avoid false
  // negatives on refresh (valid id in localStorage before storeState is set).
  useEffect(() => {
    if (segments.length === 0) {
      replace("projects");
      return;
    }
    if (section !== "studio") return;
    if (!storeReady) return;

    if (!studioProjectId) {
      replace("projects");
      return;
    }

    if (!isKnownProjectId(studioProjectId, storeState?.envelope)) {
      setHubFlashMessage("Project not found");
      replace("projects");
    }
  }, [
    segments.length,
    section,
    studioProjectId,
    replace,
    storeReady,
    storeState?.envelope,
  ]);

  /** Shared write path for all hub mutations — surfaces saveStore errors via actionError. */
  const persistEnvelope = useCallback(
    (envelope: MusicCreatorStoreEnvelope): boolean => {
      const saveResult = saveStore(envelope);
      if (!saveResult.ok) {
        setActionError(saveResult.message);
        return false;
      }

      refreshStore();
      setActionError(null);
      return true;
    },
    [refreshStore],
  );

  // Returns the loaded envelope, or null if storage failed to load.
  // Call before any CRUD handler that needs the current project list.
  const requireLoadedEnvelope = useCallback(() => {
    const loaded = storeState ?? refreshStore();
    if (!loaded) {
      setActionError("Projects could not be loaded — fix storage before continuing.");
      return null;
    }
    return loaded.envelope;
  }, [refreshStore, storeState]);

  /** Wipe localStorage to empty envelope — recovery from corrupt/unreadable store (phase 2.6). */
  const handleResetStorage = useCallback(() => {
    const result = resetStore();
    if (!result.ok) {
      setActionError(result.message);
      return;
    }

    refreshStore();
    setActionError(null);
    setHubFlashMessage("Storage reset — your project library is empty.");
  }, [refreshStore]);

  /**
   * Write validated envelope back to disk — removes invalid project keys explicitly.
   * loadStore never auto-repairs; this is the user-confirmed repair path.
   */
  const handleRepairInvalidProjects = useCallback(() => {
    if (!storeState || storeState.warnings.length === 0) return;

    persistEnvelope(storeState.envelope);
  }, [persistEnvelope, storeState]);

  const openStudio = useCallback(
    (projectId: string) => {
      registerSessionProjectId(projectId);
      setActionError(null);
      navigate(`studio/${projectId}`);
    },
    [navigate],
  );

  /** Create → saveStore → navigate. Save must succeed before leaving the hub. */
  const handleCreateProject = useCallback(() => {
    setActionError(null);

    const envelope = requireLoadedEnvelope();
    if (!envelope) return;

    const id = crypto.randomUUID();
    const project = createEmptyProject(id);
    const nextEnvelope: MusicCreatorStoreEnvelope = {
      ...envelope,
      projects: {
        ...envelope.projects,
        [id]: project,
      },
    };

    if (!persistEnvelope(nextEnvelope)) return;

    openStudio(id);
  }, [openStudio, persistEnvelope, requireLoadedEnvelope]);

  /** Hub rename — immediate save (separate from Studio explicit Save in M3). */
  const handleRenameProject = useCallback(
    (projectId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setActionError("Project name cannot be empty.");
        return;
      }

      const envelope = requireLoadedEnvelope();
      if (!envelope) return;

      const existing = envelope.projects[projectId];
      if (!existing) {
        setActionError("Project not found — it may have been deleted.");
        refreshStore();
        return;
      }

      if (trimmed === existing.name) return;

      const nextEnvelope: MusicCreatorStoreEnvelope = {
        ...envelope,
        projects: {
          ...envelope.projects,
          [projectId]: renameProject(existing, trimmed),
        },
      };

      persistEnvelope(nextEnvelope);
    },
    [persistEnvelope, refreshStore, requireLoadedEnvelope],
  );

  /** Duplicate → saveStore; user stays on hub (new card appears at top by updatedAt). */
  const handleDuplicateProject = useCallback(
    (projectId: string) => {
      const envelope = requireLoadedEnvelope();
      if (!envelope) return;

      const source = envelope.projects[projectId];
      if (!source) {
        setActionError("Project not found — it may have been deleted.");
        refreshStore();
        return;
      }

      const newId = crypto.randomUUID();
      const copy = duplicateProject(source, newId);
      const nextEnvelope: MusicCreatorStoreEnvelope = {
        ...envelope,
        projects: {
          ...envelope.projects,
          [newId]: copy,
        },
      };

      persistEnvelope(nextEnvelope);
    },
    [persistEnvelope, refreshStore, requireLoadedEnvelope],
  );

  /** Delete after ConfirmDeleteDialog — removes key from envelope then saveStore. */
  const handleDeleteProject = useCallback(
    (projectId: string) => {
      const envelope = requireLoadedEnvelope();
      if (!envelope) return;

      if (!envelope.projects[projectId]) {
        refreshStore();
        return;
      }

      const { [projectId]: removed, ...remainingProjects } = envelope.projects;
      void removed;

      const nextEnvelope: MusicCreatorStoreEnvelope = {
        ...envelope,
        projects: remainingProjects,
      };

      persistEnvelope(nextEnvelope);
    },
    [persistEnvelope, refreshStore, requireLoadedEnvelope],
  );

  /**
   * Studio explicit Save — merge workingCopy into envelope, touch updatedAt, saveStore.
   * Separate from hub rename (immediate) and from autosave (post-MVP).
   */
  const handleSaveStudioProject = useCallback(
    (project: MusicProject): StudioSaveResult => {
      const envelope = requireLoadedEnvelope();
      if (!envelope) {
        return {
          ok: false,
          message: "Projects could not be loaded — fix storage before saving.",
        };
      }

      if (!envelope.projects[project.id]) {
        refreshStore();
        return {
          ok: false,
          message: "Project not found — it may have been deleted.",
        };
      }

      const trimmed = project.name.trim();
      if (!trimmed) {
        return { ok: false, message: "Project name cannot be empty." };
      }

      const committed = commitStudioProject(project);
      const nextEnvelope: MusicCreatorStoreEnvelope = {
        ...envelope,
        projects: {
          ...envelope.projects,
          [project.id]: committed,
        },
      };

      const saveResult = saveStore(nextEnvelope);
      if (!saveResult.ok) {
        setActionError(saveResult.message);
        return { ok: false, message: saveResult.message };
      }

      refreshStore();
      setActionError(null);
      return { ok: true };
    },
    [refreshStore, requireLoadedEnvelope],
  );

  // --- Render: pick hub vs studio vs unknown route ---
  if (section === "" || section === "projects") {
    // Hub is presentational — all persistence logic lives in handlers above.
    return (
      <ProjectHub
        flashMessage={hubFlashMessage}
        onDismissFlash={() => setHubFlashMessage(null)}
        projects={storeState ? Object.values(storeState.envelope.projects) : []}
        isLoading={!storeReady}
        loadError={storeLoadError}
        loadWarnings={storeState?.warnings ?? []}
        actionError={actionError}
        onDismissActionError={() => setActionError(null)}
        onCreateProject={handleCreateProject}
        onOpenProject={openStudio}
        onRenameProject={handleRenameProject}
        onDuplicateProject={handleDuplicateProject}
        onDeleteProject={handleDeleteProject}
        onResetStorage={handleResetStorage}
        onRepairInvalidProjects={handleRepairInvalidProjects}
      />
    );
  }

  if (section === "studio") {
    // Wait for loadStore before validating id (avoids redirecting valid deep links too early).
    if (!storeReady) {
      return (
        <div className="music-creator-page music-creator-studio" role="region" aria-busy="true">
          <LoadingPanel message="Loading project…" />
        </div>
      );
    }

    if (!studioProjectId || !isKnownProjectId(studioProjectId, storeState?.envelope)) {
      return null;
    }

    const savedProject = storeState?.envelope.projects[studioProjectId];

    return (
      <Studio
        projectId={studioProjectId}
        savedProject={savedProject}
        onSaveProject={handleSaveStudioProject}
        onBackToProjects={() => navigate("projects")}
      />
    );
  }

  return (
    <div
      className="music-creator-page"
      role="region"
      aria-labelledby="music-creator-unknown-route-heading"
    >
      <div className="music-creator-panel music-creator-panel--center">
        <h1 id="music-creator-unknown-route-heading" className="music-creator-title">
          Unknown route
        </h1>
        <p className="music-creator-muted">
          This path is not recognized. Return to the project hub to continue.
        </p>
        <button
          type="button"
          className="music-creator-btn music-creator-btn-primary"
          onClick={() => navigate("projects")}
        >
          Go to projects
        </button>
      </div>
    </div>
  );
}
