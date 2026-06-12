import { useState, useCallback, useMemo, useEffect } from "react";
import type { GameDefinition } from "./types";
import { GameLauncher } from "./GameLauncher";
import { GameShell } from "./GameShell";
import { ArcadeNav } from "./ArcadeNav";
import { ArcadeScorePanel } from "./ArcadeScorePanel";
import { useSyncExternalStore } from "react";

// Games registry — import all game definitions here
import { tetrisGame } from "./games/tetris";
import { galagaGame } from "./games/galaga";
import { pacmanGame } from "./games/pacman";

/** All available games in the arcade. */
const ARCADE_GAMES: GameDefinition[] = [
  tetrisGame as GameDefinition,
  galagaGame as GameDefinition,
  pacmanGame as GameDefinition,
];

/* ── Shared State ─────────────────────────────────────────────────
   Module-level state + subscribers so that ArcadeNav, ArcadeHeaderItems,
   and ArcadeScorePanel (rendered as separate components by the shell)
   can access the same state as ArcadeContent.
   ──────────────────────────────────────────────────────────────── */

interface ArcadeState {
  activeGameId: string | null;
  isPaused: boolean;
  score: number;
  level: number;
}

let arcadeState: ArcadeState = {
  activeGameId: null,
  isPaused: false,
  score: 0,
  level: 0,
};

const listeners = new Set<() => void>();

function setArcadeState(partial: Partial<ArcadeState>) {
  arcadeState = { ...arcadeState, ...partial };
  for (const listener of listeners) listener();
}

function subscribeArcade(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getArcadeSnapshot(): ArcadeState {
  return arcadeState;
}

function useArcadeState(): ArcadeState {
  return useSyncExternalStore(subscribeArcade, getArcadeSnapshot);
}

export { ARCADE_GAMES, subscribeArcade, getArcadeSnapshot, setArcadeState };

/**
 * Main content component for the Arcade app.
 * Routes between the game launcher and the active game.
 */
export function ArcadeContent() {
  const state = useArcadeState();
  const [localGameId, setLocalGameId] = useState<string | null>(state.activeGameId);
  const [localPaused, setLocalPaused] = useState(false);

  const activeGame = useMemo(
    () => ARCADE_GAMES.find((g) => g.id === localGameId) ?? null,
    [localGameId],
  );

  // Listen for navigation events from the nav wrapper
  useEffect(() => {
    const handler = (e: Event) => {
      const gameId = (e as CustomEvent).detail as string | null;
      setLocalGameId(gameId);
      setLocalPaused(false);
    };
    window.addEventListener("arcade:navigate", handler);
    return () => window.removeEventListener("arcade:navigate", handler);
  }, []);

  // Sync pause state from header button
  useEffect(() => {
    const handler = () => {
      const snap = getArcadeSnapshot();
      setLocalPaused(snap.isPaused);
    };
    window.addEventListener("arcade:pause-toggle", handler);
    return () => window.removeEventListener("arcade:pause-toggle", handler);
  }, []);

  const handleSelectGame = useCallback((gameId: string) => {
    setLocalGameId(gameId);
    setLocalPaused(false);
    setArcadeState({ activeGameId: gameId, isPaused: false, score: 0, level: 0 });
  }, []);

  const handleQuit = useCallback(() => {
    setLocalGameId(null);
    setLocalPaused(false);
    setArcadeState({ activeGameId: null, isPaused: false, score: 0, level: 0 });
  }, []);

  const handlePauseChange = useCallback((paused: boolean) => {
    setLocalPaused(paused);
    setArcadeState({ isPaused: paused });
  }, []);

  const handleScoreChange = useCallback((score: number) => {
    setArcadeState({ score });
  }, []);

  const handleLevelChange = useCallback((level: number) => {
    setArcadeState({ level });
  }, []);

  if (!activeGame) {
    return (
      <GameLauncher
        games={ARCADE_GAMES}
        onSelectGame={handleSelectGame}
      />
    );
  }

  return (
    <GameShell
      key={activeGame.id}
      game={activeGame}
      isPaused={localPaused}
      onPauseChange={handlePauseChange}
      onScoreChange={handleScoreChange}
      onLevelChange={handleLevelChange}
      onQuit={handleQuit}
    />
  );
}

/**
 * Left nav wrapper — reads shared state so it stays in sync.
 */
export function ArcadeNavWrapper() {
  const state = useArcadeState();

  const handleSelectGame = useCallback((gameId: string) => {
    setArcadeState({ activeGameId: gameId, isPaused: false, score: 0, level: 0 });
    window.dispatchEvent(new CustomEvent("arcade:navigate", { detail: gameId }));
  }, []);

  const handleBackToLauncher = useCallback(() => {
    setArcadeState({ activeGameId: null, isPaused: false, score: 0, level: 0 });
    window.dispatchEvent(new CustomEvent("arcade:navigate", { detail: null }));
  }, []);

  return (
    <ArcadeNav
      games={ARCADE_GAMES}
      activeGameId={state.activeGameId}
      onSelectGame={handleSelectGame}
      onBackToLauncher={handleBackToLauncher}
    />
  );
}

/**
 * Score panel wrapper — reads shared state.
 */
export function ArcadeScorePanelWrapper(props: { params?: Record<string, string> }) {
  const state = useArcadeState();

  return (
    <ArcadeScorePanel
      params={props.params}
      games={ARCADE_GAMES}
      activeGameId={state.activeGameId}
    />
  );
}
