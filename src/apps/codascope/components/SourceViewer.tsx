/* ── CodaScope: SourceViewer Component ───────────────────────────────
   Modal overlay to view extracted markdown content from a knowledge
   source. Shows rendered markdown and source metadata.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, useRef } from "react";
import { MarkdownViewer } from "../../../shared/markdown";
import { IconClose, IconDownload, IconExternalLink, IconFile } from "./CodaScopeIcons";
import type { EpicKnowledgeSource } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface SourceViewerProps {
  projectId: string;
  epicId: string;
  source: EpicKnowledgeSource;
  onClose: () => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* ── Component ───────────────────────────────────────────────────────── */

export function SourceViewer({ projectId, epicId, source, onClose }: SourceViewerProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Fetch extracted markdown content
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/codascope/projects/${projectId}/epics/${epicId}/knowledge/sources/${source.id}/content`,
        );
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setMarkdown(data.markdown ?? null);
        } else {
          setError("Extracted content not available.");
        }
      } catch {
        if (!cancelled) setError("Failed to load content.");
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, epicId, source.id]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  return (
    <div
      ref={backdropRef}
      className="codascope-source-viewer-backdrop"
      onClick={handleBackdropClick}
    >
      <div className="codascope-source-viewer-modal">
        {/* Header */}
        <div className="codascope-source-viewer-header">
          <div className="codascope-source-viewer-header-info">
            <IconFile size={18} />
            <h3 className="codascope-source-viewer-title">{source.title}</h3>
          </div>
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-sm"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <IconClose size={14} />
          </button>
        </div>

        {/* Source metadata */}
        <div className="codascope-source-viewer-meta">
          <span className="codascope-source-viewer-meta-item">
            {source.contentType}
          </span>
          <span className="codascope-source-viewer-meta-item">
            {formatBytes(source.sizeBytesOriginal)}
          </span>
          <span className="codascope-source-viewer-meta-item">
            Added {formatDate(source.addedAt)}
          </span>
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="codascope-source-viewer-meta-link"
            >
              <IconExternalLink size={12} />
              Source URL
            </a>
          )}
        </div>

        {/* Content area */}
        <div className="codascope-source-viewer-content">
          {loading && (
            <div className="codascope-source-viewer-loading">
              Loading content…
            </div>
          )}
          {error && (
            <div className="codascope-source-viewer-error">
              {error}
            </div>
          )}
          {!loading && !error && markdown && (
            <MarkdownViewer content={markdown} />
          )}
          {!loading && !error && !markdown && (
            <div className="codascope-source-viewer-empty">
              No extracted markdown content available for this source.
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="codascope-source-viewer-footer">
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="codascope-btn codascope-btn-ghost codascope-btn-sm"
            >
              <IconExternalLink size={14} />
              Open Original URL
            </a>
          )}
          <a
            href={`/api/codascope/projects/${projectId}/epics/${epicId}/knowledge/sources/${source.id}/content`}
            download={`${source.id}-content.md`}
            className="codascope-btn codascope-btn-ghost codascope-btn-sm"
          >
            <IconDownload size={14} />
            Download Markdown
          </a>
        </div>
      </div>
    </div>
  );
}
