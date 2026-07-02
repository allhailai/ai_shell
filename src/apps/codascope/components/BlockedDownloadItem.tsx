/* ── CodaScope: BlockedDownloadItem Component ────────────────────────
   Renders a single blocked download entry with:
   - Clickable URL (opens in new tab)
   - Failure reason and timestamp
   - Drop zone for resolution upload
   - Dismiss button
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useRef } from "react";
import { IconBlocked, IconExternalLink, IconUpload, IconClose } from "./CodaScopeIcons";
import type { BlockedDownload } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface BlockedDownloadItemProps {
  projectId: string;
  epicId: string;
  item: BlockedDownload;
  onDismissed: (blockId: string) => void;
  onResolved: (blockId: string) => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function timeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function truncateUrl(url: string, maxLen = 60): string {
  if (url.length <= maxLen) return url;
  const parsed = new URL(url);
  const host = parsed.hostname;
  const pathPart = parsed.pathname;
  const remaining = maxLen - host.length - 6; // "…" + "https://"
  if (remaining <= 0) return `${host}…`;
  return `${host}${pathPart.slice(0, remaining)}…`;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function BlockedDownloadItem({
  projectId,
  epicId,
  item,
  onDismissed,
  onResolved,
}: BlockedDownloadItemProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDismiss = useCallback(async () => {
    setDismissing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/knowledge/blocked/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "dismiss" }),
        },
      );
      if (res.ok) {
        onDismissed(item.id);
      } else {
        setError("Failed to dismiss.");
      }
    } catch {
      setError("Network error.");
    }
    setDismissing(false);
  }, [projectId, epicId, item.id, onDismissed]);

  const resolveWithFile = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name.replace(/\.[^/.]+$/, ""));

      const res = await fetch(
        `/api/codascope/projects/${projectId}/epics/${epicId}/knowledge/blocked/${item.id}/resolve`,
        { method: "POST", body: formData },
      );
      if (res.ok) {
        onResolved(item.id);
      } else {
        setError("Failed to resolve.");
      }
    } catch {
      setError("Upload failed.");
    }
    setUploading(false);
  }, [projectId, epicId, item.id, onResolved]);

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
        <IconBlocked size={16} />
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="codascope-blocked-item-url"
          title={item.url}
        >
          {truncateUrl(item.url)}
          <IconExternalLink size={12} />
        </a>
      </div>

      <div className="codascope-blocked-item-details">
        <span className="codascope-blocked-item-reason">{item.reason}</span>
        <span className="codascope-blocked-item-time">{timeAgo(item.attemptedAt)}</span>
      </div>

      {/* Drop zone / resolve area */}
      <div className="codascope-blocked-item-actions">
        <button
          className="codascope-btn codascope-btn-ghost codascope-btn-sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          type="button"
        >
          <IconUpload size={14} />
          {uploading ? "Uploading…" : "Upload Resolved Content"}
        </button>
        <button
          className="codascope-btn codascope-btn-ghost codascope-btn-sm"
          onClick={handleDismiss}
          disabled={dismissing}
          type="button"
        >
          <IconClose size={14} />
          {dismissing ? "Dismissing…" : "Dismiss"}
        </button>
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
          Drop file to resolve this blocked download
        </div>
      )}
    </div>
  );
}
