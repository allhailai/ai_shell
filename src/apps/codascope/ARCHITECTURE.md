# CodaScope — Application Architecture

> **Progressive Disclosure Document** — Start reading from the top. Stop when you have enough context for your task.

---

## Level 0 — What Is This?

CodaScope is an **AI-powered codebase exploration, documentation, and analysis** application within AIShell. It uses AI agents (via the Cursor SDK) to automatically generate wiki documentation, quality scans, and concept maps from source code repositories. Users can chat with their codebase, manage analysis pipelines, and maintain coding standards through "Golden Rules."

**Key capabilities**: Code mapping, wiki generation, quality scanning, concept extraction, codebase chat, skills/command framework

---

## Level 1 — File Map

```
src/apps/codascope/
├── manifest.tsx                # AppManifest — wires CodaScope into the shell
├── codascope.css               # All CodaScope-specific styles
├── useCodaScopeStore.ts        # Zustand store — projects, topics, agent state
├── contextAssembler.ts         # Builds context for the AI assistant
├── CodaScopeContent.tsx        # Root content router (view switching)
├── CodaScopeNav.tsx            # Left nav — project picker + view navigation
├── CodaScopeAssistant.tsx      # Right panel — contextual AI assistant
├── components/
│   ├── CodaScopeIcons.tsx      # Centralized SVG icon components
│   ├── ModelPicker.tsx         # AI model selection dropdown
│   └── SetupBanners.tsx        # Inline banners for missing config
├── views/
│   ├── ProjectList.tsx         # Project cards + first-launch setup wizard
│   ├── ProjectDashboard.tsx    # Project overview, analyze pipeline, build state
│   ├── WikiBrowser.tsx         # Wiki topic tree + markdown editor
│   ├── ChatView.tsx            # Full-screen codebase Q&A with SSE streaming
│   ├── QualityDashboard.tsx    # Quality scores, category drill-down, issue list
│   ├── GoldenRules.tsx         # CRUD for coding/architectural standards
│   ├── ConceptExplorer.tsx     # Filterable domain concepts extracted from code
│   ├── SkillsManager.tsx       # Framework + project skills display and runner
│   └── Settings.tsx            # API key, repositories, project configuration
└── commands/                   # Agent prompt templates (markdown files)
    ├── do_build_code_map.md    # Generates repository structure map
    ├── do_build_full_wiki.md   # Builds complete wiki from code map
    ├── do_build_wiki_page.md   # Builds/rebuilds a single wiki page
    ├── do_enrich_wiki_page.md  # Enriches an existing wiki page
    ├── do_explore.md           # Lightweight codebase exploration
    ├── do_quality_scan.md      # Runs quality analysis against golden rules
    ├── do_chat.md              # Codebase Q&A system prompt
    └── do_goal_wiki.md         # Goal-mode: persistent wiki building
```

**Backend services** (under `server/`):
```
server/
├── routes/codaScopeRoutes.ts         # Express routes for all CodaScope APIs
└── services/
    ├── codaScopeProjectService.ts    # Project CRUD, repository management
    ├── codaScopeWikiService.ts       # Wiki topic CRUD (markdown files on disk)
    ├── codaScopeAgentService.ts      # Cursor SDK wrapper for agent runs
    └── codaScopeBuildStateService.ts # Build state tracking (in-memory + disk)
```

---

## Level 2 — Core Architecture

### State Management

- **Zustand store** (`useCodaScopeStore.ts`) — holds projects, wiki topics, skills, agent status, and configuration state
- **URL-driven navigation** — view routing is handled by `useAppSubRoute("codascope")`, not internal state
- **Build state** — dual-layer: in-memory `Map` for live builds + JSON log files on disk for persistence across restarts

### View Routing

`CodaScopeContent.tsx` reads `segments` from `useAppSubRoute` and renders the appropriate view:

```
/codascope/projects              → ProjectList
/codascope/project/:id/dashboard → ProjectDashboard
/codascope/project/:id/wiki      → WikiBrowser
/codascope/project/:id/chat      → ChatView
/codascope/project/:id/quality   → QualityDashboard
/codascope/project/:id/rules     → GoldenRules
/codascope/project/:id/concepts  → ConceptExplorer
/codascope/project/:id/skills    → SkillsManager
/codascope/project/:id/settings  → Settings
```

### Agent Pipeline

Analysis runs through a multi-step pipeline orchestrated by the `analyze` endpoint:

1. **Code Map** — scans repository structure → `code_map.md`
2. **Wiki Generation** — builds topic pages from code map → `wiki/*.md`
3. **Quality Scan** — evaluates code against golden rules → `quality/*.json`

Each step emits SSE events that the frontend renders as a live pipeline progress visualization.

---

## Level 3 — Design Directives

### Icons

> **MANDATORY**: Use conceptual inline SVG icons, NOT skeuomorphic emoji. All icons are exported from [`components/CodaScopeIcons.tsx`](components/CodaScopeIcons.tsx).

Icon rules:
- `viewBox="0 0 16 16"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth="1.5"`
- `strokeLinecap="round"`, `strokeLinejoin="round"`
- Geometric, minimal, conceptual forms — never photorealistic depictions
- When adding new icons, add them to the centralized module and import from there
- For `<option>` elements (which only support text), use label text without icons

### CSS

- All styles namespaced with `codascope-` prefix
- Single CSS file: `codascope.css`
- Uses shell design tokens (`--color-*`, `--space-*`, `--text-*`, etc.)
- Dark theme assumed (inherits from shell `:root` tokens)

### Component Patterns

- Views are functional components importing from the Zustand store
- SSE streaming uses `fetch` + `ReadableStream` for live output
- Empty states always include an icon (from `CodaScopeIcons`), a title, and descriptive text
- Model selection is handled by `<ModelPicker>` which fetches available models from the Cursor SDK

---

## Level 4 — Backend Services

### Build State Persistence

`CodaScopeBuildStateService` uses a two-layer approach:

1. **In-memory `Map<projectId, BuildState>`** — fast access for live builds
2. **On-disk JSON logs** — `<projectDir>/build-logs/<timestamp>-<hash>.json` + `.log` files

On server restart, `getBuildState()` lazily hydrates from disk. Builds that were "building" when the server crashed are automatically marked as `error: "interrupted by server restart"`.

The service uses `registerProjectDir(id, path)` to map project IDs to their actual filesystem directories, since directory names don't necessarily match project IDs.

### SSE Streaming

Agent runs use Server-Sent Events:
- **Live stream**: `POST /api/codascope/projects/:id/runs` → SSE response with events: `run-started`, `data`, `wiki-refresh`, `done`, `error`
- **Reconnectable replay**: `GET /api/codascope/projects/:id/build-log/:runId/stream` → replays the `.log` file, then tails live if still running

### Project Storage

Projects are stored as directories under the configured root:
```
<projectsRoot>/
├── <projectDirName>/
│   ├── project.json          # Project metadata (id, name, repos)
│   ├── wiki/                 # Generated wiki pages (markdown)
│   ├── quality/              # Quality scan results (JSON)
│   ├── build-logs/           # Build history (JSON + log pairs)
│   └── skills/               # Project-specific skill prompts
```

---

## Level 5 — Command Framework

Commands are markdown prompt templates in `commands/`. They use `{{VARIABLE}}` placeholders that are resolved at runtime from project context:

| Variable | Source |
|----------|--------|
| `{{PROJECT_NAME}}` | `project.name` |
| `{{PROJECT_DIR}}` | Filesystem path |
| `{{REPO_PATHS}}` | Formatted repository list |
| `{{TOPIC_NAME}}` | Per-run parameter |
| `{{TOPIC_SLUG}}` | Derived from topic name |

Commands are loaded by `loadCommandOrSkill()` in the routes, which checks both framework commands and project-specific skills directories.
