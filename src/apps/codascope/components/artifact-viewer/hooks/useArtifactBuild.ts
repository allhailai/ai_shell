/* ── useArtifactBuild ─────────────────────────────────────────────────
   Manages the build lifecycle for artifact construction and rebuild.
   Extracted from ArtifactViewer to reduce component complexity.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useRef, useEffect } from "react";
import type { ArtifactSpec, ArtifactBuildProgress, ArtifactAnnotation } from "../../../codaScopeTypes.js";
import * as api from "../artifactApi";

interface UseArtifactBuildOptions {
  projectId: string;
  epicId: string;
  artifactId: string;
  artifact: ArtifactSpec | null;
  hiddenSectionIds: string[];
  annotations: ArtifactAnnotation[];
  loadArtifact: () => Promise<ArtifactSpec | null>;
  flash: (message: string) => void;
}

interface UseArtifactBuildReturn {
  building: boolean;
  buildProgress: ArtifactBuildProgress | null;
  showRebuildWarning: boolean;
  previewKey: number;
  handleBuild: () => Promise<void>;
  setShowRebuildWarning: (show: boolean) => void;
  /** Call after sections are loaded to trigger a rebuild from the annotation batch flow. */
  startBuildSubscription: (
    onDone: () => void,
    onError: (err: Error) => void,
  ) => void;
}

export function useArtifactBuild({
  projectId,
  epicId,
  artifactId,
  artifact,
  hiddenSectionIds,
  annotations,
  loadArtifact,
  flash,
}: UseArtifactBuildOptions): UseArtifactBuildReturn {
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState<ArtifactBuildProgress | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [showRebuildWarning, setShowRebuildWarning] = useState(false);

  const sseCleanupRef = useRef<(() => void) | null>(null);
  const isBuilt = artifact?.status === "built";

  const handleBuild = useCallback(async () => {
    if (!artifact) return;

    // Check for modifications and show warning
    const hasModifications =
      hiddenSectionIds.length > 0 ||
      annotations.some((a) => a.status === "applied" && a.type === "add_section");

    if (hasModifications && isBuilt && !showRebuildWarning) {
      setShowRebuildWarning(true);
      return;
    }
    setShowRebuildWarning(false);

    setBuilding(true);
    setBuildProgress(null);
    try {
      await api.triggerBuild(
        projectId,
        epicId,
        artifactId,
      );

      // Subscribe to SSE build status
      sseCleanupRef.current?.();
      sseCleanupRef.current = api.subscribeBuildStatus(
        projectId,
        epicId,
        artifactId,
        (progress) => setBuildProgress(progress),
        () => {
          // Build done
          setBuilding(false);
          setBuildProgress(null);
          void loadArtifact();
          setPreviewKey((k) => k + 1);
          flash("Build complete ✓");
        },
        (err) => {
          setBuilding(false);
          flash(err.message);
        },
      );

      flash("Build started — agent is generating HTML…");
    } catch (err) {
      setBuilding(false);
      flash(err instanceof Error ? err.message : "Build failed");
    }
  }, [
    artifact,
    projectId,
    epicId,
    artifactId,
    hiddenSectionIds,
    annotations,
    isBuilt,
    showRebuildWarning,
    loadArtifact,
    flash,
  ]);

  const startBuildSubscription = useCallback(
    (onDone: () => void, onError: (err: Error) => void) => {
      setBuilding(true);
      setBuildProgress(null);

      sseCleanupRef.current?.();
      sseCleanupRef.current = api.subscribeBuildStatus(
        projectId,
        epicId,
        artifactId,
        (progress) => setBuildProgress(progress),
        () => {
          setBuilding(false);
          setBuildProgress(null);
          setPreviewKey((k) => k + 1);
          onDone();
        },
        (err) => {
          setBuilding(false);
          setBuildProgress(null);
          onError(err);
        },
      );
    },
    [projectId, epicId, artifactId],
  );

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      sseCleanupRef.current?.();
    };
  }, []);

  return {
    building,
    buildProgress,
    showRebuildWarning,
    previewKey,
    handleBuild,
    setShowRebuildWarning,
    startBuildSubscription,
  };
}
