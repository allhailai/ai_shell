/* ── CodaScope: ArtifactAnnotationCard ────────────────────────────────
   Individual annotation card for the artifact section panel.
   Displays instruction, element context, status badge, and action buttons.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import type { ArtifactAnnotation } from "../../codaScopeTypes.js";
import { IconDelete, IconAnnotation, IconCheckmark, IconWarning, IconRewrite } from "../CodaScopeIcons";

interface ArtifactAnnotationCardProps {
  annotation: ArtifactAnnotation;
  onScrollToSection: (sectionId: string) => void;
  onHighlight: (annotation: ArtifactAnnotation) => void;
  onUpdate: (annotationId: string, instruction: string) => void;
  onDelete: (annotationId: string) => void;
  onToggle: (annotationId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  applied: "Applied",
  failed: "Failed",
  inactive: "Inactive",
};

export function ArtifactAnnotationCard({
  annotation,
  onScrollToSection,
  onHighlight,
  onUpdate,
  onDelete,
  onToggle,
}: ArtifactAnnotationCardProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(annotation.instruction);

  const handleSave = useCallback(() => {
    if (editText.trim() && editText !== annotation.instruction) {
      onUpdate(annotation.id, editText.trim());
    }
    setEditing(false);
  }, [editText, annotation.id, annotation.instruction, onUpdate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        setEditing(false);
        setEditText(annotation.instruction);
      }
    },
    [handleSave, annotation.instruction],
  );

  const statusClass = `codascope-artifact-status-badge codascope-artifact-status-${annotation.status}`;
  const isAddSection = annotation.type === "add_section";

  return (
    <div
      className={`codascope-artifact-annotation-card ${annotation.status === "inactive" ? "codascope-artifact-annotation-inactive" : ""}`}
    >
      {/* Header row: section link + status badge */}
      <div className="codascope-artifact-annotation-header">
        <button
          className="codascope-artifact-annotation-section-link"
          onClick={() => onScrollToSection(annotation.sectionId)}
          title={`Scroll to "${annotation.sectionTitle}"`}
          type="button"
        >
          <IconAnnotation size={12} />
          <span>{annotation.sectionTitle}</span>
        </button>
        <span className={statusClass}>{STATUS_LABELS[annotation.status] ?? annotation.status}</span>
      </div>

      {/* Element context (when present) */}
      {annotation.elementContext && (
        <button
          className="codascope-artifact-element-context"
          onClick={() => onHighlight(annotation)}
          title="Highlight this element in the preview"
          type="button"
        >
          <code>&lt;{annotation.elementContext.elementTag}&gt;</code>
          {annotation.elementContext.cssPath && (
            <span className="codascope-artifact-element-path">
              {annotation.elementContext.cssPath.length > 50
                ? `…${annotation.elementContext.cssPath.slice(-48)}`
                : annotation.elementContext.cssPath}
            </span>
          )}
        </button>
      )}

      {/* Type badge for add_section */}
      {isAddSection && (
        <span className="codascope-artifact-annotation-type-badge">+ New Section</span>
      )}

      {/* Instruction body */}
      {editing ? (
        <div className="codascope-artifact-annotation-edit">
          <textarea
            className="codascope-artifact-annotation-edit-input"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            autoFocus
          />
          <div className="codascope-artifact-annotation-edit-actions">
            <button
              className="codascope-artifact-annotation-btn"
              onClick={handleSave}
              type="button"
            >
              <IconCheckmark size={12} /> Save
            </button>
            <button
              className="codascope-artifact-annotation-btn"
              onClick={() => {
                setEditing(false);
                setEditText(annotation.instruction);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="codascope-artifact-annotation-instruction">{annotation.instruction}</p>
      )}

      {/* Action buttons */}
      <div className="codascope-artifact-annotation-actions">
        {annotation.status === "pending" && !editing && (
          <button
            className="codascope-artifact-annotation-btn"
            onClick={() => {
              setEditing(true);
              setEditText(annotation.instruction);
            }}
            title="Edit instruction"
            type="button"
          >
            <IconRewrite size={12} /> Edit
          </button>
        )}

        {(annotation.status === "pending" || annotation.status === "inactive") && (
          <button
            className="codascope-artifact-annotation-btn"
            onClick={() => onToggle(annotation.id)}
            title={annotation.status === "pending" ? "Deactivate" : "Reactivate"}
            type="button"
          >
            {annotation.status === "pending" ? "Deactivate" : "Reactivate"}
          </button>
        )}

        {annotation.status === "failed" && (
          <button
            className="codascope-artifact-annotation-btn codascope-artifact-annotation-btn-warning"
            onClick={() => onToggle(annotation.id)}
            title="Retry this annotation"
            type="button"
          >
            <IconWarning size={12} /> Retry
          </button>
        )}

        <button
          className="codascope-artifact-annotation-btn codascope-artifact-annotation-btn-danger"
          onClick={() => onDelete(annotation.id)}
          title="Delete annotation"
          type="button"
        >
          <IconDelete size={12} />
        </button>
      </div>
    </div>
  );
}
