/* ── CodaScope: useArtifactBuild ──────────────────────────────────────
   Hook encapsulating artifact build lifecycle:
   - Trigger build → subscribe to SSE → track progress → complete
   - Save spec changes
   - Rebuild warning modal state
   Extracted from ArtifactViewer.tsx.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  ArtifactSpec,
  ArtifactBuildProgress,
  ArtifactAnnotation,
} from "../../codaScopeTypes.js";
import * as api from "./artifactApi";

/* ── Types ────────────────────────────────────────────────────────── */

export interface UseArtifactBuildOpts {
  projectId: string;
  epicId: string;
  artifactId: string;
  artifact: ArtifactSpec | null;
  hiddenSectionIds: string[];
  annotations: ArtifactAnnotation[];
  flash: (msg: string) => void;
  onBuildComplete: () => void;
}

export interface UseArtifactBuildReturn {
  building: boolean;
  buildProgress: ArtifactBuildProgress | null;
  saving: boolean;
  showRebuildWarning: boolean;
  setShowRebuildWarning: (v: boolean) => void;
  handleBuild: () => Promise<void>;
  handleSave: (updates: {
    title?: string;
    body?: string;
    modelId?: string | null;
    sources?: string[];
    autoDiscoverContext?: boolean;
  }) => Promise<void>;
  setArtifact: (a: ArtifactSpec | null) => void;
}

/* ── Hook ─────────────────────────────────────────────────────────── */

export function useArtifactBuild({
  projectId,
  epicId,
  artifactId,
  artifact: externalArtifact,
  hiddenSectionIds,
  annotations,
  flash,
  onBuildComplete,
}: UseArtifactBuildOpts): UseArtifactBuildReturn {
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState<ArtifactBuildProgress | null>(null);
  const [saving, setSaving] = useState(false);
  const [showRebuildWarning, setShowRebuildWarning] = useState(false);
  const [artifact, setArtifact] = useState<ArtifactSpec | null>(externalArtifact);

  const sseCleanupRef = useRef<(() => void) | null>(null);
  const isBuilt = artifact?.status === "built";

  // Sync external artifact changes
  useEffect(() => {
    setArtifact(externalArtifact);
  }, [externalArtifact]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      sseCleanupRef.current?.();
    };
  }, []);

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
        artifact.modelId ?? undefined,
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
          onBuildComplete();
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
    onBuildComplete,
    flash,
  ]);

  const handleSave = useCallback(
    async (updates: {
      title?: string;
      body?: string;
      modelId?: string | null;
      sources?: string[];
      autoDiscoverContext?: boolean;
    }) => {
      setSaving(true);
      try {
        const updated = await api.updateArtifact(
          projectId,
          epicId,
          artifactId,
          updates,
        );
        setArtifact(updated);
        flash("Saved");
      } catch (err) {
        flash(err instanceof Error ? err.message : "Save failed");
      } finally {
        setSaving(false);
      }
    },
    [projectId, epicId, artifactId, flash],
  );

  return {
    building,
    buildProgress,
    saving,
    showRebuildWarning,
    setShowRebuildWarning,
    handleBuild,
    handleSave,
    setArtifact,
  };
}
