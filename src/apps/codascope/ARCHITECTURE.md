# CodaScope — Application Architecture

> **Progressive Disclosure Document** — Start reading from the top. Stop when you have enough context for your task.

---

## Level 0 — What Is This?

CodaScope is an **AI-powered codebase exploration, documentation, and analysis** application within AIShell. It uses AI agents (via the Cursor SDK) to automatically generate wiki documentation, quality scans, and concept maps from source code repositories. Users can chat with their codebase, manage analysis pipelines, and maintain coding standards through "Golden Rules."

**Key capabilities**: Code mapping, wiki generation, quality scanning, concept extraction, persistent codebase chat with agent intelligence, skills/command framework, wiki depth tracking & delta detection

---

## Level 0.5 — Design Philosophy

These principles govern all CodaScope development. Violating them creates architectural debt.

1. **Chat is a contextual sidekick, not a command center.** The user's primary workflow is browsing wiki, dashboards, and quality reports. The chat assistant *enhances* that workflow — it is always available in the right panel alongside whatever view the user has open, not a separate destination.

2. **The agent proposes, the user confirms.** The agent suggests actions via interactive cards in chat. The user clicks to dispatch. No autonomous execution — the agent is advisory, not autonomous.

3. **Context is automatic, not user-managed.** The system captures what the user is viewing (view, topic, recent navigation) and injects it into the agent prompt. No manual "add file to context" flows. The user simply asks questions and the agent knows where they are.

4. **Manifest + tools, not content dumping.** The agent receives a lightweight project manifest (~500 tokens) describing what exists and how fresh it is. When it needs full content, it uses tools to retrieve it on demand. This avoids wasting tokens on irrelevant context and lets the agent manage its own context budget.

5. **Intelligence before infrastructure.** Making the agent smarter with context and tools matters more than action dispatch mechanics. Read-only tool access lets the agent discover and cross-reference wiki, quality, concepts, and code before answering.

## Level 1 — File Map

```
src/apps/codascope/
├── ARCHITECTURE.md             # ← You are here
├── manifest.tsx                # AppManifest — wires CodaScope into the shell
├── codascope.css               # All CodaScope-specific styles
├── useCodaScopeStore.ts        # Zustand store — projects, topics, agent state
├── contextAssembler.ts         # Builds lightweight context for the assistant
├── CodaScopeContent.tsx        # Root content router (view switching)
├── CodaScopeNav.tsx            # Left nav — project picker + view navigation
├── CodaScopeAssistant.tsx      # Right panel — persistent AI chat assistant
├── CodaScopeAssistant.css      # Styles for the assistant panel
├── codaScopeSseClient.ts       # Shared SSE streaming utilities
├── components/
│   ├── ActionCard.tsx          # Interactive action cards from agent suggestions
│   ├── CodaScopeIcons.tsx      # Centralized SVG icon components
│   ├── ConversationHeader.tsx  # Chat header with history popover & search
│   ├── ModelPicker.tsx         # AI model selection dropdown
│   └── SetupBanners.tsx        # Inline banners for missing config
├── views/
│   ├── ProjectList.tsx         # Project cards + first-launch setup wizard
│   ├── ProjectDashboard.tsx    # Project overview, analyze pipeline, build state
│   ├── WikiBrowser.tsx         # Wiki topic tree + markdown editor
│   ├── QualityDashboard.tsx    # Quality scores, category drill-down, issue list
│   ├── GoldenRules.tsx         # CRUD for coding/architectural standards
│   ├── ConceptExplorer.tsx     # Filterable domain concepts extracted from code
│   ├── SkillsManager.tsx       # Framework + project skills display and runner
│   └── Settings.tsx            # API key, repositories, project configuration
└── commands/                   # Agent prompt templates (markdown files)
    ├── do_build_code_map.md    # Generates repository structure map
    ├── do_build_full_wiki.md   # Builds complete wiki from code map
    ├── do_build_wiki_page.md   # Builds/rebuilds a single wiki page
    ├── do_build_wiki_delta.md  # Incremental wiki update from git changes
    ├── do_explore.md           # Lightweight codebase exploration
    ├── do_quality_scan.md      # Runs quality analysis against golden rules
    └── do_chat.md              # Codebase Q&A system prompt
```

**Backend services** (under `server/`):
```
server/
├── routes/codaScopeRoutes.ts               # Express routes for all CodaScope APIs
└── services/
    ├── codaScopeProjectService.ts          # Project CRUD, repository management
    ├── codaScopeWikiService.ts             # Wiki topic CRUD (markdown files on disk)
    ├── codaScopeAgentService.ts            # Cursor SDK wrapper for agent runs
    ├── codaScopeBuildStateService.ts        # Build state tracking (in-memory + disk)
    ├── codaScopeChatService.ts             # Conversation CRUD, auto-title, streaming detection
    ├── codaScopeChatPromptHelpers.ts        # System prompt assembly & context formatting
    ├── codaScopeActionParser.ts            # Extracts <codascope_action> tags from agent output
    ├── codaScopeCodeMapService.ts          # Progressive code map builder & staleness detection
    ├── codaScopeWikiStateService.ts         # Wiki depth tracking, delta detection, study schema
    ├── codaScopeCommandLoader.ts           # Template loader with {{VAR}} substitution
    ├── codaScopeConceptService.ts          # Domain concept extraction & storage
    ├── codaScopeGoldenRuleService.ts       # Golden rule CRUD for coding standards
    ├── codaScopeQualityService.ts          # Quality scan result storage & scoring
    └── codaScopeSkillService.ts            # Framework + project skills management
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
/codascope/project/:id/quality   → QualityDashboard
/codascope/project/:id/rules     → GoldenRules
/codascope/project/:id/concepts  → ConceptExplorer
/codascope/project/:id/skills    → SkillsManager
/codascope/project/:id/settings  → Settings
```

Chat is **not** a routed view — it lives in `CodaScopeAssistant.tsx` as a persistent right panel visible across all project views.

### Agent Pipeline

Analysis runs through a multi-step pipeline orchestrated by the `analyze` endpoint:

1. **Code Map** — scans repository structure → `code_map_<repo-slug>.md`
2. **Wiki Generation** — builds topic pages from code map → `wiki/*.md`
3. **Quality Scan** — evaluates code against golden rules → `quality/*.json`

Each step emits SSE events that the frontend renders as a live pipeline progress visualization.

---

## Level 3 — Design Directives

### Icons

> **MANDATORY**: Use conceptual inline SVG icons, NOT skeuomorphic emoji. All icons are exported from [`CodaScopeIcons.tsx`](components/CodaScopeIcons.tsx).

Icon rules:
- `viewBox="0 0 16 16"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth="1.5"`
- `strokeLinecap="round"`, `strokeLinejoin="round"`
- Geometric, minimal, conceptual forms — never photorealistic depictions
- When adding new icons, add them to the centralized module and import from there
- For `<option>` elements (which only support text), use label text without icons

### CSS

- All styles namespaced with `codascope-` prefix
- Single CSS file: `codascope.css` (+ `CodaScopeAssistant.css` for the assistant panel)
- Uses shell design tokens (`--color-*`, `--space-*`, `--text-*`, etc.)
- Dark theme assumed (inherits from shell `:root` tokens)
- Never use hard-coded colors — always reference design tokens

### Component Patterns

- Views are functional components importing from the Zustand store
- SSE streaming uses `fetch` + `ReadableStream` for live output
- Empty states always include an icon (from `CodaScopeIcons`), a title, and descriptive text
- Model selection is handled by `<ModelPicker>` which fetches available models from the Cursor SDK
- Wikilinks use Obsidian-style `[[topic-id]]` syntax, converted to internal routes client-side

### Error Handling

- All API calls use try/catch with user-facing error messages
- Agent runs can be cancelled via `POST /api/codascope/projects/:id/build/cancel` (build pipeline) or `POST /api/codascope/projects/:id/assistant/cancel` (chat)
- Stale streaming detection: conversations stuck in "streaming" for >10 minutes are auto-recovered

---

## Level 4 — Persistent Conversations

### Architecture

Chat is **not** a standalone view — it is the right-panel `CodaScopeAssistant` component, always available alongside whatever view the user has open.

**Server**: `codaScopeChatService.ts` provides full conversation CRUD with:
- Atomic writes (temp → rename) for crash-safety
- Per-project mutation queue to serialize concurrent writes
- Auto-titling from first user message (truncated to 72 chars)
- Auto-summary after AI responses (240 chars max)
- Stale streaming detection (marks stuck conversations as complete after 10 minutes)

**Storage layout**:
```
<projectDir>/conversations/
├── conversations.json                    # Index (up to 100 conversations)
└── 2026_06_30_conv_<uuid>.json           # Individual conversation files
```

**Client**: `CodaScopeAssistant.tsx` manages:
- `ConversationHeader` — title bar with dropdown history popover, search, and new-conversation button
- `ActionCardList` — renders interactive action cards parsed from agent responses
- Streaming via SSE with cancel support
- Wikilink conversion (`[[topic-id]]` → internal routes)
- Action tag stripping from display text (tags are rendered as cards instead)

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/codascope/projects/:id/conversations` | List conversations |
| `POST` | `/api/codascope/projects/:id/conversations` | Create new conversation |
| `GET` | `/api/codascope/projects/:id/conversations/:convId` | Get full conversation |
| `POST` | `/api/codascope/projects/:id/conversations/:convId/messages` | Append message |
| `PATCH` | `/api/codascope/projects/:id/conversations/:convId` | Update title/metadata |
| `DELETE` | `/api/codascope/projects/:id/conversations/:convId` | Delete conversation |

---

## Level 5 — Agent Intelligence

### Context Strategy: Manifest + Tool Use

The agent does **not** receive full wiki/quality/code content upfront. Instead:

1. **Lightweight manifest** (~500 tokens) is always injected — project name, repo list, wiki topic titles, golden rule names, concept names, quality score, build status, freshness timestamps
2. **Read-only tools** let the agent fetch full content on demand — wiki pages, quality reports, code maps, concepts, golden rules, build status
3. **The agent decides** what to read based on the user's question and the manifest overview

This hybrid approach avoids token waste (no guessing at relevance) and gives the agent agency over its own context.

### Tool Set

Tools are purpose-filtered:
- **Assistant/chat** → read-only tools only (cannot modify files, run builds, or create content)
- **Wiki-build** → read-only + write tools

| Tool | Returns |
|------|---------|
| `list_wiki_topics` | Topic IDs and titles |
| `read_wiki_topic(topicId)` | Full markdown content |
| `search_wiki(query)` | Full-text search results |
| `read_code_map(repoName)` | Repository architecture map |
| `list_repositories` | Repo names and filesystem paths |
| `read_quality_report` | Quality scores, top issues, violations |
| `list_golden_rules` | Active coding standards |
| `list_concepts` | Extracted domain concepts |
| `read_build_status` | Current and historical build state |
| `list_project_skills` | Available framework commands |

### Action Tags

The agent can propose structured actions via XML tags embedded in responses:

```xml
<codascope_action type="build_wiki_page" topic="auth-flow">
  Build a wiki page for the authentication flow module
</codascope_action>
```

**Server-side** (`codaScopeActionParser.ts`):
- Extracts all `<codascope_action>` tags from agent text
- Validates against `VALID_ACTION_TYPES`: `build_wiki_page`, `build_full_wiki`, `run_quality_scan`, `navigate`, `create_golden_rule`, `explore_codebase`
- Parsed actions are stored in `message.metadata.actions`

**Client-side** (`ActionCard.tsx`):
- Renders each action as an interactive card with icon, description, and confirm button
- Actions dispatch through existing CodaScope APIs when clicked (e.g., triggering a wiki build)
- Cards track status: `idle` → `running` → `success` | `error`
- Action tags are stripped from the display text and shown as cards instead

### Prompt Construction

`codaScopeChatPromptHelpers.ts` assembles agent system prompts at request time:

- `buildProjectManifest()` — lightweight project overview (~500 tokens): name, repos, wiki topics, golden rules, concepts, quality score, build status, freshness timestamps
- `formatHistoryMessage()` — role-prefixed, truncated for assistant messages (~300 chars)
- `formatViewContext()` — human-readable description of user's current view

The system prompt template (`do_chat.md`) uses `{{VARIABLE}}` placeholders: `{{PROJECT_MANIFEST}}`, `{{CONVERSATION_HISTORY}}`, `{{VIEW_CONTEXT}}`, `{{USER_MESSAGE}}`.

### Stale Data Awareness

The manifest includes timestamps for all data sources. The agent is instructed to:
- Flag data older than a few days as potentially stale
- Suggest running a fresh scan/build when data is outdated
- Acknowledge gaps (no wiki page, no code map) and suggest what to do

### Context Snapshots

Each user message stores a lightweight context snapshot:
```json
{ "view": "quality", "topicId": null, "projectName": "...", "recentViews": [...] }
```
This enables the agent to reference prior context ("Earlier when you were looking at the quality report...") and allows debugging agent behavior.

---

## Level 6 — Code Map Service

`codaScopeCodeMapService.ts` provides **progressive discovery** of repository structure:

### Features

- **Deterministic file inventory** (no AI): file tree, language detection, sizes, directory counts
- **Git HEAD detection** for staleness checking — compares stored commit hash to current HEAD
- **Existing docs discovery** — finds README.md, ARCHITECTURE.md, etc. in the repo
- **Multi-repo support** — per-repo code maps stored as `code_map_<repo-slug>.md`
- **Concatenated context** — provides all code maps as a single text block for agent injection

### Staleness Model

```
CodeMapStatus {
  exists, generatedAt, isStale, staleReason,
  currentGitHead, mapGitHead, commitsBehind
}
```

A code map is stale when `commitsBehind > 0` (new commits since last generation).

---

## Level 7 — Wiki State & Delta Detection

`codaScopeWikiStateService.ts` tracks wiki quality and enables incremental updates.

### Per-Topic Depth Tracking

Each wiki topic is evaluated against a rubric producing `TopicDepthMetrics`:

| Metric | What it measures |
|--------|-----------------|
| `wordCount` | Raw word count |
| `codeExampleCount` | Number of code blocks |
| `fileRefCount` | File path references |
| `fileRefsWithLineNumbers` | Precise line-number references |
| `diagramCount` | Mermaid/diagram blocks |
| `crossRefCount` | Links to other wiki topics |
| `hasEdgeCases` | Discusses edge cases |
| `hasPerformanceNotes` | Performance considerations |
| `hasTestingStrategy` | Testing approach documented |
| `hasHistoricalContext` | Historical/evolution context |

Topics are classified as: **outline** → **developed** → **deep**

### File Dependency Tracking

Wiki pages reference source files. The service extracts these dependencies so that when files change, affected topics can be identified for re-generation.

### Delta Detection

Maps git-changed files to affected wiki topics:
1. Get changed files since last wiki build (via `git diff`)
2. Match against stored file dependencies
3. Return list of topics that need updating

### Study Schema (Forward-Compatible)

```typescript
StudyEntry { id, title, goal, status, relevantTopics[], ... }
```

Prepared for Phase 2 guided-learning features.

---

## Level 8 — Command Framework

### Template System

Commands are markdown prompt templates in `commands/`. They use `{{VARIABLE}}` placeholders resolved at runtime:

| Variable | Source |
|----------|--------|
| `{{PROJECT_NAME}}` | `project.name` |
| `{{PROJECT_DIR}}` | Filesystem path |
| `{{REPO_PATHS}}` | Formatted repository list |
| `{{TOPIC_NAME}}` | Per-run parameter |
| `{{TOPIC_SLUG}}` | Derived from topic name |

### Command Loader

`codaScopeCommandLoader.ts` supports two tiers:
1. **Framework commands** — shipped in app source at `commands/`
2. **Project skills** — stored per-project at `skills/<id>/prompt.md`

The loader also injects context from:
- **Code Map Service** — repository structure and file inventory
- **Golden Rule Service** — active coding standards for quality-aware prompts

Unresolved variables are left as-is (the agent can still see them as placeholders).

---

## Level 9 — Supporting Services

| Service | Responsibility |
|---------|---------------|
| `codaScopeConceptService.ts` | Domain concept extraction and storage from codebase analysis |
| `codaScopeGoldenRuleService.ts` | CRUD for coding/architectural standards used in quality scans |
| `codaScopeQualityService.ts` | Quality scan result persistence, scoring, and category breakdown |
| `codaScopeSkillService.ts` | Framework + project skills management and listing |

---

## Level 10 — Backend Infrastructure

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
│   ├── project.json                        # Project metadata (id, name, repos)
│   ├── wiki/                               # Generated wiki pages (markdown)
│   ├── wiki-state.json                     # Depth tracking + file deps + study entries
│   ├── quality/                            # Quality scan results (JSON)
│   ├── build-logs/                         # Build history (JSON + log pairs)
│   ├── conversations/                      # Persistent chat conversations
│   │   ├── conversations.json              # Conversation index
│   │   └── 2026_06_30_conv_*.json          # Individual conversation files
│   └── skills/                             # Project-specific skill prompts
```
