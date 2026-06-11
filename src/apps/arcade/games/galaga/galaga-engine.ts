/* ══════════════════════════════════════════════════════════════════════
   GALAGA ENGINE — Pure game logic, no React, fully serializable state.
   ══════════════════════════════════════════════════════════════════════ */

/* ── Field ────────────────────────────────────────────────────────── */

export const FIELD_W = 400;
export const FIELD_H = 600;

/* ── Player ───────────────────────────────────────────────────────── */

const PLAYER_W = 28;
const PLAYER_H = 28;
const PLAYER_SPEED = 4.5;
export const PLAYER_Y = FIELD_H - 48;
const FIRE_COOLDOWN = 10;
const MAX_PLAYER_BULLETS = 3;

/* ── Bullets ──────────────────────────────────────────────────────── */

const BULLET_SPEED = 9;
const ENEMY_BULLET_SPEED_BASE = 2.8;

/* ── Enemies ──────────────────────────────────────────────────────── */

const ENEMY_W = 26;
const ENEMY_H = 26;

export const ENEMY_BEE = 0;
export const ENEMY_BUTTERFLY = 1;
export const ENEMY_BOSS = 2;

/* ── Formation ────────────────────────────────────────────────────── */

const FORM_COLS = 10;
const FORM_TOP = 70;
const FORM_COL_GAP = 34;
const FORM_ROW_GAP = 30;
const FORM_SWAY = 20;

/* ── Dive ─────────────────────────────────────────────────────────── */

const DIVE_SPEED_BASE = 2.8;
const DIVE_SINE_AMP = 50;

/* ── Misc ─────────────────────────────────────────────────────────── */

const STAR_COUNT = 80;
export const EXPLOSION_FRAMES = 18;
export const TRANSITION_TOTAL = 150;
const TRANSITION_TEXT_PHASE = 60;

/* ── Types ────────────────────────────────────────────────────────── */

export interface Bullet {
  x: number;
  y: number;
  active: boolean;
}

export interface Enemy {
  type: number;
  alive: boolean;
  hp: number;
  formRow: number;
  formCol: number;
  x: number;
  y: number;
  diving: boolean;
  diveStartX: number;
  diveStartY: number;
  diveTargetX: number;
}

export interface Explosion {
  x: number;
  y: number;
  timer: number;
  color: string;
}

export interface Star {
  x: number;
  y: number;
  speed: number;
  brightness: number;
}

export interface GalagaState {
  playerX: number;
  playerLives: number;
  playerAlive: boolean;
  playerDeathTimer: number;
  playerRespawnTimer: number;
  fireThrottle: number;

  playerBullets: Bullet[];
  enemyBullets: Bullet[];
  enemies: Enemy[];
  explosions: Explosion[];
  stars: Star[];

  formationPhase: number;

  stage: number;
  stageTransitionTimer: number;

  score: number;
  gameOver: boolean;
  tickCount: number;
}

export interface InputState {
  left: boolean;
  right: boolean;
  fire: boolean;
}

/* ── Difficulty Scaling ───────────────────────────────────────────── */

function getDifficulty(stage: number) {
  const s = Math.min(stage - 1, 15);
  return {
    diveChance: 0.0015 + s * 0.0004,
    fireChance: 0.003 + s * 0.0008,
    diveSpeed: DIVE_SPEED_BASE + s * 0.12,
    enemyBulletSpeed: ENEMY_BULLET_SPEED_BASE + s * 0.08,
    maxDivers: 2 + Math.floor(s / 3),
  };
}

/* ── Score ─────────────────────────────────────────────────────────── */

function getScore(type: number, diving: boolean): number {
  switch (type) {
    case ENEMY_BEE:
      return diving ? 100 : 50;
    case ENEMY_BUTTERFLY:
      return diving ? 160 : 80;
    case ENEMY_BOSS:
      return diving ? 400 : 150;
    default:
      return 50;
  }
}

export const ENEMY_COLORS = ["#FFD700", "#FF4488", "#44FF88"];

/* ── Formation Helpers ────────────────────────────────────────────── */

function getFormationX(col: number, phase: number): number {
  return FIELD_W / 2 + (col - (FORM_COLS - 1) / 2) * FORM_COL_GAP + Math.sin(phase) * FORM_SWAY;
}

function getFormationY(row: number): number {
  return FORM_TOP + row * FORM_ROW_GAP;
}

/* ── AABB Collision ───────────────────────────────────────────────── */

function aabb(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/* ── Factory Helpers ──────────────────────────────────────────────── */

function makeEnemy(type: number, row: number, col: number, hp: number): Enemy {
  return {
    type,
    alive: true,
    hp,
    formRow: row,
    formCol: col,
    x: getFormationX(col, 0),
    y: -60,
    diving: false,
    diveStartX: 0,
    diveStartY: 0,
    diveTargetX: FIELD_W / 2,
  };
}

function createFormation(): Enemy[] {
  const enemies: Enemy[] = [];

  // Row 0: 4 bosses (cols 3-6)
  for (let c = 3; c <= 6; c++) enemies.push(makeEnemy(ENEMY_BOSS, 0, c, 2));

  // Rows 1-2: 8 butterflies each (cols 1-8)
  for (let r = 1; r <= 2; r++)
    for (let c = 1; c <= 8; c++) enemies.push(makeEnemy(ENEMY_BUTTERFLY, r, c, 1));

  // Rows 3-4: 10 bees each (cols 0-9)
  for (let r = 3; r <= 4; r++)
    for (let c = 0; c <= 9; c++) enemies.push(makeEnemy(ENEMY_BEE, r, c, 1));

  return enemies;
}

function createStars(): Star[] {
  return Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random() * FIELD_W,
    y: Math.random() * FIELD_H,
    speed: 0.3 + Math.random() * 1.2,
    brightness: 0.3 + Math.random() * 0.7,
  }));
}

/* ── Create Initial State ─────────────────────────────────────────── */

export function createInitialState(): GalagaState {
  return {
    playerX: FIELD_W / 2,
    playerLives: 2,
    playerAlive: true,
    playerDeathTimer: 0,
    playerRespawnTimer: 90,
    fireThrottle: 0,
    playerBullets: [],
    enemyBullets: [],
    enemies: createFormation(),
    explosions: [],
    stars: createStars(),
    formationPhase: 0,
    stage: 1,
    stageTransitionTimer: TRANSITION_TOTAL,
    score: 0,
    gameOver: false,
    tickCount: 0,
  };
}

/* ── Main Tick ────────────────────────────────────────────────────── */

export function tick(prev: GalagaState, input: InputState): GalagaState {
  if (prev.gameOver) return prev;

  /* Clone state (shallow arrays cloned for safe mutation) */
  const s: GalagaState = {
    ...prev,
    tickCount: prev.tickCount + 1,
    playerBullets: prev.playerBullets.map((b) => ({ ...b })),
    enemyBullets: prev.enemyBullets.map((b) => ({ ...b })),
    enemies: prev.enemies.map((e) => ({ ...e })),
    explosions: prev.explosions.map((e) => ({ ...e })),
    stars: prev.stars.map((st) => ({ ...st })),
  };

  /* ── Stars ──────────────────────────────────────────────────────── */
  for (const star of s.stars) {
    star.y += star.speed;
    if (star.y > FIELD_H) {
      star.y = 0;
      star.x = Math.random() * FIELD_W;
    }
  }

  /* ── Explosions ─────────────────────────────────────────────────── */
  s.explosions = s.explosions.filter((e) => {
    e.timer--;
    return e.timer > 0;
  });

  /* ── Stage Transition ───────────────────────────────────────────── */
  if (s.stageTransitionTimer > 0) {
    s.stageTransitionTimer--;
    const elapsed = TRANSITION_TOTAL - s.stageTransitionTimer;

    // Player death during transition
    if (!s.playerAlive) {
      s.playerDeathTimer--;
      if (s.playerDeathTimer <= 0) {
        if (s.playerLives >= 0) {
          s.playerAlive = true;
          s.playerRespawnTimer = 60;
          s.playerX = FIELD_W / 2;
        } else {
          s.gameOver = true;
          return s;
        }
      }
    }

    // Fly-in animation
    if (elapsed >= TRANSITION_TEXT_PHASE) {
      const flyElapsed = elapsed - TRANSITION_TEXT_PHASE;
      for (const enemy of s.enemies) {
        const delay = enemy.formRow * 10;
        const t = Math.max(0, flyElapsed - delay);
        const progress = Math.min(t / 30, 1);
        const eased = 1 - Math.pow(1 - progress, 2);
        const targetY = getFormationY(enemy.formRow);
        enemy.y = -40 + (targetY + 40) * eased;
        enemy.x = getFormationX(enemy.formCol, s.formationPhase);
      }
    } else {
      for (const enemy of s.enemies) {
        enemy.y = -60;
        enemy.x = getFormationX(enemy.formCol, s.formationPhase);
      }
    }

    s.formationPhase += 0.018;
    return s;
  }

  /* ── Player Death ───────────────────────────────────────────────── */
  if (!s.playerAlive) {
    s.playerDeathTimer--;
    if (s.playerDeathTimer <= 0) {
      if (s.playerLives >= 0) {
        s.playerAlive = true;
        s.playerRespawnTimer = 120;
        s.playerX = FIELD_W / 2;
        s.enemyBullets = [];
      } else {
        s.gameOver = true;
      }
    }
    // Keep formation swaying & enemies moving while player is dead
    s.formationPhase += 0.018;
    for (const enemy of s.enemies) {
      if (!enemy.alive) continue;
      if (!enemy.diving) {
        enemy.x = getFormationX(enemy.formCol, s.formationPhase);
        enemy.y = getFormationY(enemy.formRow);
      }
    }
    return s;
  }

  /* ── Respawn Invincibility ──────────────────────────────────────── */
  if (s.playerRespawnTimer > 0) s.playerRespawnTimer--;

  /* ── Fire Throttle ──────────────────────────────────────────────── */
  if (s.fireThrottle > 0) s.fireThrottle--;

  /* ── Move Player ────────────────────────────────────────────────── */
  if (input.left) s.playerX = Math.max(PLAYER_W / 2, s.playerX - PLAYER_SPEED);
  if (input.right) s.playerX = Math.min(FIELD_W - PLAYER_W / 2, s.playerX + PLAYER_SPEED);

  /* ── Fire ───────────────────────────────────────────────────────── */
  if (input.fire && s.fireThrottle <= 0) {
    const active = s.playerBullets.filter((b) => b.active).length;
    if (active < MAX_PLAYER_BULLETS) {
      s.playerBullets.push({ x: s.playerX, y: PLAYER_Y - PLAYER_H / 2, active: true });
      s.fireThrottle = FIRE_COOLDOWN;
    }
  }

  /* ── Move Player Bullets ────────────────────────────────────────── */
  s.playerBullets = s.playerBullets.filter((b) => {
    b.y -= BULLET_SPEED;
    return b.y > -12;
  });

  /* ── Move Enemy Bullets ─────────────────────────────────────────── */
  const diff = getDifficulty(s.stage);
  s.enemyBullets = s.enemyBullets.filter((b) => {
    b.y += diff.enemyBulletSpeed;
    return b.y < FIELD_H + 10;
  });

  /* ── Formation Phase ────────────────────────────────────────────── */
  s.formationPhase += 0.018;

  /* ── Update Enemies ─────────────────────────────────────────────── */
  let currentDivers = 0;
  for (const enemy of s.enemies) {
    if (!enemy.alive) continue;

    if (enemy.diving) {
      currentDivers++;
      enemy.y += diff.diveSpeed;

      // Sine curve toward target
      const totalDist = FIELD_H + 60 - enemy.diveStartY;
      const progress = Math.min((enemy.y - enemy.diveStartY) / totalDist, 1);
      const baseX =
        enemy.diveStartX +
        (enemy.diveTargetX - enemy.diveStartX) * Math.min(progress * 1.5, 1);
      enemy.x = baseX + Math.sin(progress * Math.PI * 3) * DIVE_SINE_AMP * (1 - progress * 0.5);

      // Off screen → return to formation
      if (enemy.y > FIELD_H + 30) {
        enemy.diving = false;
        enemy.y = getFormationY(enemy.formRow);
        enemy.x = getFormationX(enemy.formCol, s.formationPhase);
      }
    } else {
      enemy.x = getFormationX(enemy.formCol, s.formationPhase);
      enemy.y = getFormationY(enemy.formRow);
    }
  }

  /* ── Start New Dives ────────────────────────────────────────────── */
  if (currentDivers < diff.maxDivers) {
    const candidates = s.enemies.filter((e) => e.alive && !e.diving);
    for (const enemy of candidates) {
      if (Math.random() < diff.diveChance) {
        enemy.diving = true;
        enemy.diveStartX = enemy.x;
        enemy.diveStartY = enemy.y;
        enemy.diveTargetX = s.playerX + (Math.random() - 0.5) * 80;
        currentDivers++;
        if (currentDivers >= diff.maxDivers) break;
      }
    }
  }

  /* ── Enemy Firing ───────────────────────────────────────────────── */
  for (const enemy of s.enemies) {
    if (!enemy.alive) continue;
    const chance = enemy.diving ? diff.fireChance * 2.5 : diff.fireChance * 0.3;
    if (Math.random() < chance) {
      s.enemyBullets.push({ x: enemy.x, y: enemy.y + ENEMY_H / 2, active: true });
    }
  }

  /* ── Collision: Player Bullets → Enemies ─────────────────────────── */
  for (const bullet of s.playerBullets) {
    if (!bullet.active) continue;
    for (const enemy of s.enemies) {
      if (!enemy.alive) continue;
      if (
        aabb(
          bullet.x - 2, bullet.y - 6, 4, 12,
          enemy.x - ENEMY_W / 2, enemy.y - ENEMY_H / 2, ENEMY_W, ENEMY_H,
        )
      ) {
        bullet.active = false;
        enemy.hp--;
        if (enemy.hp <= 0) {
          enemy.alive = false;
          s.score += getScore(enemy.type, enemy.diving);
          s.explosions.push({
            x: enemy.x,
            y: enemy.y,
            timer: EXPLOSION_FRAMES,
            color: ENEMY_COLORS[enemy.type] ?? "#FFD700",
          });
        } else {
          // Boss hit — flash
          s.explosions.push({ x: enemy.x, y: enemy.y, timer: 6, color: "#FFFFFF" });
        }
        break;
      }
    }
  }
  s.playerBullets = s.playerBullets.filter((b) => b.active);

  /* ── Collision: Enemy Bullets → Player ───────────────────────────── */
  if (s.playerAlive && s.playerRespawnTimer <= 0) {
    for (const bullet of s.enemyBullets) {
      if (!bullet.active) continue;
      if (
        aabb(
          bullet.x - 2, bullet.y - 4, 4, 8,
          s.playerX - PLAYER_W / 2, PLAYER_Y - PLAYER_H / 2, PLAYER_W, PLAYER_H,
        )
      ) {
        bullet.active = false;
        killPlayer(s);
        break;
      }
    }
    s.enemyBullets = s.enemyBullets.filter((b) => b.active);
  }

  /* ── Collision: Diving Enemies → Player ──────────────────────────── */
  if (s.playerAlive && s.playerRespawnTimer <= 0) {
    for (const enemy of s.enemies) {
      if (!enemy.alive || !enemy.diving) continue;
      if (
        aabb(
          enemy.x - ENEMY_W / 2, enemy.y - ENEMY_H / 2, ENEMY_W, ENEMY_H,
          s.playerX - PLAYER_W / 2, PLAYER_Y - PLAYER_H / 2, PLAYER_W, PLAYER_H,
        )
      ) {
        enemy.alive = false;
        s.score += getScore(enemy.type, true);
        s.explosions.push({
          x: enemy.x, y: enemy.y, timer: EXPLOSION_FRAMES, color: "#FF6600",
        });
        killPlayer(s);
        break;
      }
    }
  }

  /* ── Stage Clear ────────────────────────────────────────────────── */
  if (s.enemies.every((e) => !e.alive)) {
    s.stage++;
    s.stageTransitionTimer = TRANSITION_TOTAL;
    s.enemies = createFormation();
    s.playerBullets = [];
    s.enemyBullets = [];
    if (!s.playerAlive) {
      s.playerAlive = true;
      s.playerDeathTimer = 0;
      s.playerRespawnTimer = 60;
      s.playerX = FIELD_W / 2;
    }
  }

  return s;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function killPlayer(s: GalagaState) {
  s.playerAlive = false;
  s.playerLives--;
  s.playerDeathTimer = 90;
  s.explosions.push({
    x: s.playerX, y: PLAYER_Y, timer: EXPLOSION_FRAMES + 6, color: "#00E5FF",
  });
}

/* ── State Validation ─────────────────────────────────────────────── */

export function validateState(data: unknown): GalagaState | null {
  const s = data as Partial<GalagaState>;
  if (
    !s ||
    typeof s.playerX !== "number" ||
    typeof s.score !== "number" ||
    !Array.isArray(s.enemies) ||
    !Array.isArray(s.stars)
  ) {
    return null;
  }
  if (s.stars.length === 0 || typeof s.stars[0]?.brightness !== "number") {
    (s as GalagaState).stars = createStars();
  }
  return s as GalagaState;
}
