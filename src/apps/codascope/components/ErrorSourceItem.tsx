/* ── CodaScope: ErrorSourceItem Component ────────────────────────────
   Renders a single error source entry with:
   - Source title, type badge, error status, original URL
   - If file uploaded: file indicator, download, clear, retry extraction
   - If no file: upload button, delete button
   - Drop zone for drag-and-drop upload
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useRef } from "react";
import {
  IconWarning,
  IconUpload,
  IconDelete,
  IconExternalLink,
  IconDownload,
  IconClose,
  IconRefresh,
} from "./CodaScopeIcons";
import type { EpicKnowledgeSource } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface ErrorSourceItemProps {
  projectId: string;
  epicId: string;
  source: EpicKnowledgeSource;
  onResolved: (sourceId: string) => void;
  onDeleted: (sourceId: string) => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function truncateUrl(url: string, maxLen = 60): string {
  if (url.length <= maxLen) return url;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const pathPart = parsed.pathname;
    const remaining = maxLen - host.length - 6; // "…" + "https://"
    if (remaining <= 0) return `${host}…`;
    return `${host}${pathPart.slice(0, remaining)}…`;
  } catch {
    return url.slice(0, maxLen) + "…";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function ErrorSourceItem({
  projectId,
  epicId,
  source,
  onResolved,
  onDeleted,
}: ErrorSourceItemProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine if this source has an uploaded file
  const hasUploadedFile = source.origin === "human-resolved" && (source.sizeBytesOriginal ?? 0) > 0;

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/knowledge/sources/${source.id}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        onDeleted(source.id);
      } else {
        setError("Failed to delete.");
      }
    } catch {
      setError("Network error.");
    }
    setDeleting(false);
  }, [projectId, epicId, source.id, onDeleted]);

  const handleRetryExtraction = useCallback(async () => {
    setRetrying(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/knowledge/sources/${source.id}/retry-extract`,
        { method: "POST" },
      );
      if (res.ok) {
        onResolved(source.id);
      } else {
        const data = await res.json().catch(() => ({ error: "Extraction failed" }));
        setError(data.error ?? "Extraction failed.");
      }
    } catch {
      setError("Network error.");
    }
    setRetrying(false);
  }, [projectId, epicId, source.id, onResolved]);

  const handleDownload = useCallback(() => {
    const url = `/api/codascope/projects/${projectId}/epics/${epicId}/knowledge/sources/${source.id}/download`;
    const a = document.createElement("a");
    a.href = url;
    a.download = source.filename ?? `source-${source.id}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [projectId, epicId, source.id, source.filename]);

  const resolveWithFile = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      // Step 1: Upload a replacement source
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", source.title || file.name.replace(/\.[^/.]+$/, ""));
      if (source.url) {
        formData.append("url", source.url);
      }

      const uploadRes = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/knowledge/sources`,
        { method: "POST", body: formData },
      );
      if (!uploadRes.ok) {
        setError("Upload failed.");
        setUploading(false);
        return;
      }

      // Step 2: Delete the old error source
      const deleteRes = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/knowledge/sources/${source.id}`,
        { method: "DELETE" },
      );
      if (!deleteRes.ok) {
        // Upload succeeded but delete failed — still report success since
        // the replacement exists. User can manually clean up the old one.
        console.warn(`Failed to delete old error source ${source.id} after replacement upload.`);
      }

      onResolved(source.id);
    } catch {
      setError("Upload failed.");
    }
    setUploading(false);
  }, [projectId, epicId, source.id, source.title, source.url, onResolved]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void resolveWithFile(files[0]);
  }, [resolveWithFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) void resolveWithFile(files[0]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [resolveWithFile]);

  return (
    <div
      className={`codascope-blocked-item ${dragOver ? "codascope-blocked-item-dragover" : ""}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div className="codascope-blocked-item-header">
        <IconWarning size={16} />
        <span
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-medium)",
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {source.title}
        </span>
      </div>

      <div className="codascope-blocked-item-details">
        <span className={`codascope-knowledge-source-type codascope-knowledge-source-type-${source.type}`}>
          {source.type === "machine" ? "Machine" : "Human"}
        </span>
        <span className="codascope-knowledge-source-status codascope-knowledge-source-status-error">
          Error
        </span>
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="codascope-blocked-item-url"
            title={source.url}
            style={{ fontSize: "var(--text-2xs)" }}
          >
            {truncateUrl(source.url)}
            <IconExternalLink size={10} />
          </a>
        )}
      </div>

      {/* Uploaded file indicator */}
      {hasUploadedFile && (
        <div className="codascope-error-source-file-info">
          <span className="codascope-error-source-file-badge">
            📎 {source.filename ?? "uploaded file"}
            {source.sizeBytesOriginal != null && (
              <span className="codascope-error-source-file-size">
                · {formatBytes(source.sizeBytesOriginal)}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="codascope-blocked-item-actions">
        {hasUploadedFile ? (
          <>
            {/* Retry extraction */}
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-sm"
              onClick={handleRetryExtraction}
              disabled={retrying}
              type="button"
              title="Re-extract text content from the uploaded file"
            >
              <IconRefresh size={14} />
              {retrying ? "Extracting…" : "Retry Extract"}
            </button>
            {/* Download */}
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-sm"
              onClick={handleDownload}
              type="button"
              title="Download the uploaded original file"
            >
              <IconDownload size={14} />
              Download
            </button>
            {/* Clear (delete) */}
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-sm codascope-btn-danger"
              onClick={handleDelete}
              disabled={deleting}
              type="button"
              title="Delete this source entirely"
            >
              <IconClose size={14} />
              {deleting ? "Deleting…" : "Clear"}
            </button>
          </>
        ) : (
          <>
            {/* Upload replacement */}
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              type="button"
            >
              <IconUpload size={14} />
              {uploading ? "Uploading…" : "Upload Replacement"}
            </button>
            {/* Delete */}
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-sm"
              onClick={handleDelete}
              disabled={deleting}
              type="button"
            >
              <IconDelete size={14} />
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          className="codascope-source-upload-input"
          tabIndex={-1}
        />
      </div>

      {error && <div className="codascope-blocked-item-error">{error}</div>}

      {dragOver && (
        <div className="codascope-blocked-item-drop-overlay">
          Drop file to replace this error source
        </div>
      )}
    </div>
  );
}
