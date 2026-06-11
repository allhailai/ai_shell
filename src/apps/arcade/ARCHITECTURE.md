# Arcade — Application Architecture

> **Progressive Disclosure Document** — Start reading from the top. Stop when you have enough context.

---

## Level 0 — What Is This?

The Arcade is a **retro game hosting application** within AIShell. It provides a game launcher, pause/resume lifecycle, localStorage-based state persistence, and a top-100 high score leaderboard with initials entry. Games are pluggable — each game implements a `GameDefinition` interface and is registered in a central array.

**Current games**: Tetris, Galaga

---

## Level 1 — File Map

```
src/apps/arcade/
├── manifest.tsx            # AppManifest — wires Arcade into the shell
├── types.ts                # GameDefinition, GameProps, HighScore, SavedGameState
├── arcade.css              # All Arcade + game styles
├── ArcadeContent.tsx       # Root component: game launcher ↔ game shell routing
│                           # Also exports ArcadeNavWrapper, ArcadeScorePanelWrapper
├── ArcadeNav.tsx           # Left nav: "All Games" link + per-game nav items
├── ArcadeHeaderItems.tsx   # Topbar injection: live score, level, pause button
├── ArcadeScorePanel.tsx    # Right panel: per-game high score leaderboard
├── GameLauncher.tsx        # Game selection grid (cards with "New Game" / "Continue")
├── GameShell.tsx           # Game lifecycle wrapper (pause overlay, state management)
├── HighScoreBoard.tsx      # Scrollable high score table component
├── HighScoreEntry.tsx      # Initials entry modal after game over
├── storage.ts              # localStorage helpers: game state + high scores
└── games/                  # Individual game implementations
    ├── tetris/
    │   ├── index.tsx        # GameDefinition export + icon
    │   ├── tetris-engine.ts # Pure game logic (no React, no DOM)
    │   └── TetrisGame.tsx   # Canvas renderer + React wrapper
    └── galaga/
        ├── index.tsx        # GameDefinition export + icon
        ├── galaga-engine.ts # Pure game logic (no React, no DOM)
        └── GalagaGame.tsx   # Canvas renderer + React wrapper
```

---

## Level 2 — Core Architecture Pattern

### The Game Contract (`GameDefinition`)

Every game implements this interface ([`types.ts`](types.ts)):

```typescript
interface GameDefinition<TState> {
  id: string;                                    // Storage key, URL segment
  name: string;                                  // Display name
  description: string;                           // Launcher card subtitle
  icon: ComponentType<{ size?: number }>;         // Card/nav icon
  accentColor: string;                           // Card accent color (CSS)

  component: ComponentType<GameProps<TState>>;    // The game's React component
  createInitialState: () => TState;              // Factory for new games
  validateState?: (data: unknown) => TState | null; // Deserialize/migrate saves
}
```

### The Game Props (`GameProps`)

The `GameShell` wrapper passes these props to every game component:

```typescript
interface GameProps<TState> {
  state: TState;                          // Current game state
  onStateChange: (state: TState) => void; // Report state update (triggers save)
  onScoreChange: (score: number) => void; // Update header score display
  onLevelChange: (level: number) => void; // Update header level display
  onGameOver: (finalScore: number) => void; // Trigger game-over flow
  isPaused: boolean;                      // Freeze game when true
  onPauseToggle: () => void;              // Toggle pause from within the game
}
```

---

## Level 3 — Data Flow

```
ArcadeContent (module-level shared state via useSyncExternalStore)
  ├── GameLauncher          ← shows cards, detects saved games, starts/continues
  └── GameShell             ← wraps the active game
       ├── Pause Overlay    ← Resume / New Game / Quit
       ├── Game Component   ← e.g., TetrisGame or GalagaGame
       └── HighScoreEntry   ← modal after game over (if qualifies)

ArcadeNav         ← reads shared state (activeGameId) via useSyncExternalStore
ArcadeHeaderItems ← reads shared state (score, level, isPaused)
ArcadeScorePanel  ← reads shared state (activeGameId) for filtered leaderboard
```

### Shared State Pattern

The Arcade uses **module-level state + `useSyncExternalStore`** rather than a separate Zustand store, because the nav, header items, and score panel are rendered by the shell as separate component trees (not children of `ArcadeContent`).

```typescript
// In ArcadeContent.tsx (module scope)
let arcadeState: ArcadeState = { activeGameId: null, isPaused: false, score: 0, level: 0 };
const subscribers = new Set<() => void>();

function setArcadeState(updates: Partial<ArcadeState>) { /* notify subscribers */ }
function subscribe(cb: () => void) { /* subscribe/unsubscribe pattern */ }
function getSnapshot() { return arcadeState; }

// In ArcadeNav, ArcadeHeaderItems, ArcadeScorePanel:
const state = useSyncExternalStore(subscribe, getSnapshot);
```

---

## Level 4 — Persistence (`storage.ts`)

### Game State

- Key: `arcade:save:<gameId>`
- Debounced writes (500ms) to avoid performance hits during gameplay
- Stores: `{ state, score, level, timestamp }`
- On load: `validateState()` is called to handle schema migration or stale data

### High Scores

- Key: `arcade:scores:<gameId>`
- Top 100 scores per game, sorted descending
- Structure: `{ initials: string, score: number, level: number, date: string }`
- After game over, if score qualifies → `HighScoreEntry` modal for initials (default "XXX")

### API

| Function | Purpose |
|----------|---------|
| `saveGameState(gameId, state, score, level)` | Debounced save |
| `loadGameState(gameId)` | Load raw saved data |
| `clearGameState(gameId)` | Delete save |
| `flushPendingSaves()` | Force immediate write |
| `loadHighScores(gameId)` | Get top 100 |
| `saveHighScore(gameId, entry)` | Insert + sort + trim to 100 |
| `isHighScore(gameId, score)` | Check if score qualifies |

---

## Level 5 — Game Implementation Pattern

Every game follows a **Pure Engine + React Renderer** split:

### Engine (`*-engine.ts`)

- **Zero React/DOM dependencies** — pure TypeScript functions
- Exports: `createInitialState()`, `tick(state, input) → newState`, `validateState()`
- The `tick` function is the complete game loop step: physics, collisions, scoring, level transitions
- All constants (field dimensions, speeds, scoring tables) are exported for use by the renderer
- State is **immutable** — `tick` returns a new object (referential equality check skips no-op ticks)

### Renderer (`*Game.tsx`)

- Canvas-based rendering via `useRef<HTMLCanvasElement>` + `requestAnimationFrame`
- Reads keyboard input via `useEffect` key listeners → `keysRef` set
- Game loop: RAF → render current state → if not paused, call `tick()` → `onStateChange()`
- Sidebar with stats (score, level, lives/lines), pause button, and controls hint
- All drawing is done with Canvas 2D API (paths, arcs, fills — no sprites/images)

### Adding a New Game

```bash
# 1. Create the game directory
mkdir -p src/apps/arcade/games/my-game

# 2. Create three files:
#    my-game-engine.ts  — pure logic, exports createInitialState, tick, validateState
#    MyGameGame.tsx      — canvas renderer + sidebar
#    index.tsx           — GameDefinition export

# 3. Register in ArcadeContent.tsx:
#    import { myGameGame } from "./games/my-game";
#    Add to ARCADE_GAMES array.

# 4. Add CSS classes to arcade.css (namespaced as .my-game-*)
```

---

## Level 6 — Game Shell Lifecycle

```
User clicks game card in GameLauncher
  │
  ├── "New Game" → createInitialState()
  └── "Continue" → loadGameState() + validateState()
  │
  ▼
GameShell mounts with initial state
  │
  ├── Renders game component with GameProps
  ├── Listens for onStateChange → debounced save
  ├── Listens for onGameOver(score)
  │     ├── isHighScore? → show HighScoreEntry modal
  │     └── else → show game-over overlay
  │
  ├── Pause overlay (Escape key or button)
  │     ├── Resume → unpause
  │     ├── New Game → clearGameState + createInitialState
  │     └── Quit → clearGameState + return to launcher
  │
  └── Escape key (when game active) → toggles pause
```

---

## Level 7 — Game-Specific Details

### Tetris

- **Engine**: SRS rotation system, wall kicks, ghost piece projection, lock delay
- **Scoring**: Lines × level multiplier, soft/hard drop bonuses, T-spin detection
- **Field**: 10 × 20 visible rows + 4 hidden rows above
- **Speed**: Starts at 800ms per drop, decreases by 50ms per level (min 100ms)
- **Canvas**: 300 × 600 pixels, renders grid + active piece + ghost + next piece preview

### Galaga

- **Engine**: 40 enemies in 5-row formation (4 bosses, 8 butterflies, 8+8+12 bees)
- **Enemy types**: Bees (50/100 pts), Butterflies (80/160 pts), Bosses (150/400 pts, 2 HP)
- **Diving**: Random enemies dive with sinusoidal paths, fire bullets during dive
- **Difficulty**: Each stage increases dive frequency, bullet count, and enemy speed
- **Stage transition**: Fly-in animation (120 frames), enemies enter from off-screen
- **Player**: 3 lives, 60-frame respawn invincibility with blink effect
- **Canvas**: 480 × 640 pixels, scrolling star field background

---

## Appendix — CSS Namespacing

All Arcade styles live in `arcade.css` and use these prefixes:

| Prefix | Scope |
|--------|-------|
| `.arcade-*` | Shell-level arcade components (launcher, nav) |
| `.game-shell-*` | GameShell wrapper (pause overlay, game-over) |
| `.game-launcher-*` | Game selection cards |
| `.high-score-*` | Leaderboard and initials entry |
| `.tetris-*` | Tetris game-specific |
| `.galaga-*` | Galaga game-specific |
