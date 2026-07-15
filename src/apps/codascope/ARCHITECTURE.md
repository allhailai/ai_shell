# CodaScope — Application Architecture

> **Progressive Disclosure Document** — Start reading from the top. Stop when you have enough context for your task.

---

## Level 0 — What Is This?

CodaScope is an **AI-powered codebase exploration, documentation, and analysis** application within AIShell. It uses AI agents (via the Cursor SDK) to automatically generate wiki documentation from source code repositories. Users can chat with their codebase, manage analysis pipelines, plan epics, and create design documents.

**Key capabilities**: Code mapping, wiki generation, persistent codebase chat with agent intelligence, skills/command framework, wiki depth tracking & delta detection, epic design system, visual artifacts

---

## Level 0.5 — Design Philosophy

These principles govern all CodaScope development. Violating them creates architectural debt.

1. **Chat is a contextual sidekick, not a command center.** The user's primary workflow is browsing wiki, dashboards, and epics. The chat assistant *enhances* that workflow — it is always available in the right panel alongside whatever view the user has open, not a separate destination.

2. **The agent acts when the user's directive is clear.** The agent uses its scoped write tools for explicit requests. It asks a concise clarifying question only when intent or an essential input is genuinely ambiguous. Each successful mutation emits a completed-operation card sourced from the tool result, so the UI records what actually happened.

3. **Context is automatic, not user-managed.** The system captures what the user is viewing (view, topic, recent navigation) and injects it into the agent prompt. No manual "add file to context" flows. The user simply asks questions and the agent knows where they are.

4. **Manifest + tools, not content dumping.** The agent receives a lightweight project manifest (~500 tokens) describing what exists and how fresh it is. When it needs full content, it uses tools to retrieve it on demand. This avoids wasting tokens on irrelevant context and lets the agent manage its own context budget.

5. **Intelligence before infrastructure.** Making the agent smarter with context and tools matters more than action dispatch mechanics. Read-only tool access lets the agent discover and cross-reference wiki, epics, and code before answering.

## Level 1 — File Map

```
src/apps/codascope/
├── ARCHITECTURE.md             # ← You are here
├── manifest.tsx                # AppManifest — wires CodaScope into the shell (67 lines)
├── codascope.css               # All CodaScope-specific styles (8032 lines)
├── codascope-notes.css          # Notes feature styles (1112 lines)
├── CodaScopeAssistant.css      # Styles for the assistant panel (2289 lines)
├── codaScopeTypes.ts           # Shared API type definitions (frontend ↔ backend) (659 lines)
├── useCodaScopeStore.ts        # Zustand store — projects, topics, agent state (95 lines)
├── contextAssembler.ts         # Builds lightweight context for the assistant (124 lines)
├── codaScopeSseClient.ts       # Shared SSE streaming utilities (173 lines)
├── commandRegistry.ts          # Slash command palette registry (413 lines)
├── CodaScopeContent.tsx        # Root content router (view switching) (208 lines)
├── CodaScopeNav.tsx            # Left nav — project picker + view navigation (185 lines)
├── CodaScopeHeaderItems.tsx    # Header bar items for shell manifest (28 lines)
├── CodaScopeAssistant.tsx      # Right panel — persistent AI chat assistant (1111 lines)
├── components/
│   ├── ActionCard.tsx          # Pending-action and completed-operation cards (552 lines)
│   ├── AnnotationThread.tsx    # Threaded annotation comments on design docs (212 lines)
│   ├── AtMentionPicker.tsx     # @-mention autocomplete for chat input (393 lines)
│   ├── BlockedDownloadItem.tsx # Blocked download resolution UI (199 lines)
│   ├── CodaScopeGuideModal.tsx # Tabbed help/guide modal (624 lines)
│   ├── CodaScopeRepoRemapModal.tsx # Repository path remapping modal (210 lines)
│   ├── CodaScopeIcons.tsx      # Centralized SVG icon components (648 lines)
│   ├── ConversationHeader.tsx  # Chat header with history popover & search (148 lines)
│   ├── CurateButton.tsx        # Curation trigger button with status (52 lines)
│   ├── CurationProgressBanner.tsx # Live curation pipeline progress (245 lines)
│   ├── CurationReasonsModal.tsx # Modal showing curation trigger reasons (150 lines)
│   ├── DiffViewer.tsx          # Side-by-side version diff viewer (122 lines)
│   ├── DocumentBlockRenderer.tsx # Block-level document renderer (375 lines)
│   ├── DocumentEditor.tsx      # Rich markdown editor for design docs (815 lines)
│   ├── EditorSelectionToolbar.tsx # Floating toolbar on text selection (114 lines)
│   ├── EpicBriefExport.tsx     # Epic brief export modal + clipboard (130 lines)
│   ├── EpicSidebar.tsx         # Collapsible left panel for epic detail (761 lines)
│   ├── ErrorSourceItem.tsx     # Failed knowledge source resolution UI (326 lines)
│   ├── InsertionPrompt.tsx     # Inline directive prompt UI (374 lines)
│   ├── ModelPicker.tsx         # AI model selection dropdown (235 lines)
│   ├── PromptChips.tsx         # Quick-action prompt chip suggestions (226 lines)
│   ├── ScopeBadges.tsx         # Scope status badge components (56 lines)
│   ├── ScopeDiffModal.tsx      # Scope diff visualization modal (160 lines)
│   ├── SetupBanners.tsx        # Inline banners for missing config (130 lines)
│   ├── SlashCommandPalette.tsx # Slash command autocomplete palette (213 lines)
│   ├── SourceUpload.tsx        # File upload for knowledge sources (138 lines)
│   ├── SourceViewer.tsx        # Research source content viewer (188 lines)
│   ├── NoteAnnotationPanel.tsx # Annotation threads for notes (483 lines)
│   ├── NoteInsertionPrompt.tsx # AI-powered insertion prompt for notes (260 lines)
│   ├── NoteMoveDialog.tsx      # Move note across levels/folders dialog (318 lines)
│   ├── NoteSelectionToolbar.tsx # Floating toolbar on text selection in notes (120 lines)
│   └── artifact-viewer/        # Visual HTML artifact subsystem
│       ├── ArtifactViewer.tsx   # Main orchestrator (spec/preview tabs) (502 lines)
│       ├── ArtifactSpecEditor.tsx # Spec editing with model picker (195 lines)
│       ├── ArtifactPreview.tsx  # Sandboxed iframe preview (109 lines)
│       ├── ArtifactSectionPanel.tsx # Section/annotation/version panel (667 lines)
│       ├── ArtifactAnnotationCard.tsx # Individual annotation card (186 lines)
│       ├── artifactApi.ts      # Typed API wrappers (365 lines)
│       ├── useArtifactAnnotations.ts # Artifact annotation state hook (205 lines)
│       ├── useArtifactBuild.ts # Artifact build state hook (179 lines)
│       └── hooks/              # Dedicated artifact hooks
│           ├── useArtifactAnnotations.ts # Annotation lifecycle hook (261 lines)
│           └── useArtifactBuild.ts # Build lifecycle hook (159 lines)
├── hooks/
│   ├── useAssistantStream.ts   # Chat SSE streaming, action parsing, auto-title (207 lines)
│   ├── useBuildState.ts        # Build lifecycle SSE hook (147 lines)
│   ├── useConversationManager.ts # Conversation lifecycle management (208 lines)
│   ├── useDashboardBuildState.ts # Dashboard-specific build state (356 lines)
│   ├── useEditorDiff.ts        # Diff highlighting with fade-out timer (77 lines)
│   ├── useEditorResize.ts      # Mermaid/image resize handlers + API persistence (129 lines)
│   └── useEpicContext.ts       # Epic context for tabs/sidebar (204 lines)
├── views/
│   ├── ProjectList.tsx         # Project cards + first-launch setup wizard (686 lines)
│   ├── ProjectDashboard.tsx    # Project overview, analyze pipeline, build state (861 lines)
│   ├── WikiBrowser.tsx         # Wiki topic tree + markdown editor (444 lines)
│   ├── SkillsManager.tsx       # Framework + project skills display and runner (345 lines)
│   ├── Settings.tsx            # API key, repositories, project configuration (650 lines)
│   ├── EpicList.tsx            # Epic cards list with status/health badges (373 lines)
│   ├── EpicDetail.tsx          # Epic detail shell with tab routing (647 lines)
│   ├── EpicDefine.tsx          # Epic definition editor tab (388 lines)
│   ├── EpicScope.tsx           # Epic scope management tab (589 lines)
│   ├── EpicKnowledge.tsx       # Epic knowledge directory + research tab (714 lines)
│   ├── EpicDesignDocs.tsx      # Design document list + editor tab (318 lines)
│   ├── EpicHistory.tsx         # Version history + diff viewer tab (501 lines)
│   ├── NotesBrowser.tsx        # Note listing, search, templates, breadcrumbs (579 lines)
│   ├── NoteEditor.tsx          # Rich markdown note editor with auto-save (736 lines)
│   └── NotesRouter.tsx         # Notes view coordinator (browser vs editor) (168 lines)
└── commands/                   # Agent prompt templates (markdown files)
    ├── do_build_code_map.md    # Generates repository structure map (84 lines)
    ├── do_build_full_wiki.md   # Builds complete wiki from code map (84 lines)
    ├── do_build_wiki_page.md   # Builds/rebuilds a single wiki page (44 lines)
    ├── do_build_wiki_delta.md  # Incremental wiki update from git changes (58 lines)
    ├── do_explore.md           # Lightweight codebase exploration (34 lines)
    ├── do_chat.md              # Codebase Q&A system prompt (213 lines)
    ├── do_curate_epic.md       # Curation pipeline prompt (105 lines)
    ├── do_process_source.md    # Research source processing prompt (64 lines)
    ├── do_research_epic.md     # Web research pipeline prompt (85 lines)
    ├── do_build_artifact.md    # Artifact HTML generation prompt (96 lines)
    ├── do_regen_sections.md    # Section regeneration prompt (64 lines)
    ├── do_deep_wiki_page.md    # Deep wiki page generation (163 lines)
    └── do_wiki_cross_reference.md # Wiki cross-reference pass (101 lines)
```

**Backend** (under `server/`):
```
server/
├── routes/
│   ├── codaScopeRoutes.ts              # Thin hub — assembles all sub-route modules (35 lines)
│   ├── codaScopeServiceContext.ts      # Shared service context, ensureServices(), helpers (271 lines)
│   ├── codaScopeCoreRoutes.ts          # Config, projects, repositories, models, API key (158 lines)
│   ├── codaScopeWikiRoutes.ts          # Wiki CRUD, state, pending deletions, code map (136 lines)
│   ├── codaScopeBuildRoutes.ts         # Skills, runs, build status, log streaming, analyze (480 lines)
│   ├── codaScopeChatRoutes.ts          # Conversations, messages, assistant, images (490 lines)
│   ├── codaScopeEpicRoutes.ts          # Epic CRUD, scope, designs, versions, rendering, brief (779 lines)
│   ├── codaScopeAnnotationRoutes.ts    # Annotations, directives, blocks, batch execution (284 lines)
│   ├── codaScopeKnowledgeRoutes.ts     # Knowledge sources, blocked sources, research, curation (519 lines)
│   ├── codaScopeArtifactRoutes.ts      # Artifact CRUD, build, preview, sections, annotations, versions (562 lines)
│   └── codaScopeNoteRoutes.ts          # Note CRUD, images, annotations, versions, templates, search, move (459 lines)
└── services/
    ├── codaScopeProjectService.ts      # Project CRUD, repository management (394 lines)
    ├── codaScopeProjectDirResolver.ts  # Project directory resolution cache (134 lines)
    ├── codaScopeWikiService.ts         # Wiki topic CRUD (markdown files on disk) (211 lines)
    ├── codaScopeAgentService.ts        # Cursor SDK agent lifecycle (pool, cancel, send) (375 lines)
    ├── codaScopeToolDefinitions.ts     # Tool facade — purpose-based composition (90 lines)
    ├── codaScopeToolServiceFactory.ts  # Tool service instantiation factory (51 lines)
    ├── codaScopeBuildStateService.ts   # Build state tracking (in-memory + disk) (614 lines)
    ├── codaScopeBuildOrchestrator.ts   # Multi-step build pipeline orchestration (1021 lines)
    ├── codaScopeChatService.ts         # Conversation CRUD, auto-title, streaming detection (585 lines)
    ├── codaScopeChatOrchestrator.ts    # Chat prompt assembly + streaming dispatch (188 lines)
    ├── codaScopeChatPromptHelpers.ts   # System prompt assembly & context formatting (471 lines)
    ├── codaScopeActionParser.ts        # Extracts <codascope_action> tags from agent output (119 lines)
    ├── codaScopeCodeMapService.ts      # Progressive code map builder & staleness detection (606 lines)
    ├── codaScopeWikiStateService.ts    # Wiki depth tracking, delta detection, study schema (362 lines)
    ├── codaScopeCommandLoader.ts       # Template loader with {{VAR}} substitution (368 lines)
    ├── codaScopeSkillService.ts        # Framework + project skills management (158 lines)
    ├── codaScopeImageService.ts        # Image upload, storage, and serving (145 lines)
    ├── codaScopeEpicService.ts         # Epic CRUD, lifecycle, scope, health (683 lines)
    ├── codaScopeLockService.ts         # Edit lock management (acquire, heartbeat, release) (223 lines)
    ├── codaScopeDesignDocService.ts    # Design doc CRUD with per-doc versioning (733 lines)
    ├── codaScopeVersionService.ts      # Snapshot-based epic version history (354 lines)
    ├── codaScopeAnnotationService.ts   # Inline annotations and comment threads (462 lines)
    ├── codaScopeDirectiveService.ts    # Insertion directives and batch execution (412 lines)
    ├── codaScopeEpicRenderService.ts   # HTML rendering + storage (432 lines)
    ├── codaScopeEpicKnowledgeService.ts # Epic knowledge directory + source management (529 lines)
    ├── codaScopeContentService.ts      # Content extraction & processing (425 lines)
    ├── codaScopeCurationService.ts     # Curation trigger tracking & log persistence (312 lines)
    ├── codaScopeCurationOrchestrator.ts # Curation pipeline orchestration (371 lines)
    ├── codaScopeResearchOrchestrator.ts # Web research pipeline orchestration (681 lines)
    ├── codaScopeWebSearchService.ts    # Web search integration (68 lines)
    ├── codaScopeArtifactService.ts     # Artifact spec CRUD + build orchestration (818 lines)
    ├── codaScopeArtifactAnnotationService.ts # Artifact annotation lifecycle (320 lines)
    ├── codaScopeArtifactVersionService.ts   # Artifact build version snapshots (249 lines)
    ├── codaScopeArtifactAnnotationScript.ts # DOM inspection overlay script (228 lines)
    ├── codaScopeNoteService.ts         # Note CRUD, frontmatter, versioning, search, images (916 lines)
    ├── codaScopeNoteAnnotationService.ts # Block-level annotations for notes (409 lines)
    └── tools/                          # Agent tool implementations (split by domain)
        ├── codaScopeReadOnlyTools.ts   # 14 read-only discovery tools (545 lines)
        ├── codaScopeEpicTools.ts       # 21 epic read/write tools (702 lines)
        ├── codaScopeWriteTools.ts      # 1 code map write tool (65 lines)
        ├── codaScopeArtifactTools.ts   # 3 artifact tools (223 lines)
        └── codaScopeNoteTools.ts       # 6 note read/write tools (334 lines)
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
/codascope/project/:id/skills    → SkillsManager
/codascope/project/:id/settings  → Settings
/codascope/project/:id/epics     → EpicList
/codascope/project/:id/epic/:eid → EpicDetail (with tab sub-routing)
/codascope/notes/:visibility/<path> → NotesRouter (CodaScope shared or private notes)
/codascope/project/:id/notes/:visibility/<path> → NotesRouter (project shared or private notes)
/codascope/project/:id/epic/:eid/notes/shared/<path> → NotesRouter (epic shared notes)
```

Chat is **not** a routed view — it lives in `CodaScopeAssistant.tsx` as a persistent right panel visible across all project views.

### Route Architecture

Backend API routes are split into domain-specific sub-modules under `server/routes/`. The hub file `codaScopeRoutes.ts` (~34 lines) imports and calls registration functions from each sub-route module:

- `codaScopeServiceContext.ts` — shared service context, `ensureServices()`, helper utilities
- `codaScopeCoreRoutes.ts` — config, projects, repositories, models
- `codaScopeWikiRoutes.ts` — wiki CRUD, wiki state, pending deletions, code map
- `codaScopeBuildRoutes.ts` — skills, runs, build status, log streaming, analyze
- `codaScopeChatRoutes.ts` — conversations, messages, assistant, images
- `codaScopeEpicRoutes.ts` — epic CRUD, scope, designs, versions, rendering
- `codaScopeAnnotationRoutes.ts` — annotations, directives, blocks, batch
- `codaScopeKnowledgeRoutes.ts` — knowledge sources, research, curation
- `codaScopeArtifactRoutes.ts` — artifact CRUD, build, preview, sections, annotations, versions
- `codaScopeNoteRoutes.ts` — note CRUD, images, annotations, versions, templates, search, move

New endpoints should be added to the appropriate domain route file, not to the hub.

### Notes Storage and Lifecycle

Each note is a managed bundle: `<note>.md`, `<note>.assets/`, versions, and
annotation sidecars move, archive, restore, export, import, and delete as one
unit. Associated documents are opaque bytes inside
`<note>.assets/documents/`, with a versioned atomic `index.json` manifest and
an immutable `documents/<document-id>/blob` path. Documents have no preview,
extraction, execution, or search pipeline in v1.

Documents are capped at 100 MB each and 500 MB total per note, including
archived documents. Downloads require the authenticated actor to resolve the
parent note and are attachment-only with `X-Content-Type-Options: nosniff`.
`CodaScopeNoteTransferService` is the only note/folder move path; document
files and per-user document-star references follow through that pipeline with
the rest of the bundle.

Generated note exports are ephemeral and downloadable only by the authenticated
actor that created them. Note-audit queries are administrator-only and have a
server-enforced result limit; export IDs are not reusable download credentials.

Priority has two deliberately separate models: a star is a private per-user
shortcut in `_user-prefs`, while a pin is shared durable metadata (note
frontmatter or document manifest) with an audit event. Active lists sort
shared pins first, then the current user's stars, then their stable normal
order. Client note saves cannot author the server-owned pin fields.

### Current Content-Access Policy

Projects, epics, and notes with `shared` visibility are globally shared: every
authenticated CodaScope user may access them. CodaScope deliberately has no
per-project or per-epic membership/role ACL at present. This does not extend to
per-user data: private notes, user preferences, exports, and conversations
retain their respective actor-custody rules. A future shared-conversation or
role-based content feature must define its own authorization policy rather than
inferring one from the current global shared-content model.

### Agent Pipeline

Analysis runs through a multi-step pipeline orchestrated by the `analyze` endpoint:

1. **Code Map** — scans repository structure → `code_map_<repo-slug>.md`
2. **Wiki Generation** — builds topic pages from code map → `wiki/*.md`

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
- Scoped CSS files: `codascope.css` for the app, `CodaScopeAssistant.css` for the assistant panel, and `codascope-notes.css` for notes
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
- Actor-scoped custody: every new conversation persists the authenticated
  principal as `ownerId`; normal service methods require that actor and treat
  another user's or ownerless record as absent
- Auto-titling from first user message (truncated to 72 chars)
- Auto-summary after AI responses (240 chars max)
- Stale streaming detection (marks stuck conversations as complete after 10 minutes)

**Storage layout**:
```
<projectDir>/conversations/
├── conversations.json                    # Index (up to 100 conversations)
└── 2026_06_30_conv_<uuid>.json           # Individual files, each with ownerId
```

New conversation owners always come from `principal(req).username`; client
payloads never choose an owner. Images use the same service-level conversation
check before upload, read, or cleanup, so an agent run cannot load another
user's attachment or history. Existing ownerless records fail closed for normal
users. Administrators can use the migration endpoints below to list and assign
those records to an existing AIShell account; assignment is the only supported
legacy-ownership transition.

**Client**: `CodaScopeAssistant.tsx` manages:
- `ConversationHeader` — title bar with dropdown history popover, search, and new-conversation button
- `ActionCardList` — renders pending-action and tool-confirmed completion cards parsed from agent responses
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
| `GET` | `/api/codascope/projects/:id/conversations/legacy` | Admin-only list of ownerless legacy conversations |
| `PATCH` | `/api/codascope/projects/:id/conversations/:convId/owner` | Admin-only legacy assignment (`targetUsername`) |

---

## Level 5 — Agent Intelligence

### Context Strategy: Manifest + Tool Use

The agent does **not** receive full wiki/code content upfront. Instead:

1. **Lightweight manifest** (~500 tokens) is always injected — project name, repo list, wiki topic titles, build status, freshness timestamps
2. **Read-only tools** let the agent fetch full content on demand — wiki pages, code maps, build status, skills
3. **The agent decides** what to read based on the user's question and the manifest overview

This hybrid approach avoids token waste (no guessing at relevance) and gives the agent agency over its own context.

### Tool Set

Tools are purpose-filtered by `getToolsForPurpose()` in `codaScopeToolDefinitions.ts`. Tool implementations live in `tools/` subdirectory, organized into four builder functions:
- `buildReadOnlyTools()` — wiki, code map, build status, skills (14 tools in `tools/codaScopeReadOnlyTools.ts`)
- `buildEpicTools()` — epic CRUD, scope, design docs, research, wiki write (21 tools in `tools/codaScopeEpicTools.ts`)
- `buildWriteTools()` — code map write (1 tool in `tools/codaScopeWriteTools.ts`)
- `buildArtifactTools()` — artifact HTML read/write, epic context assembly (3 tools in `tools/codaScopeArtifactTools.ts`)
- `buildNoteReadTools()` — note listing, reading, searching, folder listing (4 tools in `tools/codaScopeNoteTools.ts`)
- `buildNoteWriteTools()` — note creation and editing (2 tools in `tools/codaScopeNoteTools.ts`)

Purpose-based filtering:
- **Assistant/chat** → ALL tools (read + write + epic + artifact + note read/write) — full agent autonomy
- **Wiki-build** → read-only + note read + write tools
- **Curation/research** → read-only + note read + epic tools
- **Artifact-build/regen** → read-only + note read + artifact tools

The purpose is an allowlist boundary: unknown values fail closed rather than
receiving the assistant's full tool set. User-facing agent pools and note-tool
closures are also actor-scoped so a private note or document path cannot cross
users through an agent reuse.

The table below is a representative subset of read-only tools:

| Tool | Returns |
|------|---------|
| `list_wiki_topics` | Topic IDs and titles |
| `read_wiki_topic(topicId)` | Full markdown content |
| `search_wiki(query)` | Full-text search results |
| `read_code_map(repoName)` | Repository architecture map |
| `list_repositories` | Repo names and filesystem paths |
| `read_build_status` | Current and historical build state |
| `list_project_skills` | Available framework commands |

Epic tools include `create_design_doc`, `edit_design_doc`, `edit_design_doc_section`, and epic scope/definition tools. See `codaScopeToolDefinitions.ts` for the full list.

### Action Tags

Action tags provide two distinct UI signals: pending UI-only actions and
tool-confirmed completed operations. A clear request to mutate data is handled
by a write tool; it is never deferred to a confirmation card.

```xml
<codascope_action type="build_wiki_page" topic="auth-flow">
  Build a wiki page for the authentication flow module
</codascope_action>
```

**Server-side** (`codaScopeActionParser.ts`):
- Extracts all `<codascope_action>` tags from agent text
- Validates against `VALID_ACTION_TYPES`: `build_wiki_page`, `build_full_wiki`, `navigate`, `explore_codebase`, `create_epic`, `update_epic_definition`, `scope_epic`, `deepen_wiki`, `create_design_doc`, `update_design_doc`, `create_version`, `insert_content`, `replace_content`, `expand_content`, `design_doc_created`, `design_doc_edited`, `trigger_research`, `artifact_built`, `operation_completed`
- **Completed-operation tags**: `operation_completed`, `design_doc_created`, `design_doc_edited`, and `artifact_built` are emitted automatically by successful tools. They render as success cards; navigation-capable cards include a View button and never re-run the mutation.
- Parsed actions are stored in `message.metadata.actions`

**Client-side** (`ActionCard.tsx`):
- Renders pending actions as interactive cards and successful tool results as durable completion cards
- Pending UI-only actions dispatch through existing CodaScope APIs when clicked (e.g., triggering a wiki build)
- Pending cards track status: `idle` → `running` → `success` | `error`; completed-operation cards begin in `success`
- Action tags are stripped from the display text and shown as cards instead

### Prompt Construction

`codaScopeChatPromptHelpers.ts` assembles agent system prompts at request time:

- `buildProjectManifest()` — lightweight project overview (~500 tokens): name, repos, wiki topics, build status, freshness timestamps
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
{ "view": "dashboard", "topicId": null, "projectName": "...", "recentViews": [...] }
```
This enables the agent to reference prior context ("Earlier when you were on the dashboard...") and allows debugging agent behavior.

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

| Variable | Source | Used By |
|----------|--------|--------|
| `{{PROJECT_NAME}}` | `project.name` | All commands |
| `{{PROJECT_DIR}}` | Filesystem path | All commands |
| `{{REPOSITORIES}}` | Formatted repository list | All commands |
| `{{TOPIC_NAME}}` | Per-run parameter | Wiki commands |
| `{{TOPIC_SLUG}}` | Derived from topic name | Wiki commands |
| `{{CODE_MAP}}` | Code map content | `buildBaseVars()` |

| `{{WIKI_INDEX}}` | Wiki topic listing | `buildBaseVars()` |
| `{{EPIC_TITLE}}`, `{{EPIC_DEFINITION}}`, `{{EPIC_SCOPE}}` | Epic context | Research/curation |
| `{{ARTIFACT_TITLE}}`, `{{ARTIFACT_SPEC_BODY}}`, `{{EPIC_CONTEXT}}` | Artifact context | Artifact build/regen |

There are 47 unique template variables across all commands. The table above is a representative subset; see `codaScopeCommandLoader.ts` and each orchestrator for the full variable set.

### Command Loader

`codaScopeCommandLoader.ts` supports two tiers:
1. **Framework commands** — shipped in app source at `commands/`
2. **Project skills** — stored per-project at `skills/<id>/prompt.md`

The loader also injects context from:
- **Code Map Service** — repository structure and file inventory

Unresolved variables are left as-is (the agent can still see them as placeholders).

---

## Level 9 — Supporting Services

| Service | Responsibility |
|---------|---------------|
| `codaScopeSkillService.ts` | Framework + project skills management and listing |
| `codaScopeImageService.ts` | Image upload, storage, and serving for design docs and chat |
| `codaScopeLockService.ts` | Edit lock acquire, heartbeat, release, and expiry cleanup |
| `codaScopeDirectiveService.ts` | Insertion directive CRUD and batch execution |
| `codaScopeProjectDirResolver.ts` | Cached project directory resolution for cross-service use |
| `codaScopeWebSearchService.ts` | Web search integration for research pipeline |

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

│   ├── build-logs/                         # Build history (JSON + log pairs)
│   ├── conversations/                      # Persistent chat conversations
│   │   ├── conversations.json              # Conversation index
│   │   └── 2026_06_30_conv_*.json          # Individual conversation files
│   └── skills/                             # Project-specific skill prompts
```

---

## Level 11 — Epic Design System

### Overview

The Epic Design subsystem provides collaborative document authoring for software design epics. Each epic is a self-contained unit with a lifecycle, design documents, annotations, directives, and version history.

### Service Architecture

| Service | Responsibility |
|---------|---------------|
| `codaScopeEpicService.ts` | Epic CRUD, lifecycle, scope management, edit locks, health computation |
| `codaScopeDesignDocService.ts` | Design document CRUD, per-doc version history, storage migration |
| `codaScopeVersionService.ts` | Snapshot-based version history for epics |
| `codaScopeAnnotationService.ts` | Inline annotations (comments), insertion directives, block tracking |
| `codaScopeEpicRenderService.ts` | HTML rendering of design documents (basic + agent-generated) |
| `codaScopeArtifactService.ts` | Visual artifact spec CRUD, build orchestration, section extraction |
| `codaScopeArtifactAnnotationService.ts` | Artifact annotation lifecycle (pending → applied/failed/inactive) |
| `codaScopeArtifactVersionService.ts` | Artifact build version snapshots and revert |

### Storage Layout

```
<projectDir>/epics/
├── epics.json                              # Epic index (id, title, status, health)
├── _archive/                               # Archived epics directory
└── <epicId>/
    ├── definition.md                       # Epic definition document
    ├── locks.json                          # Active edit locks
    ├── scope.json                          # Topic scope with enrichment data
    ├── designs/
    │   ├── designs.json                  # Design doc index
    │   └── <docId>/
    │       ├── content.md                # Current document content (markdown)
    │       ├── <docId>-rendered/index.html  # Rendered HTML output
    │       └── versions/
    │           ├── v001.md               # Version snapshot
    │           ├── v002.md
    │           └── versions.json         # Version metadata index
    ├── annotations/
    │   └── <docId>-annotations.json        # Inline annotations per document
    ├── directives/
    │   └── <docId>-directives.json         # Insertion directives per document
    ├── artifacts/
    │   └── <artifactId>/
    │       ├── spec.json                   # Artifact specification
    │       └── builds/
    │           └── <version>/
    │               └── index.html          # Built HTML output
    └── versions/
        └── <version>-<timestamp>.json      # Epic-level versioned snapshots
```

### Epic Lifecycle

```
defining → curating → designing → in-review → approved → archived
```

Health is computed at read-time (never stored): `active | hot | stale | blocked`.

### Edit Locks (P4 Hardened)

Locks prevent concurrent edits to the same document:
- **Acquire**: `POST /epics/:epicId/lock` → returns lock object with TTL
- **Heartbeat**: `PATCH /epics/:epicId/lock/heartbeat` → refreshes lock TTL (called every 60s)
- **Release**: `DELETE /epics/:epicId/lock` → explicit unlock
- **Expiry**: Server-side cleanup of locks older than 5 minutes
- **Startup cleanup**: `cleanupAllExpiredLocks()` runs on server start to clear stale locks from crashes
- **Agent safety**: `isDocumentLockedByHuman()` lets the agent check before writing (agent locks prefixed with `agent_` don't block)

### Chat-Driven Design Doc Creation

Design documents are created via the chat assistant, not templates. The flow:

1. User navigates to the Design tab or opens chat in an epic context
2. The chat assistant uses `create_design_doc` / `edit_design_doc` / `edit_design_doc_section` tools
3. SSE action tags (`design_doc_created`, `design_doc_edited`) trigger auto-navigation and diff highlighting
4. Every edit (agent or manual) creates a version snapshot before writing
5. Users can undo agent edits via the "Undo" button in the DocumentEditor toolbar

### Per-Document Version History

Each design doc maintains its own version history within `<docId>/versions/`:

- **Snapshots**: `v001.md`, `v002.md`, etc. — copies of `content.md` before each write
- **Metadata**: `versions.json` tracks author, timestamp, summary, and word count per version
- **Max versions**: 10 per document. Oldest are pruned automatically.
- **Revert**: copies target version content back to `content.md` and creates a NEW version documenting the revert (so reverts are undoable)
- **Storage migration**: legacy flat-file docs (`<docId>.md`) are migrated to `<docId>/content.md` on first access

#### Version API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/designs/:docId/versions` | List version history |
| `GET` | `/designs/:docId/versions/:num` | Get version content |
| `POST` | `/designs/:docId/revert/:num` | Revert to a version |

---

## Level 12 — HTML Rendering (Phase 3)

### Rendering Pipeline

Design documents can be rendered as static HTML for presentation/sharing:

1. **Programmatic rendering**: `CodaScopeEpicRenderService.generateBasicHtml()` converts markdown → HTML with dark-themed styling, section anchors, and responsive layout
2. **Storage**: Rendered HTML saved to `<epicDir>/designs/<docId>-rendered/index.html`

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/epics/:epicId/designs/:docId/render` | Generate/save rendered HTML |
| `GET` | `/epics/:epicId/designs/:docId/rendered` | Serve rendered HTML |

### Client Integration

- 🖨️ "Render" button on each design doc card in `EpicDesignDocs.tsx`
- Rendered HTML shown in sandboxed iframe with "Open in New Tab" option
- Inline preview replaces the design doc list view

---

## Level 13 — Per-Epic Conversations (Phase 3)

### Architecture

Each user gets a dedicated conversation per epic for design discussions. Epic
metadata does not authorize or select a project-shared conversation:

- **Server**: `CodaScopeChatService.getOrCreateEpicConversation()` scopes lookup and creation by `epicId` **and** authenticated owner
- **Indexing**: Conversations with `epicId` remain in the standard index with the same `ownerId` custody boundary as all chats
- **Client auto-switch**: `CodaScopeAssistant.tsx` detects epic navigation and auto-switches to the current user's epic conversation
- **Context banner**: A "Scoped to {Epic Title}" banner appears below the context badge

Historical `epic.conversationId` values are compatibility metadata only. They
neither authorize access nor select a conversation; epic lookup uses the
authenticated owner and `epicId` instead.

### API Endpoint

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/epics/:epicId/conversation` | Get or create epic-scoped conversation |

---

## Level 14 — Epic Brief Export (Phase 3)

### Overview

Quick-share epic status summaries as clipboard-friendly markdown.

- **Server**: `GET /epics/:epicId/brief` → assembles status, health, scope stats, open threads, collaborators
- **Client**: `EpicBriefExport.tsx` — "Export Brief" button in epic detail header opens a modal with:
  - Rendered markdown preview (via `MarkdownViewer`)
  - "Copy to Clipboard" button (with fallback for older browsers)
  - Hint: "Paste as markdown in Slack, email, or docs"

---

## Level 15 — Batch Directives (Phase 4)

### Architecture

Insertion directives can be executed in batch, applying all pending directives with generated content top-to-bottom:

- **Server**: `CodaScopeAnnotationService.executeBatchDirectives()` handles:
  - Sorting directives by line position (top-to-bottom)
  - Cumulative line offset tracking as each directive shifts the document
  - Atomic execution: all succeed or all roll back to original content
  - Support for `insert`, `replace`, and `expand` directive types
- **Client**: `DocumentEditor.tsx` shows a "Apply All" bar when directives are ready

### API Endpoint

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/epics/:epicId/docs/:docId/directives/batch` | Execute all ready directives atomically |

---

## Level 16 — Visual Artifacts

### Overview

Visual artifacts are agent-generated HTML dashboards and visualizations that present complex project data in a rich, interactive format. Unlike design documents (which are markdown), artifacts are full HTML documents with inline styles and scripts, rendered in sandboxed iframes.

### Service Architecture

| Service | Responsibility |
|---------|---------------|
| `codaScopeArtifactService.ts` | Artifact spec CRUD, build orchestration with agent callback, section extraction from built HTML, preview path resolution |
| `codaScopeArtifactAnnotationService.ts` | Annotation lifecycle management: create, toggle (pending → inactive), batch apply, soft cap enforcement (max 20 pending per artifact) |
| `codaScopeArtifactVersionService.ts` | Build version snapshots (auto-created before each rebuild), version listing, revert to previous build |

### Storage Layout

```
<epicDir>/artifacts/
├── artifacts.json                          # Artifact spec index (id, title, status, modelId)
└── <artifactId>/
    ├── spec.json                           # Full artifact specification
    ├── annotations.json                    # Annotations on the built HTML sections
    └── builds/
        ├── current/
        │   └── index.html                  # Latest built HTML
        └── v<N>/
            └── index.html                  # Version snapshot
```

### Build Pipeline

```
Artifact Spec → Agent (purpose: artifact-build) → write_artifact_html tool → index.html → section extraction
```

1. **Spec creation**: User defines an artifact spec (title, description, section outlines, model preference)
2. **Build trigger**: Frontend calls `POST /build` → route handler assembles epic context + prompt template (`do_build_artifact.md`)
3. **Agent generation**: Agent receives assembled prompt, uses `read_epic_context` for grounding, generates HTML, writes via `write_artifact_html`
4. **Section extraction**: After HTML is written, sections are extracted from `<section id="...">` elements for annotation targeting
5. **Preview**: Built HTML is served via sandboxed iframe in `ArtifactPreview.tsx`

### Annotation Lifecycle

```
pending → applied (agent regenerated the section)
        → failed (regeneration failed)
        → inactive (user toggled off)
```

- Annotations target specific `<section>` elements in the built HTML
- Batch apply groups annotations by section, then triggers section regeneration via `do_regen_sections.md`
- The agent uses `write_artifact_html(mode="section")` to replace individual section inner HTML
- Soft cap: max 20 pending annotations per artifact (configurable)

### Agent Tools

| Tool | Purpose |
|------|---------|
| `write_artifact_html` | Write complete HTML (`mode="full"`) or replace a single section (`mode="section"`) |
| `read_artifact_html` | Read current built HTML for structure understanding before section edits |
| `read_epic_context` | Assemble epic definition, scope, wiki summaries, design doc summaries for grounding |

These tools are available to:
- **artifact-build / artifact-section-regen** purposes (with read-only project tools)
- **assistant / chat** purpose (with all other tools)

### Frontend Architecture

The artifact viewer is a component tree rooted in `ArtifactViewer.tsx`:

| Component | Responsibility |
|-----------|---------------|
| `ArtifactViewer.tsx` | Orchestrator — tab switching (spec/preview), build trigger, state management |
| `ArtifactSpecEditor.tsx` | Spec editing form with model picker |
| `ArtifactPreview.tsx` | Sandboxed iframe preview of built HTML |
| `ArtifactSectionPanel.tsx` | Section list, annotation management, version history panel |
| `ArtifactAnnotationCard.tsx` | Individual annotation card with status badge and toggle |
| `artifactApi.ts` | Typed fetch wrappers for all artifact API endpoints |

### URL Scheme

```
/codascope/project/:projectId/epic/:epicId/design/artifact::artifactId
```

The `artifact:` prefix distinguishes artifact routes from design doc routes within the design tab.

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/epics/:epicId/artifacts` | List artifact specs |
| `POST` | `/epics/:epicId/artifacts` | Create new artifact spec |
| `GET` | `/epics/:epicId/artifacts/:artId` | Get artifact spec |
| `PUT` | `/epics/:epicId/artifacts/:artId` | Update artifact spec |
| `DELETE` | `/epics/:epicId/artifacts/:artId` | Delete artifact |
| `POST` | `/epics/:epicId/artifacts/:artId/build` | Trigger artifact build |
| `GET` | `/epics/:epicId/artifacts/:artId/build/status` | SSE build progress |
| `GET` | `/epics/:epicId/artifacts/:artId/preview` | Serve built HTML |
| `GET` | `/epics/:epicId/artifacts/:artId/sections` | List extracted sections |
| `GET` | `/epics/:epicId/artifacts/:artId/annotations` | List annotations |
| `POST` | `/epics/:epicId/artifacts/:artId/annotations` | Create annotation |
| `PATCH` | `/epics/:epicId/artifacts/:artId/annotations/:annId` | Toggle annotation status |
| `POST` | `/epics/:epicId/artifacts/:artId/annotations/apply` | Batch apply pending annotations |
| `GET` | `/epics/:epicId/artifacts/:artId/versions` | List build versions |
| `POST` | `/epics/:epicId/artifacts/:artId/versions/:ver/revert` | Revert to version |

## Level 17 — Discoverability System

### Slash Command Palette
- Triggered by `/` as first character in chat input
- Command registry in `commandRegistry.ts` — single source of truth
- Two behaviors: `dispatch` (direct API call) and `chat` (inject prompt)
- Deterministic soft filtering by current view context

### Guide Modal
- Tabbed modal: Overview, Chat Agent, Projects & Wiki, Epics & Design, Shortcuts
- Triggered by: nav help button, chat `?` button, `/help` command, first visit
- Content is lean and visual — diagrams + expandable sections
- Component: `CodaScopeGuideModal.tsx` (replaces old `ChatHelpModal.tsx`)

### Agent Self-Awareness
- `do_chat.md` includes capability summary
- Agent answers "what can you do?" naturally
- Only teaches when asked — no unsolicited suggestions
