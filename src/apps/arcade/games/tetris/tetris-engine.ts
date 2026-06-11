/* ── Tetris Engine ──────────────────────────────────────────────────
   Pure game logic — no React, no DOM, fully serializable state.
   All mutations return new state objects (immutable pattern).
   ──────────────────────────────────────────────────────────────────── */

/* ── Constants ───────────────────────────────────────────────────── */

export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;
export const CELL_SIZE = 28;

/** Piece type indices (1-7, 0 = empty cell). */
export const enum PieceType {
  I = 1,
  O = 2,
  T = 3,
  S = 4,
  Z = 5,
  J = 6,
  L = 7,
}

/** Colors for each piece type (index 0 unused). */
export const PIECE_COLORS = [
  "",               // 0: empty
  "#00f0f0",        // I: cyan
  "#f0f000",        // O: yellow
  "#a000f0",        // T: purple
  "#00f000",        // S: green
  "#f00000",        // Z: red
  "#0000f0",        // J: blue
  "#f0a000",        // L: orange
];

/** Ghost piece opacity. */
export const GHOST_ALPHA = 0.25;

/**
 * Rotation matrices for each piece type.
 * Each piece has 4 rotation states, each a 2D array of [row, col] offsets.
 */
const SHAPES: Record<number, number[][][]> = {
  [PieceType.I]: [
    [[0,0],[0,1],[0,2],[0,3]],
    [[0,0],[1,0],[2,0],[3,0]],
    [[0,0],[0,1],[0,2],[0,3]],
    [[0,0],[1,0],[2,0],[3,0]],
  ],
  [PieceType.O]: [
    [[0,0],[0,1],[1,0],[1,1]],
    [[0,0],[0,1],[1,0],[1,1]],
    [[0,0],[0,1],[1,0],[1,1]],
    [[0,0],[0,1],[1,0],[1,1]],
  ],
  [PieceType.T]: [
    [[0,1],[1,0],[1,1],[1,2]],
    [[0,0],[1,0],[1,1],[2,0]],
    [[0,0],[0,1],[0,2],[1,1]],
    [[0,1],[1,0],[1,1],[2,1]],
  ],
  [PieceType.S]: [
    [[0,1],[0,2],[1,0],[1,1]],
    [[0,0],[1,0],[1,1],[2,1]],
    [[0,1],[0,2],[1,0],[1,1]],
    [[0,0],[1,0],[1,1],[2,1]],
  ],
  [PieceType.Z]: [
    [[0,0],[0,1],[1,1],[1,2]],
    [[0,1],[1,0],[1,1],[2,0]],
    [[0,0],[0,1],[1,1],[1,2]],
    [[0,1],[1,0],[1,1],[2,0]],
  ],
  [PieceType.J]: [
    [[0,0],[1,0],[1,1],[1,2]],
    [[0,0],[0,1],[1,0],[2,0]],
    [[0,0],[0,1],[0,2],[1,2]],
    [[0,0],[1,0],[2,0],[2,-1]],
  ],
  [PieceType.L]: [
    [[0,2],[1,0],[1,1],[1,2]],
    [[0,0],[1,0],[2,0],[2,1]],
    [[0,0],[0,1],[0,2],[1,0]],
    [[0,0],[0,1],[1,1],[2,1]],
  ],
};

/** Wall kick offsets for standard pieces (SRS-like). */
const WALL_KICKS: [number, number][] = [
  [0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1],
];

/** Wall kick offsets for I piece. */
const I_WALL_KICKS: [number, number][] = [
  [0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2],
];

/* ── State Types ─────────────────────────────────────────────────── */

export interface Piece {
  type: PieceType;
  rotation: number;   // 0-3
  x: number;          // column offset
  y: number;          // row offset (can be negative for spawn)
}

export interface TetrisState {
  board: number[][];           // BOARD_HEIGHT × BOARD_WIDTH
  currentPiece: Piece | null;
  nextPiece: PieceType;
  score: number;
  level: number;
  lines: number;
  gameOver: boolean;
}

/* ── Board Helpers ───────────────────────────────────────────────── */

export function createEmptyBoard(): number[][] {
  return Array.from({ length: BOARD_HEIGHT }, () =>
    Array.from({ length: BOARD_WIDTH }, () => 0),
  );
}

function cloneBoard(board: number[][]): number[][] {
  return board.map((row) => [...row]);
}

/** Get the cell positions of a piece in board coordinates. */
export function getPieceCells(piece: Piece): [number, number][] {
  const shape = SHAPES[piece.type][piece.rotation];
  return shape.map(([r, c]) => [piece.y + r, piece.x + c]);
}

/** Check if a piece position is valid (no collisions, in bounds). */
function isValidPosition(board: number[][], piece: Piece): boolean {
  const cells = getPieceCells(piece);
  for (const [r, c] of cells) {
    if (c < 0 || c >= BOARD_WIDTH) return false;
    if (r >= BOARD_HEIGHT) return false;
    // Allow pieces above the board (negative rows) during spawn
    if (r >= 0 && board[r][c] !== 0) return false;
  }
  return true;
}

/* ── Random Piece Generation ─────────────────────────────────────── */

const PIECE_TYPES: PieceType[] = [
  PieceType.I, PieceType.O, PieceType.T,
  PieceType.S, PieceType.Z, PieceType.J, PieceType.L,
];

export function randomPieceType(): PieceType {
  return PIECE_TYPES[Math.floor(Math.random() * PIECE_TYPES.length)];
}

/* ── Drop Speed ──────────────────────────────────────────────────── */

/** Get the tick interval (ms) for a given level. */
export function getTickInterval(level: number): number {
  // Starts at 800ms, decreases by ~50ms per level, min 50ms
  return Math.max(50, 800 - (level - 1) * 50);
}

/* ── State Creation ──────────────────────────────────────────────── */

export function createInitialState(): TetrisState {
  const nextPiece = randomPieceType();
  const state: TetrisState = {
    board: createEmptyBoard(),
    currentPiece: null,
    nextPiece,
    score: 0,
    level: 1,
    lines: 0,
    gameOver: false,
  };
  return spawnPiece(state);
}

/** Spawn the next piece at the top of the board. */
function spawnPiece(state: TetrisState): TetrisState {
  const piece: Piece = {
    type: state.nextPiece,
    rotation: 0,
    x: Math.floor((BOARD_WIDTH - 3) / 2),
    y: -1,
  };

  // Adjust spawn for I piece (wider)
  if (piece.type === PieceType.I) {
    piece.x = Math.floor((BOARD_WIDTH - 4) / 2);
  }

  if (!isValidPosition(state.board, piece)) {
    // Can't spawn — game over
    return { ...state, currentPiece: piece, gameOver: true };
  }

  return {
    ...state,
    currentPiece: piece,
    nextPiece: randomPieceType(),
  };
}

/* ── Lock & Line Clear ───────────────────────────────────────────── */

/** Lock the current piece into the board and handle line clears. */
function lockPiece(state: TetrisState): TetrisState {
  if (!state.currentPiece) return state;

  const board = cloneBoard(state.board);
  const cells = getPieceCells(state.currentPiece);

  // Place piece on board
  for (const [r, c] of cells) {
    if (r >= 0 && r < BOARD_HEIGHT && c >= 0 && c < BOARD_WIDTH) {
      board[r][c] = state.currentPiece.type;
    }
  }

  // Check for complete lines
  const fullRows: number[] = [];
  for (let r = 0; r < BOARD_HEIGHT; r++) {
    if (board[r].every((cell) => cell !== 0)) {
      fullRows.push(r);
    }
  }

  // Remove full rows and add empty rows at top
  if (fullRows.length > 0) {
    const newBoard = board.filter((_, i) => !fullRows.includes(i));
    while (newBoard.length < BOARD_HEIGHT) {
      newBoard.unshift(Array.from({ length: BOARD_WIDTH }, () => 0));
    }

    const linesCleared = fullRows.length;
    const newLines = state.lines + linesCleared;
    const newLevel = Math.floor(newLines / 10) + 1;

    // Scoring: 1=100, 2=300, 3=500, 4=800, × level
    const lineScores = [0, 100, 300, 500, 800];
    const addedScore = (lineScores[linesCleared] ?? 0) * state.level;

    const newState: TetrisState = {
      ...state,
      board: newBoard,
      currentPiece: null,
      score: state.score + addedScore,
      lines: newLines,
      level: newLevel,
    };
    return spawnPiece(newState);
  }

  const newState: TetrisState = {
    ...state,
    board,
    currentPiece: null,
  };
  return spawnPiece(newState);
}

/* ── Movement ────────────────────────────────────────────────────── */

export function moveLeft(state: TetrisState): TetrisState {
  if (!state.currentPiece || state.gameOver) return state;
  const moved = { ...state.currentPiece, x: state.currentPiece.x - 1 };
  if (isValidPosition(state.board, moved)) {
    return { ...state, currentPiece: moved };
  }
  return state;
}

export function moveRight(state: TetrisState): TetrisState {
  if (!state.currentPiece || state.gameOver) return state;
  const moved = { ...state.currentPiece, x: state.currentPiece.x + 1 };
  if (isValidPosition(state.board, moved)) {
    return { ...state, currentPiece: moved };
  }
  return state;
}

/** Soft drop — move piece down one row. Returns locked state if can't move. */
export function moveDown(state: TetrisState): TetrisState {
  if (!state.currentPiece || state.gameOver) return state;
  const moved = { ...state.currentPiece, y: state.currentPiece.y + 1 };
  if (isValidPosition(state.board, moved)) {
    return { ...state, currentPiece: moved };
  }
  // Can't move down — lock the piece
  return lockPiece(state);
}

/** Hard drop — instantly drop piece to lowest valid position. */
export function hardDrop(state: TetrisState): TetrisState {
  if (!state.currentPiece || state.gameOver) return state;

  let piece = { ...state.currentPiece };
  let dropDistance = 0;
  while (isValidPosition(state.board, { ...piece, y: piece.y + 1 })) {
    piece.y++;
    dropDistance++;
  }

  // Add hard drop bonus (2 points per cell dropped)
  const newState: TetrisState = {
    ...state,
    currentPiece: piece,
    score: state.score + dropDistance * 2,
  };
  return lockPiece(newState);
}

/** Rotate piece clockwise with wall kicks. */
export function rotateCW(state: TetrisState): TetrisState {
  if (!state.currentPiece || state.gameOver) return state;
  return tryRotation(state, (state.currentPiece.rotation + 1) % 4);
}

/** Rotate piece counterclockwise with wall kicks. */
export function rotateCCW(state: TetrisState): TetrisState {
  if (!state.currentPiece || state.gameOver) return state;
  return tryRotation(state, (state.currentPiece.rotation + 3) % 4);
}

function tryRotation(state: TetrisState, newRotation: number): TetrisState {
  if (!state.currentPiece) return state;

  const kicks = state.currentPiece.type === PieceType.I
    ? I_WALL_KICKS
    : WALL_KICKS;

  for (const [dx, dy] of kicks) {
    const rotated: Piece = {
      ...state.currentPiece,
      rotation: newRotation,
      x: state.currentPiece.x + dx,
      y: state.currentPiece.y + dy,
    };
    if (isValidPosition(state.board, rotated)) {
      return { ...state, currentPiece: rotated };
    }
  }

  return state; // No valid rotation found
}

/** Gravity tick — same as soft drop but no score bonus. */
export function tick(state: TetrisState): TetrisState {
  return moveDown(state);
}

/* ── Ghost Piece ─────────────────────────────────────────────────── */

/** Calculate where the current piece would land (for ghost rendering). */
export function getGhostPiece(state: TetrisState): Piece | null {
  if (!state.currentPiece) return null;
  let ghost = { ...state.currentPiece };
  while (isValidPosition(state.board, { ...ghost, y: ghost.y + 1 })) {
    ghost.y++;
  }
  return ghost;
}
