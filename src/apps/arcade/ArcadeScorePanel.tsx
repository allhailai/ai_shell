import { useState } from "react";
import type { GameDefinition } from "./types";
import { loadHighScores } from "./storage";
import { HighScoreBoard } from "./HighScoreBoard";

/**
 * Right panel showing high scores for the active game,
 * or an overview when on the launcher.
 */
export function ArcadeScorePanel({
  games,
  activeGameId,
}: {
  params?: Record<string, string>;
  games: GameDefinition[];
  activeGameId: string | null;
}) {
  // Determine which game's scores to show
  const gameId = activeGameId ?? games[0]?.id;

  // If multiple games, allow tab switching when no game is active
  const [selectedTab, setSelectedTab] = useState(gameId ?? "");

  const displayGameId = activeGameId ? activeGameId : selectedTab;
  const displayGame = games.find((g) => g.id === displayGameId);
  const displayScores = displayGameId ? loadHighScores(displayGameId) : [];

  return (
    <div className="arcade-score-panel">
      {/* Game selector tabs (only when no active game and multiple games) */}
      {!activeGameId && games.length > 1 && (
        <div className="arcade-score-tabs">
          {games.map((g) => (
            <button
              key={g.id}
              className={`arcade-score-tab${g.id === displayGameId ? " active" : ""}`}
              onClick={() => setSelectedTab(g.id)}
              type="button"
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      <h3 className="arcade-score-title">
        {displayGame ? `${displayGame.name} — High Scores` : "High Scores"}
      </h3>

      <HighScoreBoard scores={displayScores} />
    </div>
  );
}
