/* ── CodaScope: NoteImportDialog ─────────────────────────────────────
   Multi-step modal for importing notes from a ZIP archive.
   Step 1: Upload ZIP  →  Step 2: Preview (collisions, counts)
   Step 3: Options (collision strategy)  →  Step 4: Execute + report
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useRef } from "react";
import { IconUpload, IconClose, IconCheck, IconWarning, IconFile } from "./CodaScopeIcons";
import type { NoteScope, NoteVisibility } from "../codaScopeTypes";

/* ── Types ───────────────────────────────────────────────────────────── */

interface ImportPreview {
  sourceScope: string;
  sourceVisibility: string;
  noteCount: number;
  attachmentCount: number;
  totalSizeBytes: number;
  collisions: Array<{
    importPath: string;
    existingNoteId: string;
    existingTitle: string;
  }>;
  items: Array<{
    path: string;
    title: string;
    hasAttachments: boolean;
    hasVersions: boolean;
  }>;
  warnings: string[];
}

interface ImportReport {
  imported: number;
  skipped: number;
  renamed: number;
  failed: Array<{ path: string; error: string }>;
  correlationId: string;
}

type CollisionStrategy = "skip" | "rename" | "import-as-copy";

/* ── Props ───────────────────────────────────────────────────────────── */

interface NoteImportDialogProps {
  open: boolean;
  scope: NoteScope;
  visibility: NoteVisibility;
  queryParams: Record<string, string>;
  onClose: () => void;
  onImported: () => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteImportDialog({
  open,
  scope,
  visibility,
  queryParams,
  onClose,
  onImported,
}: NoteImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [collisionStrategy, setCollisionStrategy] = useState<CollisionStrategy>("skip");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── File handling ────────────────────────────────────────────────── */

  const handleFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    setPreview(null);
    setReport(null);
    setError(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  }, [handleFileSelect]);

  /* ── Preview ──────────────────────────────────────────────────────── */

  const handlePreview = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("scope", scope);
      formData.append("visibility", visibility);
      if (queryParams.projectId) formData.append("projectId", queryParams.projectId);
      if (queryParams.epicId) formData.append("epicId", queryParams.epicId);

      const res = await fetch("/api/codascope/notes/import/preview", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `Preview failed (${res.status})`);
      }

      const data: ImportPreview = await res.json();
      setPreview(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Preview failed.");
    }
    setLoading(false);
  }, [file, scope, visibility, queryParams]);

  /* ── Execute ──────────────────────────────────────────────────────── */

  const handleExecute = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("scope", scope);
      formData.append("visibility", visibility);
      formData.append("collisionStrategy", collisionStrategy);
      if (queryParams.projectId) formData.append("projectId", queryParams.projectId);
      if (queryParams.epicId) formData.append("epicId", queryParams.epicId);

      const res = await fetch("/api/codascope/notes/import/execute", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `Import failed (${res.status})`);
      }

      const data: ImportReport = await res.json();
      setReport(data);
      if (data.imported > 0) onImported();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Import failed.");
    }
    setLoading(false);
  }, [file, scope, visibility, collisionStrategy, queryParams, onImported]);

  /* ── Close ────────────────────────────────────────────────────────── */

  const handleClose = useCallback(() => {
    setFile(null);
    setPreview(null);
    setReport(null);
    setError(null);
    setLoading(false);
    setCollisionStrategy("skip");
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="codascope-notes-move-overlay" onClick={handleClose}>
      <div className="codascope-notes-import-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="codascope-notes-move-dialog-header">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <IconUpload size={14} />
            <span>Import Notes</span>
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

          {/* Step 1: File Upload */}
          {!report && (
            <div className="codascope-notes-import-section">
              <div
                className={`codascope-notes-import-dropzone${dragging ? " codascope-notes-import-dropzone-active" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <IconUpload size={20} />
                {file ? (
                  <span className="codascope-notes-import-filename">{file.name} ({formatBytes(file.size)})</span>
                ) : (
                  <span>Drop a ZIP file here or click to browse</span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                />
              </div>
            </div>
          )}

          {/* Preview button */}
          {file && !preview && !report && (
            <button
              className="codascope-btn codascope-btn-primary codascope-btn-sm"
              style={{ alignSelf: "flex-start" }}
              onClick={() => void handlePreview()}
              disabled={loading}
              type="button"
            >
              {loading ? "Analyzing…" : "Analyze ZIP"}
            </button>
          )}

          {/* Step 2: Preview */}
          {preview && !report && (
            <div className="codascope-notes-import-preview">
              {/* Summary */}
              <div className="codascope-notes-import-summary">
                <div className="codascope-notes-import-stat">
                  <span className="codascope-notes-import-stat-value">{preview.noteCount}</span>
                  <span className="codascope-notes-import-stat-label">Notes</span>
                </div>
                <div className="codascope-notes-import-stat">
                  <span className="codascope-notes-import-stat-value">{preview.attachmentCount}</span>
                  <span className="codascope-notes-import-stat-label">Attachments</span>
                </div>
                <div className="codascope-notes-import-stat">
                  <span className="codascope-notes-import-stat-value">{formatBytes(preview.totalSizeBytes)}</span>
                  <span className="codascope-notes-import-stat-label">Size</span>
                </div>
              </div>

              {/* Source info */}
              {preview.sourceScope !== "unknown" && (
                <div className="codascope-notes-import-source">
                  From: {preview.sourceScope} / {preview.sourceVisibility}
                </div>
              )}

              {/* Warnings */}
              {preview.warnings.length > 0 && (
                <div className="codascope-notes-import-warnings">
                  {preview.warnings.map((w, i) => (
                    <div key={i} className="codascope-notes-import-warning">
                      <IconWarning size={12} />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Collisions */}
              {preview.collisions.length > 0 && (
                <div className="codascope-notes-import-collisions">
                  <div className="codascope-notes-move-label">
                    {preview.collisions.length} collision{preview.collisions.length !== 1 ? "s" : ""} detected
                  </div>
                  <div className="codascope-notes-import-collision-list">
                    {preview.collisions.map((c, i) => (
                      <div key={i} className="codascope-notes-import-collision-item">
                        <IconFile size={12} />
                        <span className="codascope-notes-import-collision-path">{c.importPath}</span>
                        <span className="codascope-notes-import-collision-existing">
                          exists as "{c.existingTitle}"
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Collision strategy */}
              <div className="codascope-notes-import-strategy">
                <span className="codascope-notes-move-label">When a note already exists:</span>
                <div className="codascope-notes-move-level-picker">
                  {(["skip", "rename", "import-as-copy"] as const).map((s) => (
                    <button
                      key={s}
                      className={`codascope-notes-move-level-btn${collisionStrategy === s ? " codascope-notes-move-level-btn--active" : ""}`}
                      onClick={() => setCollisionStrategy(s)}
                      type="button"
                    >
                      {s === "skip" ? "Skip" : s === "rename" ? "Rename" : "Copy"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Note list (collapsible) */}
              <details className="codascope-notes-import-details">
                <summary className="codascope-notes-import-details-summary">
                  {preview.items.length} notes to import
                </summary>
                <div className="codascope-notes-import-item-list">
                  {preview.items.map((item, i) => (
                    <div key={i} className="codascope-notes-import-item">
                      <IconFile size={12} />
                      <span>{item.title}</span>
                      <span className="codascope-notes-import-item-path">{item.path}</span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          {/* Step 4: Report */}
          {report && (
            <div className="codascope-notes-import-report">
              <div className="codascope-notes-import-report-header">
                <IconCheck size={16} />
                <span>Import Complete</span>
              </div>
              <div className="codascope-notes-import-summary">
                <div className="codascope-notes-import-stat">
                  <span className="codascope-notes-import-stat-value">{report.imported}</span>
                  <span className="codascope-notes-import-stat-label">Imported</span>
                </div>
                <div className="codascope-notes-import-stat">
                  <span className="codascope-notes-import-stat-value">{report.skipped}</span>
                  <span className="codascope-notes-import-stat-label">Skipped</span>
                </div>
                <div className="codascope-notes-import-stat">
                  <span className="codascope-notes-import-stat-value">{report.renamed}</span>
                  <span className="codascope-notes-import-stat-label">Renamed</span>
                </div>
              </div>
              {report.failed.length > 0 && (
                <div className="codascope-notes-import-failures">
                  <div className="codascope-notes-move-label">{report.failed.length} failed:</div>
                  {report.failed.map((f, i) => (
                    <div key={i} className="codascope-notes-import-failure-item">
                      <span>{f.path}</span>
                      <span className="codascope-notes-import-failure-error">{f.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="codascope-notes-export-error">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="codascope-notes-move-dialog-footer">
          <button
            className="codascope-btn codascope-btn-sm"
            onClick={handleClose}
            type="button"
          >
            {report ? "Done" : "Cancel"}
          </button>
          {preview && !report && (
            <button
              className="codascope-btn codascope-btn-primary codascope-btn-sm"
              onClick={() => void handleExecute()}
              disabled={loading}
              type="button"
            >
              {loading ? "Importing…" : "Import"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
