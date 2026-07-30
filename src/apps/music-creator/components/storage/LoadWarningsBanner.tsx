import type { ProjectLoadWarning } from "../../types";

export interface LoadWarningsBannerProps {
  warnings: ProjectLoadWarning[];
  onRepair: () => void;
}

/**
 * Non-fatal load warnings — invalid projects omitted from UI but still on disk until repair.
 * "Remove from storage" writes the validated envelope only (explicit save, per plan).
 */
export function LoadWarningsBanner({ warnings, onRepair }: LoadWarningsBannerProps) {
  if (warnings.length === 0) return null;

  return (
    <div
      className="music-creator-banner music-creator-banner--warning music-creator-banner--stacked"
      role="status"
    >
      <div className="music-creator-banner-body">
        <p className="music-creator-banner-text">
          {warnings.length} project(s) skipped due to invalid saved data. Your library shows
          only valid projects; damaged entries remain on disk until you repair or reset.
        </p>
        <details className="music-creator-warning-details">
          <summary className="music-creator-warning-summary">View skipped ids</summary>
          <ul className="music-creator-warning-list">
            {warnings.map((warning) => (
              <li key={warning.projectId}>
                <code className="music-creator-code">{warning.projectId}</code>
                {" — "}
                {warning.message}
              </li>
            ))}
          </ul>
        </details>
      </div>
      <button
        type="button"
        className="music-creator-btn music-creator-btn-secondary music-creator-banner-action"
        onClick={onRepair}
      >
        Remove invalid from storage
      </button>
    </div>
  );
}
