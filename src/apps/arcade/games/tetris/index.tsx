import type { GameDefinition } from "../../types";
import type { TetrisState } from "./tetris-engine";
import { createInitialState, BOARD_WIDTH, BOARD_HEIGHT } from "./tetris-engine";
import { TetrisGame } from "./TetrisGame";

function TetrisIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="17" width="8" height="4" rx="1" />
    </svg>
  );
}

function validateState(raw: unknown): TetrisState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;

  // Basic shape validation
  if (!Array.isArray(s.board)) return null;
  if (s.board.length !== BOARD_HEIGHT) return null;
  if (typeof s.score !== "number") return null;
  if (typeof s.level !== "number") return null;
  if (typeof s.lines !== "number") return null;
  if (typeof s.gameOver !== "boolean") return null;

  // Board width check
  for (const row of s.board as unknown[][]) {
    if (!Array.isArray(row) || row.length !== BOARD_WIDTH) return null;
  }

  return raw as TetrisState;
}

export const tetrisGame: GameDefinition<TetrisState> = {
  id: "tetris",
  name: "Tetris",
  description: "The classic block-stacking puzzle game",
  icon: TetrisIcon,
  accentColor: "hsl(180, 80%, 45%)",

  component: TetrisGame,
  createInitialState,
  validateState,
};
