import type { GameDefinition } from "../../types";
import type { PacmanState } from "./pacman-engine";
import { createInitialState, COLS } from "./pacman-engine";
import { PacmanGame } from "./PacmanGame";

function PacmanIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 1a9 9 0 0 1 6.36 2.64L12 12l6.36 6.36A9 9 0 1 1 12 3z" />
    </svg>
  );
}

function validateState(raw: unknown): PacmanState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;

  // Basic shape validation
  if (!Array.isArray(s.board)) return null;
  if (typeof s.score !== "number") return null;
  if (typeof s.level !== "number") return null;
  if (typeof s.lives !== "number") return null;
  if (typeof s.gameOver !== "boolean") return null;
  if (typeof s.pacRow !== "number") return null;
  if (typeof s.pacCol !== "number") return null;

  // Board width check
  for (const row of s.board as unknown[][]) {
    if (!Array.isArray(row) || row.length !== COLS) return null;
  }

  return raw as PacmanState;
}

export const pacmanGame: GameDefinition<PacmanState> = {
  id: "pacman",
  name: "Pac-Man",
  description: "Eat all the dots and avoid the ghosts!",
  icon: PacmanIcon,
  accentColor: "hsl(50, 95%, 50%)",

  component: PacmanGame,
  createInitialState,
  validateState,
};
