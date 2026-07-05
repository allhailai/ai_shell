/* ── CodaScope: ArtifactViewer ────────────────────────────────────────
   Main orchestrator component for visual HTML artifacts.
   Wires together ArtifactSpecEditor, ArtifactPreview, and
   ArtifactSectionPanel with tab switching, build lifecycle,
   annotation flow, and version management.

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
import { ArtifactSpecEditor } from "./ArtifactSpecEditor";
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

type Tab = "spec" | "preview";

/* ── Component ─────────────────────────────────────────────────────── */

export function ArtifactViewer({ projectId, epicId, artifactId }: ArtifactViewerProps) {
  // Core state
  const [artifact, setArtifact] = useState<ArtifactSpec | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("spec");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Section/version state
  const [sections, setSections] = useState<ArtifactSection[]>([]);
  const [versions, setVersions] = useState<ArtifactBuildVersion[]>([]);
  const [hiddenSectionIds, setHiddenSectionIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

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
    activeTab,
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

  // Load sections/annotations/versions when switching to preview
  useEffect(() => {
    if (activeTab === "preview" && isBuilt) {
      void loadSections();
      void loadAnnotations();
      void loadVersions();
    }
  }, [activeTab, isBuilt, loadSections, loadAnnotations, loadVersions, previewKey]);

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
