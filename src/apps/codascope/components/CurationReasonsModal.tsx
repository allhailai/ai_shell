/* ── CodaScope: CurationReasonsModal ─────────────────────────────────
   Portal-based modal listing accumulated curation reasons with
   relative timestamps. Actions: Dismiss (close) or Curate Now.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { IconClose, IconCurate, IconClock } from "./CodaScopeIcons";
import type { CurationReason } from "../codaScopeTypes";

/* ── Types ───────────────────────────────────────────────────────────── */

interface CurationReasonsModalProps {
  epicId: string;
  projectId: string;
  reasons: CurationReason[];
  onCurate: () => void;
  onClose: () => void;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

const REASON_LABELS: Record<string, string> = {
  definition_changed: "Definition updated",
  code_delta_processed: "Code changes detected",
  research_sources_added: "Research sources added",
  human_content_added: "Human content uploaded",
  blocked_download_resolved: "Blocked download resolved",
  research_topics_changed: "Research topics changed",
  manual: "Manual trigger",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function CurationReasonsModal({ reasons, onCurate, onClose }: CurationReasonsModalProps) {
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 150);
  }, [onClose]);

  const handleCurate = useCallback(() => {
    onCurate();
    onClose();
  }, [onCurate, onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleClose]);

  // Prevent body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return createPortal(
    <div
      className={`codascope-curation-modal-backdrop${closing ? " codascope-curation-modal-backdrop-closing" : ""}`}
      onClick={handleClose}
      role="presentation"
    >
      <div
        className={`codascope-curation-modal${closing ? " codascope-curation-modal-closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Curation Recommended"
      >
        {/* Header */}
        <div className="codascope-curation-modal-header">
          <div className="codascope-curation-modal-header-left">
            <IconCurate size={18} />
            <h3>Curation Recommended</h3>
          </div>
          <button
            className="codascope-btn codascope-btn-ghost codascope-curation-modal-close"
            onClick={handleClose}
            type="button"
            aria-label="Close"
          >
            <IconClose size={14} />
          </button>
        </div>

        {/* Reasons list */}
        <div className="codascope-curation-modal-body">
          <p className="codascope-curation-modal-subtitle">
            {reasons.length} change{reasons.length !== 1 ? "s" : ""} since last curation:
          </p>
          <ul className="codascope-curation-modal-reasons">
            {reasons.map((reason, idx) => (
              <li key={`${reason.type}-${idx}`} className="codascope-curation-modal-reason">
                <span className="codascope-curation-modal-reason-label">
                  {REASON_LABELS[reason.type] ?? reason.type}
                </span>
                {reason.detail && (
                  <span className="codascope-curation-modal-reason-detail">
                    {reason.detail}
                  </span>
                )}
                <span className="codascope-curation-modal-reason-time">
                  <IconClock size={11} />
                  {timeAgo(reason.at)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        <div className="codascope-curation-modal-actions">
          <button
            className="codascope-btn codascope-btn-ghost"
            onClick={handleClose}
            type="button"
          >
            Dismiss
          </button>
          <button
            className="codascope-btn codascope-btn-primary codascope-curation-modal-curate-btn"
            onClick={handleCurate}
            type="button"
          >
            <IconCurate size={14} />
            Curate Now
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
