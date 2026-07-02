/* ── CodaScope: CurateButton ─────────────────────────────────────────
   Glowing curation trigger button for the epic detail header.
   Shows a badge with pending curation reason count and a spinner
   when curation is actively running.
   ──────────────────────────────────────────────────────────────────── */

import { IconCurate } from "./CodaScopeIcons";

/* ── Types ───────────────────────────────────────────────────────────── */

interface CurateButtonProps {
  epicId: string;
  reasonCount: number;
  onCurate: () => void;
  onShowReasons: () => void;
  curating: boolean;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function CurateButton({ reasonCount, onCurate, onShowReasons, curating }: CurateButtonProps) {
  const handleClick = () => {
    if (curating) return;
    if (reasonCount > 0) {
      onShowReasons();
    } else {
      onCurate();
    }
  };

  return (
    <button
      className={`codascope-btn codascope-curate-btn${curating ? " codascope-curate-btn-curating" : ""}${reasonCount > 0 ? " codascope-curate-btn-has-reasons" : ""}`}
      onClick={handleClick}
      disabled={curating}
      type="button"
      title={curating ? "Curation in progress…" : reasonCount > 0 ? `${reasonCount} curation trigger${reasonCount !== 1 ? "s" : ""} pending` : "Run curation"}
    >
      <span className={`codascope-curate-btn-icon${curating ? " codascope-curate-btn-spinning" : ""}`}>
        <IconCurate size={14} />
      </span>
      <span className="codascope-curate-btn-label">
        {curating ? "Curating…" : "Curate"}
      </span>
      {reasonCount > 0 && !curating && (
        <span className="codascope-curate-btn-badge">
          {reasonCount}
        </span>
      )}
    </button>
  );
}
