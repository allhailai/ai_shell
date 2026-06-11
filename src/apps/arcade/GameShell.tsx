import { useCallback, useEffect, useRef, useState } from "react";
import type { GameDefinition, SavedGameState } from "./types";
import {
  saveGameState,
  loadGameState,
  clearGameState,
  getScoreRank,
  saveHighScore,
} from "./storage";
import { HighScoreEntry } from "./HighScoreEntry";

/* ── Constants ───────────────────────────────────────────────────── */

const SAVE_DEBOUNCE_MS = 500;

/* ── Game Shell ──────────────────────────────────────────────────── */

/**
 * GameShell wraps any game component with:
 * - Pause/resume (Escape key, visibility change, external toggle)
 * - State persistence (debounced localStorage saves)
 * - Game-over → high score entry flow
 *
 * It owns the game state and passes it down to the game component.
 */
export function GameShell<TState>({
  game,
  isPaused: externalPaused,
  onPauseChange,
  onScoreChange,
  onLevelChange,
  onQuit,
}: {
  game: GameDefinition<TState>;
  isPaused: boolean;
  onPauseChange: (paused: boolean) => void;
  onScoreChange: (score: number) => void;
  onLevelChange: (level: number) => void;
  onQuit: () => void;
}) {
  // Initialize state: try to restore from localStorage, or create fresh
  const [gameState, setGameState] = useState<TState>(() => {
    const saved = loadGameState<TState>(game.id);
    if (saved) {
      const validated = game.validateState
        ? game.validateState(saved.state)
        : (saved.state as TState);
      if (validated) return validated;
    }
    return game.createInitialState();
  });

  const [showHighScoreEntry, setShowHighScoreEntry] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [scoreRank, setScoreRank] = useState(1);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scoreRef = useRef(0);
  const levelRef = useRef(1);

  const GameComponent = game.component;

  /* ── Debounced Save ───────────────────────────────────────────── */

  const saveNow = useCallback(
    (state: TState) => {
      const data: SavedGameState<TState> = {
        state,
        score: scoreRef.current,
        level: levelRef.current,
        timestamp: Date.now(),
      };
      saveGameState(game.id, data);
    },
    [game.id],
  );

  const debouncedSave = useCallback(
    (state: TState) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveNow(state), SAVE_DEBOUNCE_MS);
    },
    [saveNow],
  );

  /* ── Callbacks for Game Component ──────────────────────────────── */

  const handleStateChange = useCallback(
    (newState: TState) => {
      setGameState(newState);
      debouncedSave(newState);
    },
    [debouncedSave],
  );

  const handleScoreChange = useCallback(
    (score: number) => {
      scoreRef.current = score;
      onScoreChange(score);
    },
    [onScoreChange],
  );

  const handleLevelChange = useCallback(
    (level: number) => {
      levelRef.current = level;
      onLevelChange(level);
    },
    [onLevelChange],
  );

  const handleGameOver = useCallback(
    (score: number) => {
      // Clear saved game state — game is over
      clearGameState(game.id);

      // Check if it qualifies for the leaderboard
      const rank = getScoreRank(game.id, score);
      if (rank !== null) {
        setFinalScore(score);
        setScoreRank(rank);
        setShowHighScoreEntry(true);
        onPauseChange(true); // Pause while entering initials
      }
    },
    [game.id, onPauseChange],
  );

  const handleHighScoreSubmit = useCallback(
    (initials: string) => {
      saveHighScore(game.id, {
        initials,
        score: finalScore,
        level: levelRef.current,
        date: new Date().toISOString(),
      });
      setShowHighScoreEntry(false);
    },
    [game.id, finalScore],
  );

  /* ── Escape Key → Toggle Pause ─────────────────────────────────── */

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !showHighScoreEntry) {
        e.preventDefault();
        onPauseChange(!externalPaused);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [externalPaused, onPauseChange, showHighScoreEntry]);

  /* ── Visibility Change → Auto-Pause ────────────────────────────── */

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && !externalPaused) {
        onPauseChange(true);
        saveNow(gameState);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [externalPaused, onPauseChange, saveNow, gameState]);

  /* ── Before Unload → Immediate Save ────────────────────────────── */

  useEffect(() => {
    const handleBeforeUnload = () => {
      saveNow(gameState);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveNow, gameState]);

  /* ── Immediate Save on Pause ───────────────────────────────────── */

  useEffect(() => {
    if (externalPaused) {
      saveNow(gameState);
    }
  }, [externalPaused, saveNow, gameState]);

  /* ── New Game ──────────────────────────────────────────────────── */

  const handleNewGame = useCallback(() => {
    clearGameState(game.id);
    const fresh = game.createInitialState();
    setGameState(fresh);
    scoreRef.current = 0;
    levelRef.current = 1;
    onScoreChange(0);
    onLevelChange(1);
    onPauseChange(false);
  }, [game, onScoreChange, onLevelChange, onPauseChange]);

  /* ── Render ────────────────────────────────────────────────────── */

  // Check if the current state represents a finished game
  const isGameOver = (gameState as Record<string, unknown>).gameOver === true;

  return (
    <div className="game-shell">
      <GameComponent
        state={gameState}
        onStateChange={handleStateChange}
        onScoreChange={handleScoreChange}
        onLevelChange={handleLevelChange}
        onGameOver={handleGameOver}
        isPaused={externalPaused || showHighScoreEntry}
        onPauseToggle={() => onPauseChange(!externalPaused)}
      />

      {/* Pause overlay */}
      {externalPaused && !showHighScoreEntry && !isGameOver && (
        <div className="game-pause-overlay">
          <div className="game-pause-content">
            <div className="game-pause-icon">⏸</div>
            <h2 className="game-pause-title">Paused</h2>
            <div className="game-pause-actions">
              <button
                className="game-pause-btn game-pause-btn-primary"
                onClick={() => onPauseChange(false)}
                type="button"
              >
                Resume
              </button>
              <button
                className="game-pause-btn"
                onClick={handleNewGame}
                type="button"
              >
                New Game
              </button>
              <button
                className="game-pause-btn"
                onClick={onQuit}
                type="button"
              >
                Quit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game over overlay (no high score) */}
      {isGameOver && !showHighScoreEntry && (
        <div className="game-pause-overlay">
          <div className="game-pause-content">
            <div className="game-pause-icon">💀</div>
            <h2 className="game-pause-title">Game Over</h2>
            <p className="game-over-score">{scoreRef.current.toLocaleString()} pts</p>
            <div className="game-pause-actions">
              <button
                className="game-pause-btn game-pause-btn-primary"
                onClick={handleNewGame}
                type="button"
              >
                Play Again
              </button>
              <button
                className="game-pause-btn"
                onClick={onQuit}
                type="button"
              >
                Quit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* High score entry modal */}
      {showHighScoreEntry && (
        <HighScoreEntry
          score={finalScore}
          rank={scoreRank}
          onSubmit={handleHighScoreSubmit}
        />
      )}
    </div>
  );
}
