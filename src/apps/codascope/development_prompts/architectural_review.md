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
├── manifest.tsx                      # AppManifest — wires CodaScope into the shell (65 lines)
├── codascope.css                     # Primary CodaScope styles (5668 lines)
├── CodaScopeAssistant.css            # Assistant panel styles (1067 lines)
├── useCodaScopeStore.ts              # Zustand store (111 lines)
├── contextAssembler.ts               # Lightweight context for assistant (127 lines)
├── codaScopeSseClient.ts             # Shared SSE streaming utilities (182 lines)
├── codaScopeTypes.ts                 # Shared API type definitions (546 lines)
├── CodaScopeContent.tsx              # Root content router (193 lines)
├── CodaScopeNav.tsx                  # Left nav — project picker + view nav (193 lines)
├── CodaScopeAssistant.tsx            # Right panel — persistent AI chat (992 lines)
├── components/
│   ├── ActionCard.tsx                # Interactive action cards (329 lines)
│   ├── AnnotationThread.tsx          # Threaded annotation comments (212 lines)
│   ├── AtMentionPicker.tsx           # @-mention autocomplete (393 lines)
│   ├── AtMentionPicker.css           # @-mention picker styles (163 lines)
│   ├── BlockedDownloadItem.tsx       # Blocked download resolution (199 lines)
│   ├── ChatHelpModal.tsx             # Chat help modal (150 lines)
│   ├── CodaScopeIcons.tsx            # Centralized SVG icons (586 lines)
│   ├── ConversationHeader.tsx        # Chat header with history popover (148 lines)
│   ├── CurateButton.tsx              # Curation trigger button (52 lines)
│   ├── CurationProgressBanner.tsx    # Live curation pipeline progress (146 lines)
│   ├── CurationReasonsModal.tsx      # Modal showing curation reasons (150 lines)
│   ├── DiffViewer.tsx                # Side-by-side version diff viewer (122 lines)
│   ├── DocumentEditor.tsx            # Rich markdown editor (766 lines)
│   ├── EditorSelectionToolbar.tsx    # Floating selection toolbar (77 lines)
│   ├── EpicBriefExport.tsx           # Epic brief export modal (129 lines)
│   ├── InsertionPrompt.tsx           # Inline directive prompt UI (325 lines)
│   ├── ModelPicker.tsx               # AI model selection dropdown (235 lines)
│   ├── PromptChips.tsx               # Quick-action prompt chips (192 lines)
│   ├── SetupBanners.tsx              # Inline banners for missing config (130 lines)
│   ├── SourceUpload.tsx              # File upload for knowledge sources (138 lines)
│   └── SourceViewer.tsx              # Research source content viewer (188 lines)
├── hooks/
│   ├── useAssistantStream.ts         # Chat SSE streaming + action parsing (207 lines)
│   ├── useEditorDiff.ts              # Diff highlighting with fade-out (77 lines)
│   └── useEditorResize.ts            # Mermaid/image resize handlers (115 lines)
├── views/
│   ├── ProjectList.tsx               # Project cards + first-launch wizard (239 lines)
│   ├── ProjectDashboard.tsx          # Project overview + analyze pipeline (788 lines)
│   ├── WikiBrowser.tsx               # Wiki topic tree + markdown editor (431 lines)
│   ├── QualityDashboard.tsx          # Quality scores + category drill-down (334 lines)
│   ├── GoldenRules.tsx               # CRUD for coding standards (354 lines)
│   ├── ConceptExplorer.tsx           # Filterable domain concepts (298 lines)
│   ├── SkillsManager.tsx             # Framework + project skills (345 lines)
│   ├── Settings.tsx                  # API key, repos, project config (569 lines)
│   ├── EpicList.tsx                  # Epic cards list with badges (373 lines)
│   ├── EpicDetail.tsx                # Epic detail shell with tab routing (288 lines)
│   ├── EpicDefine.tsx                # Epic definition editor tab (379 lines)
│   ├── EpicScope.tsx                 # Epic scope management tab (798 lines)
│   ├── EpicKnowledge.tsx             # Epic knowledge + research tab (467 lines)
│   ├── EpicDesignDocs.tsx            # Design document list + editor tab (382 lines)
│   └── EpicHistory.tsx               # Version history + diff viewer tab (475 lines)
└── commands/                         # Agent prompt templates (10 files, 867 lines total)
    ├── do_build_code_map.md          # Generates repo structure map (100 lines)
    ├── do_build_full_wiki.md         # Builds complete wiki from code map (85 lines)
    ├── do_build_wiki_page.md         # Builds/rebuilds a single wiki page (44 lines)
    ├── do_build_wiki_delta.md        # Incremental wiki update (58 lines)
    ├── do_explore.md                 # Lightweight codebase exploration (35 lines)
    ├── do_quality_scan.md            # Quality analysis against golden rules (114 lines)
    ├── do_chat.md                    # Codebase Q&A system prompt (169 lines)
    ├── do_curate_epic.md             # Curation pipeline prompt (109 lines)
    ├── do_process_source.md          # Research source processing prompt (66 lines)
    └── do_research_epic.md           # Web research pipeline prompt (87 lines)
```

**Backend** (under `server/`):
```
server/
├── routes/
│   ├── codaScopeRoutes.ts            # Thin hub — assembles sub-routes (33 lines)
│   ├── codaScopeServiceContext.ts    # Shared service context + helpers (244 lines)
│   ├── codaScopeCoreRoutes.ts        # Config, projects, repos, models (137 lines)
│   ├── codaScopeWikiRoutes.ts        # Wiki, concepts, rules, quality, code map (284 lines)
│   ├── codaScopeBuildRoutes.ts       # Skills, runs, build status, analyze (479 lines)
│   ├── codaScopeChatRoutes.ts        # Conversations, messages, assistant (490 lines)
│   ├── codaScopeEpicRoutes.ts        # Epic CRUD, scope, designs, versions (658 lines)
│   ├── codaScopeAnnotationRoutes.ts  # Annotations, directives, batch (284 lines)
│   └── codaScopeKnowledgeRoutes.ts   # Knowledge sources, research, curation (470 lines)
└── services/
    ├── codaScopeAgentService.ts       # Cursor SDK agent wrapper (375 lines)
    ├── codaScopeToolDefinitions.ts    # Agent tool factory — read/write/epic (1589 lines)
    ├── codaScopeCodeMapService.ts     # Progressive code map builder (606 lines)
    ├── codaScopeBuildStateService.ts  # Build state tracking (532 lines)
    ├── codaScopeBuildOrchestrator.ts  # Multi-step build pipeline (591 lines)
    ├── codaScopeChatService.ts        # Conversation CRUD + streaming detection (585 lines)
    ├── codaScopeChatOrchestrator.ts   # Chat prompt assembly + dispatch (201 lines)
    ├── codaScopeChatPromptHelpers.ts  # System prompt assembly (527 lines)
    ├── codaScopeWikiStateService.ts   # Wiki depth tracking + delta detection (362 lines)
    ├── codaScopeQualityService.ts     # Quality scan persistence + scoring (262 lines)
    ├── codaScopeGoldenRuleService.ts  # Golden rule CRUD (252 lines)
    ├── codaScopeProjectService.ts     # Project CRUD + repo management (241 lines)
    ├── codaScopeCommandLoader.ts      # Template loader + variable substitution (212 lines)
    ├── codaScopeWikiService.ts        # Wiki topic CRUD (211 lines)
    ├── codaScopeConceptService.ts     # Domain concept extraction (197 lines)
    ├── codaScopeSkillService.ts       # Skills management (162 lines)
    ├── codaScopeImageService.ts       # Image upload, storage, serving (145 lines)
    ├── codaScopeActionParser.ts       # Action tag extraction (117 lines)
    ├── codaScopeEpicService.ts        # Epic CRUD, lifecycle, scope, locks (807 lines)
    ├── codaScopeDesignDocService.ts   # Design doc CRUD (466 lines)
    ├── codaScopeVersionService.ts     # Snapshot-based version history (354 lines)
    ├── codaScopeAnnotationService.ts  # Annotations, directives, batch (803 lines)
    ├── codaScopeEpicRenderService.ts  # HTML rendering + storage (432 lines)
    ├── codaScopeEpicKnowledgeService.ts # Epic knowledge + source management (525 lines)
    ├── codaScopeContentService.ts     # Content extraction + processing (421 lines)
    ├── codaScopeCurationService.ts    # Curation trigger tracking (261 lines)
    ├── codaScopeCurationOrchestrator.ts # Curation pipeline (377 lines)
    └── codaScopeResearchOrchestrator.ts # Web research pipeline (672 lines)
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
- `useCodaScopeStore.ts` (143 lines) — are all store fields and actions consumed by components?
- `contextAssembler.ts` (107 lines) — are all exports used?
- `CodaScopeIcons.tsx` (324 lines) — are all icon exports used? This is likely to accumulate dead icons.
- Each backend service — are all exported functions called by routes or other services?

### 2.3 Dead Views or Routes

Verify the route table in `CodaScopeContent.tsx` matches reality:

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

- Are there routes defined that are never linked to from the nav?
- Are there nav items in `CodaScopeNav.tsx` that link to routes not handled by the content router?
- Are there API endpoints in any `codaScope*Routes.ts` file that no frontend code calls?

### 2.4 Dead Agent Commands

For each command in `commands/`:
- Is it referenced by `codaScopeCommandLoader.ts` or `codaScopeRoutes.ts`?
- Is the corresponding agent pipeline step wired in the routes?

Current commands to verify:
- `do_build_code_map.md` (100 lines)
- `do_build_full_wiki.md` (85 lines)
- `do_build_wiki_page.md` (44 lines)
- `do_build_wiki_delta.md` (58 lines)
- `do_explore.md` (35 lines)
- `do_quality_scan.md` (114 lines)
- `do_chat.md` (169 lines)
- `do_curate_epic.md` (109 lines)
- `do_process_source.md` (66 lines)
- `do_research_epic.md` (87 lines)

### 2.5 Dead CSS

CodaScope has two CSS files totaling **6735 lines**:
- `codascope.css` (5668 lines)
- `CodaScopeAssistant.css` (1067 lines)
- `AtMentionPicker.css` (163 lines)

For each CSS file:
- Sample-check 10+ class names to confirm they appear in a `.tsx` file
- Report CSS selectors that appear to have no active consumers
- Look for commented-out CSS blocks that should be removed
- Check for duplicate patterns between the two CSS files

---

## Phase 3: Complexity and Simplification

### 3.1 God Files

These are the largest files in CodaScope. Each needs targeted analysis:

**`codaScopeToolDefinitions.ts` — 1589 lines (LARGEST BACKEND FILE)**

The centralized tool definitions file. Analyze:
- Are all three builder functions (`buildReadOnlyTools`, `buildEpicTools`, `buildWriteTools`) well-organized?
- Is `getToolsForPurpose()` returning the correct tool sets for each purpose?
- Could tool definitions be split further by domain (wiki tools, epic tools, etc.)?
- Are there duplicated patterns across tool definitions?

**`CodaScopeAssistant.tsx` — 992 lines (LARGEST FRONTEND FILE)**

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
- **List views**: `GoldenRules.tsx`, `ConceptExplorer.tsx`, `SkillsManager.tsx` are all CRUD list views. Do they share a common pattern that could be abstracted?
- **CSS patterns**: Between `codascope.css` (5668 lines), `CodaScopeAssistant.css` (1067 lines), and `AtMentionPicker.css` (163 lines), are there duplicated card, list, or panel patterns?
- **Empty state rendering**: Multiple views should show empty states with an icon, title, and description. Is the pattern consistent or duplicated?

### 3.4 Over-Abstraction

Identify abstractions that add indirection without benefit:
- Is `contextAssembler.ts` (107 lines) doing enough to justify a separate file, or could it be inlined?
- Is `codaScopeActionParser.ts` (104 lines) appropriately scoped or over-engineered for its purpose?
- Does `codaScopeCommandLoader.ts` have abstraction layers that only serve one caller?
- Are there service functions that just forward to another service without adding value?

### 3.5 CSS Consolidation

With **6898 total CSS lines** across three files:
- Should `CodaScopeAssistant.css` be merged into `codascope.css`?
- Or is the separation justified by the assistant being a distinct UI region?
- Should `AtMentionPicker.css` be merged into one of the other files?
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
