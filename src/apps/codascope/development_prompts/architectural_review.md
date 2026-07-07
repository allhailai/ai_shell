# Architectural Review — CodaScope Application

> **Purpose:** Reusable prompt for periodic architectural reviews of the CodaScope application within AIShell. Run this prompt when CodaScope needs a health check on boundaries, complexity, dead code, documentation drift, and design coherence.
>
> **Prerequisite:** If you also need to review the shell framework and cross-app concerns, run the shell-level review at `development_prompts/architectural_review.md` in the AIShell root.

## Instructions

You are performing an architectural review of the CodaScope application. CodaScope is an AI-powered codebase exploration, documentation, and analysis app hosted within AIShell. It has a React frontend with Zustand state management and an Express backend with 14+ services.

Read all relevant code. Do not skim. Your findings must cite specific files, line ranges, and concrete evidence. Do not report hypothetical issues — only report what you observe in the actual codebase.

## Review Scope

The review covers the entire CodaScope application:

```
src/apps/codascope/
├── ARCHITECTURE.md                   # App architecture (progressive disclosure, 15 levels)
├── AGENTS.md                         # App-specific agent development guidelines
├── manifest.tsx                      # AppManifest — wires CodaScope into the shell (67 lines)
├── codascope.css                     # Primary CodaScope styles (8032 lines)
├── CodaScopeAssistant.css            # Assistant panel styles (2289 lines)
├── useCodaScopeStore.ts              # Zustand store (95 lines)
├── contextAssembler.ts               # Lightweight context for assistant (124 lines)
├── codaScopeSseClient.ts             # Shared SSE streaming utilities (173 lines)
├── codaScopeTypes.ts                 # Shared API type definitions (606 lines)
├── commandRegistry.ts               # Slash command palette registry (413 lines)
├── CodaScopeContent.tsx              # Root content router (208 lines)
├── CodaScopeNav.tsx                  # Left nav — project picker + view nav (185 lines)
├── CodaScopeHeaderItems.tsx          # Header bar items for shell manifest (28 lines)
├── CodaScopeAssistant.tsx            # Right panel — persistent AI chat (1111 lines)
├── components/
│   ├── ActionCard.tsx                # Interactive action cards (552 lines)
│   ├── AnnotationThread.tsx          # Threaded annotation comments (212 lines)
│   ├── AtMentionPicker.tsx           # @-mention autocomplete (393 lines)
│   ├── BlockedDownloadItem.tsx       # Blocked download resolution (199 lines)
│   ├── CodaScopeGuideModal.tsx       # Tabbed help/guide modal (624 lines)
│   ├── CodaScopeRepoRemapModal.tsx   # Repository path remapping modal (210 lines)
│   ├── CodaScopeIcons.tsx            # Centralized SVG icons (648 lines)
│   ├── ConversationHeader.tsx        # Chat header with history popover (148 lines)
│   ├── CurateButton.tsx              # Curation trigger button (52 lines)
│   ├── CurationProgressBanner.tsx    # Live curation pipeline progress (245 lines)
│   ├── CurationReasonsModal.tsx      # Modal showing curation reasons (150 lines)
│   ├── DiffViewer.tsx                # Side-by-side version diff viewer (122 lines)
│   ├── DocumentBlockRenderer.tsx     # Block-level document renderer (375 lines)
│   ├── DocumentEditor.tsx            # Rich markdown editor (815 lines)
│   ├── EditorSelectionToolbar.tsx    # Floating selection toolbar (114 lines)
│   ├── EpicBriefExport.tsx           # Epic brief export modal (130 lines)
│   ├── EpicSidebar.tsx               # Collapsible epic navigation sidebar (761 lines)
│   ├── ErrorSourceItem.tsx           # Failed knowledge source resolution (326 lines)
│   ├── InsertionPrompt.tsx           # Inline directive prompt UI (374 lines)
│   ├── ModelPicker.tsx               # AI model selection dropdown (235 lines)
│   ├── PromptChips.tsx               # Quick-action prompt chips (226 lines)
│   ├── ScopeBadges.tsx               # Scope status badge components (56 lines)
│   ├── ScopeDiffModal.tsx            # Scope diff visualization modal (160 lines)
│   ├── SetupBanners.tsx              # Inline banners for missing config (130 lines)
│   ├── SlashCommandPalette.tsx       # Slash command autocomplete palette (213 lines)
│   ├── SourceUpload.tsx              # File upload for knowledge sources (138 lines)
│   ├── SourceViewer.tsx              # Research source content viewer (188 lines)
│   └── artifact-viewer/              # Visual HTML artifact subsystem
│       ├── ArtifactViewer.tsx         # Main orchestrator (502 lines)
│       ├── ArtifactSpecEditor.tsx     # Spec editing with model picker (195 lines)
│       ├── ArtifactPreview.tsx        # Sandboxed iframe preview (109 lines)
│       ├── ArtifactSectionPanel.tsx   # Section/annotation/version panel (667 lines)
│       ├── ArtifactAnnotationCard.tsx # Individual annotation card (186 lines)
│       ├── artifactApi.ts             # Typed API wrappers (365 lines)
│       └── hooks/                     # Dedicated artifact hooks
│           ├── useArtifactAnnotations.ts # Annotation lifecycle hook (261 lines)
│           └── useArtifactBuild.ts     # Build lifecycle hook (159 lines)
├── hooks/
│   ├── useAssistantStream.ts         # Chat SSE streaming + action parsing (207 lines)
│   ├── useBuildState.ts              # Build lifecycle SSE hook (147 lines)
│   ├── useConversationManager.ts     # Conversation lifecycle management (208 lines)
│   ├── useDashboardBuildState.ts     # Dashboard-specific build state (356 lines)
│   ├── useEditorDiff.ts              # Diff highlighting with fade-out (77 lines)
│   ├── useEditorResize.ts            # Mermaid/image resize handlers (129 lines)
│   └── useEpicContext.ts             # Epic context for tabs/sidebar (204 lines)
├── views/
│   ├── ProjectList.tsx               # Project cards + first-launch wizard (686 lines)
│   ├── ProjectDashboard.tsx          # Project overview + analyze pipeline (861 lines)
│   ├── WikiBrowser.tsx               # Wiki topic tree + markdown editor (444 lines)
│   ├── SkillsManager.tsx             # Framework + project skills (345 lines)
│   ├── Settings.tsx                  # API key, repos, project config (650 lines)
│   ├── EpicList.tsx                  # Epic cards list with badges (373 lines)
│   ├── EpicDetail.tsx                # Epic detail shell with tab routing (647 lines)
│   ├── EpicDefine.tsx                # Epic definition editor tab (388 lines)
│   ├── EpicScope.tsx                 # Epic scope management tab (589 lines)
│   ├── EpicKnowledge.tsx             # Epic knowledge + research tab (714 lines)
│   ├── EpicDesignDocs.tsx            # Design document list + editor tab (318 lines)
│   └── EpicHistory.tsx               # Version history + diff viewer tab (501 lines)
└── commands/                         # Agent prompt templates (13 files, 1095 lines total)
    ├── do_build_code_map.md          # Generates repo structure map (84 lines)
    ├── do_build_full_wiki.md         # Builds complete wiki from code map (84 lines)
    ├── do_build_wiki_page.md         # Builds/rebuilds a single wiki page (44 lines)
    ├── do_build_wiki_delta.md        # Incremental wiki update (58 lines)
    ├── do_explore.md                 # Lightweight codebase exploration (34 lines)
    ├── do_chat.md                    # Codebase Q&A system prompt (213 lines)
    ├── do_curate_epic.md             # Curation pipeline prompt (105 lines)
    ├── do_process_source.md          # Research source processing prompt (64 lines)
    ├── do_research_epic.md           # Web research pipeline prompt (85 lines)
    ├── do_build_artifact.md          # Artifact HTML generation prompt (96 lines)
    ├── do_regen_sections.md          # Section regeneration prompt (64 lines)
    ├── do_deep_wiki_page.md          # Deep wiki page generation (163 lines)
    └── do_wiki_cross_reference.md    # Wiki cross-reference pass (101 lines)
```

**Backend** (under `server/`):
```
server/
├── routes/
│   ├── codaScopeRoutes.ts            # Thin hub — assembles sub-routes (35 lines)
│   ├── codaScopeServiceContext.ts    # Shared service context + helpers (271 lines)
│   ├── codaScopeCoreRoutes.ts        # Config, projects, repos, models (158 lines)
│   ├── codaScopeWikiRoutes.ts        # Wiki CRUD, state, pending deletions, code map (136 lines)
│   ├── codaScopeBuildRoutes.ts       # Skills, runs, build status, analyze (480 lines)
│   ├── codaScopeChatRoutes.ts        # Conversations, messages, assistant (490 lines)
│   ├── codaScopeEpicRoutes.ts        # Epic CRUD, scope, designs, versions (779 lines)
│   ├── codaScopeAnnotationRoutes.ts  # Annotations, directives, batch (284 lines)
│   ├── codaScopeKnowledgeRoutes.ts   # Knowledge sources, research, curation (519 lines)
│   └── codaScopeArtifactRoutes.ts    # Artifact CRUD, build, preview, sections (562 lines)
└── services/
    ├── codaScopeProjectService.ts     # Project CRUD + repo management (394 lines)
    ├── codaScopeProjectDirResolver.ts # Project directory resolution cache (134 lines)
    ├── codaScopeAgentService.ts       # Cursor SDK agent wrapper (375 lines)
    ├── codaScopeToolDefinitions.ts    # Tool facade — purpose-based composition (90 lines)
    ├── codaScopeToolServiceFactory.ts # Tool service instantiation factory (51 lines)
    ├── codaScopeCodeMapService.ts     # Progressive code map builder (606 lines)
    ├── codaScopeBuildStateService.ts  # Build state tracking (614 lines)
    ├── codaScopeBuildOrchestrator.ts  # Multi-step build pipeline (1021 lines)
    ├── codaScopeChatService.ts        # Conversation CRUD + streaming detection (585 lines)
    ├── codaScopeChatOrchestrator.ts   # Chat prompt assembly + dispatch (188 lines)
    ├── codaScopeChatPromptHelpers.ts  # System prompt assembly (471 lines)
    ├── codaScopeWikiStateService.ts   # Wiki depth tracking + delta detection (362 lines)
    ├── codaScopeWikiService.ts        # Wiki topic CRUD (211 lines)
    ├── codaScopeProjectService.ts     # Project CRUD + repo management (394 lines)
    ├── codaScopeCommandLoader.ts      # Template loader + variable substitution (368 lines)
    ├── codaScopeSkillService.ts       # Skills management (158 lines)
    ├── codaScopeImageService.ts       # Image upload, storage, serving (145 lines)
    ├── codaScopeActionParser.ts       # Action tag extraction (119 lines)
    ├── codaScopeEpicService.ts        # Epic CRUD, lifecycle, scope, health (683 lines)
    ├── codaScopeLockService.ts        # Edit lock management (223 lines)
    ├── codaScopeDesignDocService.ts   # Design doc CRUD + versioning (733 lines)
    ├── codaScopeVersionService.ts     # Snapshot-based version history (354 lines)
    ├── codaScopeAnnotationService.ts  # Inline annotations and comment threads (462 lines)
    ├── codaScopeDirectiveService.ts   # Insertion directives and batch execution (412 lines)
    ├── codaScopeEpicRenderService.ts  # HTML rendering + storage (432 lines)
    ├── codaScopeEpicKnowledgeService.ts # Epic knowledge + source management (529 lines)
    ├── codaScopeContentService.ts     # Content extraction + processing (425 lines)
    ├── codaScopeCurationService.ts    # Curation trigger tracking (312 lines)
    ├── codaScopeCurationOrchestrator.ts # Curation pipeline (371 lines)
    ├── codaScopeResearchOrchestrator.ts # Web research pipeline (681 lines)
    ├── codaScopeWebSearchService.ts   # Web search integration (68 lines)
    ├── codaScopeArtifactService.ts    # Artifact spec CRUD + build (818 lines)
    ├── codaScopeArtifactAnnotationService.ts # Artifact annotation lifecycle (320 lines)
    ├── codaScopeArtifactVersionService.ts   # Artifact build version snapshots (249 lines)
    ├── codaScopeArtifactAnnotationScript.ts # DOM inspection overlay script (228 lines)
    └── tools/                         # Agent tool implementations (split by domain)
        ├── codaScopeReadOnlyTools.ts   # 14 read-only discovery tools (545 lines)
        ├── codaScopeEpicTools.ts       # 21 epic read/write tools (702 lines)
        ├── codaScopeWriteTools.ts      # 1 code map write tool (65 lines)
        └── codaScopeArtifactTools.ts   # 3 artifact tools (223 lines)
```

---

## Phase 1: Boundary Integrity

### 1.1 Shell Boundary Compliance

CodaScope must interact with the shell ONLY through approved interfaces. Verify:

- **Manifest**: `manifest.tsx` exports a valid `AppManifest` — does it use only the `AppManifest` interface from `../../types/app`?
- **Shell hooks**: Does CodaScope only import from `../../shell/hooks.ts`, `../../shell/store.ts`, `../../shell/useAppSubRoute.ts`, `../../shell/authContext.tsx`, and `../../shell/useSecrets.ts`?
- **No shell internals**: CodaScope should NOT import from `../../app/` (shell UI components) or directly access `../../shell/urlState.ts` or `../../shell/commandBus.ts` internals.
- **No cross-app imports**: CodaScope should NOT import from `../../apps/arcade/`, `../../apps/admin/`, etc.
- **Shared components**: Imports from `../../shared/` are allowed and expected.

### 1.2 Frontend Internal Boundaries

Within CodaScope's frontend:

- **Views** (`views/`) should import from `components/`, the Zustand store, and shell hooks. They should NOT import from each other (no view-to-view coupling).
- **Components** (`components/`) should be reusable within CodaScope. They should NOT import directly from `views/`.
- **Store** (`useCodaScopeStore.ts`) should not import React components or views.
- **Context assembler** (`contextAssembler.ts`) should not import React components.

Report any violations with file path, import statement, and recommended fix.

### 1.3 Server-Side Boundaries

- **Route files** (`codaScope*Routes.ts`) — Routes are split into domain-specific sub-modules (core, wiki, build, chat, epic, annotation, knowledge) with a thin hub file. Verify that each sub-route file is a dispatcher to services and doesn't contain inline business logic. Check that `codaScopeServiceContext.ts` provides the shared service context correctly.
- **Services** should not handle HTTP (no `req`/`res` objects). Each service should have one clear domain.
- **Service isolation**: Services should not form circular dependencies. Map the dependency graph:
  - Does `codaScopeAgentService` call other CodaScope services directly, or does the route handler orchestrate?
  - Does `codaScopeChatService` depend on `codaScopeAgentService`?
  - Is there a clear layering (routes → orchestration → domain services)?

### 1.4 Agent Command Isolation

Agent command templates (`commands/*.md`) are prompt files, not executable code. Verify:
- They contain only markdown and `{{VARIABLE}}` placeholders
- They don't contain embedded JavaScript or code that gets `eval`'d
- All `{{VARIABLE}}` references are resolved by `codaScopeCommandLoader.ts`
- Unresolved variables are left as-is intentionally (documented behavior)

---

## Phase 2: Dead Code and Dead UI

### 2.1 Unreferenced Files

Identify files that are never imported or rendered:
- Check all `.ts`, `.tsx` files under `src/apps/codascope/`
- Check all CodaScope services under `server/services/codaScope*.ts`
- A component is dead if no parent renders it
- A service is dead if no route or other service calls it
- A view is dead if `CodaScopeContent.tsx` never routes to it

### 2.2 Unreferenced Exports

For each file, check for exported functions, types, or constants that nothing imports:

Priority files to check:
- `useCodaScopeStore.ts` (95 lines) — are all store fields and actions consumed by components?
- `contextAssembler.ts` (124 lines) — are all exports used?
- `CodaScopeIcons.tsx` (648 lines) — are all icon exports used? This is likely to accumulate dead icons.
- `commandRegistry.ts` (403 lines) — are all registered commands wired to handlers in the assistant?
- Each backend service — are all exported functions called by routes or other services?

### 2.3 Dead Views or Routes

Verify the route table in `CodaScopeContent.tsx` matches reality:

```
/codascope/projects              → ProjectList
/codascope/project/:id/dashboard → ProjectDashboard
/codascope/project/:id/wiki      → WikiBrowser
/codascope/project/:id/skills    → SkillsManager
/codascope/project/:id/settings  → Settings
/codascope/project/:id/epics     → EpicList
/codascope/project/:id/epic/:eid → EpicDetail (with tab sub-routing)
```

- Are there routes defined that are never linked to from the nav?
- Are there nav items in `CodaScopeNav.tsx` that link to routes not handled by the content router?
- Are there API endpoints in any `codaScope*Routes.ts` file that no frontend code calls?

### 2.4 Dead Agent Commands

For each command in `commands/`:
- Is it referenced by `codaScopeCommandLoader.ts` or `codaScopeRoutes.ts`?
- Is the corresponding agent pipeline step wired in the routes?

Current commands to verify:
- `do_build_code_map.md` (84 lines)
- `do_build_full_wiki.md` (84 lines)
- `do_build_wiki_page.md` (44 lines)
- `do_build_wiki_delta.md` (58 lines)
- `do_explore.md` (34 lines)
- `do_chat.md` (213 lines)
- `do_curate_epic.md` (105 lines)
- `do_process_source.md` (64 lines)
- `do_research_epic.md` (85 lines)
- `do_build_artifact.md` (96 lines)
- `do_regen_sections.md` (64 lines)

### 2.5 Dead CSS

CodaScope has two CSS files totaling **9831 lines**:
- `codascope.css` (7545 lines)
- `CodaScopeAssistant.css` (2286 lines)

For each CSS file:
- Sample-check 10+ class names to confirm they appear in a `.tsx` file
- Report CSS selectors that appear to have no active consumers
- Look for commented-out CSS blocks that should be removed
- Check for duplicate patterns between the two CSS files

---

## Phase 3: Complexity and Simplification

### 3.1 God Files

These are the largest files in CodaScope. Each needs targeted analysis:

**`codaScopeBuildOrchestrator.ts` — 1021 lines (LARGEST BACKEND FILE)**

The multi-step build pipeline orchestrator. Analyze:
- It handles 3 distinct pipelines: standard analyze, deep run, and shared helpers
- Could the deep run pipeline be extracted into its own file?
- Are the SSE event emissions consistent across pipelines?
- Are there duplicated agent-call patterns across the different pipeline steps?

**`CodaScopeAssistant.tsx` — 1111 lines (LARGEST FRONTEND FILE)**

The persistent chat panel. Analyze:
- Does it handle too many concerns? (rendering, streaming, action parsing, wikilink conversion, scroll management)
- Has the `useAssistantStream` hook extraction been complete, or is there residual streaming logic?
- Could message rendering be a separate component?
- Is the @-mention integration clean?

**`codaScopeEpicService.ts` — 807 lines**

Epic lifecycle management. Analyze:
- How many distinct responsibilities? (CRUD, lifecycle, scope, locks, health)
- Is the lock logic separable from the core CRUD?
- Could health computation be extracted?

**`codaScopeAnnotationService.ts` — 803 lines**

Annotation and directive management. Analyze:
- How many distinct responsibilities? (annotations, directives, batch execution, block tracking)
- Could batch execution logic be extracted?

**`EpicScope.tsx` — 798 lines**

Scope management view. Analyze:
- How many distinct UI sections does it render?
- Could scope diff, scope enrichment, or scope table be extracted into sub-components?

**`ProjectDashboard.tsx` — 788 lines**

Project overview. Analyze:
- How many distinct UI sections does it render?
- Does it mix data fetching, state management, and rendering in a single component?
- Could any sub-sections be extracted into child components?

**`DocumentEditor.tsx` — 766 lines**

Rich markdown editor. Analyze:
- Has the component extraction been complete? (EditorSelectionToolbar, useEditorDiff, useEditorResize extracted)
- Are there remaining sub-components that could be extracted?

**`codaScopeEpicRoutes.ts` — 658 lines (LARGEST ROUTE FILE)**

Epic domain routes. Analyze:
- Are route handlers thin dispatchers to services?
- Are there handlers with inline business logic that should move to a service?
- Could it be further split (e.g., epic CRUD vs. epic design vs. epic scope)?

**`Settings.tsx` — 569 lines**

Project settings view. Analyze:
- How many distinct setting sections?
- Could sections be individual components?
- Does it handle its own API calls or delegate to the store?

### 3.2 God Functions

Identify functions over 80 lines in:
- `codaScopeRoutes.ts` — route handlers that are too long
- `ProjectDashboard.tsx` — render methods or effect hooks that are too complex
- `codaScopeAgentService.ts` — agent orchestration functions
- `CodaScopeAssistant.tsx` — streaming or rendering functions
- `codaScopeBuildStateService.ts` — state management functions

For each, answer:
- What does it do?
- Could it be split into smaller composable functions?
- Does it mix concerns (e.g., data fetching + DOM rendering + state mutation)?

### 3.3 Duplicated Patterns

Look for duplicated logic across CodaScope files:

- **SSE streaming**: The shared `codaScopeSseClient.ts` should be used for all frontend SSE streams. Verify no components still inline `getReader()` + `TextDecoder` parsing instead of using `connectToSseStream()`.
- **API call patterns**: Do views duplicate similar fetch/error-handling patterns? Could there be a shared `codaScopeApi.ts` transport layer?
- **List views**: `SkillsManager.tsx`, `EpicList.tsx` are CRUD list views. Do they share a common pattern that could be abstracted?
- **CSS patterns**: Between `codascope.css` (8032 lines) and `CodaScopeAssistant.css` (2289 lines), are there duplicated card, list, or panel patterns?
- **Empty state rendering**: Multiple views should show empty states with an icon, title, and description. Is the pattern consistent or duplicated?

### 3.4 Over-Abstraction

Identify abstractions that add indirection without benefit:
- Is `contextAssembler.ts` (107 lines) doing enough to justify a separate file, or could it be inlined?
- Is `codaScopeActionParser.ts` (104 lines) appropriately scoped or over-engineered for its purpose?
- Does `codaScopeCommandLoader.ts` have abstraction layers that only serve one caller?
- Are there service functions that just forward to another service without adding value?

### 3.5 CSS Consolidation

With **10,321 total CSS lines** across two files:
- Should `CodaScopeAssistant.css` be merged into `codascope.css`?
- Or is the separation justified by the assistant being a distinct UI region?
- Are there CSS custom properties defined in one file but needed in both?
- Could some styles be replaced by shell utility classes from `02-utilities.css`?

---

## Phase 4: Documentation Integrity

### 4.1 ARCHITECTURE.md Accuracy

Compare `ARCHITECTURE.md` (10 levels of progressive disclosure) against the actual codebase:

- **Level 0 (What Is This):** Does the description match current capabilities?
- **Level 0.5 (Design Philosophy):** Are all 5 principles still followed?
- **Level 1 (File Map):** Does the directory listing match reality? Are there files not documented?
  - Frontend files: verify all `.tsx`, `.ts` files are listed
  - Backend services: verify all `codaScope*.ts` files are listed
  - Commands: verify all `commands/*.md` files are listed
- **Level 2 (Core Architecture):**
  - Does the route table match `CodaScopeContent.tsx`?
  - Does the agent pipeline description match the actual implementation?
  - Is the build state description accurate?
- **Level 3 (Design Directives):** Do the icon, CSS, component, and error handling rules match reality?
- **Level 4 (Persistent Conversations):** Does the API endpoint table match `codaScopeRoutes.ts`?
- **Level 5 (Agent Intelligence):** Does the tool set table match `codaScopeToolDefinitions.ts`? Are all tools listed? Are the action types still valid?
- **Level 6 (Code Map Service):** Does the staleness model match `codaScopeCodeMapService.ts`?
- **Level 7 (Wiki State):** Do the depth metrics match `codaScopeWikiStateService.ts`?
- **Level 8 (Command Framework):** Does the variable table match `codaScopeCommandLoader.ts`?
- **Level 9 (Supporting Services):** Does the service table match reality?
- **Level 10 (Backend Infrastructure):** Is the build state persistence and SSE streaming description accurate?

### 4.2 AGENTS.md Accuracy

Compare `AGENTS.md` against the actual codebase:

- **Design Philosophy section:** Still matches ARCHITECTURE.md Level 0.5?
- **Critical Rules:** All 8 rules still valid and followed?
- **File Organization table:** Does the "Where" column match reality? (Endpoints should reference domain sub-route files, not the hub.)
- **Patterns to Follow:** All patterns still relevant?
- **Testing Checklist:** Complete and achievable?
- **Common Mistakes:** All 10 items still relevant? Any new ones to add?

### 4.3 Command Template Accuracy

For each command in `commands/`:
- Does its described schema match what `codaScopeCommandLoader.ts` actually resolves?
- Are there `{{VARIABLE}}` references that the loader doesn't know about?
- Do command templates reference features or data structures that no longer exist?
- Are the agent instructions consistent with the current architecture?

---

## Phase 5: API Contract Integrity

### 5.1 Frontend-Backend Contract

CodaScope doesn't appear to have a shared `contracts/` or types file between frontend and backend. Evaluate:
- Are API shapes defined implicitly in both the route handlers and the component fetch calls?
- Are there mismatches between what routes return and what components expect?
- Should there be a shared type definition file?

### 5.2 Route Handler Validation

In the domain route files (e.g., `codaScopeChatRoutes.ts`, `codaScopeEpicRoutes.ts`):
- Do route handlers validate incoming request bodies?
- Are there routes that accept arbitrary payloads without validation?
- Are error responses consistent (status codes, error shapes)?

### 5.3 SSE Event Contract

The SSE streaming events are a contract between server and client. Verify:
- Are the event types (`run-started`, `data`, `wiki-refresh`, `done`, `error`) consistent between the route files and the frontend SSE parsers in `ProjectDashboard.tsx` and `CodaScopeAssistant.tsx`?
- Are there event types the server sends that the client doesn't handle?
- Are there event types the client expects that the server never sends?

### 5.4 Action Tag Contract

The agent action system has a multi-layer contract:
1. Agent output → `codaScopeActionParser.ts` (extraction)
2. Parser → message metadata → `ActionCard.tsx` (rendering)
3. ActionCard → CodaScope APIs (dispatch)

Verify:
- `VALID_ACTION_TYPES` in `codaScopeActionParser.ts` matches what `ActionCard.tsx` can render
- Each action type has a corresponding dispatch handler in `ActionCard.tsx`
- The `do_chat.md` system prompt accurately describes the available action types to the agent

---

## Phase 6: State Management Review

### 6.1 Zustand Store

Analyze `useCodaScopeStore.ts` (143 lines):
- Is the store appropriately scoped? Does it hold only client-side state, or does it duplicate server state?
- Are there store fields that are never read?
- Are there store actions that are never dispatched?
- Is the store shape well-typed or does it use `any`?

### 6.2 URL State

Via `useAppSubRoute("codascope")`:
- Does every view properly sync to the URL?
- Can every view be deep-linked?
- Does browser back/forward work correctly across all view transitions?

### 6.3 Local vs. Server State

CodaScope fetches data from the server. Verify:
- Is server data cached appropriately in the Zustand store, or is it re-fetched too aggressively?
- Are there stale cache bugs (data updated on server but client still shows old data)?
- Are there components that should refetch on mount but don't?

---

## Phase 7: Agent System Review

### 7.1 Tool Safety

The ARCHITECTURE.md and AGENTS.md state that:
- **Assistant/chat** → read-only tools only
- **Wiki-build** → read-only + write tools

Verify this separation in `codaScopeToolDefinitions.ts`:
- Are read-only tools correctly identified in `buildReadOnlyTools()`?
- Are epic tools correctly identified in `buildEpicTools()`?
- Are write tools excluded from chat/assistant mode when not intended?
- Could a prompt injection cause the chat agent to invoke write tools inappropriately?

### 7.2 Manifest vs. Tool Strategy

The agent receives a ~500 token manifest + tools for full content. Verify:
- Is the manifest actually lightweight (~500 tokens)?
- Are there code paths that inject full content instead of using the manifest strategy?
- Do the tools return appropriate amounts of data, or could they return unbounded content?

### 7.3 Stale Streaming Detection

`codaScopeChatService.ts` auto-recovers conversations stuck in "streaming" for >10 minutes. Verify:
- Is this timer actually implemented?
- Does it run on a schedule or only on access?
- Could it incorrectly mark an active stream as stale?

---

## Phase 8: Test Coverage Gaps

### 8.1 Current Test Files

List all test files under `src/apps/codascope/` and `server/services/codaScope*.test.ts` and `server/routes/codaScope*.test.ts`.

### 8.2 Critical Untested Paths

Based on the file inventory, these are likely untested and high-risk:
- Domain route files (total ~3,079 lines across 7 files) — API contract enforcement
- `codaScopeToolDefinitions.ts` (1589 lines) — tool definition correctness
- `codaScopeBuildStateService.ts` (532 lines) — state persistence
- `codaScopeChatService.ts` (585 lines) — conversation lifecycle
- `codaScopeEpicService.ts` (807 lines) — epic lifecycle management
- `codaScopeAnnotationService.ts` (803 lines) — annotation and directive correctness

### 8.3 Recommended Test Priorities

Rank which modules would benefit most from tests, based on:
- Complexity (line count)
- Criticality (data loss or security risk if buggy)
- Rate of change (frequently modified modules need tests as guardrails)

---

## Output Format

Produce a structured report with these sections:

1. **Executive Summary** — 3–5 bullet health assessment
2. **Critical Issues** — Must-fix boundary violations, god files, or stale documentation
3. **Simplification Opportunities** — Files or patterns that can be split, deduplicated, or removed
4. **ARCHITECTURE.md Updates** — Specific text changes needed to bring the doc in line with reality
5. **AGENTS.md Updates** — Specific text changes needed
6. **Dead Code Removal List** — Files, exports, CSS selectors safe to delete
7. **API Contract Issues** — Frontend-backend mismatches, missing validation
8. **Agent System Findings** — Tool safety, manifest strategy, action tag integrity
9. **Test Coverage Priorities** — Most impactful untested modules
10. **Recommended Follow-Up Tasks** — Prioritized list of cleanup work

For each finding, include:
- **File(s):** exact path(s)
- **Evidence:** what you observed (line numbers, import statements, missing references)
- **Recommendation:** concrete action
- **Risk:** low / medium / high if left unaddressed
