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
├── ARCHITECTURE.md                   # App architecture (progressive disclosure, 10 levels)
├── AGENTS.md                         # App-specific agent development guidelines
├── manifest.tsx                      # AppManifest — wires CodaScope into the shell (65 lines)
├── codascope.css                     # Primary CodaScope styles (2152 lines)
├── CodaScopeAssistant.css            # Assistant panel styles (732 lines)
├── useCodaScopeStore.ts              # Zustand store (143 lines)
├── contextAssembler.ts               # Lightweight context for assistant (107 lines)
├── CodaScopeContent.tsx              # Root content router (175 lines)
├── CodaScopeNav.tsx                  # Left nav — project picker + view nav (193 lines)
├── CodaScopeAssistant.tsx            # Right panel — persistent AI chat (586 lines)
├── components/
│   ├── ActionCard.tsx                # Interactive action cards (257 lines)
│   ├── CodaScopeIcons.tsx            # Centralized SVG icons (324 lines)
│   ├── ConversationHeader.tsx        # Chat header with history popover (161 lines)
│   ├── ModelPicker.tsx               # AI model selection dropdown (235 lines)
│   └── SetupBanners.tsx              # Inline banners for missing config (130 lines)
├── views/
│   ├── ProjectList.tsx               # Project cards + first-launch wizard (245 lines)
│   ├── ProjectDashboard.tsx          # Project overview + analyze pipeline (944 lines)
│   ├── WikiBrowser.tsx               # Wiki topic tree + markdown editor (469 lines)
│   ├── QualityDashboard.tsx          # Quality scores + category drill-down (334 lines)
│   ├── GoldenRules.tsx               # CRUD for coding standards (354 lines)
│   ├── ConceptExplorer.tsx           # Filterable domain concepts (298 lines)
│   ├── SkillsManager.tsx             # Framework + project skills (376 lines)
│   └── Settings.tsx                  # API key, repos, project config (569 lines)
└── commands/                         # Agent prompt templates (9 files, 621 lines total)
    ├── do_build_code_map.md          # Generates repo structure map (100 lines)
    ├── do_build_full_wiki.md         # Builds complete wiki from code map (85 lines)
    ├── do_build_wiki_page.md         # Builds/rebuilds a single wiki page (44 lines)
    ├── do_build_wiki_delta.md        # Incremental wiki update (58 lines)
    ├── do_enrich_wiki_page.md        # Enriches an existing wiki page (55 lines)
    ├── do_explore.md                 # Lightweight codebase exploration (35 lines)
    ├── do_quality_scan.md            # Quality analysis against golden rules (114 lines)
    ├── do_chat.md                    # Codebase Q&A system prompt (94 lines)
    └── do_goal_wiki.md               # Goal-mode: persistent wiki building (36 lines)
```

**Backend services** (under `server/`):
```
server/
├── routes/
│   └── codaScopeRoutes.ts            # All CodaScope API routes (1722 lines)
└── services/
    ├── codaScopeAgentService.ts       # Cursor SDK agent wrapper (800 lines)
    ├── codaScopeCodeMapService.ts     # Progressive code map builder (606 lines)
    ├── codaScopeBuildStateService.ts  # Build state tracking (532 lines)
    ├── codaScopeChatService.ts       # Conversation CRUD + streaming detection (509 lines)
    ├── codaScopeWikiStateService.ts   # Wiki depth tracking + delta detection (389 lines)
    ├── codaScopeChatPromptHelpers.ts  # System prompt assembly (313 lines)
    ├── codaScopeQualityService.ts     # Quality scan persistence + scoring (262 lines)
    ├── codaScopeGoldenRuleService.ts  # Golden rule CRUD (252 lines)
    ├── codaScopeProjectService.ts     # Project CRUD + repo management (241 lines)
    ├── codaScopeCommandLoader.ts     # Template loader + variable substitution (212 lines)
    ├── codaScopeConceptService.ts     # Domain concept extraction (197 lines)
    ├── codaScopeSkillService.ts       # Skills management (163 lines)
    ├── codaScopeWikiService.ts        # Wiki topic CRUD (128 lines)
    └── codaScopeActionParser.ts       # Action tag extraction (104 lines)
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

- **Route file** (`codaScopeRoutes.ts`, 1722 lines) should be a dispatcher to services. Check for business logic that belongs in a service. At this size, it is a high-risk boundary violation candidate.
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
- Are there API endpoints in `codaScopeRoutes.ts` that no frontend code calls?

### 2.4 Dead Agent Commands

For each command in `commands/`:
- Is it referenced by `codaScopeCommandLoader.ts` or `codaScopeRoutes.ts`?
- Is the corresponding agent pipeline step wired in the routes?

Current commands to verify:
- `do_build_code_map.md` (100 lines)
- `do_build_full_wiki.md` (85 lines)
- `do_build_wiki_page.md` (44 lines)
- `do_build_wiki_delta.md` (58 lines)
- `do_enrich_wiki_page.md` (55 lines)
- `do_explore.md` (35 lines)
- `do_quality_scan.md` (114 lines)
- `do_chat.md` (94 lines)
- `do_goal_wiki.md` (36 lines)

### 2.5 Dead CSS

CodaScope has two CSS files totaling **2884 lines**:
- `codascope.css` (2152 lines)
- `CodaScopeAssistant.css` (732 lines)

For each CSS file:
- Sample-check 10+ class names to confirm they appear in a `.tsx` file
- Report CSS selectors that appear to have no active consumers
- Look for commented-out CSS blocks that should be removed
- Check for duplicate patterns between the two CSS files

---

## Phase 3: Complexity and Simplification

### 3.1 God Files

These are the largest files in CodaScope. Each needs targeted analysis:

**`codaScopeRoutes.ts` — 1722 lines (CRITICAL)**

This is a massive route file. For a healthy architecture, route files should be thin dispatchers. Analyze:
- How many distinct route groups does it contain?
- How many lines are business logic vs. thin dispatch?
- Could it be split into sub-route files (e.g., `codaScopeWikiRoutes.ts`, `codaScopeChatRoutes.ts`, `codaScopeBuildRoutes.ts`)?
- Does it orchestrate multi-service operations (acceptable at the route layer) or contain inline domain logic (not acceptable)?

**`ProjectDashboard.tsx` — 944 lines**

This is the largest frontend file. Analyze:
- How many distinct UI sections does it render?
- Does it mix data fetching, state management, and rendering in a single component?
- Could any sub-sections be extracted into child components?
- Does it have god-function render methods?

**`codaScopeAgentService.ts` — 800 lines**

The agent service wraps the Cursor SDK. Analyze:
- How many distinct responsibilities? (agent runs, tool definitions, streaming, etc.)
- Could tool definitions be extracted into a separate `codaScopeToolDefinitions.ts`?
- Is the streaming logic separable from the agent orchestration?

**`CodaScopeAssistant.tsx` — 586 lines**

The persistent chat panel. Analyze:
- Does it handle too many concerns? (rendering, streaming, action parsing, wikilink conversion, scroll management)
- Could streaming logic be extracted to a custom hook?
- Could message rendering be a separate component?

**`Settings.tsx` — 569 lines**

Project settings view. Analyze:
- How many distinct setting sections?
- Could sections be individual components?
- Does it handle its own API calls or delegate to the store?

**`codaScopeCodeMapService.ts` — 606 lines**

Code map generation. Analyze:
- Is the file tree generation logic separable from the staleness detection?
- Could the markdown formatting be extracted?

**`codaScopeBuildStateService.ts` — 532 lines**

Build state tracking. Analyze:
- Is the in-memory + disk dual-layer appropriately implemented?
- Could the disk persistence logic be extracted?

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

- **SSE streaming**: Is the `fetch` + `ReadableStream` + line-based parsing pattern duplicated across multiple components? Could it be a shared utility?
- **API call patterns**: Do views duplicate similar fetch/error-handling patterns? Could there be a shared `codaScopeApi.ts` transport layer?
- **List views**: `GoldenRules.tsx`, `ConceptExplorer.tsx`, `SkillsManager.tsx` are all CRUD list views. Do they share a common pattern that could be abstracted?
- **CSS patterns**: Between `codascope.css` (2152 lines) and `CodaScopeAssistant.css` (732 lines), are there duplicated card, list, or panel patterns?
- **Empty state rendering**: Multiple views should show empty states with an icon, title, and description. Is the pattern consistent or duplicated?

### 3.4 Over-Abstraction

Identify abstractions that add indirection without benefit:
- Is `contextAssembler.ts` (107 lines) doing enough to justify a separate file, or could it be inlined?
- Is `codaScopeActionParser.ts` (104 lines) appropriately scoped or over-engineered for its purpose?
- Does `codaScopeCommandLoader.ts` have abstraction layers that only serve one caller?
- Are there service functions that just forward to another service without adding value?

### 3.5 CSS Consolidation

With **2884 total CSS lines** across two files:
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
- **Level 5 (Agent Intelligence):** Does the tool set table match `codaScopeAgentService.ts`? Are all tools listed? Are the action types still valid?
- **Level 6 (Code Map Service):** Does the staleness model match `codaScopeCodeMapService.ts`?
- **Level 7 (Wiki State):** Do the depth metrics match `codaScopeWikiStateService.ts`?
- **Level 8 (Command Framework):** Does the variable table match `codaScopeCommandLoader.ts`?
- **Level 9 (Supporting Services):** Does the service table match reality?
- **Level 10 (Backend Infrastructure):** Is the build state persistence and SSE streaming description accurate?

### 4.2 AGENTS.md Accuracy

Compare `AGENTS.md` against the actual codebase:

- **Design Philosophy section:** Still matches ARCHITECTURE.md Level 0.5?
- **Critical Rules:** All 8 rules still valid and followed?
- **File Organization table:** Does the "Where" column match reality?
- **Patterns to Follow:** All patterns still relevant?
- **Testing Checklist:** Complete and achievable?
- **Common Mistakes:** All 7 items still relevant? Any new ones to add?

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

In `codaScopeRoutes.ts` (1722 lines):
- Do route handlers validate incoming request bodies?
- Are there routes that accept arbitrary payloads without validation?
- Are error responses consistent (status codes, error shapes)?

### 5.3 SSE Event Contract

The SSE streaming events are a contract between server and client. Verify:
- Are the event types (`run-started`, `data`, `wiki-refresh`, `done`, `error`) consistent between `codaScopeRoutes.ts` and the frontend SSE parsers in `ProjectDashboard.tsx` and `CodaScopeAssistant.tsx`?
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

Verify this separation in `codaScopeAgentService.ts`:
- Are read-only tools correctly identified?
- Are write tools excluded from chat/assistant mode?
- Could a prompt injection cause the chat agent to invoke write tools?

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
- `codaScopeRoutes.ts` (1722 lines) — API contract enforcement
- `codaScopeAgentService.ts` (800 lines) — agent orchestration
- `codaScopeBuildStateService.ts` (532 lines) — state persistence
- `codaScopeChatService.ts` (509 lines) — conversation lifecycle
- `codaScopeActionParser.ts` (104 lines) — action tag extraction (critical for safety)

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
