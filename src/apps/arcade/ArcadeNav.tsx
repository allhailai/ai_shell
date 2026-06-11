import type { GameDefinition } from "./types";

/**
 * Left navigation for the Arcade app.
 * - No active game → shows game list
 * - Active game → shows game name (highlighted) + back link
 */
export function ArcadeNav({
  games,
  activeGameId,
  onSelectGame,
  onBackToLauncher,
}: {
  games: GameDefinition[];
  activeGameId: string | null;
  onSelectGame: (gameId: string) => void;
  onBackToLauncher: () => void;
}) {
  return (
    <div className="arcade-nav">
      {activeGameId ? (
        <>
          <button
            className="nav-item nav-item-home"
            onClick={onBackToLauncher}
            type="button"
          >
            <span className="nav-item-icon">
              <BackIcon />
            </span>
            <span className="nav-item-label">All Games</span>
          </button>

          <div className="nav-divider" />

          {games.map((g) => (
            <button
              key={g.id}
              className={`nav-item${g.id === activeGameId ? " active" : ""}`}
              onClick={() => onSelectGame(g.id)}
              type="button"
            >
              <span className="nav-item-icon">
                <g.icon size={18} />
              </span>
              <span className="nav-item-label">{g.name}</span>
            </button>
          ))}
        </>
      ) : (
        <>
          <div className="nav-group-label">Games</div>
          {games.map((g) => (
            <button
              key={g.id}
              className="nav-item"
              onClick={() => onSelectGame(g.id)}
              type="button"
            >
              <span className="nav-item-icon">
                <g.icon size={18} />
              </span>
              <span className="nav-item-label">{g.name}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
