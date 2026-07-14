/* ── CodaScope: NoteExportDialog ─────────────────────────────────────
   Modal dialog for exporting notes as a governed ZIP archive.
   Pre-fills scope/visibility from current context.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import { IconDownload, IconClose, IconCheck } from "./CodaScopeIcons";
import type { NoteScope, NoteVisibility } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface NoteExportDialogProps {
  open: boolean;
  scope: NoteScope;
  visibility: NoteVisibility;
  queryParams: Record<string, string>;
  /** Optional library-relative paths to export instead of the whole library. */
  notePaths?: string[];
  onClose: () => void;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteExportDialog({
  open,
  scope,
  visibility,
  queryParams,
  notePaths,
  onClose,
}: NoteExportDialogProps) {
  const [includeVersions, setIncludeVersions] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportId, setExportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setError(null);
    setExportId(null);

    try {
      const res = await fetch("/api/codascope/notes/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          visibility,
          projectId: queryParams.projectId,
          epicId: queryParams.epicId,
          notePaths,
          includeVersions,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `Export failed (${res.status})`);
      }

      const data = await res.json();
      setExportId(data.exportId);

      // Auto-trigger download
      if (data.exportId) {
        window.open(`/api/codascope/notes/export/${data.exportId}`, "_blank");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed.");
    }
    setExporting(false);
  }, [scope, visibility, queryParams, notePaths, includeVersions]);

  const handleClose = useCallback(() => {
    setExportId(null);
    setError(null);
    setExporting(false);
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="codascope-notes-move-overlay" onClick={handleClose}>
      <div className="codascope-notes-export-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="codascope-notes-move-dialog-header">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <IconDownload size={14} />
            <span>{notePaths?.length === 1 ? "Export Note" : "Export Notes"}</span>
          </div>
          <button
            className="codascope-notes-move-level-btn"
            onClick={handleClose}
            type="button"
          >
            <IconClose size={12} />
          </button>
        </div>

        {/* Body */}
        <div className="codascope-notes-move-dialog-body">
          {/* Scope info */}
          <div className="codascope-notes-export-info">
            <div className="codascope-notes-export-info-row">
              <span className="codascope-notes-move-label">Scope</span>
              <span className="codascope-notes-export-info-value">
                {scope === "codascope" ? "CodaScope" : scope === "project" ? "Project" : "Epic"}
              </span>
            </div>
            <div className="codascope-notes-export-info-row">
              <span className="codascope-notes-move-label">Visibility</span>
              <span className="codascope-notes-export-info-value">
                {visibility === "shared" ? "Shared" : "Private"}
              </span>
            </div>
          </div>

          {/* Options */}
          <div className="codascope-notes-export-options">
            <label className="codascope-notes-export-checkbox">
              <input
                type="checkbox"
                checked={includeVersions}
                onChange={(e) => setIncludeVersions(e.target.checked)}
              />
              <span>Include version history</span>
            </label>
            <div className="codascope-notes-export-info-row">
              <span className="codascope-notes-move-label">Annotations</span>
              <span className="codascope-notes-export-info-value">Always included</span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="codascope-notes-export-error">{error}</div>
          )}

          {/* Success */}
          {exportId && (
            <div className="codascope-notes-export-success">
              <IconCheck size={14} />
              <span>Export ready!</span>
              <a
                href={`/api/codascope/notes/export/${exportId}`}
                className="codascope-notes-export-download-link"
                download
              >
                Download again
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="codascope-notes-move-dialog-footer">
          <button
            className="codascope-btn codascope-btn-sm"
            onClick={handleClose}
            type="button"
          >
            {exportId ? "Done" : "Cancel"}
          </button>
          {!exportId && (
            <button
              className="codascope-btn codascope-btn-primary codascope-btn-sm"
              onClick={() => void handleExport()}
              disabled={exporting}
              type="button"
            >
              {exporting ? "Exporting…" : "Export"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
