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
2. **Propose, don't execute.** The agent suggests actions via cards. The user clicks to confirm. No autonomous execution.
3. **Context is automatic.** The system injects what the user is viewing. No manual "add to context" flows.
4. **Manifest + tools, not content dumping.** Inject ~500 tokens of *what exists*. Let the agent tool-call for full content.
5. **Intelligence before infrastructure.** Smarter context > more features.

## Critical Rules

### 1. Icons — SVG Only, No Emoji

CodaScope uses **conceptual inline SVG icons**, never emoji or icon fonts. All icons live in [`CodaScopeIcons.tsx`](components/CodaScopeIcons.tsx).

```
✅  Import { IconSomething } from "./components/CodaScopeIcons"
❌  Using 📝 🔍 ⚡ emoji in JSX (except inside ActionCard.tsx which is legacy)
❌  Using icon libraries (lucide, heroicons, font-awesome)
```

When adding a new icon:
- Add it to `CodaScopeIcons.tsx` as a named export
- Use `viewBox="0 0 16 16"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth="1.5"`
- Use `strokeLinecap="round"`, `strokeLinejoin="round"`
- Keep forms geometric and minimal — never photorealistic

### 2. CSS — Namespaced, Token-Only

- **Prefix all classes** with `codascope-` (e.g., `codascope-wiki-tree`, `codascope-action-card`)
- **Never hard-code colors** — use shell design tokens: `--color-*`, `--space-*`, `--text-*`, `--radius-*`
- Primary styles go in `codascope.css`; assistant-specific styles in `CodaScopeAssistant.css`
- Dark theme is assumed (inherited from shell `:root` tokens)

### 3. State Management — Zustand + URL

- **Zustand store** (`useCodaScopeStore.ts`) for application state (projects, topics, agent status)
- **URL segments** via `useAppSubRoute("codascope")` for view routing — never use internal state for navigation
- Don't duplicate server state in the Zustand store; fetch from API as needed

### 4. SSE Streaming — ReadableStream Pattern

All streaming uses `fetch` + `ReadableStream`, **not** `EventSource`:

```typescript
const res = await fetch(url, { method: "POST", ... });
const reader = res.body!.getReader();
const decoder = new TextDecoder();
// ... read loop with line-based SSE parsing
```

### 5. Backend Services — Single Responsibility

Each service file has one clear domain:
- Don't add unrelated functionality to an existing service
- Services are instantiated per-import (module singletons), not dependency-injected
- Use `registerProjectDir(id, path)` pattern when the service needs to resolve project directories

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

### 8. Agent Intelligence Model

The chat agent is built on a **manifest + tool use** architecture:

- The agent receives a **lightweight manifest** (~500 tokens) — project name, repo list, wiki topic titles, golden rule names, concept names, quality score, build status, and freshness timestamps
- The agent has **read-only tools** to fetch full content on demand (wiki pages, quality reports, code maps, etc.)
- The agent **decides what to read** based on the user's question — it is not force-fed content
- **Tool safety**: assistant/chat = read-only tools only. Wiki-build = read + write tools. Never mix these.

When extending agent capabilities:
- Add new action types to `VALID_ACTION_TYPES` in `codaScopeActionParser.ts`
- Add corresponding card rendering in `ActionCard.tsx`
- Actions must dispatch through existing CodaScope APIs — never bypass the API layer
- New tools go in `buildReadOnlyTools()` or `buildWriteTools()` in `codaScopeAgentService.ts`
- Update `do_chat.md` system prompt with new tool descriptions and behavioral guidance

---

## File Organization

| What | Where |
|------|-------|
| New view component | `views/<ViewName>.tsx` |
| New reusable component | `components/<ComponentName>.tsx` |
| New agent command | `commands/do_<action>.md` |
| New backend service | `server/services/codaScope<Domain>Service.ts` |
| New API endpoints | Add to `server/routes/codaScopeRoutes.ts` |
| New styles | Add to `codascope.css` (or `CodaScopeAssistant.css` for assistant) |
| New icons | Add to `components/CodaScopeIcons.tsx` |

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
2. Add the step to the route handler's `analyze` flow in `codaScopeRoutes.ts`
3. Create a command template in `commands/`

### Agent Context Awareness

- The `contextAssembler.ts` tracks a ring buffer of the user's last 5 view visits
- Each message stores a context snapshot (view, topicId, recentViews) for multi-turn awareness
- The manifest is built in the **route handler** (not the agent service) by querying lightweight data from each service
- Freshness timestamps let the agent flag stale data proactively
- Don't inject full content into the manifest — that defeats the tool-use strategy

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
