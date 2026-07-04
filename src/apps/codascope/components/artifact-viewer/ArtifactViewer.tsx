/* ── CodaScope: ArtifactViewer ────────────────────────────────────────
   Main orchestrator component for visual HTML artifacts.
   Wires together ArtifactSpecEditor, ArtifactPreview, and
   ArtifactSectionPanel with tab switching, build lifecycle,
   annotation flow, and version management.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  ArtifactSpec,
  ArtifactSection,
  ArtifactAnnotation,
  ArtifactBuildVersion,
  ArtifactBuildProgress,
  ArtifactElementContext,
} from "../../codaScopeTypes.js";
import * as api from "./artifactApi";
import { ArtifactSpecEditor } from "./ArtifactSpecEditor";
import { ArtifactPreview, type ArtifactPreviewHandle } from "./ArtifactPreview";
import { ArtifactSectionPanel } from "./ArtifactSectionPanel";

/* ── Props ─────────────────────────────────────────────────────────── */

interface ArtifactViewerProps {
  projectId: string;
  epicId: string;
  artifactId: string;
}

type Tab = "spec" | "preview";

/* ── Component ─────────────────────────────────────────────────────── */

export function ArtifactViewer({ projectId, epicId, artifactId }: ArtifactViewerProps) {
  // Core state
  const [artifact, setArtifact] = useState<ArtifactSpec | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("spec");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Build state
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState<ArtifactBuildProgress | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  // Section/annotation/version state
  const [sections, setSections] = useState<ArtifactSection[]>([]);
  const [annotations, setAnnotations] = useState<ArtifactAnnotation[]>([]);
  const [versions, setVersions] = useState<ArtifactBuildVersion[]>([]);
  const [hiddenSectionIds, setHiddenSectionIds] = useState<string[]>([]);

  // Inspection mode
  const [inspectionMode, setInspectionMode] = useState(false);
  const [pendingElementContext, setPendingElementContext] = useState<{
    sectionId: string;
    sectionTitle: string;
    elementContext: ArtifactElementContext;
  } | null>(null);

  // Rebuild warning modal
  const [showRebuildWarning, setShowRebuildWarning] = useState(false);

  // Section panel collapse
  const [sectionPanelCollapsed, setSectionPanelCollapsed] = useState(false);

  const previewRef = useRef<ArtifactPreviewHandle>(null);
  const sseCleanupRef = useRef<(() => void) | null>(null);

  const isBuilt = artifact?.status === "built";

  // Flash notice
  const flash = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 5000);
  }, []);

  // ── Load artifact ────────────────────────────────────────────────

  const loadArtifact = useCallback(async () => {
    try {
      const a = await api.getArtifact(projectId, epicId, artifactId);
      setArtifact(a);
      setError(null);
      return a;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load artifact");
      return null;
    }
  }, [projectId, epicId, artifactId]);

  useEffect(() => {
    setLoading(true);
    loadArtifact().then((a) => {
      setLoading(false);
      // Default to preview tab if already built
      if (a?.status === "built") {
        setActiveTab("preview");
      }
    });
  }, [loadArtifact]);

  // ── Load sections ────────────────────────────────────────────────

  const loadSections = useCallback(async () => {
    try {
      const result = await api.listSections(projectId, epicId, artifactId);
      setSections(result.sections);
      setHiddenSectionIds(result.hiddenSectionIds);
    } catch {
      setSections([]);
    }
  }, [projectId, epicId, artifactId]);

  // ── Load annotations ─────────────────────────────────────────────

  const loadAnnotations = useCallback(async () => {
    try {
      const list = await api.listAnnotations(projectId, epicId, artifactId);
      setAnnotations(list);
    } catch {
      /* non-fatal */
    }
  }, [projectId, epicId, artifactId]);

  // ── Load versions ─────────────────────────────────────────────────

  const loadVersions = useCallback(async () => {
    try {
      const list = await api.listVersions(projectId, epicId, artifactId);
      setVersions(list);
    } catch {
      /* non-fatal */
    }
  }, [projectId, epicId, artifactId]);

  // Load sections/annotations/versions when switching to preview
  useEffect(() => {
    if (activeTab === "preview" && isBuilt) {
      void loadSections();
      void loadAnnotations();
      void loadVersions();
    }
  }, [activeTab, isBuilt, loadSections, loadAnnotations, loadVersions, previewKey]);

  // ── Build lifecycle ──────────────────────────────────────────────

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
          void loadArtifact();
          setPreviewKey((k) => k + 1);
          setActiveTab("preview");
          flash("Build complete ✓");
        },
        (err) => {
          setBuilding(false);
          flash(err.message);
        },
      );

      setActiveTab("preview");
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

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      sseCleanupRef.current?.();
    };
  }, []);

  // ── Save spec ────────────────────────────────────────────────────

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

  // ── Annotation handlers ──────────────────────────────────────────

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

      // Enter building state and subscribe to SSE for real-time progress
      setBuilding(true);
      setBuildProgress(null);
      flash(`Regenerating ${result.applied} annotation(s)…`);

      // Subscribe to SSE build status — same pattern as handleBuild
      sseCleanupRef.current?.();
      sseCleanupRef.current = api.subscribeBuildStatus(
        projectId,
        epicId,
        artifactId,
        (progress) => setBuildProgress(progress),
        () => {
          // Regeneration done
          setBuilding(false);
          setBuildProgress(null);
          void loadAnnotations();
          void loadSections();
          setPreviewKey((k) => k + 1);
          flash("Sections regenerated ✓");
        },
        (err) => {
          setBuilding(false);
          setBuildProgress(null);
          void loadAnnotations();
          flash(err.message || "Regeneration failed");
        },
      );
    } catch (err) {
      flash(err instanceof Error ? err.message : "Batch apply failed");
    }
  }, [projectId, epicId, artifactId, loadAnnotations, loadSections, flash]);

  const handleRetryFailed = useCallback(async () => {
    try {
      await api.retryFailedAnnotations(projectId, epicId, artifactId);
      await loadAnnotations();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Retry failed");
    }
  }, [projectId, epicId, artifactId, loadAnnotations, flash]);

  // ── Section handlers ─────────────────────────────────────────────

  const handleScrollToSection = useCallback(
    (sectionId: string) => {
      previewRef.current?.scrollToSection(sectionId);
    },
    [],
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
    [],
  );

  const handleHideSection = useCallback(
    async (sectionId: string) => {
      try {
        const result = await api.hideSection(
          projectId,
          epicId,
          artifactId,
          sectionId,
        );
        setSections(result.sections);
        setHiddenSectionIds(result.hiddenSectionIds);
        setPreviewKey((k) => k + 1);
        flash("Section hidden");
      } catch (err) {
        flash(err instanceof Error ? err.message : "Failed to hide section");
      }
    },
    [projectId, epicId, artifactId, flash],
  );

  const handleUnhideSection = useCallback(
    async (sectionId: string) => {
      try {
        const result = await api.unhideSection(
          projectId,
          epicId,
          artifactId,
          sectionId,
        );
        setSections(result.sections);
        setHiddenSectionIds(result.hiddenSectionIds);
        setPreviewKey((k) => k + 1);
        flash("Section visible again");
      } catch (err) {
        flash(err instanceof Error ? err.message : "Failed to show section");
      }
    },
    [projectId, epicId, artifactId, flash],
  );

  const handleReorderSections = useCallback(
    async (orderedIds: string[]) => {
      try {
        const result = await api.reorderSections(
          projectId,
          epicId,
          artifactId,
          orderedIds,
        );
        setSections(result.sections);
        setPreviewKey((k) => k + 1);
        flash("Sections reordered");
      } catch (err) {
        flash(err instanceof Error ? err.message : "Reorder failed");
      }
    },
    [projectId, epicId, artifactId, flash],
  );

  const handleAddSection = useCallback(
    async (title: string, afterSectionId: string | null, instruction?: string) => {
      try {
        await api.addSection(projectId, epicId, artifactId, {
          title,
          afterSectionId,
          instruction,
        });
        await loadAnnotations();
        flash("New section added as draft annotation");
      } catch (err) {
        flash(err instanceof Error ? err.message : "Failed to add section");
      }
    },
    [projectId, epicId, artifactId, loadAnnotations, flash],
  );

  // ── Version handlers ─────────────────────────────────────────────

  const handleRevertVersion = useCallback(
    async (dirName: string) => {
      try {
        await api.revertToVersion(projectId, epicId, artifactId, dirName);
        setPreviewKey((k) => k + 1);
        void loadSections();
        void loadAnnotations();
        void loadVersions();
        flash("Reverted to previous version");
      } catch (err) {
        flash(err instanceof Error ? err.message : "Revert failed");
      }
    },
    [projectId, epicId, artifactId, loadSections, loadAnnotations, loadVersions, flash],
  );

  const handleRevertToLatest = useCallback(async () => {
    try {
      await api.revertToLatest(projectId, epicId, artifactId);
      setPreviewKey((k) => k + 1);
      void loadSections();
      void loadAnnotations();
      void loadVersions();
      flash("Reverted to latest");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Revert failed");
    }
  }, [projectId, epicId, artifactId, loadSections, loadAnnotations, loadVersions, flash]);

  // ── Inspection mode ──────────────────────────────────────────────

  const toggleInspectionMode = useCallback(() => {
    const next = !inspectionMode;
    setInspectionMode(next);
    if (next) {
      previewRef.current?.enterAnnotationMode();
    } else {
      previewRef.current?.exitAnnotationMode();
      setPendingElementContext(null);
    }
  }, [inspectionMode]);

  // Exit inspection mode when leaving preview
  useEffect(() => {
    if (activeTab !== "preview" && inspectionMode) {
      setInspectionMode(false);
      previewRef.current?.exitAnnotationMode();
      setPendingElementContext(null);
    }
  }, [activeTab, inspectionMode]);

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

  // ── Download handlers ────────────────────────────────────────────

  const handleDownloadHtml = useCallback(() => {
    const url = api.previewUrl(projectId, epicId, artifactId);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact?.title ?? artifactId}.html`;
    a.click();
  }, [projectId, epicId, artifactId, artifact?.title]);

  const handleDownloadSpec = useCallback(() => {
    if (!artifact) return;
    const blob = new Blob(
      [`# ${artifact.title}\n\n${artifact.body}`],
      { type: "text/markdown" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [artifact]);

  // ── Preview URL ──────────────────────────────────────────────────

  const previewSrc = useMemo(
    () => api.previewUrl(projectId, epicId, artifactId),
    [projectId, epicId, artifactId],
  );

  // ── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="codascope-artifact-viewer codascope-artifact-viewer-loading">
        <p>Loading artifact…</p>
      </div>
    );
  }

  if (error || !artifact) {
    return (
      <div className="codascope-artifact-viewer codascope-artifact-viewer-error">
        <p>{error ?? "Artifact not found"}</p>
      </div>
    );
  }

  return (
    <div className="codascope-artifact-viewer">
      {/* Tab bar */}
      <div className="codascope-artifact-tabs">
        <button
          className={`codascope-artifact-tab ${activeTab === "spec" ? "codascope-artifact-tab-active" : ""}`}
          onClick={() => setActiveTab("spec")}
          type="button"
        >
          Spec
        </button>
        <button
          className={`codascope-artifact-tab ${activeTab === "preview" ? "codascope-artifact-tab-active" : ""}`}
          onClick={() => setActiveTab("preview")}
          disabled={!isBuilt && !building}
          title={!isBuilt && !building ? "Build the artifact first" : undefined}
          type="button"
        >
          Preview
        </button>
        {notice && (
          <span className="codascope-artifact-notice">{notice}</span>
        )}
        {building && (
          <span className="codascope-artifact-build-status">
            {buildProgress?.progress ?? "Agent generating sections…"}
          </span>
        )}
      </div>

      {/* Rebuild warning modal */}
      {showRebuildWarning && (
        <div className="codascope-artifact-modal-overlay">
          <div className="codascope-artifact-modal">
            <h3 className="codascope-artifact-modal-title">Rebuild Artifact?</h3>
            <p className="codascope-artifact-modal-body">
              This artifact has section modifications (hidden sections, applied
              annotations, or version changes). A full rebuild will regenerate
              all content from the spec, replacing all current modifications.
            </p>
            <div className="codascope-artifact-modal-actions">
              <button
                className="codascope-artifact-spec-btn codascope-artifact-spec-btn-secondary"
                onClick={() => setShowRebuildWarning(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="codascope-artifact-spec-btn codascope-artifact-spec-btn-primary"
                onClick={() => void handleBuild()}
                type="button"
              >
                Rebuild Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="codascope-artifact-content">
        {activeTab === "spec" && (
          <ArtifactSpecEditor
            artifact={artifact}
            onSave={handleSave}
            onBuild={handleBuild}
            onDownloadHtml={handleDownloadHtml}
            onDownloadSpec={handleDownloadSpec}
            building={building}
            saving={saving}
          />
        )}

        {activeTab === "preview" && (
          <div className="codascope-artifact-preview-layout">
            {/* Preview iframe */}
            <div className="codascope-artifact-preview-main">
              {isBuilt ? (
                <ArtifactPreview
                  ref={previewRef}
                  previewSrc={previewSrc}
                  reloadKey={previewKey}
                  onAnnotationSelected={handleAnnotationSelected}
                />
              ) : building ? (
                <div className="codascope-artifact-preview-building">
                  <div className="codascope-artifact-preview-spinner" />
                  <p>{buildProgress?.progress ?? "Agent is generating HTML…"}</p>
                </div>
              ) : (
                <div className="codascope-artifact-preview-empty">
                  <p>No preview available. Build the artifact from the Spec tab.</p>
                </div>
              )}

              {/* Expand button shown when panel is collapsed */}
              {isBuilt && sectionPanelCollapsed && (
                <button
                  className="codascope-artifact-panel-expand-btn"
                  onClick={() => setSectionPanelCollapsed(false)}
                  title="Expand Sections & Annotations"
                  type="button"
                >
                  ◀
                </button>
              )}
            </div>

            {/* Section panel (right side) */}
            {isBuilt && !sectionPanelCollapsed && (
              <ArtifactSectionPanel
                sections={sections}
                annotations={annotations}
                versions={versions}
                hiddenSectionIds={hiddenSectionIds}
                inspectionMode={inspectionMode}
                pendingElementContext={pendingElementContext}
                onToggleInspectionMode={toggleInspectionMode}
                onScrollToSection={handleScrollToSection}
                onHighlightAnnotation={handleHighlightAnnotation}
                onHideSection={handleHideSection}
                onUnhideSection={handleUnhideSection}
                onReorderSections={handleReorderSections}
                onAddAnnotation={handleAddAnnotation}
                onUpdateAnnotation={handleUpdateAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                onToggleAnnotation={handleToggleAnnotation}
                onBatchApply={handleBatchApply}
                onRetryFailed={handleRetryFailed}
                onAddSection={handleAddSection}
                onRevertVersion={handleRevertVersion}
                onRevertToLatest={handleRevertToLatest}
                onPauseHover={() => previewRef.current?.pauseHover()}
                onResumeHover={() => previewRef.current?.resumeHover()}
                onCollapse={() => setSectionPanelCollapsed(true)}
                building={building}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
