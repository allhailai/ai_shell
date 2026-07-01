# Application Development Guide

> **For AI agents and human developers building apps in AIShell.**
> Read this document BEFORE creating or modifying any application.
> This is the authoritative source for application conventions.

---

## Mandatory Conventions

Every application MUST follow these conventions. Failure to comply will result in broken user experience.

### 1. Deep Linking / URL State

**Every application MUST maintain deep-linkable URL state.** The URL must reflect the current view so that:
- Refreshing the page restores the same view
- Browser back/forward works naturally
- URLs can be shared/bookmarked

**How to implement:**
- Read the URL sub-route on component mount to initialize state
- Push URL changes via `window.history.pushState()` when the user navigates within the app
- Listen for `popstate` events to handle browser back/forward
- Use `replaceState` for non-navigation state changes (e.g., form inputs, toggles)

**URL Schema:**
```
/:appId                   → app's default/home view
/:appId/:subRoute         → app sub-views (e.g., /arcade/tetris)
/:appId/:subRoute/:param  → deeper nesting as needed
```

**Example pattern** (from the arcade app):
```typescript
// Read sub-route from URL
function getSubRouteFromUrl(): string | null {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments[1] ?? null;
}

// Push sub-route changes
function pushSubRoute(subRoute: string | null): void {
  const path = subRoute ? `/${appId}/${subRoute}` : `/${appId}`;
  window.history.pushState(null, "", `${path}${window.location.search}`);
}

// On mount: initialize from URL
const [view, setView] = useState(() => getSubRouteFromUrl());

// On popstate: sync back
useEffect(() => {
  const handler = () => setView(getSubRouteFromUrl());
  window.addEventListener("popstate", handler);
  return () => window.removeEventListener("popstate", handler);
}, []);
```

**See also:** [`src/apps/hello-world/HelloContent.tsx`](src/apps/hello-world/HelloContent.tsx) for the simplest example, [`src/apps/arcade/ArcadeContent.tsx`](src/apps/arcade/ArcadeContent.tsx) for a more complex one.

---

### 2. Architecture & Agent Documentation

**Every application MUST include an `ARCHITECTURE.md`** in its root directory following the **progressive disclosure** pattern:

```markdown
# <App Name> — Application Architecture

> **Progressive Disclosure Document** — Start reading from the top. Stop when you have enough context.

## Level 0 — What Is This?
One paragraph explaining the app's purpose.

## Level 1 — File Map
Directory tree with one-line descriptions.

## Level 2 — Core Concepts
Key interfaces, contracts, patterns.

## Level 3+ — Implementation Details
Data flow, state management, persistence, game logic, etc.
```

**Every application SHOULD include an `AGENTS.md`** in its root directory with:
- Reference to the app's `ARCHITECTURE.md`
- App-specific coding conventions (icons, state, data patterns)
- File organization rules
- Common mistakes to avoid
- Testing/verification checklist

**Applications are encouraged to maintain a `development_prompts/` directory** with reusable prompts for periodic health checks. The most common is an architectural review prompt:

```
src/apps/<appId>/
├── development_prompts/
│   └── architectural_review.md    # App-specific boundary, complexity, dead code review
```

The shell provides a framework-level review at `development_prompts/architectural_review.md` in the project root. App-level review prompts focus on internal architecture — service boundaries, god files, dead code within the app, and documentation drift specific to that app. See `src/apps/codascope/development_prompts/architectural_review.md` for an example.

**Why this matters:** AI agents reading the codebase discover `ARCHITECTURE.md` and `AGENTS.md` files first. Progressive disclosure lets them stop reading as soon as they have enough context. App-level `AGENTS.md` keeps app-specific conventions scoped correctly — they don't belong in the shell-level docs. App-level review prompts enable targeted architectural health checks without reviewing the entire shell.

---

### 3. CSS Namespacing

All CSS classes MUST be prefixed with the app's ID to prevent collisions:
- `.arcade-*` for the arcade app
- `.hello-*` for the hello-world app
- `.admin-*` for the admin app

Styles go in a dedicated `<appId>.css` file imported via `src/styles.css`.

---

### 4. Manifest Contract

Every app exports an `AppManifest` from `manifest.tsx`:

```typescript
export const myApp: AppManifest = {
  id: "my-app",           // URL path segment — MUST match directory name
  name: "My App",         // Display name
  icon: MyIcon,           // SVG icon component
  description: "...",     // Landing page card subtitle
  accentColor: "...",     // Card accent (HSL preferred)
  system: false,          // true = hidden from landing page, shown at nav bottom

  mainContent: MyContent, // Required — the canvas area
  leftNav: MyNav,         // Optional — left sidebar
  rightPanel: { ... },    // Optional — right panel widget
  bottomPanel: { ... },   // Optional — bottom panel widget
  headerItems: MyHeader,  // Optional — topbar injection
};
```

**Registration steps:**
1. Add import to `src/apps/registry.ts`
2. Add to the `apps` array
3. Add CSS import to `src/styles.css` (if app has styles)

---

### 5. Authentication Context

Use `useAuth()` from `../../shell/authContext` to access:
- `mode` — `"standalone"` or `"server"`
- `username` — current user's name
- `isAdmin` — whether the user has admin privileges

**Always check auth mode** before showing multi-user features. See the admin app's `UsersTab.tsx` for the standalone-mode disabled pattern.

---

### 6. Secrets API

Apps that need secrets (API keys, tokens) MUST use the centralized secrets API:

```typescript
// Read a secret
const res = await fetch(`/api/secrets/app/${appId}/${key}`);

// Save a secret
await fetch(`/api/secrets/app/${appId}/${key}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ value }),
});
```

Scopes: `global` (shared), `app` (app-private), `user` (per-user).

---

## Design System

Use the shell's design tokens — never hardcode colors, spacing, or fonts:

| Token | Example |
|-------|---------|
| Colors | `var(--color-bg-primary)`, `var(--color-text-secondary)` |
| Spacing | `var(--space-1)` through `var(--space-10)` |
| Typography | `var(--text-sm)`, `var(--weight-semibold)` |
| Borders | `var(--radius-md)`, `var(--color-border-primary)` |
| Shadows | `var(--shadow-md)` |
| Transitions | `var(--transition-fast)` |

Dark theme is the default. All colors use HSL.

---

## Communication Tiers

| Need | Use |
|------|-----|
| "What is the current UI state?" | **Tier 1**: Zustand store (`useShellStore`) |
| "Make something happen" | **Tier 2**: Command bus (`useCommandBus`) |
| "Share state across shell-rendered components" | Module-level state + `useSyncExternalStore` |

---

## Checklist for New Applications

- [ ] Created `src/apps/<appId>/` directory
- [ ] Created `manifest.tsx` with valid `AppManifest`
- [ ] Registered in `src/apps/registry.ts`
- [ ] Created `<appId>.css` and imported in `src/styles.css`
- [ ] Created `ARCHITECTURE.md` with progressive disclosure
- [ ] Created `AGENTS.md` with app-specific development rules
- [ ] (Encouraged) Created `development_prompts/architectural_review.md` for periodic health checks
- [ ] URL deep-linking: sub-routes sync with `pushState`/`popstate`
- [ ] CSS classes namespaced with app ID prefix
- [ ] Design tokens used (no hardcoded colors/spacing)
- [ ] Type-checked: `npm run check` passes

