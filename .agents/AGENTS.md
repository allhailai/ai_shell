# AIShell — Agent Development Guidelines

> Rules and conventions for AI agents working on the AIShell framework.

---

## Architecture Reference

Read the following docs in order, stopping when you have enough context:

1. [`ARCHITECTURE.md`](../ARCHITECTURE.md) — Shell architecture (progressive disclosure)
2. [`APP_DEVELOPMENT_GUIDE.md`](../APP_DEVELOPMENT_GUIDE.md) — How to build apps within the shell

---

## The Container Principle

AIShell is a **container shell** that hosts multiple applications. Each application is a self-contained module with its own architecture, patterns, and conventions.

### Documentation Hierarchy

```
ai_shell/
├── ARCHITECTURE.md                # Shell-level architecture
├── APP_DEVELOPMENT_GUIDE.md       # How apps plug into the shell
├── .agents/AGENTS.md              # ← You are here (shell-level agent rules)
└── src/apps/
    ├── codascope/
    │   ├── ARCHITECTURE.md        # CodaScope architecture (progressive disclosure)
    │   └── AGENTS.md              # CodaScope-specific agent rules
    ├── arcade/
    │   ├── ARCHITECTURE.md        # Arcade architecture
    │   └── AGENTS.md              # Arcade-specific agent rules (if needed)
    └── <app>/
        ├── ARCHITECTURE.md        # REQUIRED — every app must have one
        └── AGENTS.md              # RECOMMENDED — app-specific development rules
```

### Scope Rules

| You are working on… | Read first… |
|---------------------|-------------|
| Shell framework (`src/shell/`, `src/app/`, `src/styles/`) | This file + `ARCHITECTURE.md` |
| A specific application (e.g., CodaScope) | That app's `AGENTS.md` + `ARCHITECTURE.md` |
| Creating a new application | This file + `APP_DEVELOPMENT_GUIDE.md` |
| Shared infrastructure (`src/shared/`, `server/`) | This file + relevant app's `AGENTS.md` if it owns the service |

**Critical**: Do NOT put application-specific rules in this file. Each app governs itself through its own `AGENTS.md` and `ARCHITECTURE.md`.

---

## Shell-Level Rules

### 1. Design Tokens — No Hard-Coded Values

All UI must use the shell's CSS custom properties from `src/styles/01-tokens.css`:

```css
/* ✅ Correct */
color: var(--color-text-primary);
padding: var(--space-3);
border-radius: var(--radius-md);

/* ❌ Wrong */
color: #ffffff;
padding: 12px;
border-radius: 6px;
```

Token categories: `--color-*`, `--space-*`, `--text-*`, `--weight-*`, `--radius-*`, `--shadow-*`, `--transition-*`

### 2. CSS Namespacing — Always Prefix

Every app MUST prefix all CSS classes with its app ID:

```css
/* ✅ Correct for an app with id "codascope" */
.codascope-sidebar { ... }
.codascope-action-card { ... }

/* ❌ Wrong — will collide with other apps */
.sidebar { ... }
.action-card { ... }
```

Shell-level classes use `shell-` prefix. Shared components use `shared-` prefix.

### 3. URL State — Mandatory Deep Linking

Every app MUST sync its view state to the URL. See `APP_DEVELOPMENT_GUIDE.md` for the authoritative pattern. Key points:

- Use `useAppSubRoute("<appId>")` hook for reading/writing sub-routes
- Navigation actions → `pushState` (creates history entry)
- Layout/UI toggles → `replaceState` (no history entry)
- Never use internal component state for view routing

### 4. App Manifest — The Only Interface

Apps connect to the shell exclusively through `AppManifest` in `manifest.tsx`:
- `mainContent` — the canvas area (required)
- `leftNav`, `rightPanel`, `bottomPanel`, `headerItems` — optional UI regions
- `commands` — command bus registrations

**Never reach into the shell internals** from an app. Use the hooks in `src/shell/hooks.ts`.

### 5. Communication Tiers

| Need | Mechanism |
|------|-----------|
| Current UI state | Tier 1: `useShellStore(selector)` |
| Imperative actions | Tier 2: `useCommandBus()` → `invoke`/`emit`/`on` |
| Cross-component state | Module-level state + `useSyncExternalStore` |

### 6. Server Routes & Services

Backend code lives in `server/`:
- **Routes**: `server/routes/<domain>Routes.ts`
- **Services**: `server/services/<domain>Service.ts`

Services follow **single responsibility** — one domain per file. They are module singletons (not dependency-injected).

The Express server entry point is `server/index.ts`. All routes are mounted there.

---

## Creating a New Application

Follow the checklist in `APP_DEVELOPMENT_GUIDE.md`. The minimum requirements:

1. Create `src/apps/<appId>/manifest.tsx` with a valid `AppManifest`
2. Register in `src/apps/registry.ts`
3. Create `<appId>.css` imported via `src/styles.css`
4. **Create `ARCHITECTURE.md`** with progressive disclosure (Levels 0+)
5. **Create `AGENTS.md`** with app-specific development rules
6. Implement URL deep-linking via `useAppSubRoute`

### Application AGENTS.md Template

Every app's `AGENTS.md` should cover:
- Reference to the app's `ARCHITECTURE.md`
- App-specific coding conventions (icons, state management, data patterns)
- File organization rules
- Common mistakes to avoid
- Testing/verification checklist

---

## Shell Infrastructure Patterns

### Shared Components (`src/shared/`)

Reusable components available to all apps:
- `shared/markdown/` — Markdown rendering (MarkdownViewer)
- `shared/folder-picker/` — Filesystem folder selection

When adding shared components, namespace CSS with `shared-` prefix.

### Authentication

Apps access auth state via `useAuth()` from `src/shell/authContext.tsx`:
- `mode` — `"standalone"` or `"server"`
- `username`, `isAdmin`
- Always guard multi-user features behind auth mode checks

### Secrets

Use the centralized secrets API for API keys and tokens:
- `GET /api/secrets/app/<appId>/<key>`
- `PUT /api/secrets/app/<appId>/<key>`
- Scopes: `global`, `app` (app-private), `user` (per-user)

---

## Common Mistakes to Avoid

1. **Putting app-specific rules in this file** — Each app owns its own `AGENTS.md`
2. **Hard-coding colors or spacing** — Always use design tokens
3. **Unprefixed CSS classes** — Will collide across apps
4. **Storing view state in component state** — Use URL state via `useAppSubRoute`
5. **Importing shell internals directly** — Use the hooks API in `src/shell/hooks.ts`
6. **Skipping `ARCHITECTURE.md`** — Every app must have one for agent discoverability
7. **Skipping URL deep-linking** — Refresh/back/forward must work correctly
