# AIShell Architecture

> **Progressive Disclosure Document** — Start reading from the top for a high-level overview. Each section reveals more detail. Stop when you have enough context for your task.

---

## Level 0 — What Is This?

AIShell is a **multi-application hosting framework** built with React + TypeScript + Vite. It provides a shell UI (topbar, left nav, main canvas, right panel, bottom panel) and a **registry-based app model** where each application gets full control over every UI region when active.

- **Stack**: React 19, TypeScript 6, Zustand 5, Vite 8, vanilla CSS
- **No router library for shell navigation** — URL ↔ state sync is hand-rolled via `pushState`/`replaceState`
- **Dev server**: `npm run dev` → `http://127.0.0.1:5174`
- **Type check**: `npm run check`
- **Build**: `npm run build` (tsc + vite)

---

## Level 1 — Directory Map

```
ai_shell/
├── ARCHITECTURE.md               # ← You are here (shell-level)
├── APP_DEVELOPMENT_GUIDE.md      # How to build apps within the shell
├── .agents/AGENTS.md             # Shell-level agent development guidelines
├── index.html                    # Vite entry HTML
├── package.json                  # React 19, Zustand 5, Vite 8
├── vite.config.ts                # Vite config with React plugin
├── tsconfig.json                 # Project references root
├── tsconfig.app.json             # App-level TS config
├── server/                       # Express backend (routes, services, middleware)
│   ├── index.ts                  # Server entry point — mounts all routes
│   ├── routes/                   # API route handlers per domain
│   └── services/                 # Business logic (module singletons)
└── src/
    ├── main.tsx                  # React root → <Shell />
    ├── styles.css                # CSS barrel (import order matters)
    ├── styles/                   # Shell design system
    │   ├── 00-reset.css          # CSS reset
    │   ├── 01-tokens.css         # Design tokens (colors, spacing, fonts)
    │   ├── 02-utilities.css      # Utility classes
    │   ├── shell-layout.css      # CSS Grid shell layout
    │   ├── shell-topbar.css      # Topbar styles
    │   ├── shell-panels.css      # Right & bottom panel styles
    │   └── landing-page.css      # App launcher landing page styles
    ├── types/
    │   └── app.ts                # AppManifest, PanelRegistration, CommandRegistration
    ├── shared/                   # Reusable components available to all apps
    │   ├── markdown/             # Markdown rendering (MarkdownViewer)
    │   └── folder-picker/        # Filesystem folder selection
    ├── shell/                    # Framework internals (apps import from here)
    │   ├── store.ts              # Zustand store — layout, navigation, preferences
    │   ├── commandBus.ts         # Tier 2 imperative command/event system
    │   ├── hooks.ts              # React hooks for apps (panels, commands, resize)
    │   ├── urlState.ts           # Bidirectional URL ↔ store sync
    │   ├── useAppSubRoute.ts     # Per-app sub-route hook
    │   ├── authContext.tsx       # Auth context (standalone vs server mode)
    │   └── useSecrets.ts         # Secrets API hook
    ├── app/                      # Shell UI components
    │   ├── Shell.tsx             # Root layout compositor
    │   ├── Topbar.tsx            # Header bar with app breadcrumbs + panel toggles
    │   ├── LeftNav.tsx           # Left sidebar (delegates to active app's leftNav)
    │   ├── CanvasArea.tsx        # Main content area wrapper
    │   ├── RightPanel.tsx        # Right panel wrapper with resize handle
    │   ├── BottomPanel.tsx       # Bottom panel wrapper with resize handle
    │   └── LandingPage.tsx       # App launcher grid (search, pin, hide)
    └── apps/                     # Hosted applications
        ├── registry.ts           # Central app registry (compile-time imports)
        ├── hello-world/          # Demo app — exercises all shell capabilities
        │   └── ARCHITECTURE.md
        ├── arcade/               # Retro game arcade
        │   └── ARCHITECTURE.md
        ├── admin/                # User/system administration
        ├── db-helper/            # Database exploration tools
        │   └── ARCHITECTURE.md
        ├── codascope/            # AI-powered codebase documentation & analysis
        │    ├── ARCHITECTURE.md   # ← App-specific architecture (progressive disclosure)
        │    └── AGENTS.md         # ← App-specific agent development rules
        └── music-creator/        # Compact browser-based drum and melody sequencer
            ├── ARCHITECTURE.md   # ← App-specific architecture (progressive disclosure)
            └── AGENTS.md         # ← App-specific agent development rules
```

> **Container Principle**: AIShell is a container. Each app is self-governing — its architecture and development conventions live in its own `ARCHITECTURE.md` and `AGENTS.md`. This document covers only the shell framework. For app-specific details, read the app's own docs.

---

## Level 2 — Core Concepts

### The Application Contract (`AppManifest`)

Every application exports a single `AppManifest` from `<appDir>/manifest.tsx`. This is the **only interface** between an app and the shell.

```typescript
interface AppManifest {
  id: AppId;                              // URL path segment: /:appId
  name: string;                           // Display name
  icon?: ComponentType<{ size?: number }>; // Icon for cards and header
  description?: string;                   // Landing page card subtitle
  accentColor?: string;                   // Card accent (CSS color)

  // UI regions — the app owns ALL of these when active
  mainContent: ComponentType;              // Required — the canvas area
  leftNav?: ComponentType;                 // Left sidebar content
  rightPanel?: PanelRegistration;          // Right panel widget
  bottomPanel?: PanelRegistration;         // Bottom panel widget
  headerItems?: ComponentType;             // Injected into the topbar

  // Lifecycle
  commands?: CommandRegistration[];        // Command bus handlers
}
```

**Key file**: [`src/types/app.ts`](src/types/app.ts)

### App Registry

All apps are registered at compile time in [`src/apps/registry.ts`](src/apps/registry.ts):

```typescript
import { helloWorldApp } from "./hello-world/manifest";
import { arcadeApp }     from "./arcade/manifest";
import { adminApp }      from "./admin/manifest";
import { dbHelperApp }   from "./db-helper/manifest";
import { codaScopeApp }  from "./codascope/manifest";
import { musicCreatorApp } from "./music-creator/manifest";

export const apps: AppManifest[] = [
  helloWorldApp, arcadeApp, dbHelperApp, codaScopeApp, musicCreatorApp, adminApp
];
```

**To add a new app:**
1. Create `src/apps/<appId>/` directory
2. Export an `AppManifest` from `manifest.tsx`
3. Add the import + array entry in `registry.ts`
4. Add `@import "./apps/<appId>/<appId>.css"` to `src/styles.css` (if app has styles)

### Navigation Model

- **Landing page** (`/`) — Shows all registered apps as cards with search, pin, and hide
- **Active app** (`/:appId`) — Shell renders the app's `mainContent`, `leftNav`, panels, etc.
- App sub-routes are handled by the **app's own `mainContent`** (not the shell)
- URL query params: `?rp=<panelId>`, `?bp=<panelId>`, `?rpw=<px>`, `?bph=<px>`, `?nav=collapsed`

> **⚠️ MANDATORY**: Every application MUST maintain deep-linkable URL state. Sub-views must sync to the URL via `pushState`/`popstate` so that refresh, back/forward, and sharing work. See [`APP_DEVELOPMENT_GUIDE.md`](APP_DEVELOPMENT_GUIDE.md) for the required pattern.

---

## Level 3 — Communication Architecture

The shell uses a **two-tier communication model**:

### Tier 1: Shell Store (Reactive State)

**When to use**: "What is the current state of the UI?"

- Zustand store in [`src/shell/store.ts`](src/shell/store.ts)
- Holds layout geometry, active app, theme, user preferences (pinned/hidden apps)
- Components subscribe via `useShellStore(selector)`
- State syncs bidirectionally with the URL via [`src/shell/urlState.ts`](src/shell/urlState.ts)

```typescript
interface ShellState {
  leftNavCollapsed: boolean;
  rightPanelId: string | null;    rightPanelWidth: number;
  bottomPanelId: string | null;   bottomPanelHeight: number;
  activeAppId: string | null;
  theme: "dark" | "light";
  pinnedApps: string[];           hiddenApps: string[];
  // ... actions (setActiveApp, toggleRightPanel, etc.)
}
```

### Tier 2: Command Bus (Imperative Actions)

**When to use**: "Make something happen"

- Singleton in [`src/shell/commandBus.ts`](src/shell/commandBus.ts)
- Patterns: `invoke()` (request/response), `emit()` (fire-and-forget), `on()` (subscribe)
- Built-in commands: `shell.navigate`, `shell.goHome`, `shell.openRightPanel`, `shell.closeRightPanel`, `shell.openBottomPanel`, `shell.closeBottomPanel`
- Apps register custom commands via `AppManifest.commands[]`
- Accessible globally via `window.__aiShell.commandBus`

### Shell Hooks for Apps

[`src/shell/hooks.ts`](src/shell/hooks.ts) provides convenience hooks:

| Hook | Purpose |
|------|---------|
| `useRightPanel(panelId)` | Open/close/toggle right panel |
| `useBottomPanel(panelId)` | Open/close/toggle bottom panel |
| `usePanelParams(prefix)` | Read/write URL params scoped to a panel |
| `useCommandBus()` | Register/invoke/emit commands (auto-cleanup) |
| `usePanelResize(opts)` | Pointer-capture panel resize drag |

---

## Level 4 — Shell UI Component Flow

```
main.tsx
  └── <Shell />                              ← src/app/Shell.tsx
       ├── <Topbar activeApp={app} />        ← Header: logo, breadcrumb, app.headerItems, panel toggles
       ├── <LeftNav apps={apps} activeApp />  ← Renders app.leftNav when active, or nothing
       ├── <CanvasArea>                       ← Main content wrapper
       │    ├── app.mainContent OR <LandingPage />
       │    └── <BottomPanel activeApp />     ← Renders app.bottomPanel if open
       └── <RightPanel activeApp />           ← Renders app.rightPanel if open
```

### Layout CSS

The shell uses **CSS Grid** (`shell-layout.css`) with named grid areas:
- `topbar` — fixed height header
- `left-nav` — collapsible sidebar (200px default)
- `canvas` — main content (fills remaining space)
- `right-panel` — optional, width set by `--right-panel-width` CSS variable

Panels use `data-*` attributes on the `.shell` element for conditional layout:
- `data-nav="collapsed"` — collapses left nav
- `data-right-panel="<id>"` — shows right panel column

---

## Level 5 — Design System

### CSS Architecture

Styles are loaded in strict order via [`src/styles.css`](src/styles.css):

1. **`00-reset.css`** — Minimal CSS reset
2. **`01-tokens.css`** — Design tokens as CSS custom properties
   - Colors: `--color-bg-primary`, `--color-text-primary`, `--color-accent`, etc.
   - Spacing: `--space-1` through `--space-10`
   - Typography: `--text-2xs` through `--text-xl`, `--weight-*`, `--font-sans`, `--font-mono`
   - Borders: `--radius-sm/md/lg/xl`, `--color-border-*`
   - Shadows: `--shadow-sm/md/lg`
   - Transitions: `--transition-fast/normal/slow`
3. **`02-utilities.css`** — Utility classes
4. **Shell layout styles** — `shell-layout.css`, `shell-topbar.css`, `shell-panels.css`
5. **Landing page** — `landing-page.css`
6. **App styles** — Each app imports its own CSS file

### Conventions

- Dark theme by default (tokens in `:root`)
- All colors use HSL for consistency
- Font stack: Inter (Google Fonts via index.html), system-ui fallback
- App CSS is namespaced by app name (e.g., `.arcade-*`, `.hello-*`)

---

## Level 6 — URL Schema

```
/:appId                      → Active application
/:appId/:subRoute*           → App-managed sub-routes (splat)

?rp=<panelId>                → Right panel open
?bp=<panelId>                → Bottom panel open
?rp.<key>=<value>            → Right panel scoped state
?bp.<key>=<value>            → Bottom panel scoped state
?rpw=<px>                    → Right panel width (if non-default)
?bph=<px>                    → Bottom panel height (if non-default)
&nav=collapsed               → Left nav collapsed
```

- App navigation → `pushState` (new history entry)
- Layout changes → `replaceState` (no history entry)
- Browser back/forward → `popstate` re-hydrates the store

---

## Level 7 — User Preferences

Stored in `localStorage` under key `aishell:user-prefs`:

```json
{ "pinnedApps": ["arcade"], "hiddenApps": [] }
```

- **Pinned apps** appear first on the landing page with a star badge
- **Hidden apps** are not shown unless the user clicks "Show Hidden"
- Hiding an app auto-unpins it
- Managed by `togglePinApp(appId)` and `toggleHideApp(appId)` in the store

---

## Appendix — How to Create a New Application

> **Read [`APP_DEVELOPMENT_GUIDE.md`](APP_DEVELOPMENT_GUIDE.md) for the full, authoritative guide.** The summary below covers the basics.

```bash
# 1. Create the app directory
mkdir -p src/apps/my-app

# 2. Create the manifest
cat > src/apps/my-app/manifest.tsx << 'EOF'
import type { AppManifest } from "../../types/app";

function MyContent() { return <div>Hello from My App</div>; }

export const myApp: AppManifest = {
  id: "my-app",
  name: "My App",
  description: "A new application",
  accentColor: "hsl(140, 70%, 50%)",
  mainContent: MyContent,
};
EOF

# 3. Register in src/apps/registry.ts
#    import { myApp } from "./my-app/manifest";
#    Add to the apps array.

# 4. (Optional) Add CSS: create my-app.css, add @import to src/styles.css

# 5. REQUIRED: Create ARCHITECTURE.md for the app
# 6. REQUIRED: Create AGENTS.md with app-specific dev rules
# 7. REQUIRED: Implement URL deep-linking (pushState/popstate)
```

Each application **must** include its own `ARCHITECTURE.md` (progressive disclosure format) and `AGENTS.md` (development conventions). App-specific rules, patterns, and constraints belong in these files — not in the shell-level docs. See [`APP_DEVELOPMENT_GUIDE.md`](APP_DEVELOPMENT_GUIDE.md) for detailed requirements and examples.
