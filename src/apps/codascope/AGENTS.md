# CodaScope — Development Guidelines

> Rules and conventions for AI agents working on the CodaScope application within AIShell.

---

## Architecture Reference

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) **first** — it is the progressive-disclosure source of truth for the entire CodaScope system. Stop reading when you have enough context for your task.

For shell-level patterns (design tokens, URL routing, app manifest), see the [AIShell AGENTS.md](../../.agents/AGENTS.md).

---

## Design Philosophy

These principles are **non-negotiable**. They shaped every architectural decision. Read [`ARCHITECTURE.md` Level 0.5](ARCHITECTURE.md#level-05--design-philosophy) for the full rationale.

1. **Chat is a sidekick, not a destination.** It lives in the right panel — never add a routed `ChatView.tsx`.
2. **Act when the directive is clear.** The agent uses its scoped write tools for explicit requests and asks one concise question only when essential intent or required details are genuinely ambiguous. Successful mutations must surface a completed-operation card backed by the tool result.
3. **Context is automatic.** The system injects what the user is viewing. No manual "add to context" flows.
4. **Manifest + tools, not content dumping.** Inject ~500 tokens of *what exists*. Let the agent tool-call for full content.
5. **Intelligence before infrastructure.** Smarter context > more features.

## Critical Rules

### 1. Icons — SVG Only, No Emoji ⚠️ MOST VIOLATED RULE

CodaScope uses **conceptual inline SVG icons**, never emoji or icon fonts. All icons live in [`CodaScopeIcons.tsx`](components/CodaScopeIcons.tsx).

**BEFORE writing any JSX**, check if the icon you need already exists in `CodaScopeIcons.tsx`. Common icons: `IconDelete`, `IconClose`, `IconCheck`, `IconLaunch`, `IconRefresh`, `IconSearch`, `IconFile`, `IconUpload`, `IconDownload`, `IconWarning`, `IconSparkle`.

```
✅  Import { IconDelete } from "./components/CodaScopeIcons"
✅  <IconDelete size={14} />

❌  "🗑️"  "🖨️"  "📐"  "📝"  "🔍"  "⚡"  — NO emoji in JSX
❌  Using icon libraries (lucide, heroicons, font-awesome)
❌  Inline <svg> elements outside CodaScopeIcons.tsx
```

**Pre-submit check**: Before finishing any component work, run:
```bash
grep -rn '[🗑📐🖨📝🔍⚡🔄💡🎯📊📋🚀✨🛠️🧹]' src/apps/codascope/ --include='*.tsx'
```
If any hits exist outside `CodaScopeIcons.tsx`, fix them before submitting.

When adding a new icon:
- Add it to `CodaScopeIcons.tsx` as a named export
- Use `viewBox="0 0 16 16"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth="1.5"`
- Use `strokeLinecap="round"`, `strokeLinejoin="round"`
- Keep forms geometric and minimal — never photorealistic or skeuomorphic

### 2. CSS — Namespaced, Token-Only

- **Prefix all classes** with `codascope-` (e.g., `codascope-wiki-tree`, `codascope-action-card`)
- **Never hard-code colors** — use shell design tokens: `--color-*`, `--space-*`, `--text-*`, `--radius-*`
- Primary styles go in `codascope.css`; assistant-specific styles in `CodaScopeAssistant.css`; notes styles in `codascope-notes.css`
- Dark theme is assumed (inherited from shell `:root` tokens)

### 3. State Management — Zustand + URL

- **Zustand store** (`useCodaScopeStore.ts`) for application state (projects, topics, agent status)
- **URL segments** via `useAppSubRoute("codascope")` for view routing — never use internal state for navigation
- Don't duplicate server state in the Zustand store; fetch from API as needed

### 4. SSE Streaming — ReadableStream Pattern

All streaming uses `fetch` + `ReadableStream`, **not** `EventSource`. Use the shared `codaScopeSseClient.ts` module:

```typescript
import { connectToSseStream } from "../codaScopeSseClient";

const controller = connectToSseStream(url, {
  onText: (text) => { /* handle streaming text */ },
  onDone: (summary) => { /* handle completion */ },
  onError: (error) => { /* handle error */ },
  onPipelineStep: (step) => { /* handle pipeline progress */ },
});
```

Do not duplicate the SSE parsing logic — always import from `codaScopeSseClient.ts`.

> **Exception**: `artifactApi.ts` uses the browser-native `EventSource` API for GET-based SSE polling of artifact build status. This is an acceptable deviation because `connectToSseStream` is designed for POST-based SSE streams, while the artifact status endpoint is a GET-only polling endpoint.

### 5. Backend Services — Single Responsibility

Each service file has one clear domain:
- Don't add unrelated functionality to an existing service
- Services are instantiated per-import (module singletons), not dependency-injected

### Filesystem Path Safety and Destructive Operations

- Treat every route parameter, tool argument, imported metadata field, and
  persisted identifier as untrusted before it influences a filesystem path.
  Route and tool code must call the owning service; never join an external ID
  into a storage path directly or duplicate a weaker validator at the edge.
- Use the shared `codaScopePathSafety.ts` contract. Values such as epic,
  document, artifact, source, wiki-page, conversation, run, curation, skill,
  version-directory, and filename IDs occupy exactly one safe segment. Reject
  empty, dot, traversal, separator, encoded-separator, NUL, absolute, and
  Windows drive-qualified forms; do not normalize them into another value.
  Numeric design/epic version identifiers must be positive safe integers;
  validate persisted indexes, reject duplicates, and never interpolate an
  unvalidated version value into a file or directory name.
- Note paths, folder paths, repository source paths, and other intentionally
  nested values use the contained-relative-path contract. Do not replace that
  contract with single-segment validation, and never use string-prefix checks
  as proof of containment.
- Delete, recursive remove, move, overwrite, and atomic publication targets
  must be proven strict descendants of the expected storage root. Equality
  with the root is always an error.
- Bundle imports must validate staged entry paths and path-backed JSON IDs
  before atomic publication. Imports and assistant tools may not bypass the
  same service boundary used by HTTP routes.
- Hostile path tests create isolated temporary roots and sentinel files only.
  Never aim traversal/destructive tests at this checkout, configured CodaScope
  data, a user's home directory, or shared fixtures.

### Notes Documents and Priority

- A personal star belongs only in that user's `_notes/_user-prefs` data. Never
  write a star into shared note frontmatter or a document manifest.
- A shared pin is durable, portable metadata and every pin/unpin must carry an
  authenticated actor into the note audit log. Client content saves may not
  author pin fields.
- Document blobs live only inside the owning note's existing `.assets`
  bundle. Do not add direct filesystem move/rename endpoints or a competing
  document transfer flow; `CodaScopeNoteTransferService` remains the external
  note/folder move pipeline.
- Every document route and agent tool resolves the parent note using the
  authenticated principal. Do not accept an effective user ID from a client,
  prompt, or tool argument. Agent pool/tool closures must be actor-scoped
  before a private document path is returned.
- Export records are short-lived and bound to their authenticated creator;
  never treat an export ID as a reusable download credential.
- Annotation mutations derive the actor server-side. Validate status
  transitions and do not accept client-supplied reaction users or arbitrary
  whole-reaction-array replacement.
- Use `registerProjectDir(id, path)` pattern when the service needs to resolve project directories

### Portable Projects and Projects-Root Custody

- Ordinary project export is a versioned, allowlisted portable bundle of
  shared artifacts. Never archive the project directory wholesale. Exclude
  conversations and images, private notes/documents, `_user-prefs`, build
  logs, active locks, actor-owned exports, secrets, and machine-local
  repository paths.
- Project import accepts only the current manifest format, rejects unexpected
  entries, stages and validates the complete ZIP before atomic installation,
  and leaves repository paths empty for explicit remapping. Legacy raw project
  exports are unsupported through the ordinary import route.
- Only administrators may read or change the absolute projects-root path.
  Ordinary users may receive only configured/not-configured status. Standalone
  mode remains configurable because its injected local principal is an admin.
- A root change replaces the complete root-bound service graph. It must cancel
  active SDK runs, close pooled agents and their tool closures, invalidate
  build/export/cache state, and stop cleanup timers before publishing the new
  graph. Do not restore scattered `setRoot()` cutovers.

### 6. Agent Prompt Templates

Commands in `commands/` are markdown files with `{{VARIABLE}}` placeholders:
- Use existing variables from `codaScopeCommandLoader.ts` when possible
- Unresolved variables are left as-is intentionally (the agent can see them)
- Framework commands ship in source; project-specific commands go in `<projectDir>/skills/`

### 7. Conversation Storage — Atomic Writes

The chat service uses temp-file → rename for crash safety:
```
write to: <path>.tmp.<random>
rename:   <path>.tmp.<random> → <path>
```
Always follow this pattern when adding write operations to conversation files.

Conversation custody is per user. Every new conversation receives its `ownerId`
from the authenticated route principal; never accept an owner or effective-user
identifier from the client. Service calls for list/read/update/delete/messages
and chat images must receive that actor and return generic absence when the
conversation is not theirs. Ownerless records are legacy data: ordinary users
must not see or self-claim them. Only the administrator migration endpoints may
list them and assign a target account after validating it through AIShell auth.
Epic conversations follow the same rule and are per-user, not project-shared.

Projects, epics, and notes marked `shared` use CodaScope's current global
shared-content policy: every authenticated CodaScope user may access them.
This is intentional and is not a project or epic membership/role ACL. Keep
private note data and conversations actor-custodied; do not infer a future
shared-conversation policy from the globally shared project content.

### 8. Agent Intelligence Model

The chat agent is built on a **manifest + tool use** architecture:

- The agent receives a **lightweight manifest** (~500 tokens) — project name, repo list, wiki topic titles, build status, and freshness timestamps
- The agent has **read-only tools** to fetch full content on demand (wiki pages, code maps, etc.)
- The agent **decides what to read** based on the user's question — it is not force-fed content
- **Tool safety**: assistant/chat = ALL tools (full autonomy — read + write + epic + artifact). Wiki-build = read + write. Curation/research = read + epic tools. Artifact-build/regen = read + artifact tools.

When extending agent capabilities:
- Add new action types to `VALID_ACTION_TYPES` in `codaScopeActionParser.ts`
- Add corresponding card rendering in `ActionCard.tsx`
- Pending UI-only actions dispatch through existing CodaScope APIs. Successful mutation tools emit completion tags; do not use an action card to defer an explicit write request.
- New tools go in `buildReadOnlyTools()`, `buildEpicTools()`, `buildWriteTools()`, or `buildArtifactTools()` in the `tools/` subdirectory under `server/services/tools/`
- Artifact tools (`write_artifact_html`, `read_artifact_html`, `read_epic_context`) are in `buildArtifactTools()`
- Tool safety: assistant/chat = ALL tools (read + write + epic + artifact). Wiki-build = read + write. Curation/research = read + epic. Artifact-build/regen = read + artifact.
- Agent purposes are an allowlist. Unknown purposes must fail closed and never
  inherit the assistant/chat tool set.
- Update `do_chat.md` system prompt with new tool descriptions and behavioral guidance

### 9. Wiki-Build Storage Custody

- A `wiki-build` agent's native workspace is the CodaScope project directory,
  never a configured source repository. Keep the Cursor SDK sandbox enabled for
  that purpose when supported; on hosts that explicitly report sandbox
  unsupported, the service may retry with sandboxing explicitly disabled while
  retaining the project cwd and scoped source tools.
- Source repositories are read through `list_source_files` and
  `read_source_file`, which resolve only configured repositories and reject
  traversal. Do not restore direct native repository access to build agents.
- Build output must use `write_code_map` and `write_project_wiki_topic`; those
  tools store output under the CodaScope project and make it visible to the UI.
  Do not instruct an agent to write `wiki/*.md` or `code_map_*.md` directly.
- A full wiki build with zero substantive registered topics is a build error,
  not a successful no-op.
- Legacy repository pollution is recovered only through the explicit
  generated-wiki recovery action. It previews and stashes only `wiki/**` and
  root `code_map_*.md` changes after a fingerprinted, typed confirmation;
  never automatically stash or discard arbitrary repository work.

---

## File Organization

| What | Where |
|------|-------|
| New view component | `views/<ViewName>.tsx` |
| New reusable component | `components/<ComponentName>.tsx` |
| New custom React hook | `hooks/use<HookName>.ts` |
| New agent command | `commands/do_<action>.md` |
| New agent tool definition | `server/services/tools/codaScope<Domain>Tools.ts` |
| New backend service | `server/services/codaScope<Domain>Service.ts` |
| New API endpoints | Add to the appropriate domain route file in `server/routes/codaScope*Routes.ts` |
| New artifact component | `components/artifact-viewer/<ComponentName>.tsx` |
| New artifact hook | `components/artifact-viewer/hooks/use<HookName>.ts` |
| New artifact service | `server/services/codaScopeArtifact*Service.ts` |
| Artifact API endpoints | `server/routes/codaScopeArtifactRoutes.ts` |
| New slash commands | `commandRegistry.ts` |
| New styles | Add to `codascope.css` (or `CodaScopeAssistant.css` for assistant, `codascope-notes.css` for notes) |
| New icons | Add to `components/CodaScopeIcons.tsx` |

---

## Design Doc Development Rules

### Chat-Driven Creation (No Templates)

Design documents are created and edited via the chat assistant, not through templates. The flow is:

1. Agent uses `create_design_doc` / `edit_design_doc` / `edit_design_doc_section` tools
2. SSE action tags (`design_doc_created`, `design_doc_edited`) trigger frontend auto-navigation and diff highlighting
3. Users can select text → "Edit with Agent" for targeted edits

### Version History

Every design doc edit (agent or manual) creates a version snapshot:

- Versions are stored per-doc in `<docId>/versions/v001.md`, `v002.md`, etc.
- Max 10 versions per doc — oldest are pruned automatically
- Reverting creates a NEW version (so reverts themselves are undoable)
- The "Undo" button in DocumentEditor toolbar appears after agent edits

When modifying the design doc service:
- Always use `docPath()` which handles storage migration transparently
- Never read/write to `<docId>.md` directly — use the service methods
- Version creation is best-effort (wrapped in try/catch in tools and routes)

### Storage Layout

```
<docId>/
  content.md        (current content)
  versions/
    v001.md         (snapshot before each write)
    versions.json   (metadata: number, author, summary, wordCount)
```

Legacy flat-file docs (`<docId>.md`) are migrated to `<docId>/content.md` on first access.

---

## Patterns to Follow

### Empty States

Every view must handle the empty case with:
1. An icon from `CodaScopeIcons`
2. A descriptive title
3. Explanatory text or a call-to-action

### Error States

- Wrap all `fetch` calls in try/catch
- Surface errors as user-readable messages, not raw HTTP status codes
- For agent runs: emit `error` SSE event, don't silently fail

### Wikilinks

Wiki content uses Obsidian-style `[[topic-id]]` wikilinks. The client converts these to internal routes:
```
[[auth-flow]] → /codascope/project/<id>/wiki/auth-flow
```

### Build Pipeline Steps

When adding new pipeline steps:
1. Add SSE event types to the frontend pipeline visualization in `ProjectDashboard.tsx`
2. Add the step to the route handler's `analyze` flow in `codaScopeBuildRoutes.ts`
3. Create a command template in `commands/`

### Agent Context Awareness

- The `contextAssembler.ts` tracks a ring buffer of the user's last 5 view visits
- Each message stores a context snapshot (view, topicId, recentViews) for multi-turn awareness
- The manifest is built in the **route handler** (not the agent service) by querying lightweight data from each service
- Freshness timestamps let the agent flag stale data proactively
- Don't inject full content into the manifest — that defeats the tool-use strategy

---

### Help System Content Sync

CodaScope has a discoverability system (slash command palette + guide modal).
The canonical source of truth for available commands is
[`commandRegistry.ts`](commandRegistry.ts).

When modifying commands, action types, or agent capabilities:
1. Update `commandRegistry.ts` (slash commands, categories, descriptions)
2. Update the guide modal content in `CodaScopeGuideModal.tsx` (if a new
   capability category is added)
3. Update the self-awareness section in `commands/do_chat.md`

The guide modal reads from the command registry for the Chat Agent tab,
so individual command changes are automatically reflected. Only structural
changes (new categories, new tabs) require manual guide modal updates.

---

## Testing Checklist

Before marking work as complete:

- [ ] Server compiles without errors (`npm run build` or TypeScript check)
- [ ] Dev server starts cleanly (`npm run dev`)
- [ ] New views are reachable via URL routing
- [ ] SSE streams connect and display output
- [ ] Empty states render correctly
- [ ] Dark theme looks correct (no hard-coded colors)
- [ ] Agent runs can be cancelled without leaving orphan processes

---

## Common Mistakes to Avoid

1. **Adding a `ChatView.tsx`** — Chat is the right-panel assistant, not a routed view
2. **Using emoji in new components** — Always use SVG icons from `CodaScopeIcons`
3. **Hard-coding colors** — Use design tokens from the shell
4. **Storing navigation state in Zustand** — Use `useAppSubRoute` URL segments
5. **Using `EventSource` for SSE** — Use `fetch` + `ReadableStream` (supports POST, headers, cancellation)
6. **Modifying conversation files without atomic writes** — Always use temp → rename pattern
7. **Adding agent actions without updating the parser** — Both `codaScopeActionParser.ts` AND `ActionCard.tsx` need updates
8. **Using `codascope-btn--primary` (BEM double-dash)** — Use flat single-dash convention: `codascope-btn-primary`, `codascope-btn-danger`, `codascope-btn-sm`
9. **Duplicating SSE parsing logic** — Always import from `codaScopeSseClient.ts`, never inline
10. **Not updating `do_chat.md` Available Actions** — When adding new action types to the parser and ActionCard, also update the Available Actions section in `do_chat.md` so the agent knows about them
11. **Not wiring agent prompts for new purposes** — Adding a purpose to `AgentPurpose` is not enough; the command loader must also load the corresponding `do_*.md` prompt file and the route handler must assemble the prompt and create the `agentCallback`
