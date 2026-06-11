import { useEffect, useRef, useCallback } from "react";
import type { GameProps } from "../../types";
import {
  type TetrisState,
  BOARD_WIDTH,
  BOARD_HEIGHT,
  CELL_SIZE,
  PIECE_COLORS,
  GHOST_ALPHA,
  getPieceCells,
  getGhostPiece,
  getTickInterval,
  moveLeft,
  moveRight,
  moveDown,
  hardDrop,
  rotateCW,
  rotateCCW,
  tick,
} from "./tetris-engine";

/* ── Constants ───────────────────────────────────────────────────── */

const BOARD_PX_W = BOARD_WIDTH * CELL_SIZE;
const BOARD_PX_H = BOARD_HEIGHT * CELL_SIZE;
const PREVIEW_CELLS = 5;
const PREVIEW_SIZE = PREVIEW_CELLS * 16; // smaller cells for preview
const GRID_COLOR = "hsla(228, 14%, 20%, 0.4)";
const BORDER_COLOR = "hsla(228, 14%, 28%, 0.6)";
const BG_COLOR = "hsl(228, 16%, 5%)";

/**
 * Tetris game component — canvas-based rendering with requestAnimationFrame.
 * Receives state from GameShell, reports changes back via callbacks.
 */
export function TetrisGame({
  state,
  onStateChange,
  onScoreChange,
  onLevelChange,
  onGameOver,
  isPaused,
  onPauseToggle,
}: GameProps<TetrisState>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const lastTickRef = useRef(0);
  const rafRef = useRef(0);
  const isPausedRef = useRef(isPaused);
  const gameOverFiredRef = useRef(false);

  // Keep refs in sync
  stateRef.current = state;
  isPausedRef.current = isPaused;

  // Reset game-over flag when state resets
  useEffect(() => {
    if (!state.gameOver) {
      gameOverFiredRef.current = false;
    }
  }, [state.gameOver]);

  /* ── State Update Helper ──────────────────────────────────────── */

  const updateState = useCallback(
    (newState: TetrisState) => {
      stateRef.current = newState;
      onStateChange(newState);
      onScoreChange(newState.score);
      onLevelChange(newState.level);

      if (newState.gameOver && !gameOverFiredRef.current) {
        gameOverFiredRef.current = true;
        onGameOver(newState.score);
      }
    },
    [onStateChange, onScoreChange, onLevelChange, onGameOver],
  );

  /* ── Keyboard Input ───────────────────────────────────────────── */

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPausedRef.current) return;

      const s = stateRef.current;
      if (s.gameOver) return;

      let newState: TetrisState | null = null;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          newState = moveLeft(s);
          break;
        case "ArrowRight":
          e.preventDefault();
          newState = moveRight(s);
          break;
        case "ArrowDown":
          e.preventDefault();
          newState = moveDown(s);
          break;
        case "ArrowUp":
        case "x":
        case "X":
          e.preventDefault();
          newState = rotateCW(s);
          break;
        case "z":
        case "Z":
        case "Control":
          e.preventDefault();
          newState = rotateCCW(s);
          break;
        case " ":
          e.preventDefault();
          newState = hardDrop(s);
          break;
      }

      if (newState && newState !== s) {
        updateState(newState);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [updateState]);

  /* ── Game Loop ─────────────────────────────────────────────────── */

  useEffect(() => {
    lastTickRef.current = performance.now();

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);

      // Always render (even when paused — just don't tick)
      render(canvasRef.current, stateRef.current);

      if (isPausedRef.current || stateRef.current.gameOver) return;

      const interval = getTickInterval(stateRef.current.level);
      if (now - lastTickRef.current >= interval) {
        lastTickRef.current = now;
        const newState = tick(stateRef.current);
        if (newState !== stateRef.current) {
          updateState(newState);
        }
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateState]);

  /* ── Initial report ────────────────────────────────────────────── */

  useEffect(() => {
    onScoreChange(state.score);
    onLevelChange(state.level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="tetris-container">
      <div className="tetris-board-wrapper">
        <canvas
          ref={canvasRef}
          width={BOARD_PX_W}
          height={BOARD_PX_H}
          className="tetris-canvas"
        />
      </div>

      {/* Side panel: next piece + stats */}
      <div className="tetris-sidebar">
        <div className="tetris-sidebar-section">
          <span className="tetris-sidebar-label">Next</span>
          <NextPiecePreview pieceType={state.nextPiece} />
        </div>
        <div className="tetris-sidebar-section">
          <span className="tetris-sidebar-label">Score</span>
          <span className="tetris-sidebar-value">{state.score.toLocaleString()}</span>
        </div>
        <div className="tetris-sidebar-section">
          <span className="tetris-sidebar-label">Level</span>
          <span className="tetris-sidebar-value">{state.level}</span>
        </div>
        <div className="tetris-sidebar-section">
          <span className="tetris-sidebar-label">Lines</span>
          <span className="tetris-sidebar-value">{state.lines}</span>
        </div>
        {!state.gameOver && (
          <button
            className={`tetris-pause-btn${isPaused ? " tetris-pause-btn-resume" : ""}`}
            onClick={onPauseToggle}
            type="button"
          >
            {isPaused ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Resume
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
                Pause
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Next Piece Preview ──────────────────────────────────────────── */

function NextPiecePreview({ pieceType }: { pieceType: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cellSize = 16;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw the piece centered in the preview area
    const cells = getPieceCells({ type: pieceType, rotation: 0, x: 0, y: 0 });
    const minC = Math.min(...cells.map(([, c]) => c));
    const maxC = Math.max(...cells.map(([, c]) => c));
    const minR = Math.min(...cells.map(([r]) => r));
    const maxR = Math.max(...cells.map(([r]) => r));
    const pieceW = maxC - minC + 1;
    const pieceH = maxR - minR + 1;
    const offsetX = Math.floor((PREVIEW_CELLS - pieceW) / 2) - minC;
    const offsetY = Math.floor((PREVIEW_CELLS - pieceH) / 2) - minR;

    const color = PIECE_COLORS[pieceType];
    for (const [r, c] of cells) {
      const x = (c + offsetX) * cellSize;
      const y = (r + offsetY) * cellSize;
      drawCell(ctx, x, y, cellSize, color);
    }
  }, [pieceType]);

  return (
    <canvas
      ref={canvasRef}
      width={PREVIEW_SIZE}
      height={PREVIEW_SIZE}
      className="tetris-preview-canvas"
    />
  );
}

/* ── Rendering ───────────────────────────────────────────────────── */

function render(canvas: HTMLCanvasElement | null, state: TetrisState) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Clear
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, BOARD_PX_W, BOARD_PX_H);

  // Draw grid lines
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < BOARD_WIDTH; c++) {
    ctx.beginPath();
    ctx.moveTo(c * CELL_SIZE, 0);
    ctx.lineTo(c * CELL_SIZE, BOARD_PX_H);
    ctx.stroke();
  }
  for (let r = 1; r < BOARD_HEIGHT; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * CELL_SIZE);
    ctx.lineTo(BOARD_PX_W, r * CELL_SIZE);
    ctx.stroke();
  }

  // Draw locked cells
  for (let r = 0; r < BOARD_HEIGHT; r++) {
    for (let c = 0; c < BOARD_WIDTH; c++) {
      const cell = state.board[r][c];
      if (cell !== 0) {
        drawCell(ctx, c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, PIECE_COLORS[cell]);
      }
    }
  }

  // Draw ghost piece
  if (state.currentPiece) {
    const ghost = getGhostPiece(state);
    if (ghost) {
      const ghostCells = getPieceCells(ghost);
      const color = PIECE_COLORS[ghost.type];
      ctx.globalAlpha = GHOST_ALPHA;
      for (const [r, c] of ghostCells) {
        if (r >= 0) {
          drawCell(ctx, c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, color);
        }
      }
      ctx.globalAlpha = 1.0;
    }
  }

  // Draw current piece
  if (state.currentPiece) {
    const cells = getPieceCells(state.currentPiece);
    const color = PIECE_COLORS[state.currentPiece.type];
    for (const [r, c] of cells) {
      if (r >= 0) {
        drawCell(ctx, c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, color);
      }
    }
  }

  // Draw border
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, BOARD_PX_W, BOARD_PX_H);
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  const inset = 1;
  const s = size - inset * 2;

  // Fill
  ctx.fillStyle = color;
  ctx.fillRect(x + inset, y + inset, s, s);

  // Highlight (top-left)
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(x + inset, y + inset, s, 2);
  ctx.fillRect(x + inset, y + inset, 2, s);

  // Shadow (bottom-right)
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(x + inset, y + inset + s - 2, s, 2);
  ctx.fillRect(x + inset + s - 2, y + inset, 2, s);
}
