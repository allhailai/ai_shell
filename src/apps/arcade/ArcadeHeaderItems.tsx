import { useSyncExternalStore } from "react";
import { subscribeArcade, getArcadeSnapshot, setArcadeState } from "./ArcadeContent";

/**
 * Header items injected into the topbar when the Arcade app is active.
 * Shows current score, level, and a pause toggle — only when a game is running.
 */
export function ArcadeHeaderItems() {
  const state = useSyncExternalStore(subscribeArcade, getArcadeSnapshot);

  // Only show when a game is active
  if (!state.activeGameId) return null;

  return (
    <div className="arcade-header-items">
      <div className="arcade-header-stat">
        <span className="arcade-header-stat-label">Score</span>
        <span className="arcade-header-stat-value">{state.score.toLocaleString()}</span>
      </div>
      <div className="arcade-header-stat">
        <span className="arcade-header-stat-label">Level</span>
        <span className="arcade-header-stat-value">{state.level}</span>
      </div>
      <button
        className={`arcade-header-pause${state.isPaused ? " active" : ""}`}
        onClick={() => {
          setArcadeState({ isPaused: !state.isPaused });
          window.dispatchEvent(new CustomEvent("arcade:pause-toggle"));
        }}
        title={state.isPaused ? "Resume" : "Pause"}
        type="button"
      >
        {state.isPaused ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        )}
      </button>
    </div>
  );
}
