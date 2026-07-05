/* ── CodaScope: useArtifactAnnotations ────────────────────────────────
   Hook encapsulating artifact annotation lifecycle:
   - CRUD for annotations (add, update, delete, toggle)
   - Batch apply with SSE progress
   - Retry failed annotations
   Extracted from ArtifactViewer.tsx.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useRef } from "react";
import type {
  ArtifactAnnotation,
  ArtifactBuildProgress,
  ArtifactElementContext,
} from "../../codaScopeTypes.js";
import * as api from "./artifactApi";

/* ── Types ────────────────────────────────────────────────────────── */

export interface UseArtifactAnnotationsOpts {
  projectId: string;
  epicId: string;
  artifactId: string;
  flash: (msg: string) => void;
  onRegenComplete: () => void;
}

export interface UseArtifactAnnotationsReturn {
  annotations: ArtifactAnnotation[];
  loadAnnotations: () => Promise<void>;
  handleAddAnnotation: (data: {
    sectionId: string;
    sectionTitle: string;
    instruction: string;
    elementContext?: ArtifactElementContext | null;
  }) => Promise<void>;
  handleUpdateAnnotation: (annotationId: string, instruction: string) => Promise<void>;
  handleDeleteAnnotation: (annotationId: string) => Promise<void>;
  handleToggleAnnotation: (annotationId: string) => Promise<void>;
  handleBatchApply: () => Promise<void>;
  handleRetryFailed: () => Promise<void>;
  batchBuilding: boolean;
  batchBuildProgress: ArtifactBuildProgress | null;
  pendingElementContext: {
    sectionId: string;
    sectionTitle: string;
    elementContext: ArtifactElementContext;
  } | null;
  setPendingElementContext: (ctx: {
    sectionId: string;
    sectionTitle: string;
    elementContext: ArtifactElementContext;
  } | null) => void;
}

/* ── Hook ─────────────────────────────────────────────────────────── */

export function useArtifactAnnotations({
  projectId,
  epicId,
  artifactId,
  flash,
  onRegenComplete,
}: UseArtifactAnnotationsOpts): UseArtifactAnnotationsReturn {
  const [annotations, setAnnotations] = useState<ArtifactAnnotation[]>([]);
  const [batchBuilding, setBatchBuilding] = useState(false);
  const [batchBuildProgress, setBatchBuildProgress] = useState<ArtifactBuildProgress | null>(null);
  const [pendingElementContext, setPendingElementContext] = useState<{
    sectionId: string;
    sectionTitle: string;
    elementContext: ArtifactElementContext;
  } | null>(null);

  const sseCleanupRef = useRef<(() => void) | null>(null);

  const loadAnnotations = useCallback(async () => {
    try {
      const list = await api.listAnnotations(projectId, epicId, artifactId);
      setAnnotations(list);
    } catch {
      /* non-fatal */
    }
  }, [projectId, epicId, artifactId]);

  const handleAddAnnotation = useCallback(
    async (data: {
      sectionId: string;
      sectionTitle: string;
      instruction: string;
      elementContext?: ArtifactElementContext | null;
    }) => {
      try {
        await api.addAnnotation(projectId, epicId, artifactId, data);
        setPendingElementContext(null);
        await loadAnnotations();
        flash("Annotation added");
      } catch (err) {
        flash(err instanceof Error ? err.message : "Failed to add annotation");
      }
    },
    [projectId, epicId, artifactId, loadAnnotations, flash],
  );

  const handleUpdateAnnotation = useCallback(
    async (annotationId: string, instruction: string) => {
      try {
        await api.updateAnnotation(projectId, epicId, artifactId, annotationId, {
          instruction,
        });
        await loadAnnotations();
      } catch (err) {
        flash(err instanceof Error ? err.message : "Update failed");
      }
    },
    [projectId, epicId, artifactId, loadAnnotations, flash],
  );

  const handleDeleteAnnotation = useCallback(
    async (annotationId: string) => {
      try {
        await api.deleteAnnotation(projectId, epicId, artifactId, annotationId);
        await loadAnnotations();
      } catch (err) {
        flash(err instanceof Error ? err.message : "Delete failed");
      }
    },
    [projectId, epicId, artifactId, loadAnnotations, flash],
  );

  const handleToggleAnnotation = useCallback(
    async (annotationId: string) => {
      try {
        await api.toggleAnnotation(projectId, epicId, artifactId, annotationId);
        await loadAnnotations();
      } catch (err) {
        flash(err instanceof Error ? err.message : "Toggle failed");
      }
    },
    [projectId, epicId, artifactId, loadAnnotations, flash],
  );

  const handleBatchApply = useCallback(async () => {
    try {
      const result = await api.batchApplyAnnotations(
        projectId,
        epicId,
        artifactId,
      );
      if (result.applied === 0) {
        flash("No pending annotations to apply");
        return;
      }

      setBatchBuilding(true);
      setBatchBuildProgress(null);
      flash(`Regenerating ${result.applied} annotation(s)…`);

      sseCleanupRef.current?.();
      sseCleanupRef.current = api.subscribeBuildStatus(
        projectId,
        epicId,
        artifactId,
        (progress) => setBatchBuildProgress(progress),
        () => {
          setBatchBuilding(false);
          setBatchBuildProgress(null);
          void loadAnnotations();
          onRegenComplete();
          flash("Sections regenerated ✓");
        },
        (err) => {
          setBatchBuilding(false);
          setBatchBuildProgress(null);
          void loadAnnotations();
          flash(err.message || "Regeneration failed");
        },
      );
    } catch (err) {
      flash(err instanceof Error ? err.message : "Batch apply failed");
    }
  }, [projectId, epicId, artifactId, loadAnnotations, onRegenComplete, flash]);

  const handleRetryFailed = useCallback(async () => {
    try {
      await api.retryFailedAnnotations(projectId, epicId, artifactId);
      await loadAnnotations();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Retry failed");
    }
  }, [projectId, epicId, artifactId, loadAnnotations, flash]);

  return {
    annotations,
    loadAnnotations,
    handleAddAnnotation,
    handleUpdateAnnotation,
    handleDeleteAnnotation,
    handleToggleAnnotation,
    handleBatchApply,
    handleRetryFailed,
    batchBuilding,
    batchBuildProgress,
    pendingElementContext,
    setPendingElementContext,
  };
}
