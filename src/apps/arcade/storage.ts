import type { HighScore, SavedGameState } from "./types";

/* ── Arcade Storage Layer ───────────────────────────────────────────
   All persistence goes through localStorage with typed helpers.
   Keys are namespaced as `arcade:*` to avoid collisions.
   ──────────────────────────────────────────────────────────────────── */

const GAME_STATE_PREFIX = "arcade:game-state:";
const HIGH_SCORES_PREFIX = "arcade:high-scores:";
const MAX_HIGH_SCORES = 100;

/* ── Game State ─────────────────────────────────────────────────── */

export function saveGameState<TState>(
  gameId: string,
  data: SavedGameState<TState>,
): void {
  try {
    localStorage.setItem(
      GAME_STATE_PREFIX + gameId,
      JSON.stringify(data),
    );
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

export function loadGameState<TState>(
  gameId: string,
): SavedGameState<TState> | null {
  try {
    const raw = localStorage.getItem(GAME_STATE_PREFIX + gameId);
    if (!raw) return null;
    return JSON.parse(raw) as SavedGameState<TState>;
  } catch {
    return null;
  }
}

export function clearGameState(gameId: string): void {
  localStorage.removeItem(GAME_STATE_PREFIX + gameId);
}

export function hasSavedGame(gameId: string): boolean {
  return localStorage.getItem(GAME_STATE_PREFIX + gameId) !== null;
}

/* ── High Scores ────────────────────────────────────────────────── */

export function loadHighScores(gameId: string): HighScore[] {
  try {
    const raw = localStorage.getItem(HIGH_SCORES_PREFIX + gameId);
    if (!raw) return [];
    const scores = JSON.parse(raw) as HighScore[];
    return scores.slice(0, MAX_HIGH_SCORES);
  } catch {
    return [];
  }
}

export function saveHighScore(gameId: string, entry: HighScore): HighScore[] {
  const scores = loadHighScores(gameId);

  // Insert in sorted position (descending by score)
  const idx = scores.findIndex((s) => entry.score > s.score);
  if (idx === -1) {
    scores.push(entry);
  } else {
    scores.splice(idx, 0, entry);
  }

  // Trim to max
  const trimmed = scores.slice(0, MAX_HIGH_SCORES);

  try {
    localStorage.setItem(
      HIGH_SCORES_PREFIX + gameId,
      JSON.stringify(trimmed),
    );
  } catch {
    // silently fail
  }

  return trimmed;
}

/**
 * Check if a score qualifies for the top 100.
 * Returns the rank (1-indexed) or null if it doesn't qualify.
 */
export function getScoreRank(gameId: string, score: number): number | null {
  if (score <= 0) return null;
  const scores = loadHighScores(gameId);
  if (scores.length < MAX_HIGH_SCORES) {
    // Board isn't full — any positive score qualifies
    const rank = scores.findIndex((s) => score > s.score);
    return rank === -1 ? scores.length + 1 : rank + 1;
  }
  // Board is full — must beat the lowest
  const lowest = scores[scores.length - 1];
  if (score <= lowest.score) return null;
  const rank = scores.findIndex((s) => score > s.score);
  return rank + 1;
}
