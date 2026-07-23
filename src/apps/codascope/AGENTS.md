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
- **Never hard-code UI colors** — `src/styles/01-tokens.css` is the
  authoritative color-token boundary. Use its `--color-*` and `--shadow-*`
  properties directly, or use `color-mix()` whose color inputs are shell
  tokens and allowed CSS keywords such as `transparent` and `currentColor`.
- Do not add literal hexadecimal, `rgb[a]()`, `hsl[a]()`, `hwb()`, `lab()`,
  `lch()`, `oklab()`, `oklch()`, `color()`, or opaque named visual colors to
  CodaScope UI styles. Literal color fallbacks such as
  `var(--color-danger, #f87171)` are also forbidden; a missing shell token must
  fail the automated audit instead of being concealed.
- A repeated CodaScope-only semantic may use a `--codascope-*` alias only when
  the alias is defined from authoritative shell tokens or token-based
  `color-mix()`. Define it where main content, navigation, notes, assistant
  panels, and modals can all inherit it. Never create an app-specific
  `--color-*` property.
- Persisted content colors are the narrow exception: the user-authored
  highlight/text palettes in `NoteFormattingToolbar.tsx`, configurable
  highlight values and the native color-input default in `Settings.tsx`,
  persisted-markup test fixtures, and `manifest.tsx` accent metadata retain
  literal values. Do not reuse those exceptions for UI chrome.
- Primary styles go in `codascope.css`; assistant-specific styles in `CodaScopeAssistant.css`; notes styles in `codascope-notes.css`
- Dark theme is assumed (inherited from shell `:root` tokens)
- `codaScopeStyleTokens.test.ts` audits all three stylesheets, shell-token
  resolution, token-derived CodaScope aliases, CSS fallbacks, and
  color-bearing TS/TSX properties. Its AST pass follows statically resolvable
  local constants and retains only the exact persisted-content/native-picker
  allowlist. Run it for every CodaScope color change.

When a new semantic color is needed, first map it to the existing accent,
status, text, surface, or border tokens. Use a token-based `color-mix()` for
translucency or a state variation. Add a shell token only when the concept is
genuinely AIShell-wide, cannot be expressed clearly from existing tokens, and
is documented and covered by the shell/CodaScope token contract.

### 3. State Management — Zustand + URL

- **Zustand store** (`useCodaScopeStore.ts`) for application state (projects, topics, agent status)
- **URL segments** via `useAppSubRoute("codascope")` for view routing — never use internal state for navigation
- Don't duplicate server state in the Zustand store; fetch from API as needed

### 4. SSE Streaming — ReadableStream Pattern

All streaming uses `fetch` + `ReadableStream`, **not** `EventSource`. Use the shared stateful parser and transport in `codaScopeSseClient.ts`:

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

The transport contract is strict:

- `done` is the only standard success terminal; `error` is failure and
  `cancelled` is cancellation, never success.
- A stream must emit exactly one standard terminal and then close. EOF before
  a terminal, an incomplete trailing record, or a malformed terminal payload
  is a transport failure.
- Caller abort is silent transport cleanup. It must not call `onDone` or be
  converted into a user-facing network error. A server `cancelled` event uses
  `onCancelled` and must never fall back to success.
- Custom/domain events such as `research-complete` are progress only. Consume
  them through `onEvent`; never add another byte, line, or chunk parser.
- Promise consumers use `startSseStream(...).completion`; callback consumers
  use `connectToSseStream()`. Both share the same parser, HTTP error handling,
  terminal validation, decoder flush, and unexpected-EOF behavior.
- On the server, every route family has one terminal owner and uses the
  exactly-once writer in `server/routes/utils/ssePipelineHelper.ts`. Exceptions
  after SSE headers are sent must become an `error` event before closure.

> **Exception**: `artifactApi.ts` intentionally retains browser-native
> `EventSource` for its GET-only artifact status subscription and automatic
> connection lifecycle; it is the only CodaScope streaming exception.
> Its domain status still fails closed: only `complete` succeeds; `idle`,
> malformed data, timeout, connection loss, and `error` all fail.

### 5. Backend Services — Single Responsibility

Each service file has one clear domain:
- Don't add unrelated functionality to an existing service
- Services are instantiated per-import (module singletons), not dependency-injected

### Build Pipeline Dependency Direction

- `codaScopeBuildOrchestrator.ts` (standard analyze and epic-deepen) and
  `codaScopeDeepRunOrchestrator.ts` (Deep Run) are sibling pipeline modules.
  Neither may import, dynamically import, or re-export the other.
- `codaScopeBuildRoutes.ts` is their composition root. It must import every
  pipeline entry point directly from the module that owns it; do not use one
  orchestrator as a barrel for another or introduce a replacement barrel.
- `codaScopeBuildPipelineShared.ts` is the leaf shared by the siblings. It owns
  the neutral build-pipeline callback/core-service contracts and the pure
  token-usage and substantive-wiki-topic helpers. Its service imports remain
  type-only, and it must not depend on orchestrators, routes, or service
  composition.
- Analyze-only optional services stay in the build orchestrator. Future
  pipelines must expose their own options and entry point from their owning
  module and be composed through a direct route import.
- Preserve terminal ownership when changing pipeline structure: Analyze,
  Deep Run, and epic-deepen orchestrators own normal `done`/`cancelled`
  emission after build-state persistence; routes own thrown-error and
  missing-terminal fail-closed handling through the exactly-once writer.

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

### Authoritative JSON Persistence

- Never interpret malformed or structurally invalid persistent JSON as empty
  state. Only a genuinely missing, explicitly uninitialized file may use a
  documented default; preserve corrupt bytes for operator repair.
- Never directly overwrite authoritative JSON. Use
  `codaScopePersistence.ts` for strict reads and same-directory atomic
  replacement.
- Hold the canonical mutation-coordinator key across the complete
  read-validate-modify-write operation. Epic lifecycle and epic import share
  the project `epics/` key; epic-version creation uses that same key because it
  replaces `epic.json`; annotations use a per-epic key; design versions use a
  per-document key.
- Validate persisted `projectId` and `id` values against their requested
  project and storage directory before mutation. Indexed-but-missing metadata,
  required content, or snapshot files are `persistence_corrupt`, never empty
  content or not-found.
- Never prune snapshots, permanently delete an epic, or discard old state
  before the replacement authoritative index is durable. Use staging,
  tombstones, ordering, and bounded rollback; do not claim multi-file ACID.
- Persistence tests must inject write, flush/close, rename, index-publication,
  and metadata-publication failures and verify the prior bytes, directories,
  and queued mutations remain usable.
- The mutation coordinator assumes one AIShell server process. Direct external
  writers and multiple server processes are unsupported.

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

### Epic Annotation Identity and Recovery

- Epic annotation identity is a service boundary. Routes derive human actors
  from `principal(req).username`; agent tools carry the initiating `actorId`
  and record agent provenance separately. Never accept an annotation author,
  owner, reaction username, provenance, or effective actor from a client.
- Only an owned annotation's author may edit its body or delete it. Enforce
  this inside `CodaScopeAnnotationService`, and return the same generic absence
  for unauthorized and missing body edits/deletes.
- Never recursively delete another actor's replies. Remove an owned leaf, or
  retain a visible deleted-comment tombstone when descendants still exist.
- Status is collaborative root-thread state. Enforce the transition table in
  the service and apply root transitions to every descendant; replies cannot
  transition independently. Version-2 persistence requires every descendant
  status to equal its root, while legacy migration normalizes descendants to
  the preserved root status.
- Annotation IDs form one epic-wide namespace across all document sidecars.
  Read the strict epic catalog under the annotation mutation key before any
  creation or ID-based mutation; cross-file duplicates are corruption, never
  first-file-wins lookup behavior.
- Reactions are actor-bound add/remove operations unique by emoji and username.
  Whole-array replacement is forbidden.
- Never silently reattach an epic annotation by nearby line, substring,
  section, or fuzzy scoring. Only the exact stored block ID is attached.
  Detached threads remain visible as `needs_review` or `orphaned` and move only
  through an explicit, current-content-hash-checked reattachment. Reattachment
  must coordinate with the definition/design writer's mutation key so a save
  cannot interleave between hash verification and annotation publication.
- Preserve and expose complete legacy thread graphs recursively in deterministic
  parent-before-child order. Status, attachment, deletion, and reattachment
  operations cover every descendant.
- Every assistant, chat, research, or curation agent that receives epic mutation
  tools must carry the authenticated initiating actor through `agentSvc.send()`;
  fail before agent creation when no actor exists.
- Epic annotation schema migration, reconciliation, reactions, deletes, and
  reattachment all use `codaScopePersistence.ts` under the per-epic annotation
  mutation key. Malformed or unknown-version files are preserved unchanged.

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

Design documents are fully written or generated markdown documents created and
edited through the chat assistant. Document archetypes such as API
specifications, data models, system designs, user flows, and decision records
may guide their structure, but CodaScope has no design-template catalog,
stable template IDs, template picker, or template-selection API. The flow is:

1. Agent reads the current epic definition, scope, existing designs, and relevant research context
2. Agent drafts substantial, complete markdown and uses `create_design_doc(epicId, title, content)` for an explicit creation request
3. Agent uses `edit_design_doc` / `edit_design_doc_section` for later changes
4. SSE action tags (`design_doc_created`, `design_doc_edited`) trigger frontend auto-navigation and diff highlighting
5. Users can select text → "Edit with Agent" for targeted edits

The optional persisted `EpicDesignDoc.template` field is legacy/import
compatibility metadata only. Preserve it when reading, editing, or bundling old
documents, but never accept it as a new creation input or present it as an
available design capability.

### Version History

Every design doc edit (agent or manual) creates a version snapshot:

- Versions are stored per-doc in `<docId>/versions/v001.md`, `v002.md`, etc.
- Max 10 versions per doc — oldest are pruned automatically
- Reverting creates a NEW version (so reverts themselves are undoable)
- The "Undo" button in DocumentEditor toolbar appears after agent edits

When modifying the design doc service:
- Always use `docPath()` which handles storage migration transparently
- Never read/write to `<docId>.md` directly — use the service methods
- Versioned edits use the service-owned combined mutation boundary; callers
  must never call `createVersion()` and `updateDesignDoc()` as separate edit
  steps
- Combined design mutations acquire the epic `designs/` key before the
  per-document version key. Revert and destructive resize/delete operations
  use that same order.
- Optimistic hash validation happens inside the combined lock before snapshot
  publication. A conflict creates no version and does not prune history.
- After hash validation, a byte-identical versioned update is a no-op: do not
  update metadata, create a snapshot, or prune.
- `applyResizeMetadata()` derives version behavior from the operation type:
  deletes require author/summary metadata, while cosmetic resizes reject it.

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
