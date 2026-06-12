/* ── Pac-Man Engine ───────────────────────────────────────────────────
   Pure-function game engine for Pac-Man.
   No React, no DOM — just state transformations.
   ──────────────────────────────────────────────────────────────────── */

// ── Constants ───────────────────────────────────────────────────────

export const TILE_SIZE = 24;
export const COLS = 21;
export const ROWS = 23;

/** Tile types */
const WALL = 1;
const DOT = 2;
const POWER = 3;
const EMPTY = 0;

export const TILE = { WALL, DOT, POWER, EMPTY } as const;

/** Directions */
export type Direction = "up" | "down" | "left" | "right";

const DIR_VECTORS: Record<Direction, [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

// ── Ghost modes ─────────────────────────────────────────────────────

export type GhostMode = "scatter" | "chase" | "frightened" | "eaten";

export interface Ghost {
  row: number;
  col: number;
  dir: Direction;
  mode: GhostMode;
  color: string;
  name: string;
  /** Scatter target corner */
  scatterRow: number;
  scatterCol: number;
  /** Frame counter for movement speed */
  moveTimer: number;
  /** Steps before ghost can leave pen */
  penTimer: number;
}

// ── State ───────────────────────────────────────────────────────────

export interface PacmanState {
  board: number[][];
  pacRow: number;
  pacCol: number;
  pacDir: Direction;
  pacNextDir: Direction;
  pacMouthOpen: boolean;
  pacMouthTimer: number;
  ghosts: Ghost[];
  score: number;
  level: number;
  lives: number;
  dotsRemaining: number;
  totalDots: number;
  frightenedTimer: number;
  ghostsEatenCombo: number;
  modeTimer: number;
  modePhase: number;
  gameOver: boolean;
  tickCount: number;
  moveTimer: number;
}

// ── Level Layout ────────────────────────────────────────────────────
// 1=wall, 2=dot, 3=power pellet, 0=empty
// Classic 21x23 Pac-Man inspired layout

const BASE_LAYOUT: number[][] = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,1],
  [1,3,1,1,2,1,1,1,2,1,1,1,2,1,1,1,2,1,1,3,1],
  [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
  [1,2,1,1,2,1,2,1,1,1,1,1,1,1,2,1,2,1,1,2,1],
  [1,2,2,2,2,1,2,2,2,2,1,2,2,2,2,1,2,2,2,2,1],
  [1,1,1,1,2,1,1,1,0,1,1,1,0,1,1,1,2,1,1,1,1],
  [0,0,0,1,2,1,0,0,0,0,0,0,0,0,0,1,2,1,0,0,0],
  [1,1,1,1,2,1,0,1,1,0,0,0,1,1,0,1,2,1,1,1,1],
  [0,0,0,0,2,0,0,1,0,0,0,0,0,1,0,0,2,0,0,0,0],
  [1,1,1,1,2,1,0,1,0,0,0,0,0,1,0,1,2,1,1,1,1],
  [0,0,0,1,2,1,0,1,1,1,1,1,1,1,0,1,2,1,0,0,0],
  [1,1,1,1,2,1,0,0,0,0,0,0,0,0,0,1,2,1,1,1,1],
  [1,2,2,2,2,2,2,2,2,2,1,2,2,2,2,2,2,2,2,2,1],
  [1,2,1,1,2,1,1,1,2,1,1,1,2,1,1,1,2,1,1,2,1],
  [1,3,2,1,2,2,2,2,2,2,0,2,2,2,2,2,2,1,2,3,1],
  [1,1,2,1,2,1,2,1,1,1,1,1,1,1,2,1,2,1,2,1,1],
  [1,2,2,2,2,1,2,2,2,2,1,2,2,2,2,1,2,2,2,2,1],
  [1,2,1,1,1,1,1,1,2,1,1,1,2,1,1,1,1,1,1,2,1],
  [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  // Tunnel row wraps handled in code
];

function cloneLayout(): number[][] {
  return BASE_LAYOUT.map((row) => [...row]);
}

function countDots(board: number[][]): number {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell === DOT || cell === POWER) count++;
    }
  }
  return count;
}

// ── Initial State ───────────────────────────────────────────────────

function createGhosts(): Ghost[] {
  return [
    { name: "blinky", row: 9, col: 10, dir: "left",  mode: "scatter", color: "hsl(0, 85%, 55%)",   scatterRow: 0,  scatterCol: 20, moveTimer: 0, penTimer: 0 },
    { name: "pinky",  row: 10, col: 10, dir: "up",    mode: "scatter", color: "hsl(320, 80%, 65%)", scatterRow: 0,  scatterCol: 0,  moveTimer: 0, penTimer: 30 },
    { name: "inky",   row: 10, col: 9,  dir: "up",    mode: "scatter", color: "hsl(180, 80%, 55%)", scatterRow: 20, scatterCol: 20, moveTimer: 0, penTimer: 60 },
    { name: "clyde",  row: 10, col: 11, dir: "up",    mode: "scatter", color: "hsl(30, 90%, 55%)",  scatterRow: 20, scatterCol: 0,  moveTimer: 0, penTimer: 90 },
  ];
}

export function createInitialState(): PacmanState {
  const board = cloneLayout();
  const dots = countDots(board);
  return {
    board,
    pacRow: 15,
    pacCol: 10,
    pacDir: "left",
    pacNextDir: "left",
    pacMouthOpen: true,
    pacMouthTimer: 0,
    ghosts: createGhosts(),
    score: 0,
    level: 1,
    lives: 3,
    dotsRemaining: dots,
    totalDots: dots,
    frightenedTimer: 0,
    ghostsEatenCombo: 0,
    modeTimer: 0,
    modePhase: 0,
    gameOver: false,
    tickCount: 0,
    moveTimer: 0,
  };
}

// ── Movement helpers ────────────────────────────────────────────────

function isWalkable(board: number[][], row: number, col: number): boolean {
  // Handle tunnel wrapping
  if (col < 0 || col >= COLS) return row === 9; // tunnel row
  if (row < 0 || row >= board.length) return false;
  return board[row][col] !== WALL;
}

function wrapCol(col: number): number {
  if (col < 0) return COLS - 1;
  if (col >= COLS) return 0;
  return col;
}

function canMove(board: number[][], row: number, col: number, dir: Direction): boolean {
  const [dr, dc] = DIR_VECTORS[dir];
  const newRow = row + dr;
  const newCol = col + dc;
  return isWalkable(board, newRow, newCol);
}

// ── Ghost AI ────────────────────────────────────────────────────────

function getGhostTarget(ghost: Ghost, state: PacmanState): [number, number] {
  if (ghost.mode === "scatter") {
    return [ghost.scatterRow, ghost.scatterCol];
  }

  if (ghost.mode === "frightened") {
    // Random-ish target based on tick count
    return [
      ((state.tickCount * 7 + ghost.scatterRow * 13) % (state.board.length)),
      ((state.tickCount * 11 + ghost.scatterCol * 17) % COLS),
    ];
  }

  // Chase mode — each ghost has different targeting
  const { pacRow, pacCol, pacDir } = state;
  const [pdr, pdc] = DIR_VECTORS[pacDir];

  switch (ghost.name) {
    case "blinky":
      // Direct chase
      return [pacRow, pacCol];
    case "pinky":
      // 4 tiles ahead of Pac-Man
      return [pacRow + pdr * 4, pacCol + pdc * 4];
    case "inky": {
      // 2 tiles ahead, then double the vector from blinky
      const blinky = state.ghosts[0];
      const aheadR = pacRow + pdr * 2;
      const aheadC = pacCol + pdc * 2;
      return [aheadR + (aheadR - blinky.row), aheadC + (aheadC - blinky.col)];
    }
    case "clyde": {
      // If close, scatter; if far, chase
      const dist = Math.abs(ghost.row - pacRow) + Math.abs(ghost.col - pacCol);
      return dist > 8 ? [pacRow, pacCol] : [ghost.scatterRow, ghost.scatterCol];
    }
    default:
      return [pacRow, pacCol];
  }
}

function distSq(r1: number, c1: number, r2: number, c2: number): number {
  return (r1 - r2) ** 2 + (c1 - c2) ** 2;
}

function chooseGhostDirection(ghost: Ghost, board: number[][]): Direction {
  const [targetRow, targetCol] = getGhostTarget(ghost, { board } as PacmanState);
  const possibleDirs: Direction[] = (["up", "down", "left", "right"] as Direction[]).filter(
    (d) => d !== OPPOSITE[ghost.dir] && canMove(board, ghost.row, ghost.col, d),
  );

  if (possibleDirs.length === 0) {
    // Dead end — reverse
    return OPPOSITE[ghost.dir];
  }

  // In frightened mode, pick randomly
  if (ghost.mode === "frightened") {
    return possibleDirs[Math.floor(Math.random() * possibleDirs.length)];
  }

  // Pick direction closest to target
  let bestDir = possibleDirs[0];
  let bestDist = Infinity;
  for (const d of possibleDirs) {
    const [dr, dc] = DIR_VECTORS[d];
    const nr = ghost.row + dr;
    const nc = ghost.col + dc;
    const dist = distSq(nr, nc, targetRow, targetCol);
    if (dist < bestDist) {
      bestDist = dist;
      bestDir = d;
    }
  }
  return bestDir;
}

// ── Ghost mode timing (scatter/chase cycle) ─────────────────────────

const MODE_DURATIONS = [
  420, // scatter 7s at 60fps
  1200, // chase 20s
  420, // scatter
  1200, // chase
  300, // scatter 5s
  1200, // chase
  300, // scatter
  Infinity, // chase forever
];

// ── Input ───────────────────────────────────────────────────────────

export function setDirection(state: PacmanState, dir: Direction): PacmanState {
  return { ...state, pacNextDir: dir };
}

// ── Tick ─────────────────────────────────────────────────────────────

const PAC_MOVE_INTERVAL = 3; // Pac-Man moves every N ticks (lower = faster)
const GHOST_MOVE_INTERVAL = 4; // Ghosts move every N ticks
const GHOST_FRIGHTENED_INTERVAL = 6; // Slower when frightened
const GHOST_EATEN_INTERVAL = 2; // Faster when eaten

export function getTickInterval(_level: number): number {
  return 1000 / 60; // 60 FPS
}

export function tick(state: PacmanState): PacmanState {
  if (state.gameOver) return state;

  let s = { ...state, tickCount: state.tickCount + 1 };

  // ── Mouth animation ─────────────────────────────────────────────
  s.pacMouthTimer++;
  if (s.pacMouthTimer >= 4) {
    s.pacMouthTimer = 0;
    s.pacMouthOpen = !s.pacMouthOpen;
  }

  // ── Frightened timer ────────────────────────────────────────────
  if (s.frightenedTimer > 0) {
    s.frightenedTimer--;
    if (s.frightenedTimer === 0) {
      s = {
        ...s,
        ghosts: s.ghosts.map((g) =>
          g.mode === "frightened" ? { ...g, mode: "chase" as GhostMode } : g,
        ),
        ghostsEatenCombo: 0,
      };
    }
  }

  // ── Mode timer (scatter/chase cycling) ──────────────────────────
  if (s.frightenedTimer === 0 && s.modePhase < MODE_DURATIONS.length) {
    s.modeTimer++;
    if (s.modeTimer >= MODE_DURATIONS[s.modePhase]) {
      s.modeTimer = 0;
      s.modePhase++;
      const newMode: GhostMode = s.modePhase % 2 === 0 ? "scatter" : "chase";
      s = {
        ...s,
        ghosts: s.ghosts.map((g) =>
          g.mode !== "eaten" && g.mode !== "frightened"
            ? { ...g, mode: newMode, dir: OPPOSITE[g.dir] }
            : g,
        ),
      };
    }
  }

  // ── Move Pac-Man ────────────────────────────────────────────────
  s.moveTimer++;
  if (s.moveTimer >= PAC_MOVE_INTERVAL) {
    s.moveTimer = 0;

    // Try desired direction first
    let moveDir = s.pacDir;
    if (canMove(s.board, s.pacRow, s.pacCol, s.pacNextDir)) {
      moveDir = s.pacNextDir;
    }

    if (canMove(s.board, s.pacRow, s.pacCol, moveDir)) {
      const [dr, dc] = DIR_VECTORS[moveDir];
      let newRow = s.pacRow + dr;
      let newCol = wrapCol(s.pacCol + dc);

      s = { ...s, pacRow: newRow, pacCol: newCol, pacDir: moveDir };

      // Eat dot
      if (newRow >= 0 && newRow < s.board.length && newCol >= 0 && newCol < COLS) {
        const cell = s.board[newRow][newCol];
        if (cell === DOT) {
          const newBoard = s.board.map((r) => [...r]);
          newBoard[newRow][newCol] = EMPTY;
          s = { ...s, board: newBoard, score: s.score + 10, dotsRemaining: s.dotsRemaining - 1 };
        } else if (cell === POWER) {
          const newBoard = s.board.map((r) => [...r]);
          newBoard[newRow][newCol] = EMPTY;
          s = {
            ...s,
            board: newBoard,
            score: s.score + 50,
            dotsRemaining: s.dotsRemaining - 1,
            frightenedTimer: 360, // 6 seconds
            ghostsEatenCombo: 0,
            ghosts: s.ghosts.map((g) =>
              g.mode !== "eaten" ? { ...g, mode: "frightened" as GhostMode, dir: OPPOSITE[g.dir] } : g,
            ),
          };
        }
      }
    }

    // Level complete?
    if (s.dotsRemaining <= 0) {
      const newBoard = cloneLayout();
      const dots = countDots(newBoard);
      return {
        ...s,
        board: newBoard,
        level: s.level + 1,
        dotsRemaining: dots,
        totalDots: dots,
        pacRow: 15,
        pacCol: 10,
        pacDir: "left",
        pacNextDir: "left",
        ghosts: createGhosts(),
        frightenedTimer: 0,
        ghostsEatenCombo: 0,
        modeTimer: 0,
        modePhase: 0,
      };
    }
  }

  // ── Move Ghosts ─────────────────────────────────────────────────
  s = {
    ...s,
    ghosts: s.ghosts.map((ghost) => {
      let g = { ...ghost };

      // Pen timer
      if (g.penTimer > 0) {
        g.penTimer--;
        return g;
      }

      // Movement speed
      const interval = g.mode === "frightened" ? GHOST_FRIGHTENED_INTERVAL :
                        g.mode === "eaten" ? GHOST_EATEN_INTERVAL :
                        GHOST_MOVE_INTERVAL;

      g.moveTimer++;
      if (g.moveTimer < interval) return g;
      g.moveTimer = 0;

      // Eaten ghosts return to pen
      if (g.mode === "eaten") {
        if (g.row === 9 && g.col === 10) {
          return { ...g, mode: s.modePhase % 2 === 0 ? "scatter" as GhostMode : "chase" as GhostMode };
        }
        // Move toward pen
        const targetR = 9, targetC = 10;
        const dirs: Direction[] = (["up", "down", "left", "right"] as Direction[]).filter(
          (d) => canMove(s.board, g.row, g.col, d),
        );
        let bestDir = g.dir;
        let bestDist = Infinity;
        for (const d of dirs) {
          const [dr, dc] = DIR_VECTORS[d];
          const dist = distSq(g.row + dr, g.col + dc, targetR, targetC);
          if (dist < bestDist) {
            bestDist = dist;
            bestDir = d;
          }
        }
        const [dr, dc] = DIR_VECTORS[bestDir];
        return { ...g, row: g.row + dr, col: wrapCol(g.col + dc), dir: bestDir };
      }

      // At intersection, choose new direction
      const possibleMoves = (["up", "down", "left", "right"] as Direction[]).filter(
        (d) => d !== OPPOSITE[g.dir] && canMove(s.board, g.row, g.col, d),
      );

      if (possibleMoves.length > 1 || !canMove(s.board, g.row, g.col, g.dir)) {
        g.dir = chooseGhostDirection({ ...g }, s.board);
      }

      if (canMove(s.board, g.row, g.col, g.dir)) {
        const [dr, dc] = DIR_VECTORS[g.dir];
        g.row += dr;
        g.col = wrapCol(g.col + dc);
      }

      return g;
    }),
  };

  // ── Collision detection ─────────────────────────────────────────
  s = {
    ...s,
    ghosts: s.ghosts.map((ghost) => {
      if (ghost.row === s.pacRow && ghost.col === s.pacCol) {
        if (ghost.mode === "frightened") {
          s.ghostsEatenCombo++;
          s.score += 200 * Math.pow(2, s.ghostsEatenCombo - 1);
          return { ...ghost, mode: "eaten" as GhostMode };
        } else if (ghost.mode !== "eaten") {
          // Pac-Man dies
          s.lives--;
          if (s.lives <= 0) {
            s.gameOver = true;
          } else {
            // Reset positions
            s.pacRow = 15;
            s.pacCol = 10;
            s.pacDir = "left";
            s.pacNextDir = "left";
            s.frightenedTimer = 0;
            s.ghostsEatenCombo = 0;
            s = { ...s, ghosts: createGhosts() };
          }
          return ghost;
        }
      }
      return ghost;
    }),
  };

  // Calculate level from score for display
  const newLevel = s.level;
  if (s.level !== newLevel) {
    s.level = newLevel;
  }

  return s;
}

// ── Rendering colors ────────────────────────────────────────────────

export const COLORS = {
  wall: "hsl(240, 80%, 40%)",
  wallStroke: "hsl(240, 70%, 55%)",
  dot: "hsl(50, 80%, 80%)",
  power: "hsl(50, 90%, 85%)",
  pacman: "hsl(50, 95%, 55%)",
  frightened: "hsl(220, 80%, 55%)",
  frightenedFlash: "hsl(0, 0%, 90%)",
  eaten: "hsl(0, 0%, 60%)",
  bg: "hsl(240, 20%, 4%)",
  text: "hsl(0, 0%, 100%)",
};
