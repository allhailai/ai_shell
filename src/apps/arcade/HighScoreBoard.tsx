import type { HighScore } from "./types";

/**
 * Reusable high score leaderboard display.
 * Shows rank, initials, score, and date columns.
 */
export function HighScoreBoard({
  scores,
  highlightIndex,
  emptyMessage,
}: {
  scores: HighScore[];
  highlightIndex?: number;
  emptyMessage?: string;
}) {
  if (scores.length === 0) {
    return (
      <div className="hs-board-empty">
        <p>{emptyMessage ?? "No scores yet. Be the first!"}</p>
      </div>
    );
  }

  return (
    <div className="hs-board">
      <div className="hs-board-header">
        <span className="hs-col-rank">#</span>
        <span className="hs-col-initials">Name</span>
        <span className="hs-col-score">Score</span>
        <span className="hs-col-date">Date</span>
      </div>
      <div className="hs-board-body">
        {scores.map((entry, i) => (
          <div
            key={`${i}-${entry.date}`}
            className={`hs-board-row${i === highlightIndex ? " hs-board-row-highlight" : ""}`}
          >
            <span className="hs-col-rank">{i + 1}</span>
            <span className="hs-col-initials">{entry.initials}</span>
            <span className="hs-col-score">{entry.score.toLocaleString()}</span>
            <span className="hs-col-date">
              {new Date(entry.date).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
