/* ── CodaScope: ArtifactSectionPanel ──────────────────────────────────
   Section management panel for visual artifacts.
   Lists sections, annotation queue, quick-add input, version history,
   and batch regeneration controls.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useMemo, useRef } from "react";
import type {
  ArtifactSection,
  ArtifactAnnotation,
  ArtifactBuildVersion,
  ArtifactElementContext,
} from "../../codaScopeTypes.js";
import { ArtifactAnnotationCard } from "./ArtifactAnnotationCard";
import {
  IconAnnotation,
  IconEye,
  IconRefresh,
  IconDelete,
  IconInsert,
  IconCheckmark,
  IconWarning,
  IconClock,
} from "../CodaScopeIcons";

/* ── Props ─────────────────────────────────────────────────────────── */

interface ArtifactSectionPanelProps {
  sections: ArtifactSection[];
  annotations: ArtifactAnnotation[];
  versions: ArtifactBuildVersion[];
  hiddenSectionIds: string[];
  inspectionMode: boolean;
  /** Element context from the last iframe click (while in inspection mode) */
  pendingElementContext: {
    sectionId: string;
    sectionTitle: string;
    elementContext: ArtifactElementContext;
  } | null;
  onToggleInspectionMode: () => void;
  onScrollToSection: (sectionId: string) => void;
  onHighlightAnnotation: (annotation: ArtifactAnnotation) => void;
  onHideSection: (sectionId: string) => void;
  onUnhideSection: (sectionId: string) => void;
  onReorderSections: (orderedIds: string[]) => void;
  onAddAnnotation: (data: {
    sectionId: string;
    sectionTitle: string;
    instruction: string;
    elementContext?: ArtifactElementContext | null;
  }) => void;
  onUpdateAnnotation: (annotationId: string, instruction: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onToggleAnnotation: (annotationId: string) => void;
  onBatchApply: () => void;
  onRetryFailed: () => void;
  onAddSection: (title: string, afterSectionId: string | null) => void;
  onRevertVersion: (dirName: string) => void;
  onRevertToLatest: () => void;
  building: boolean;
}

/* ── Component ─────────────────────────────────────────────────────── */

export function ArtifactSectionPanel({
  sections,
  annotations,
  versions,
  hiddenSectionIds,
  inspectionMode,
  pendingElementContext,
  onToggleInspectionMode,
  onScrollToSection,
  onHighlightAnnotation,
  onHideSection,
  onUnhideSection,
  onReorderSections,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onToggleAnnotation,
  onBatchApply,
  onRetryFailed,
  onAddSection,
  onRevertVersion,
  onRevertToLatest,
  building,
}: ArtifactSectionPanelProps) {
  const [quickAddText, setQuickAddText] = useState("");
  const [addSectionTitle, setAddSectionTitle] = useState("");
  const [addSectionAfter, setAddSectionAfter] = useState<string | null>(null);
  const [showAddSection, setShowAddSection] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const quickAddRef = useRef<HTMLTextAreaElement>(null);

  // Group annotations by status
  const pendingAnnotations = useMemo(
    () => annotations.filter((a) => a.status === "pending"),
    [annotations],
  );
  const appliedAnnotations = useMemo(
    () => annotations.filter((a) => a.status === "applied"),
    [annotations],
  );
  const failedAnnotations = useMemo(
    () => annotations.filter((a) => a.status === "failed"),
    [annotations],
  );
  const inactiveAnnotations = useMemo(
    () => annotations.filter((a) => a.status === "inactive"),
    [annotations],
  );

  const pendingCount = pendingAnnotations.length;
  const failedCount = failedAnnotations.length;

  // Quick-add uses pending element context if available
  const handleQuickAdd = useCallback(() => {
    if (!quickAddText.trim()) return;
    const ctx = pendingElementContext;
    onAddAnnotation({
      sectionId: ctx?.sectionId ?? sections[0]?.id ?? "__general__",
      sectionTitle:
        ctx?.sectionTitle ?? sections[0]?.title ?? "General",
      instruction: quickAddText.trim(),
      elementContext: ctx?.elementContext ?? null,
    });
    setQuickAddText("");
  }, [quickAddText, pendingElementContext, sections, onAddAnnotation]);

  const handleQuickAddKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleQuickAdd();
      }
    },
    [handleQuickAdd],
  );

  // Add section handler
  const handleAddSection = useCallback(() => {
    if (!addSectionTitle.trim()) return;
    onAddSection(addSectionTitle.trim(), addSectionAfter);
    setAddSectionTitle("");
    setAddSectionAfter(null);
    setShowAddSection(false);
  }, [addSectionTitle, addSectionAfter, onAddSection]);

  // Drag-and-drop reorder
  const handleDragStart = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      setDragIdx(idx);
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleDragOver = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    [],
  );

  const handleDrop = useCallback(
    (targetIdx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      if (dragIdx === null || dragIdx === targetIdx) {
        setDragIdx(null);
        return;
      }
      const ids = sections.map((s) => s.id);
      const [moved] = ids.splice(dragIdx, 1);
      ids.splice(targetIdx, 0, moved);
      onReorderSections(ids);
      setDragIdx(null);
    },
    [dragIdx, sections, onReorderSections],
  );

  // Move up/down fallback
  const handleMoveSection = useCallback(
    (idx: number, direction: "up" | "down") => {
      const ids = sections.map((s) => s.id);
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= ids.length) return;
      [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
      onReorderSections(ids);
    },
    [sections, onReorderSections],
  );

  return (
    <div className="codascope-artifact-section-panel">
      {/* Header */}
      <div className="codascope-artifact-section-panel-header">
        <h3 className="codascope-artifact-section-panel-title">
          Sections & Annotations
        </h3>
        <div className="codascope-artifact-section-panel-controls">
          <button
            className={`codascope-artifact-inspect-btn ${inspectionMode ? "codascope-artifact-inspect-btn-active" : ""}`}
            onClick={onToggleInspectionMode}
            title={inspectionMode ? "Exit inspection mode" : "Pick UI to annotate"}
            type="button"
          >
            <IconEye size={14} />
            {inspectionMode ? "Exit Inspect" : "Pick UI"}
          </button>
        </div>
      </div>

      {/* Quick-add annotation input */}
      <div className="codascope-artifact-quick-add">
        {pendingElementContext && (
          <div className="codascope-artifact-quick-add-context">
            <span className="codascope-artifact-element-context-tag">
              &lt;{pendingElementContext.elementContext.elementTag}&gt;
            </span>
            <span className="codascope-artifact-quick-add-section">
              in {pendingElementContext.sectionTitle}
            </span>
          </div>
        )}
        <div className="codascope-artifact-quick-add-row">
          <textarea
            ref={quickAddRef}
            className="codascope-artifact-quick-add-input"
            value={quickAddText}
            onChange={(e) => setQuickAddText(e.target.value)}
            onKeyDown={handleQuickAddKeyDown}
            placeholder={
              pendingElementContext
                ? "Describe change for this element…"
                : "Add annotation…"
            }
            rows={2}
          />
          <button
            className="codascope-artifact-quick-add-btn"
            onClick={handleQuickAdd}
            disabled={!quickAddText.trim()}
            title="Add annotation"
            type="button"
          >
            <IconInsert size={14} />
          </button>
        </div>
      </div>

      {/* Batch action bar */}
      {(pendingCount > 0 || failedCount > 0) && (
        <div className="codascope-artifact-batch-bar">
          {pendingCount > 0 && (
            <button
              className="codascope-artifact-batch-regen-btn"
              onClick={onBatchApply}
              disabled={building}
              type="button"
            >
              <IconRefresh size={14} />
              Regenerate w/ {pendingCount} change{pendingCount !== 1 ? "s" : ""}
            </button>
          )}
          {failedCount > 0 && (
            <button
              className="codascope-artifact-batch-retry-btn"
              onClick={onRetryFailed}
              disabled={building}
              type="button"
            >
              <IconWarning size={14} /> Retry {failedCount} failed
            </button>
          )}
        </div>
      )}

      {/* Section list */}
      <div className="codascope-artifact-section-list">
        <div className="codascope-artifact-section-list-header">
          <span>Sections ({sections.length})</span>
          <button
            className="codascope-artifact-section-add-toggle"
            onClick={() => setShowAddSection(!showAddSection)}
            title="Add new section"
            type="button"
          >
            <IconInsert size={14} /> Add
          </button>
        </div>

        {/* Add section form */}
        {showAddSection && (
          <div className="codascope-artifact-add-section-form">
            <input
              className="codascope-artifact-add-section-input"
              type="text"
              value={addSectionTitle}
              onChange={(e) => setAddSectionTitle(e.target.value)}
              placeholder="New section title"
              onKeyDown={(e) => e.key === "Enter" && handleAddSection()}
            />
            <select
              className="codascope-artifact-add-section-select"
              value={addSectionAfter ?? "__end__"}
              onChange={(e) =>
                setAddSectionAfter(
                  e.target.value === "__end__" ? null : e.target.value,
                )
              }
            >
              <option value="__end__">At the end</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  After: {s.title}
                </option>
              ))}
            </select>
            <div className="codascope-artifact-add-section-actions">
              <button
                className="codascope-artifact-section-action-btn"
                onClick={handleAddSection}
                disabled={!addSectionTitle.trim()}
                type="button"
              >
                <IconCheckmark size={12} /> Add
              </button>
              <button
                className="codascope-artifact-section-action-btn"
                onClick={() => setShowAddSection(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Section items */}
        {sections.map((section, idx) => {
          const isHidden = hiddenSectionIds.includes(section.id);
          const sectionAnnotations = annotations.filter(
            (a) => a.sectionId === section.id,
          );
          const sectionPending = sectionAnnotations.filter(
            (a) => a.status === "pending",
          ).length;

          return (
            <div
              key={section.id}
              className={`codascope-artifact-section-item ${isHidden ? "codascope-artifact-section-hidden" : ""} ${dragIdx === idx ? "codascope-artifact-section-dragging" : ""}`}
              draggable
              onDragStart={handleDragStart(idx)}
              onDragOver={handleDragOver(idx)}
              onDrop={handleDrop(idx)}
            >
              <div className="codascope-artifact-section-item-header">
                <span className="codascope-artifact-section-drag-handle" title="Drag to reorder">⠿</span>
                <button
                  className="codascope-artifact-section-title-btn"
                  onClick={() => onScrollToSection(section.id)}
                  title={`Scroll to "${section.title}"`}
                  type="button"
                >
                  {section.title}
                </button>
                {sectionPending > 0 && (
                  <span className="codascope-artifact-section-badge">
                    {sectionPending}
                  </span>
                )}
                <div className="codascope-artifact-section-item-actions">
                  <button
                    className="codascope-artifact-section-action-btn"
                    onClick={() => handleMoveSection(idx, "up")}
                    disabled={idx === 0}
                    title="Move up"
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    className="codascope-artifact-section-action-btn"
                    onClick={() => handleMoveSection(idx, "down")}
                    disabled={idx === sections.length - 1}
                    title="Move down"
                    type="button"
                  >
                    ↓
                  </button>
                  <button
                    className="codascope-artifact-section-action-btn"
                    onClick={() =>
                      isHidden
                        ? onUnhideSection(section.id)
                        : onHideSection(section.id)
                    }
                    title={isHidden ? "Show section" : "Hide section"}
                    type="button"
                  >
                    {isHidden ? "Show" : "Hide"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Annotation queue */}
      <div className="codascope-artifact-annotation-queue">
        <h4 className="codascope-artifact-annotation-queue-title">
          <IconAnnotation size={14} />
          Annotations ({annotations.length})
        </h4>

        {/* Pending */}
        {pendingAnnotations.length > 0 && (
          <div className="codascope-artifact-annotation-group">
            <span className="codascope-artifact-annotation-group-label">
              Pending ({pendingAnnotations.length})
            </span>
            {pendingAnnotations.map((a) => (
              <ArtifactAnnotationCard
                key={a.id}
                annotation={a}
                onScrollToSection={onScrollToSection}
                onHighlight={onHighlightAnnotation}
                onUpdate={onUpdateAnnotation}
                onDelete={onDeleteAnnotation}
                onToggle={onToggleAnnotation}
              />
            ))}
          </div>
        )}

        {/* Failed */}
        {failedAnnotations.length > 0 && (
          <div className="codascope-artifact-annotation-group">
            <span className="codascope-artifact-annotation-group-label codascope-artifact-annotation-group-failed">
              Failed ({failedAnnotations.length})
            </span>
            {failedAnnotations.map((a) => (
              <ArtifactAnnotationCard
                key={a.id}
                annotation={a}
                onScrollToSection={onScrollToSection}
                onHighlight={onHighlightAnnotation}
                onUpdate={onUpdateAnnotation}
                onDelete={onDeleteAnnotation}
                onToggle={onToggleAnnotation}
              />
            ))}
          </div>
        )}

        {/* Applied */}
        {appliedAnnotations.length > 0 && (
          <div className="codascope-artifact-annotation-group">
            <span className="codascope-artifact-annotation-group-label codascope-artifact-annotation-group-applied">
              Applied ({appliedAnnotations.length})
            </span>
            {appliedAnnotations.map((a) => (
              <ArtifactAnnotationCard
                key={a.id}
                annotation={a}
                onScrollToSection={onScrollToSection}
                onHighlight={onHighlightAnnotation}
                onUpdate={onUpdateAnnotation}
                onDelete={onDeleteAnnotation}
                onToggle={onToggleAnnotation}
              />
            ))}
          </div>
        )}

        {/* Inactive */}
        {inactiveAnnotations.length > 0 && (
          <div className="codascope-artifact-annotation-group">
            <span className="codascope-artifact-annotation-group-label codascope-artifact-annotation-group-inactive">
              Inactive ({inactiveAnnotations.length})
            </span>
            {inactiveAnnotations.map((a) => (
              <ArtifactAnnotationCard
                key={a.id}
                annotation={a}
                onScrollToSection={onScrollToSection}
                onHighlight={onHighlightAnnotation}
                onUpdate={onUpdateAnnotation}
                onDelete={onDeleteAnnotation}
                onToggle={onToggleAnnotation}
              />
            ))}
          </div>
        )}

        {annotations.length === 0 && (
          <p className="codascope-artifact-annotation-empty">
            No annotations yet. Use "Pick UI" to select elements, then add
            instructions.
          </p>
        )}
      </div>

      {/* Version history */}
      <div className="codascope-artifact-version-history">
        <button
          className="codascope-artifact-version-toggle"
          onClick={() => setShowVersions(!showVersions)}
          type="button"
        >
          <IconClock size={14} />
          Version History ({versions.length})
          <span className="codascope-artifact-version-chevron">
            {showVersions ? "▾" : "▸"}
          </span>
        </button>

        {showVersions && (
          <div className="codascope-artifact-version-list">
            {versions.length === 0 ? (
              <p className="codascope-artifact-version-empty">
                No previous versions.
              </p>
            ) : (
              <>
                {versions.map((v) => (
                  <div key={v.dirName} className="codascope-artifact-version-item">
                    <div className="codascope-artifact-version-info">
                      <span className="codascope-artifact-version-number">
                        v{v.version}
                      </span>
                      <span className="codascope-artifact-version-date">
                        {new Date(v.timestamp).toLocaleString()}
                      </span>
                      <span className="codascope-artifact-version-size">
                        {(v.sizeBytes / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <button
                      className="codascope-artifact-version-revert-btn"
                      onClick={() => onRevertVersion(v.dirName)}
                      title="Revert to this version"
                      type="button"
                    >
                      Revert
                    </button>
                  </div>
                ))}
                <button
                  className="codascope-artifact-version-revert-latest"
                  onClick={onRevertToLatest}
                  type="button"
                >
                  Revert to Latest
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
