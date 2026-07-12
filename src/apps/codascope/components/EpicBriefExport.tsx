/* ── CodaScope: EpicBriefExport Component ────────────────────────────
   "Export Brief" button and modal for quick epic status summaries.
   
   Features:
   - Click → fetches brief from API
   - Shows brief in a small modal preview
   - "Copy to Clipboard" button
   - Copies as markdown (works in Slack, email, etc.)
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import type { EpicBriefResponse } from "../codaScopeTypes";
import { MarkdownViewer } from "../../../shared/markdown";
import { IconClipboard, IconClose } from "./CodaScopeIcons";

/* ── Props ───────────────────────────────────────────────────────────── */

interface EpicBriefExportProps {
  epicId: string;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicBriefExport({ epicId }: EpicBriefExportProps) {
  const { activeProjectId } = useCodaScopeStore();

  const [showModal, setShowModal] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBrief = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/brief`,
      );
      if (res.ok) {
        const data: EpicBriefResponse = await res.json();
        setBrief(data.brief);
        setShowModal(true);
      } else {
        setError("Failed to generate brief");
      }
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }, [activeProjectId, epicId]);

  const copyToClipboard = useCallback(async () => {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = brief;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [brief]);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setCopied(false);
  }, []);

  return (
    <>
      <button
        className="codascope-btn codascope-btn-ghost codascope-btn-sm"
        onClick={fetchBrief}
        disabled={loading}
        type="button"
        title="Export brief summary"
      >
        <IconClipboard size={14} />
        <span>{loading ? "Loading…" : "Export Brief"}</span>
      </button>

      {error && (
        <span className="codascope-epic-brief-error">{error}</span>
      )}

      {showModal && brief && (
        <div className="codascope-modal-overlay" onClick={closeModal}>
          <div className="codascope-epic-brief-modal" onClick={(e) => e.stopPropagation()}>
            <div className="codascope-epic-brief-modal-header">
              <h3>Epic Brief</h3>
              <button
                className="codascope-btn codascope-btn-ghost codascope-btn-sm"
                onClick={closeModal}
                type="button"
              >
                <IconClose size={13} />
              </button>
            </div>
            <div className="codascope-epic-brief-modal-content">
              <MarkdownViewer content={brief} />
            </div>
            <div className="codascope-epic-brief-modal-footer">
              <button
                className={`codascope-btn ${copied ? "codascope-btn-success" : "codascope-btn-primary"}`}
                onClick={copyToClipboard}
                type="button"
              >
                <IconClipboard size={14} />
                <span>{copied ? "Copied!" : "Copy to Clipboard"}</span>
              </button>
              <span className="codascope-epic-brief-hint">
                Paste as markdown in Slack, email, or docs
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
