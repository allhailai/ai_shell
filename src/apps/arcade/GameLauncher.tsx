import { useCallback } from "react";
import type { GameDefinition } from "./types";
import { hasSavedGame, loadHighScores } from "./storage";

/**
 * Game selection grid — card-based launcher for the arcade.
 * Shows a "Continue" badge if a saved state exists.
 * Shows best score if any high scores exist.
 */
export function GameLauncher({
  games,
  onSelectGame,
}: {
  games: GameDefinition[];
  onSelectGame: (gameId: string) => void;
}) {
  return (
    <div className="game-launcher">
      <div className="game-launcher-inner">
        <div className="game-launcher-header">
          <div className="game-launcher-logo">🕹️</div>
          <h1 className="game-launcher-title">Arcade</h1>
          <p className="game-launcher-subtitle">Choose a game to play</p>
        </div>

        <div className="game-launcher-grid">
          {games.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              onSelect={onSelectGame}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function GameCard({
  game,
  onSelect,
}: {
  game: GameDefinition;
  onSelect: (gameId: string) => void;
}) {
  const hasSave = hasSavedGame(game.id);
  const scores = loadHighScores(game.id);
  const bestScore = scores.length > 0 ? scores[0].score : null;
  const Icon = game.icon;

  const handleClick = useCallback(() => {
    onSelect(game.id);
  }, [game.id, onSelect]);

  return (
    <button
      className="game-card"
      onClick={handleClick}
      style={{ "--game-accent": game.accentColor } as React.CSSProperties}
      type="button"
    >
      <div className="game-card-icon-wrapper">
        <Icon size={32} />
      </div>

      <div className="game-card-info">
        <span className="game-card-name">{game.name}</span>
        <span className="game-card-desc">{game.description}</span>
      </div>

      <div className="game-card-meta">
        {hasSave && (
          <span className="game-card-badge game-card-badge-continue">
            ▶ Continue
          </span>
        )}
        {bestScore !== null && (
          <span className="game-card-best">
            Best: {bestScore.toLocaleString()}
          </span>
        )}
      </div>
    </button>
  );
}
