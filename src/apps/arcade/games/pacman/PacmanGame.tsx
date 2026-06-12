import { useEffect, useRef, useCallback } from "react";
import type { GameProps } from "../../types";
import {
  type PacmanState,
  type Direction,
  COLS,
  ROWS,
  TILE_SIZE,
  TILE,
  COLORS,
  getTickInterval,
  setDirection,
  tick,
} from "./pacman-engine";

/* ── Constants ───────────────────────────────────────────────────── */

const BOARD_PX_W = COLS * TILE_SIZE;
const BOARD_PX_H = ROWS * TILE_SIZE;

/**
 * Pac-Man game component — canvas-based rendering with requestAnimationFrame.
 */
export function PacmanGame({
  state,
  onStateChange,
  onScoreChange,
  onLevelChange,
  onGameOver,
  isPaused,
  onPauseToggle,
}: GameProps<PacmanState>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const lastTickRef = useRef(0);
  const rafRef = useRef(0);
  const isPausedRef = useRef(isPaused);
  const gameOverFiredRef = useRef(false);

  stateRef.current = state;
  isPausedRef.current = isPaused;

  useEffect(() => {
    if (!state.gameOver) {
      gameOverFiredRef.current = false;
    }
  }, [state.gameOver]);

  /* ── State Update Helper ──────────────────────────────────────── */

  const updateState = useCallback(
    (newState: PacmanState) => {
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
      const s = stateRef.current;
      if (s.gameOver) return;

      if (e.key === "p" || e.key === "P" || e.key === "Escape") {
        e.preventDefault();
        onPauseToggle();
        return;
      }

      if (isPausedRef.current) return;

      let dir: Direction | null = null;
      switch (e.key) {
        case "ArrowLeft":
        case "a":
        case "A":
          dir = "left";
          break;
        case "ArrowRight":
        case "d":
        case "D":
          dir = "right";
          break;
        case "ArrowUp":
        case "w":
        case "W":
          dir = "up";
          break;
        case "ArrowDown":
        case "s":
        case "S":
          dir = "down";
          break;
      }

      if (dir) {
        e.preventDefault();
        updateState(setDirection(s, dir));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [updateState, onPauseToggle]);

  /* ── Game Loop ─────────────────────────────────────────────────── */

  useEffect(() => {
    lastTickRef.current = performance.now();

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);

      // Always render
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
    <div className="pacman-container">
      <div className="pacman-board-wrapper">
        <canvas
          ref={canvasRef}
          width={BOARD_PX_W}
          height={BOARD_PX_H}
          className="pacman-canvas"
        />
      </div>

      {/* Side panel */}
      <div className="pacman-sidebar">
        <div className="pacman-sidebar-section">
          <span className="pacman-sidebar-label">Score</span>
          <span className="pacman-sidebar-value">{state.score.toLocaleString()}</span>
        </div>
        <div className="pacman-sidebar-section">
          <span className="pacman-sidebar-label">Level</span>
          <span className="pacman-sidebar-value">{state.level}</span>
        </div>
        <div className="pacman-sidebar-section">
          <span className="pacman-sidebar-label">Lives</span>
          <div className="pacman-lives">
            {Array.from({ length: state.lives }, (_, i) => (
              <span key={i} className="pacman-life-icon">●</span>
            ))}
          </div>
        </div>
        <div className="pacman-sidebar-section">
          <span className="pacman-sidebar-label">Dots</span>
          <span className="pacman-sidebar-value">{state.dotsRemaining} / {state.totalDots}</span>
        </div>
        {!state.gameOver && (
          <button
            className={`pacman-pause-btn${isPaused ? " pacman-pause-btn-resume" : ""}`}
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

/* ── Rendering ───────────────────────────────────────────────────── */

function render(canvas: HTMLCanvasElement | null, state: PacmanState) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const T = TILE_SIZE;

  // Clear
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, BOARD_PX_W, BOARD_PX_H);

  // Draw board
  for (let r = 0; r < state.board.length; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = state.board[r][c];
      const x = c * T;
      const y = r * T;

      if (cell === TILE.WALL) {
        // Wall with rounded appearance
        ctx.fillStyle = COLORS.wall;
        ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
        ctx.strokeStyle = COLORS.wallStroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
      } else if (cell === TILE.DOT) {
        ctx.fillStyle = COLORS.dot;
        ctx.beginPath();
        ctx.arc(x + T / 2, y + T / 2, 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (cell === TILE.POWER) {
        // Pulsating power pellet
        const pulse = 3 + Math.sin(state.tickCount * 0.1) * 1.5;
        ctx.fillStyle = COLORS.power;
        ctx.beginPath();
        ctx.arc(x + T / 2, y + T / 2, pulse, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Draw ghosts
  for (const ghost of state.ghosts) {
    const gx = ghost.col * T + T / 2;
    const gy = ghost.row * T + T / 2;
    const radius = T / 2 - 2;

    let fillColor: string;
    if (ghost.mode === "eaten") {
      fillColor = COLORS.eaten;
    } else if (ghost.mode === "frightened") {
      // Flash when about to end
      fillColor = state.frightenedTimer < 120 && state.tickCount % 10 < 5
        ? COLORS.frightenedFlash
        : COLORS.frightened;
    } else {
      fillColor = ghost.color;
    }

    ctx.fillStyle = fillColor;

    if (ghost.mode === "eaten") {
      // Just draw eyes
      drawGhostEyes(ctx, gx, gy, radius, ghost.dir);
    } else {
      // Ghost body: dome top + wavy bottom
      ctx.beginPath();
      ctx.arc(gx, gy - 1, radius, Math.PI, 0);
      // Wavy bottom
      const bottom = gy + radius - 1;
      const waveAmp = 3;
      const waveOffset = (state.tickCount % 12) < 6 ? 0 : waveAmp;
      ctx.lineTo(gx + radius, bottom);
      for (let i = 0; i < 3; i++) {
        const wx = gx + radius - (i * 2 + 1) * (radius / 3);
        const wy = bottom + ((i + (waveOffset ? 1 : 0)) % 2 === 0 ? -waveAmp : 0);
        ctx.lineTo(wx, wy);
      }
      ctx.lineTo(gx - radius, bottom);
      ctx.closePath();
      ctx.fill();

      // Eyes
      drawGhostEyes(ctx, gx, gy, radius, ghost.dir);
    }
  }

  // Draw Pac-Man
  const px = state.pacCol * T + T / 2;
  const py = state.pacRow * T + T / 2;
  const pacRadius = T / 2 - 2;

  ctx.fillStyle = COLORS.pacman;
  ctx.beginPath();

  if (state.pacMouthOpen) {
    const mouthAngle = 0.3;
    let startAngle: number;
    switch (state.pacDir) {
      case "right": startAngle = mouthAngle; break;
      case "left": startAngle = Math.PI + mouthAngle; break;
      case "up": startAngle = -Math.PI / 2 + mouthAngle; break;
      case "down": startAngle = Math.PI / 2 + mouthAngle; break;
    }
    ctx.arc(px, py, pacRadius, startAngle, startAngle + (Math.PI * 2 - mouthAngle * 2));
    ctx.lineTo(px, py);
  } else {
    ctx.arc(px, py, pacRadius, 0, Math.PI * 2);
  }

  ctx.fill();
}

function drawGhostEyes(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  dir: Direction,
) {
  const eyeRadius = radius * 0.25;
  const pupilRadius = eyeRadius * 0.5;
  const eyeOffsetX = radius * 0.3;
  const eyeOffsetY = -radius * 0.15;

  // Direction offset for pupils
  let pdx = 0, pdy = 0;
  switch (dir) {
    case "left": pdx = -pupilRadius; break;
    case "right": pdx = pupilRadius; break;
    case "up": pdy = -pupilRadius; break;
    case "down": pdy = pupilRadius; break;
  }

  for (const xDir of [-1, 1]) {
    // White of eye
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx + xDir * eyeOffsetX, cy + eyeOffsetY, eyeRadius, 0, Math.PI * 2);
    ctx.fill();

    // Pupil
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(cx + xDir * eyeOffsetX + pdx, cy + eyeOffsetY + pdy, pupilRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}
