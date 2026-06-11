import type { ComponentType } from "react";

/* ── Arcade Game Framework Types ────────────────────────────────────
   Every game implements GameDefinition so GameShell can manage it.
   ──────────────────────────────────────────────────────────────────── */

/**
 * Props passed to every game component by the GameShell wrapper.
 * The game component is responsible for:
 * - Rendering the game using `state`
 * - Calling `onStateChange` on every meaningful tick
 * - Calling `onScoreChange` / `onLevelChange` for header display
 * - Calling `onGameOver` when the game ends
 * - Respecting `isPaused` by freezing timers/input
 */
export interface GameProps<TState = unknown> {
  /** Current game state — owned by GameShell, passed down. */
  state: TState;
  /** Report updated state (triggers debounced save). */
  onStateChange: (state: TState) => void;
  /** Report score change (updates header display). */
  onScoreChange: (score: number) => void;
  /** Report level change (updates header display). */
  onLevelChange: (level: number) => void;
  /** Report game over with final score. */
  onGameOver: (finalScore: number) => void;
  /** Whether the game is currently paused. */
  isPaused: boolean;
  /** Toggle pause state. */
  onPauseToggle: () => void;
}

/**
 * Contract that every game must implement.
 * Registered in the games array and used by GameShell + GameLauncher.
 */
export interface GameDefinition<TState = unknown> {
  /** Unique game ID — used in URLs and storage keys. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short description for the game launcher card. */
  description: string;
  /** Icon component for cards and nav. */
  icon: ComponentType<{ size?: number }>;
  /** Accent color for the card (CSS value). */
  accentColor: string;

  /** React component that renders the game. */
  component: ComponentType<GameProps<TState>>;

  /** Create a fresh initial state for a new game. */
  createInitialState: () => TState;

  /**
   * Validate or migrate a deserialized state from localStorage.
   * Returns null if the state is invalid/stale and should be discarded.
   */
  validateState?: (state: unknown) => TState | null;
}

/* ── High Score Types ────────────────────────────────────────────── */

export interface HighScore {
  /** 3-character uppercase initials. */
  initials: string;
  /** Final score. */
  score: number;
  /** Level reached. */
  level: number;
  /** ISO date string. */
  date: string;
}

/** Shape of a saved game state in localStorage. */
export interface SavedGameState<TState = unknown> {
  state: TState;
  score: number;
  level: number;
  timestamp: number;
}
