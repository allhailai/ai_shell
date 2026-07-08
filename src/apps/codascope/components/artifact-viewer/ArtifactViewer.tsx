/* ── CodaScope: ArtifactViewer ────────────────────────────────────────
   Main orchestrator component for visual HTML artifacts.
   Wires together ArtifactPreview and ArtifactSectionPanel with
   build lifecycle, annotation flow, and version management.

   Build lifecycle → useArtifactBuild hook
   Annotation flow → useArtifactAnnotations hook
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  ArtifactSpec,
  ArtifactSection,
  ArtifactBuildVersion,
} from "../../codaScopeTypes.js";
import * as api from "./artifactApi";
import { ArtifactPreview, type ArtifactPreviewHandle } from "./ArtifactPreview";
import { ArtifactSectionPanel } from "./ArtifactSectionPanel";
import { useArtifactBuild } from "./hooks/useArtifactBuild";
import { useArtifactAnnotations } from "./hooks/useArtifactAnnotations";

/* ── Props ─────────────────────────────────────────────────────────── */

interface ArtifactViewerProps {
  projectId: string;
  epicId: string;
  artifactId: string;
}

/* ── Component ─────────────────────────────────────────────────────── */

export function ArtifactViewer({ projectId, epicId, artifactId }: ArtifactViewerProps) {
  // Core state
  const [artifact, setArtifact] = useState<ArtifactSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Section/version state
  const [sections, setSections] = useState<ArtifactSection[]>([]);
  const [versions, setVersions] = useState<ArtifactBuildVersion[]>([]);
  const [hiddenSectionIds, setHiddenSectionIds] = useState<string[]>([]);

  // Section panel collapse
  const [sectionPanelCollapsed, setSectionPanelCollapsed] = useState(false);

  const previewRef = useRef<ArtifactPreviewHandle>(null);
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
    loadArtifact().then(() => {
      setLoading(false);
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

  // ── Build lifecycle (hook) ───────────────────────────────────────

  const {
    building,
    buildProgress,
    showRebuildWarning,
    previewKey,
    handleBuild,
    setShowRebuildWarning,
    startBuildSubscription,
  } = useArtifactBuild({
    projectId,
    epicId,
    artifactId,
    artifact,
    hiddenSectionIds,
    annotations: [], // Will be populated by annotation hook below
    loadArtifact,
    flash,
  });

  // ── Annotations (hook) ──────────────────────────────────────────

  const {
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
  } = useArtifactAnnotations({
    projectId,
    epicId,
    artifactId,
    activeTab: "preview",
    isBuilt: isBuilt ?? false,
    sections,
    previewRef,
    loadSections,
    flash,
    startBuildSubscription,
  });

  // ── Load versions ──────────────────────────────────────────────

  const loadVersions = useCallback(async () => {
    try {
      const list = await api.listVersions(projectId, epicId, artifactId);
      setVersions(list);
    } catch {
      /* non-fatal */
    }
  }, [projectId, epicId, artifactId]);

  // Load sections/annotations/versions when built
  useEffect(() => {
    if (isBuilt) {
      void loadSections();
      void loadAnnotations();
      void loadVersions();
    }
  }, [isBuilt, loadSections, loadAnnotations, loadVersions, previewKey]);

  // ── Section handlers ─────────────────────────────────────────────

  const handleScrollToSection = useCallback(
    (sectionId: string) => {
      previewRef.current?.scrollToSection(sectionId);
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
      void loadSections();
      void loadAnnotations();
      void loadVersions();
      flash("Reverted to latest");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Revert failed");
    }
  }, [projectId, epicId, artifactId, loadSections, loadAnnotations, loadVersions, flash]);

  // ── Download handler ─────────────────────────────────────────────

  const handleDownloadHtml = useCallback(() => {
    const url = api.previewUrl(projectId, epicId, artifactId);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact?.title ?? artifactId}.html`;
    a.click();
  }, [projectId, epicId, artifactId, artifact?.title]);

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
      {/* Header bar */}
      <div className="codascope-artifact-header">
        <span className="codascope-artifact-header-title">{artifact.title}</span>
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
              all content, replacing all current modifications.
            </p>
            <div className="codascope-artifact-modal-actions">
              <button
                className="codascope-artifact-btn codascope-artifact-btn-secondary"
                onClick={() => setShowRebuildWarning(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="codascope-artifact-btn codascope-artifact-btn-primary"
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
                <p>This artifact hasn't been built yet. Use the chat agent to generate it.</p>
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
      </div>
    </div>
  );
}
