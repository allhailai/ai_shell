/* ── useArtifactAnnotations ───────────────────────────────────────────
   Manages annotation CRUD, inspection mode, element picking,
   and batch apply lifecycle for artifact annotations.
   Extracted from ArtifactViewer to reduce component complexity.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
import type {
  ArtifactAnnotation,
  ArtifactElementContext,
  ArtifactSection,
} from "../../../codaScopeTypes.js";
import type { ArtifactPreviewHandle } from "../ArtifactPreview";
import * as api from "../artifactApi";

interface UseArtifactAnnotationsOptions {
  projectId: string;
  epicId: string;
  artifactId: string;
  activeTab: string;
  isBuilt: boolean;
  sections: ArtifactSection[];
  previewRef: React.RefObject<ArtifactPreviewHandle | null>;
  loadSections: () => Promise<void>;
  flash: (message: string) => void;
  /** Start SSE subscription for regeneration build. */
  startBuildSubscription: (
    onDone: () => void,
    onError: (err: Error) => void,
  ) => void;
}

interface UseArtifactAnnotationsReturn {
  annotations: ArtifactAnnotation[];
  inspectionMode: boolean;
  pendingElementContext: {
    sectionId: string;
    sectionTitle: string;
    elementContext: ArtifactElementContext;
  } | null;
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
  toggleInspectionMode: () => void;
  handleAnnotationSelected: (data: {
    sectionId: string;
    sectionTitle: string;
    elementContext: ArtifactElementContext;
  }) => void;
  handleHighlightAnnotation: (annotation: ArtifactAnnotation) => void;
}

export function useArtifactAnnotations({
  projectId,
  epicId,
  artifactId,
  activeTab,
  isBuilt: _isBuilt,
  sections,
  previewRef,
  loadSections,
  flash,
  startBuildSubscription,
}: UseArtifactAnnotationsOptions): UseArtifactAnnotationsReturn {
  const [annotations, setAnnotations] = useState<ArtifactAnnotation[]>([]);
  const [inspectionMode, setInspectionMode] = useState(false);
  const [pendingElementContext, setPendingElementContext] = useState<{
    sectionId: string;
    sectionTitle: string;
    elementContext: ArtifactElementContext;
  } | null>(null);

  // ── Load annotations ────────────────────────────────────────────

  const loadAnnotations = useCallback(async () => {
    try {
      const list = await api.listAnnotations(projectId, epicId, artifactId);
      setAnnotations(list);
    } catch {
      /* non-fatal */
    }
  }, [projectId, epicId, artifactId]);

  // ── CRUD handlers ───────────────────────────────────────────────

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

  // ── Batch apply ─────────────────────────────────────────────────

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

      flash(`Regenerating ${result.applied} annotation(s)…`);

      // Subscribe to SSE build status for regeneration
      startBuildSubscription(
        () => {
          void loadAnnotations();
          void loadSections();
          flash("Sections regenerated ✓");
        },
        (err) => {
          void loadAnnotations();
          flash(err.message || "Regeneration failed");
        },
      );
    } catch (err) {
      flash(err instanceof Error ? err.message : "Batch apply failed");
    }
  }, [projectId, epicId, artifactId, loadAnnotations, loadSections, flash, startBuildSubscription]);

  const handleRetryFailed = useCallback(async () => {
    try {
      await api.retryFailedAnnotations(projectId, epicId, artifactId);
      await loadAnnotations();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Retry failed");
    }
  }, [projectId, epicId, artifactId, loadAnnotations, flash]);

  // ── Inspection mode ─────────────────────────────────────────────

  const toggleInspectionMode = useCallback(() => {
    const next = !inspectionMode;
    setInspectionMode(next);
    if (next) {
      previewRef.current?.enterAnnotationMode();
    } else {
      previewRef.current?.exitAnnotationMode();
      setPendingElementContext(null);
    }
  }, [inspectionMode, previewRef]);

  // Exit inspection mode when leaving preview
  useEffect(() => {
    if (activeTab !== "preview" && inspectionMode) {
      setInspectionMode(false);
      previewRef.current?.exitAnnotationMode();
      setPendingElementContext(null);
    }
  }, [activeTab, inspectionMode, previewRef]);

  const handleAnnotationSelected = useCallback(
    (data: {
      sectionId: string;
      sectionTitle: string;
      elementContext: ArtifactElementContext;
    }) => {
      // Resolve section title from loaded sections
      const section = sections.find((s) => s.id === data.sectionId);
      setPendingElementContext({
        ...data,
        sectionTitle: section?.title ?? data.sectionTitle,
      });
    },
    [sections],
  );

  const handleHighlightAnnotation = useCallback(
    (annotation: ArtifactAnnotation) => {
      if (annotation.elementContext?.cssPath) {
        previewRef.current?.highlightElement(
          annotation.elementContext.cssPath,
          annotation.sectionId,
        );
      } else {
        previewRef.current?.scrollToSection(annotation.sectionId);
      }
    },
    [previewRef],
  );

  return {
    annotations,
    inspectionMode,
    pendingElementContext,
    loadAnnotations,
    handleAddAnnotation,
    handleUpdateAnnotation,
    handleDeleteAnnotation,
    handleToggleAnnotation,
    handleBatchApply,
    handleRetryFailed,
    toggleInspectionMode,
    handleAnnotationSelected,
    handleHighlightAnnotation,
  };
}
