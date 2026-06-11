import { useEffect, useRef, useCallback } from "react";
import type { GameProps } from "../../types";
import {
  type GalagaState,
  type InputState,
  FIELD_W,
  FIELD_H,
  PLAYER_Y,
  ENEMY_BEE,
  ENEMY_BUTTERFLY,
  ENEMY_BOSS,
  EXPLOSION_FRAMES,
  TRANSITION_TOTAL,
  tick,
} from "./galaga-engine";

/* ── Constants ───────────────────────────────────────────────────── */

const BG_COLOR = "#050510";
const TRANSITION_TEXT_PHASE = 60;

/* ── Component ───────────────────────────────────────────────────── */

export function GalagaGame({
  state,
  onStateChange,
  onScoreChange,
  onLevelChange,
  onGameOver,
  isPaused,
  onPauseToggle,
}: GameProps<GalagaState>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const isPausedRef = useRef(isPaused);
  const keysRef = useRef(new Set<string>());
  const rafRef = useRef(0);
  const gameOverFiredRef = useRef(false);

  stateRef.current = state;
  isPausedRef.current = isPaused;

  useEffect(() => {
    if (!state.gameOver) gameOverFiredRef.current = false;
  }, [state.gameOver]);

  /* ── State Update ─────────────────────────────────────────────── */

  const updateState = useCallback(
    (newState: GalagaState) => {
      stateRef.current = newState;
      onStateChange(newState);
      onScoreChange(newState.score);
      onLevelChange(newState.stage);
      if (newState.gameOver && !gameOverFiredRef.current) {
        gameOverFiredRef.current = true;
        onGameOver(newState.score);
      }
    },
    [onStateChange, onScoreChange, onLevelChange, onGameOver],
  );

  /* ── Keyboard ─────────────────────────────────────────────────── */

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", " ", "z", "Z", "x", "X"].includes(
          e.key,
        )
      ) {
        e.preventDefault();
        keysRef.current.add(e.key);
      }
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    const blur = () => keysRef.current.clear();

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Clear keys on pause
  useEffect(() => {
    if (isPaused) keysRef.current.clear();
  }, [isPaused]);

  /* ── Game Loop ────────────────────────────────────────────────── */

  useEffect(() => {
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);

      render(canvasRef.current, stateRef.current);

      if (isPausedRef.current || stateRef.current.gameOver) return;

      const keys = keysRef.current;
      const input: InputState = {
        left: keys.has("ArrowLeft"),
        right: keys.has("ArrowRight"),
        fire:
          keys.has(" ") ||
          keys.has("ArrowUp") ||
          keys.has("z") ||
          keys.has("Z") ||
          keys.has("x") ||
          keys.has("X"),
      };

      const newState = tick(stateRef.current, input);
      if (newState !== stateRef.current) {
        updateState(newState);
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateState]);

  /* ── Initial report ───────────────────────────────────────────── */

  useEffect(() => {
    onScoreChange(state.score);
    onLevelChange(state.stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Render ───────────────────────────────────────────────────── */

  const enemiesAlive = state.enemies.filter((e) => e.alive).length;

  return (
    <div className="galaga-container">
      <div className="galaga-board-wrapper">
        <canvas
          ref={canvasRef}
          width={FIELD_W}
          height={FIELD_H}
          className="galaga-canvas"
        />
      </div>

      <div className="galaga-sidebar">
        <div className="galaga-sidebar-section">
          <span className="galaga-sidebar-label">Stage</span>
          <span className="galaga-sidebar-value">{state.stage}</span>
        </div>
        <div className="galaga-sidebar-section">
          <span className="galaga-sidebar-label">Score</span>
          <span className="galaga-sidebar-value">
            {state.score.toLocaleString()}
          </span>
        </div>
        <div className="galaga-sidebar-section">
          <span className="galaga-sidebar-label">Lives</span>
          <div className="galaga-lives">
            {Array.from({ length: Math.max(0, state.playerLives) }, (_, i) => (
              <span key={i} className="galaga-life-icon">
                ▲
              </span>
            ))}
            {state.playerLives <= 0 && (
              <span className="galaga-no-lives">—</span>
            )}
          </div>
        </div>
        <div className="galaga-sidebar-section">
          <span className="galaga-sidebar-label">Enemies</span>
          <span className="galaga-sidebar-value">{enemiesAlive}</span>
        </div>
        {!state.gameOver && (
          <button
            className={`galaga-pause-btn${isPaused ? " galaga-pause-btn-resume" : ""}`}
            onClick={onPauseToggle}
            type="button"
          >
            {isPaused ? (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Resume
              </>
            ) : (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
                Pause
              </>
            )}
          </button>
        )}
        <div className="galaga-sidebar-section galaga-controls">
          <span className="galaga-sidebar-label">Controls</span>
          <span className="galaga-control-hint">← → Move</span>
          <span className="galaga-control-hint">Space / ↑ Fire</span>
          <span className="galaga-control-hint">Esc Pause</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   RENDERING
   ══════════════════════════════════════════════════════════════════════ */

function render(canvas: HTMLCanvasElement | null, s: GalagaState) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  /* ── Background ─────────────────────────────────────────────────── */
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  /* ── Stars ──────────────────────────────────────────────────────── */
  for (const star of s.stars) {
    ctx.globalAlpha = star.brightness;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(star.x, star.y, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;

  /* ── Stage Transition Text ──────────────────────────────────────── */
  const elapsed = TRANSITION_TOTAL - s.stageTransitionTimer;
  if (s.stageTransitionTimer > 0 && elapsed < TRANSITION_TEXT_PHASE + 20) {
    const fadeIn = Math.min(elapsed / 15, 1);
    const fadeOut =
      elapsed > TRANSITION_TEXT_PHASE
        ? Math.max(0, 1 - (elapsed - TRANSITION_TEXT_PHASE) / 20)
        : 1;
    ctx.globalAlpha = fadeIn * fadeOut;

    ctx.fillStyle = "#FFFFFF";
    ctx.font = 'bold 32px "Inter", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`STAGE ${s.stage}`, FIELD_W / 2, FIELD_H / 2 - 15);

    ctx.font = '14px "Inter", system-ui, sans-serif';
    ctx.fillStyle = "#6688CC";
    ctx.fillText("GET READY", FIELD_W / 2, FIELD_H / 2 + 18);

    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1;
  }

  /* ── Enemies ────────────────────────────────────────────────────── */
  for (const enemy of s.enemies) {
    if (!enemy.alive || enemy.y < -30) continue;

    // Subtle pulse in formation
    if (!enemy.diving) {
      const pulse =
        1 +
        Math.sin(
          s.tickCount * 0.05 + enemy.formRow * 0.5 + enemy.formCol * 0.3,
        ) *
          0.04;
      ctx.save();
      ctx.translate(enemy.x, enemy.y);
      ctx.scale(pulse, pulse);
      drawEnemy(ctx, 0, 0, enemy.type, enemy.hp);
      ctx.restore();
    } else {
      drawEnemy(ctx, enemy.x, enemy.y, enemy.type, enemy.hp);
    }
  }

  /* ── Player Bullets ─────────────────────────────────────────────── */
  for (const b of s.playerBullets) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(b.x - 1.5, b.y - 6, 3, 12);
    // Glow
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#00E5FF";
    ctx.fillRect(b.x - 3, b.y - 8, 6, 16);
    ctx.globalAlpha = 1;
  }

  /* ── Enemy Bullets ──────────────────────────────────────────────── */
  for (const b of s.enemyBullets) {
    ctx.fillStyle = "#FF4444";
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
    // Glow
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#FF0000";
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ── Player Ship ────────────────────────────────────────────────── */
  if (s.playerAlive) {
    const blink =
      s.playerRespawnTimer > 0 && Math.floor(s.tickCount / 4) % 2 === 0;
    if (!blink) {
      drawPlayer(ctx, s.playerX, PLAYER_Y, s.tickCount);
    }
  }

  /* ── Explosions ─────────────────────────────────────────────────── */
  for (const exp of s.explosions) {
    drawExplosion(ctx, exp.x, exp.y, exp.timer, EXPLOSION_FRAMES, exp.color);
  }
}

/* ── Draw Player ──────────────────────────────────────────────────── */

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tick: number,
) {
  // Ship body
  ctx.fillStyle = "#00E5FF";
  ctx.beginPath();
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x + 5, y - 6);
  ctx.lineTo(x + 4, y + 2);
  ctx.lineTo(x + 12, y + 6);
  ctx.lineTo(x + 10, y + 10);
  ctx.lineTo(x + 4, y + 8);
  ctx.lineTo(x + 3, y + 14);
  ctx.lineTo(x - 3, y + 14);
  ctx.lineTo(x - 4, y + 8);
  ctx.lineTo(x - 10, y + 10);
  ctx.lineTo(x - 12, y + 6);
  ctx.lineTo(x - 4, y + 2);
  ctx.lineTo(x - 5, y - 6);
  ctx.closePath();
  ctx.fill();

  // Cockpit
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.ellipse(x, y - 4, 2, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Engine glow
  const flicker = 0.7 + Math.sin(tick * 0.5) * 0.3;
  ctx.globalAlpha = flicker;
  ctx.fillStyle = "#FF8800";
  ctx.beginPath();
  ctx.ellipse(x, y + 16, 3, 3 + Math.sin(tick * 0.3) * 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* ── Draw Enemies ─────────────────────────────────────────────────── */

function drawEnemy(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: number,
  hp: number,
) {
  switch (type) {
    case ENEMY_BEE:
      drawBee(ctx, x, y);
      break;
    case ENEMY_BUTTERFLY:
      drawButterfly(ctx, x, y);
      break;
    case ENEMY_BOSS:
      drawBoss(ctx, x, y, hp);
      break;
  }
}

function drawBee(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#FFD700";
  ctx.beginPath();
  ctx.moveTo(x, y - 10);
  ctx.lineTo(x + 8, y - 3);
  ctx.lineTo(x + 10, y + 4);
  ctx.lineTo(x + 6, y + 10);
  ctx.lineTo(x - 6, y + 10);
  ctx.lineTo(x - 10, y + 4);
  ctx.lineTo(x - 8, y - 3);
  ctx.closePath();
  ctx.fill();

  // Eyes
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(x - 3, y - 1, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 3, y - 1, 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawButterfly(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#FF4488";
  ctx.beginPath();
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x + 6, y - 10);
  ctx.lineTo(x + 13, y - 4);
  ctx.lineTo(x + 12, y + 4);
  ctx.lineTo(x + 6, y + 10);
  ctx.lineTo(x, y + 8);
  ctx.lineTo(x - 6, y + 10);
  ctx.lineTo(x - 12, y + 4);
  ctx.lineTo(x - 13, y - 4);
  ctx.lineTo(x - 6, y - 10);
  ctx.closePath();
  ctx.fill();

  // Body center
  ctx.fillStyle = "#FF88AA";
  ctx.beginPath();
  ctx.ellipse(x, y, 3, 7, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBoss(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hp: number,
) {
  ctx.fillStyle = hp > 1 ? "#44FF88" : "#88FFBB";
  ctx.beginPath();
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x + 8, y - 10);
  ctx.lineTo(x + 16, y - 2);
  ctx.lineTo(x + 14, y + 6);
  ctx.lineTo(x + 8, y + 12);
  ctx.lineTo(x + 4, y + 14);
  ctx.lineTo(x - 4, y + 14);
  ctx.lineTo(x - 8, y + 12);
  ctx.lineTo(x - 14, y + 6);
  ctx.lineTo(x - 16, y - 2);
  ctx.lineTo(x - 8, y - 10);
  ctx.closePath();
  ctx.fill();

  // Horns
  ctx.fillStyle = hp > 1 ? "#22CC66" : "#66DDAA";
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 10);
  ctx.lineTo(x - 10, y - 18);
  ctx.lineTo(x - 3, y - 12);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 6, y - 10);
  ctx.lineTo(x + 10, y - 18);
  ctx.lineTo(x + 3, y - 12);
  ctx.closePath();
  ctx.fill();

  // Eyes
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(x - 5, y - 2, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 5, y - 2, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(x - 5, y - 1, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 5, y - 1, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

/* ── Draw Explosion ───────────────────────────────────────────────── */

function drawExplosion(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  timer: number,
  maxTimer: number,
  color: string,
) {
  const progress = Math.max(0, Math.min(1, 1 - timer / maxTimer));

  // Outer ring
  const r1 = Math.max(0, progress * 28);
  ctx.globalAlpha = Math.max(0, 1 - progress * 1.4);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, 3 - progress * 2.5);
  ctx.beginPath();
  ctx.arc(x, y, r1, 0, Math.PI * 2);
  ctx.stroke();

  // Inner ring
  if (progress > 0.15) {
    const p2 = (progress - 0.15) / 0.85;
    const r2 = Math.max(0, p2 * 18);
    ctx.globalAlpha = Math.max(0, 1 - p2 * 1.5);
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = Math.max(0.5, 2 - p2 * 1.5);
    ctx.beginPath();
    ctx.arc(x, y, r2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Center flash
  if (progress < 0.3) {
    ctx.globalAlpha = Math.max(0, 1 - progress / 0.3);
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0, 8 * (1 - progress / 0.3)), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}
