# Architectural Review — AIShell (Shell Framework)

> **Purpose:** Reusable prompt for periodic architectural reviews of the AIShell **shell framework**. This covers the container, shared infrastructure, and cross-app concerns — NOT individual application internals. For app-specific reviews, see each app's own `development_prompts/architectural_review.md`.

## Instructions

You are performing an architectural review of the AIShell shell framework. AIShell is a multi-application hosting framework built with React + TypeScript + Vite (frontend) and Express + TypeScript (backend). It provides a container shell with UI regions (topbar, left nav, canvas, right panel, bottom panel) and a registry-based app model.

Read all relevant code. Do not skim. Your findings must cite specific files, line ranges, and concrete evidence. Do not report hypothetical issues — only report what you observe in the actual codebase.

## Review Scope

The review covers the shell framework and cross-cutting concerns:

```
ai_shell/
├── ARCHITECTURE.md                   # Shell architecture (progressive disclosure)
├── APP_DEVELOPMENT_GUIDE.md          # How apps plug into the shell
├── .agents/AGENTS.md                 # Shell-level agent development guidelines
├── development_prompts/              # Review prompts (this file lives here)
├── index.html                        # Vite entry HTML
├── package.json                      # React 19, Zustand 5, Vite 8
├── vite.config.ts                    # Vite config with React plugin
├── tsconfig.json / tsconfig.app.json / tsconfig.server.json
├── server/
│   ├── index.ts                      # Server entry point — mounts all routes (228 lines)
│   ├── middleware/
│   │   └── auth.ts                   # Auth middleware factory (179 lines)
│   ├── routes/
│   │   ├── authRoutes.ts             # Auth routes (263 lines)
│   │   ├── secretRoutes.ts           # Secret management routes (250 lines)
│   │   ├── filesystemRoutes.ts       # Filesystem access routes (245 lines)
│   │   ├── dbHelperRoutes.ts         # DB Helper routes (436 lines)
│   │   ├── dbExplorerRoutes.ts       # DB Explorer routes (521 lines)
│   │   └── codaScopeRoutes.ts        # CodaScope routes (1722 lines)
│   └── services/
│       ├── platform.ts               # OS/platform detection (123 lines)
│       ├── authService.ts            # Auth service facade (84 lines)
│       ├── localAuthStrategy.ts      # Local auth implementation (425 lines)
│       ├── keychainBackend.ts        # OS keychain integration (203 lines)
│       ├── secretService.ts          # Secret storage service (168 lines)
│       ├── secretBackend.ts          # Secret backend interface (70 lines)
│       └── codaScope*.ts             # CodaScope services (app-specific, reviewed separately)
└── src/
    ├── main.tsx                      # React root → <Shell />
    ├── styles.css                    # CSS barrel (import order matters)
    ├── styles/                       # Shell design system
    │   ├── 00-reset.css              # CSS reset
    │   ├── 01-tokens.css             # Design tokens (132 lines)
    │   ├── 02-utilities.css          # Utility classes (80 lines)
    │   ├── shell-layout.css          # CSS Grid shell layout (73 lines)
    │   ├── shell-topbar.css          # Topbar styles (177 lines)
    │   ├── shell-panels.css          # Right & bottom panel styles (379 lines)
    │   ├── landing-page.css          # App launcher (342 lines)
    │   └── login-page.css            # Login page (148 lines)
    ├── types/
    │   └── app.ts                    # AppManifest, PanelRegistration, CommandRegistration (159 lines)
    ├── shared/
    │   ├── markdown/                 # Markdown rendering (MarkdownViewer, MarkdownEditor, extensions)
    │   └── folder-picker/            # Filesystem folder selection (FolderPicker.tsx + .css)
    ├── shell/                        # Framework internals
    │   ├── store.ts                  # Zustand store (149 lines)
    │   ├── commandBus.ts             # Tier 2 command/event system (117 lines)
    │   ├── hooks.ts                  # React hooks for apps (186 lines)
    │   ├── urlState.ts               # URL ↔ store sync (172 lines)
    │   ├── useAppSubRoute.ts         # Per-app sub-route hook (143 lines)
    │   ├── authContext.tsx            # Auth context (163 lines)
    │   └── useSecrets.ts             # Secrets API hook (115 lines)
    ├── app/                          # Shell UI components
    │   ├── Shell.tsx                  # Root layout compositor (152 lines)
    │   ├── Topbar.tsx                # Header bar (138 lines)
    │   ├── LeftNav.tsx               # Left sidebar (177 lines)
    │   ├── CanvasArea.tsx            # Main content wrapper
    │   ├── RightPanel.tsx            # Right panel wrapper
    │   ├── BottomPanel.tsx           # Bottom panel wrapper
    │   ├── LandingPage.tsx           # App launcher grid (297 lines)
    │   └── LoginPage.tsx             # Login page (96 lines)
    └── apps/                         # Hosted applications (reviewed separately)
        ├── registry.ts               # Central app registry (25 lines)
        ├── hello-world/              # Demo app
        ├── arcade/                   # Retro game arcade
        ├── admin/                    # User/system administration
        ├── db-helper/                # Database exploration tools
        └── codascope/                # AI-powered codebase documentation & analysis
```

**Out of scope**: Individual application internals. Each app is reviewed by its own architectural review prompt. This review covers the shell framework AND cross-app concerns (e.g., do apps respect boundaries, does the registry match reality).

---

## Phase 1: Shell Framework Boundary Integrity

### 1.1 Shell Module Boundaries

Verify that the shell framework modules respect their intended roles:

- **`src/shell/`** — Framework internals. These are the hooks and state that apps import. Shell modules should NOT import from `src/app/` (UI components) or `src/apps/` (applications). The dependency arrow is: `apps → shell`, never `shell → apps`.
- **`src/app/`** — Shell UI components. These may import from `src/shell/` and `src/types/`. They should NOT import directly from `src/apps/` except through the registry.
- **`src/types/`** — Pure type definitions. Should not import from any other `src/` directory. Should not contain runtime code.
- **`src/shared/`** — Reusable components available to all apps. Should NOT import from `src/shell/`, `src/app/`, or `src/apps/`. Must be self-contained or depend only on `src/types/`.
- **`src/apps/registry.ts`** — The ONLY file that should import from individual app directories. Verify no other shell file reaches into `src/apps/<appId>/`.
- **`src/main.tsx`** — Must be a thin entrypoint. No business logic, no data loading.

For each violation found, report the file, import statement, and recommended fix.

### 1.2 Cross-App Isolation

Applications must not import from each other. Verify:

- No `src/apps/arcade/` file imports from `src/apps/codascope/` (or any other app)
- No `src/apps/admin/` file imports from `src/apps/db-helper/` (or any other app)
- Shared code between apps should live in `src/shared/`, not be duplicated or cross-imported

### 1.3 Server-Side Boundaries

- **`server/index.ts`** (228 lines) — Entry point. Should be a thin composition root: create services, wire routes, start server. Verify no business logic leaks into this file.
- **Routes** should be thin dispatchers to services. Check each route file for business logic that should be in a service:
  - `authRoutes.ts` (263 lines)
  - `secretRoutes.ts` (250 lines)
  - `filesystemRoutes.ts` (245 lines)
  - `dbHelperRoutes.ts` (436 lines) — large for a route file, check for service logic
  - `dbExplorerRoutes.ts` (521 lines) — large for a route file, check for service logic
  - `codaScopeRoutes.ts` (1722 lines) — **very large**, reviewed in the CodaScope-specific prompt
- **Services** should not directly handle HTTP (no `req`/`res` objects). Services should be domain-focused singletons.
- **Shared services** (auth, secrets, platform) should not have app-specific knowledge. Verify `authService.ts`, `secretService.ts`, `keychainBackend.ts`, and `localAuthStrategy.ts` don't reference CodaScope, DB Helper, or any specific app.

### 1.4 Server Route Ownership

Each route file maps to an app domain. Verify the ownership is clear and there's no bleed:

| Route File | Expected Owner | Lines |
|-----------|----------------|-------|
| `authRoutes.ts` | Shell (shared) | 263 |
| `secretRoutes.ts` | Shell (shared) | 250 |
| `filesystemRoutes.ts` | Shell (shared) | 245 |
| `dbHelperRoutes.ts` | DB Helper app | 436 |
| `dbExplorerRoutes.ts` | DB Helper app | 521 |
| `codaScopeRoutes.ts` | CodaScope app | 1722 |

- Are there routes in `authRoutes.ts` or `secretRoutes.ts` that serve only one app?
- Does any app define routes outside its designated route file?
- Should `dbHelperRoutes.ts` and `dbExplorerRoutes.ts` be merged or are they correctly separated?

---

## Phase 2: App Manifest Contract Compliance

### 2.1 Registry Accuracy

Read `src/apps/registry.ts` and verify:
- Every directory under `src/apps/` has a corresponding import and array entry
- Every import in the registry resolves to a valid `manifest.tsx`
- The registry array order is intentional (affects landing page order)

Current registered apps: `helloWorldApp`, `arcadeApp`, `dbHelperApp`, `codaScopeApp`, `adminApp`

### 2.2 Manifest Contract Adherence

For each registered app, verify the manifest satisfies `AppManifest` from `src/types/app.ts`:

| App | Has leftNav? | Has rightPanel? | Has bottomPanel? | Has headerItems? | Has commands? | system? |
|-----|-------------|----------------|-----------------|-----------------|--------------|---------|
| hello-world | | | | | | |
| arcade | | | | | | |
| db-helper | | | | | | |
| codascope | | | | | | |
| admin | | | | | | |

Fill in the table and verify each field type-checks against the interface.

### 2.3 CSS Registration

Verify `src/styles.css` imports match the app registry:
- Every app in the registry has a corresponding CSS import in `styles.css`
- No CSS imports reference apps that don't exist in the registry
- Import order is correct: reset → tokens → utilities → shell → shared → apps

Current CSS imports for apps:
```
./apps/hello-world/hello-world.css
./apps/arcade/arcade.css
./apps/admin/admin.css
./apps/db-helper/db-helper.css
./apps/codascope/codascope.css
./apps/codascope/CodaScopeAssistant.css
```

- CodaScope has two CSS files imported. Is this appropriate or should they be consolidated?

### 2.4 URL Deep-Linking Compliance

For each app, verify it properly implements URL state:
- Uses `useAppSubRoute("<appId>")` or manual `pushState`/`popstate`
- Refreshing the page restores the current view
- Browser back/forward works
- Sub-routes are reflected in the URL

### 2.5 Documentation Compliance

For each app, verify it has:
- [ ] `ARCHITECTURE.md` (progressive disclosure format)
- [ ] `AGENTS.md` (app-specific development rules)

Current status (verify):
- `hello-world/` — has ARCHITECTURE.md? AGENTS.md?
- `arcade/` — has ARCHITECTURE.md? AGENTS.md?
- `admin/` — has ARCHITECTURE.md? AGENTS.md?
- `db-helper/` — has ARCHITECTURE.md? AGENTS.md?
- `codascope/` — has ARCHITECTURE.md ✓, AGENTS.md ✓

---

## Phase 3: CSS and Design Token Integrity

### 3.1 Token Usage Audit

Sample-check each app's CSS file for hard-coded values that should use design tokens:

| App CSS | Lines | Check |
|---------|-------|-------|
| `hello-world.css` | 386 | |
| `arcade.css` | 851 | |
| `admin.css` | 611 | |
| `db-helper.css` | 626 | |
| `db-helper/explorer/explorer.css` | 829 | |
| `codascope.css` | 2152 | |
| `CodaScopeAssistant.css` | 732 | |

For each, grep for:
- Hard-coded hex colors (`#xxx`)
- Hard-coded `rgb()` or `hsl()` not from tokens
- Hard-coded pixel values for spacing (should use `--space-*`)
- Hard-coded font sizes (should use `--text-*`)
- Hard-coded border-radius (should use `--radius-*`)

### 3.2 CSS Namespace Audit

Verify every app prefixes its CSS classes correctly:
- `hello-*` for hello-world
- `arcade-*` for arcade
- `admin-*` for admin
- `db-helper-*` or `dbhelper-*` for db-helper
- `codascope-*` for codascope
- `shell-*` for shell framework
- `shared-*` for shared components

Search for unprefixed CSS classes that could collide.

### 3.3 Shell Style Files

Verify shell CSS files (`shell-layout.css`, `shell-topbar.css`, `shell-panels.css`) don't contain app-specific styles. These should be purely framework layout.

---

## Phase 4: Dead Code and Dead Infrastructure

### 4.1 Unreferenced Files

Identify files under `src/` and `server/` that are never imported:
- A component is dead if no parent renders it
- A service is dead if no route or other service calls it
- A CSS file is dead if nothing imports it
- A hook is dead if no component calls it

Pay special attention to:
- `src/shared/` — are all shared components actually used by at least one app?
- Shared markdown extensions — are all extensions consumed?

### 4.2 Unreferenced Exports

Check for exported functions, types, or constants that are never imported:
- `src/types/app.ts` — are all exported types consumed?
- `src/shell/hooks.ts` — are all exported hooks used by at least one app?
- `src/shell/store.ts` — are all store actions used?
- `src/shell/commandBus.ts` — are all built-in commands dispatched?

### 4.3 Server Dead Code

- `server/services/secretBackend.ts` (70 lines) — is this an interface that `keychainBackend.ts` implements, or is it dead?
- `server/services/platform.ts` (123 lines) — verify all exported fields are consumed
- Are there server service functions that no route calls?

---

## Phase 5: Complexity and Simplification

### 5.1 Large Server Files

Report all server files over 200 lines:

| File | Lines | Notes |
|------|-------|-------|
| `codaScopeRoutes.ts` | 1722 | Reviewed in CodaScope prompt |
| `codaScopeAgentService.ts` | 800 | Reviewed in CodaScope prompt |
| `codaScopeCodeMapService.ts` | 606 | Reviewed in CodaScope prompt |
| `codaScopeBuildStateService.ts` | 532 | Reviewed in CodaScope prompt |
| `dbExplorerRoutes.ts` | 521 | DB Explorer — should logic be in a service? |
| `codaScopeChatService.ts` | 509 | Reviewed in CodaScope prompt |
| `dbHelperRoutes.ts` | 436 | DB Helper — should logic be in a service? |
| `localAuthStrategy.ts` | 425 | Auth implementation — appropriate complexity? |
| `codaScopeWikiStateService.ts` | 389 | Reviewed in CodaScope prompt |
| `codaScopeChatPromptHelpers.ts` | 313 | Reviewed in CodaScope prompt |
| `authRoutes.ts` | 263 | Auth routes — any business logic leaks? |
| `codaScopeQualityService.ts` | 262 | Reviewed in CodaScope prompt |
| `codaScopeGoldenRuleService.ts` | 252 | Reviewed in CodaScope prompt |
| `secretRoutes.ts` | 250 | Secret routes — appropriately sized? |
| `filesystemRoutes.ts` | 245 | Filesystem routes — any security concerns? |
| `codaScopeProjectService.ts` | 241 | Reviewed in CodaScope prompt |
| `server/index.ts` | 228 | Server entry — is it still thin? |
| `codaScopeCommandLoader.ts` | 212 | Reviewed in CodaScope prompt |
| `keychainBackend.ts` | 203 | Keychain — appropriate complexity? |

For non-CodaScope files, identify:
- How many distinct responsibilities does it handle?
- Could any sub-responsibility be extracted?

### 5.2 DB Helper Route Consolidation

`dbHelperRoutes.ts` (436 lines) and `dbExplorerRoutes.ts` (521 lines) serve the same app. Evaluate:
- Should they be merged into one file?
- Or is the separation between "connection management" and "query/explore" intentional and correct?
- Do they share a service layer, or does route-level business logic need extraction?

### 5.3 Shell Component Complexity

Shell UI components should be simple layout delegators. Verify none have grown business logic:

| Component | Lines | Expected Role |
|-----------|-------|---------------|
| `LandingPage.tsx` | 297 | App card grid + search/pin/hide |
| `LeftNav.tsx` | 177 | Delegates to active app's leftNav |
| `Shell.tsx` | 152 | CSS Grid layout compositor |
| `Topbar.tsx` | 138 | Header bar + panel toggles |
| `LoginPage.tsx` | 96 | Login form |

---

## Phase 6: Documentation Accuracy

### 6.1 ARCHITECTURE.md

Compare `ARCHITECTURE.md` against the actual codebase:

- **Directory Map (Level 1):** Does it match reality? Any directories added or removed since last update?
- **App Registry (Level 2):** Does the listed registry match `src/apps/registry.ts`?
- **Communication Architecture (Level 3):** Are the store fields, command bus commands, and hooks still accurate?
- **Shell UI Flow (Level 4):** Does the component tree match `Shell.tsx`?
- **Design System (Level 5):** Do the listed token categories match `01-tokens.css`?
- **URL Schema (Level 6):** Does it match `urlState.ts` behavior?
- **User Preferences (Level 7):** Does the localStorage schema match the store?

### 6.2 APP_DEVELOPMENT_GUIDE.md

- **Mandatory Conventions:** Are all 6 conventions still accurate and enforced?
- **Design System tokens:** Does the token table match `01-tokens.css`?
- **Communication Tiers:** Still accurate?
- **New App Checklist:** Complete and correct?
- Does it reference any removed features or stale file paths?

### 6.3 .agents/AGENTS.md

- **Scope Rules table:** Does it match the actual directory structure?
- **Design Tokens rule:** Does the token example match `01-tokens.css`?
- **CSS Namespacing rule:** Are the examples still correct?
- **Communication Tiers table:** Still accurate?
- **Server Routes & Services section:** Does it match the actual `server/` layout?
- **Shared Components section:** Does it list all shared components?
- Does it reference any removed features or stale file paths?

---

## Phase 7: Type Safety and Shared Contracts

### 7.1 AppManifest Contract

- Does `src/types/app.ts` (159 lines) accurately describe what the shell actually consumes?
- Are there manifest fields the shell ignores?
- Are there behaviors the shell expects but the manifest doesn't declare?
- Is `AppId` just `string` — should it be a branded type or union of known IDs?

### 7.2 Server API Surface

- Is there a shared contract between frontend and backend, or are API shapes implicit?
- If implicit: are there mismatches between what routes return and what components expect?
- Check for `any` types in route handlers and service functions

### 7.3 Secret Declaration Types

- `SecretDeclaration` in `app.ts` — is it used by any app's manifest?
- Does the `useSecrets` hook properly consume the declaration?

---

## Phase 8: Security Review (Server Mode)

### 8.1 Auth Middleware Coverage

In server mode (`AISHELL_MODE=server`):
- Verify ALL `/api/*` routes go through `authMiddleware.requireAuth`
- Check for routes accidentally registered before the auth middleware
- Verify the version endpoint (`/api/version`) is intentionally public

### 8.2 Filesystem Access

- `filesystemRoutes.ts` (245 lines) — provides filesystem access. In server mode, is this appropriately restricted?
- Are there path traversal protections?
- Who should have access — admin only, or all authenticated users?

### 8.3 Session Management

- Session expiry is configurable via `aishell.config.json`. What's the default?
- Are sessions invalidated on password change?
- Is the cookie `httpOnly`, `secure`, `sameSite`?

---

## Output Format

Produce a structured report with these sections:

1. **Executive Summary** — 3–5 bullet health assessment
2. **Critical Issues** — Must-fix boundary violations, security gaps, or dead code causing confusion
3. **Simplification Opportunities** — Files or patterns that can be split, deduplicated, or removed
4. **Documentation Updates** — Specific text changes needed to bring docs in line with reality
5. **Dead Code Removal List** — Files and exports safe to delete
6. **Cross-App Compliance** — Which apps pass/fail manifest, URL, CSS, and documentation requirements
7. **Security Findings** — Auth, filesystem, session issues (server mode)
8. **Recommended Follow-Up Tasks** — Prioritized list of cleanup work

For each finding, include:
- **File(s):** exact path(s)
- **Evidence:** what you observed (line numbers, import statements, missing references)
- **Recommendation:** concrete action
- **Risk:** low / medium / high if left unaddressed
