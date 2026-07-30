# Music Creator — Development Guidelines

> App-specific rules for AI agents and humans working in `src/apps/music-creator/`.

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first for routing, file layout, and data model. Stop when you have enough context for your task.

Shell-level patterns: [APP_DEVELOPMENT_GUIDE.md](../../APP_DEVELOPMENT_GUIDE.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md) (Levels 0–3).

---

## How to use this file

**`ARCHITECTURE.md`** = what the system is (progressive disclosure, design decisions).

**`AGENTS.md`** (this file) = how to work on it safely (conventions, verification checklists, common mistakes).

---

## Current progress

| Milestone | Status | Scope |
| --------- | ------ | ----- |
| **M2** | Complete | Persistence, hub CRUD, recovery UX, Vitest |
| **M3** | Complete | Studio sequencer UI, explicit Save, leave guard |
| **M4** | Complete | Tone.js playback, playhead, live edits, dispose lifecycle |
| **M5** | Complete | QA audit, doc sync, bar-divider polish |
| **MVP** | **Complete** | POC ready — stretch goals listed in ARCHITECTURE Level 7 |
| **Post-MVP** | **Partial** | Shell topbar transport via `headerItems` + `studioSession` (shipped) |

---

## Design principles (stable)

1. **URL is the router** — Hub vs Studio via `useAppSubRoute("music-creator")`; never hand-roll `pushState` without preserving shell query params.
2. **React state in the app tree** — No app-local Zustand. Hub/Studio use component state and props. Tone synth nodes live in `audioEngine` module singleton, never in React state or `localStorage`.
3. **Explicit save in Studio** — Autosave is post-MVP. Studio edits stay in `workingCopy` until Save. **Hub rename/duplicate/delete save immediately** via `saveStore`.
4. **Typed storage results** — All persistence I/O returns `StorageResult<T>`; surface errors in UI banners. Do not silently catch like arcade storage.
5. **One envelope, one key** — `localStorage` key `music-creator:store`; shape `MusicCreatorStoreEnvelope`. No separate index/blob keys.
6. **Single tab** — No cross-tab sync; last-write-wins is acceptable for POC. Document, do not over-engineer.

### Post-MVP — do not add without explicit scope

App-local Zustand, command bus, autosave, global `Transport.cancel()`, sample-based drums, WAV export, undo stack.

---

## Conventions

### App identity

- **App ID:** `music-creator` (URL segment, manifest id, CSS prefix `music-creator-`)
- **Storage key:** `music-creator:store`
- **Session routing key:** `music-creator:session-project-ids` in `sessionStorage` — tracks project ids opened this tab for studio deep links

### Comments

Prefer readable code first, but **do not hesitate to comment** when you or a future reader might ask “why?” — especially while learning the app.

**Especially comment:**

- **Router and hub** (`MusicCreatorContent`, `ProjectHub`) — state variables, render branches, who owns persistence vs presentation
- **Studio** (`workingCopy`, dirty/Save, leave guard) — what lives in React vs disk
- **Audio** (`audio/*`) — factories vs engine ownership; `stop()` keeps synths, `dispose()` destroys them; never in React state
- **Timing / ordering** (e.g. `storeReady` before route guard, load does not rewrite disk)
- **Multi-step flows** (create → save → navigate; repair vs reset)
- **Intentional limitations** (shell leave without confirm on app switch / browser back)

**Usually skip:** Pure boilerplate JSX, obvious prop passthrough, restating what a line literally does.

**Style:** `//` for inline “why”; `/** … */` on exported helpers; a short block comment above each major hub state or render section is welcome.

**Recovery UX note:** Quota/corrupt-storage UI is defensive POC wiring — unlikely in normal use. Manual verify via DevTools when touching storage; no need to re-test every session.

### Routing

- Always `useAppSubRoute("music-creator")` for `navigate` / `replace` / segments.
- Bare `/music-creator` → `replace("projects")`.
- `/music-creator/studio` (no id) → `replace("projects")`.
- Unknown studio id → `replace("projects")` + one-shot “Project not found” banner.
- **Route lookup:** `isKnownProjectId(id, envelope)` checks `localStorage` first; session registry fallback for ids opened this tab

### Left nav

- Use shell **`nav-item` / `nav-item-icon` / `nav-item-label`** for every entry (including studio context). Custom nav blocks break collapsed mode.
- Add `title` when collapsed for icon-only tooltips.

### CSS

- Design tokens only (`--color-*`, `--space-*`, `--text-*`, `--radius-*`).
- Classes prefixed `music-creator-`.
- Styles in `music-creator.css`; import via `src/styles.css`.

### Icons

- Inline SVG in components (no emoji, no icon font libraries).

### Accessibility

- Shell owns document `<main className="shell">` — app views use `<div role="region" aria-labelledby="...">`, not nested `<main>`.
- `type="button"` on non-submit controls; visible `:focus-visible` on buttons, inputs, sliders, mute toggles, step cells.
- Sequencer cells are native `<button type="button">` with `aria-label` and `aria-pressed` — not ARIA grid/roving tabindex.
- Transport: `role="toolbar"`, labeled Play/Stop, tempo range with `<label>` + `aria-valuetext`.

### State ownership

| Concern | Owner |
| ------- | ----- |
| Project list, storage errors | Hub React state |
| `workingCopy`, `isDirty`, playback UI | Studio React state |
| Dirty comparison | `areStudioEditsEqual` in `project/projectUtils.ts` — derived from `workingCopy` vs saved baseline |
| Topbar transport snapshot + actions | `routing/studioSession.ts` — Studio publishes, header subscribes |
| URL route | `useAppSubRoute` |
| Persisted projects | `localStorage` envelope via `storage/` |
| Tone nodes, schedule ids | `audioEngine` module |

---

## File organization

| What | Where |
| ---- | ----- |
| Types, envelope, `StorageResult` | `types.ts` |
| STEPS, drum ids, melody MIDI, tempo bounds | `constants/music.ts` |
| Storage error copy | `constants/storageMessages.ts` |
| Blank project / empty store factories | `project/createProject.ts` |
| Hub list sort / date display | `project/sortProjects.ts`, `project/formatProject.ts` |
| Duplicate, rename, Studio Save | `project/projectUtils.ts` |
| Hub project row + dialogs | `components/ProjectCard.tsx`, `components/ConfirmDeleteDialog.tsx` |
| Studio transport + grids | `MusicCreatorHeaderItems.tsx`, `components/TransportBar.tsx`, `StepCell.tsx`, `DrumSequencer.tsx`, `MelodyGrid.tsx`, `MuteToggle.tsx` |
| Studio leave confirm | `components/ConfirmLeaveStudioDialog.tsx`, `routing/leaveGuard.ts` |
| Studio ↔ topbar bridge | `routing/studioSession.ts`, `MusicCreatorHeaderItems.tsx` |
| Refresh / tab close guard | `routing/useDirtyBeforeUnload.ts` |
| Storage load / recovery UI | `components/storage/` |
| Load, save, migrate, validate | `storage/*.ts` |
| Route guards | `routing/projectRoute.ts`, `routing/leaveGuard.ts` |
| Audio | `audio/drumSynths.ts`, `audio/melodySynth.ts`, `audio/schedulePattern.ts`, `audio/audioEngine.ts` |
| Router / views | `MusicCreatorContent.tsx`, `views/`, `MusicCreatorNav.tsx` |
| Pure helper tests | Colocated `**/*.test.ts` |

---

## Data model quick reference

- **`MusicProject`** — one saved composition (drums, melody, tempo, mutes, metadata).
- **`MusicCreatorStoreEnvelope`** — wrapper stored in `localStorage`: `{ schemaVersion, projects: Record<id, MusicProject> }`.
- **`StorageResult<T>`** — `{ ok: true, data }` or `{ ok: false, code, message }`.
- **Factories** — use `createEmptyProject(id)` / `createEmptyStoreEnvelope()` from `project/createProject.ts`.

### Persistence I/O

All reads/writes go through `storage/storage.ts`:

| API | Purpose |
| --- | ------- |
| `loadStore()` | Parse → migrate → validate; **does not rewrite disk** on load |
| `saveStore(envelope)` | Full envelope replace under `music-creator:store` |
| `resetStore()` | Save empty envelope (recovery) |
| `isProjectInStore(envelope, id)` | Route guard helper |

Never throw from storage into React render. Never silently catch write failures.

---

## Dev workflow

- Run `npm run check` after substantive changes; run `npm test -- src/apps/music-creator` when touching app code.
- **HMR** usually picks up edits to existing files. After **adding new files/folders**, config changes, or deps: restart `npm run dev` if behavior looks stale.
- One git commit per **milestone** unless the user asks otherwise.

---

## Verification checklists

Per-milestone sign-off blocks below. Edge-case recipes are for re-testing when touching related code.

### Milestone 2 — sign-off

- [x] Routing: redirects, studio deep links, unknown id banner, shell `?nav=` preserved, no nested app `<main>`
- [x] Persistence: create/open/rename/duplicate/delete survive refresh
- [x] Storage errors surfaced in UI (no white screen); reset + invalid-project repair work
- [x] `npm run check` and `npm test` (music-creator) pass

**Loading UI:** `LoadingPanel` while `!storeReady` — sync load is usually sub-frame; spinner rarely visible. Hub → studio navigation skips loading when store is already in memory.

#### Edge-case recipes (storage)

**Save failure (hub)** — stub `localStorage.setItem` for key `music-creator:store` to throw `QuotaExceededError`, then New project / Duplicate. Expect error banner; stay on hub.

**Corrupt JSON** — set `music-creator:store` to `{not json`, reload → recovery panel → Reset storage → empty hub.

**Invalid project on disk** — add `"bad-id": { "name": "broken" }` inside `projects`, reload → warning banner → **Remove invalid from storage** → key gone from disk.

### Milestone 3 — sign-off

- [x] Transport: name/tempo editors; dirty indicator
- [x] Drums 4×16 + melody 8×16 (monophonic); native button cells with `aria-pressed` / focus ring
- [x] Per-track mute toggles; pattern editable while muted; mute → dirty
- [x] Explicit Save writes pattern/name/tempo/mutes; refresh restores; dirty clears; Save failure keeps dirty + banner
- [x] Leave confirm on **All projects** / nav **Projects** when dirty; Stay keeps edits; Leave discards
- [x] Clean project navigates without confirm; browser Back / refresh / shell Home: no custom confirm
- [x] `npm run check` and `npm test` (music-creator) pass

#### Studio save failure (DevTools)

1. Open Studio on a saved project; make an edit so **Save** enables.
2. Stub `localStorage.setItem` for `music-creator:store` to throw `QuotaExceededError` (see M2 recipe).
3. Click **Save** → red error banner in Studio; **Unsaved changes** persists; pattern retained in grid.

### Milestone 4 — sign-off (playback)

- [x] `tone` dependency; synth factories, `buildSchedule`, `audioEngine` (`load`, `play`, `stop`, `dispose`, `setTempo`, `updatePattern`)
- [x] Play/Stop toggle — audible pattern; mutes respected; playhead column while playing
- [x] Bar dividers after steps 4, 8, 12 (not after final column)
- [x] Live pattern/mute edits during playback; live tempo via slider
- [x] `dispose()` on Studio unmount and project id change — no leaked audio
- [x] Stop then Play reuses synths; kick/snare/open-hat distinguishable
- [x] No `Transport.cancel()` in executable code (grep — docs/comments only)
- [x] `npm run check` and `npm test` (music-creator) pass

### Milestone 5 — sign-off (QA audit)

#### Playback lifecycle audit (M5 — code review 2026-07-28)

| Path | Code path | Verified |
| ---- | --------- | -------- |
| Stop button | `Studio.handleStop` → `audioEngine.stop()` — clears owned Transport ids, keeps synths | Yes |
| Play after Stop | `handlePlay` → `play()` reuses synths, fresh schedule | Yes |
| Project id change | `Studio` `[projectId]` effect → `dispose()` | Yes |
| Leave Studio (All projects, nav Projects) | unmount cleanup → `dispose()` | Yes |
| Shell app switch / browser back | Studio unmount → `dispose()` | Yes |
| `Transport.cancel()` | Not used — owned ids cleared via `transport.clear(id)` | Yes (grep) |

#### Route & persistence QA (M5 — code review 2026-07-28)

| Scenario | Expected behavior | Verified |
| -------- | ----------------- | -------- |
| Corrupt JSON | `parse_error` → `StorageRecoveryPanel` + reset | Yes (storage + UI wiring) |
| Invalid project in envelope | Warning banner; disk unchanged until repair | Yes (`loadStore` + `LoadWarningsBanner`) |
| `/music-creator/studio` (no id) | Redirect to projects | Yes |
| Unknown studio id | Redirect + “Project not found” flash | Yes |
| Quota on save | Error banner; in-memory state retained | Yes (`StorageResult` + Studio/hub banners) |
| Shell query params | Preserved via `useAppSubRoute` | Yes (hook contract) |

Manual re-check via DevTools recipes above when changing storage or routing.

#### Accessibility review (M5 — code review 2026-07-28)

| Control | Check | Status |
| ------- | ----- | ------ |
| Hub / Studio | `role="region"`, `aria-labelledby`, no nested `<main>` | Pass |
| Step cells | Native buttons, `aria-label`, `aria-pressed` | Pass |
| Mute toggles | `aria-pressed`, dynamic mute/unmute labels | Pass |
| Transport | `role="toolbar"`, labeled Play/Stop, tempo `<label>` + range | Pass |
| Focus | `:focus-visible` on `.music-creator-btn`, step cells, inputs, sliders, mute | Pass |

- [x] Lifecycle audit documented above
- [x] Persistence/route scenarios verified (code + wiring)
- [x] ARCHITECTURE.md / AGENTS.md synced with M2–M4 behavior
- [x] `npm run check` and `npm test` (music-creator) pass

**Stretch (post-MVP):** document-level Space/Escape; arrow-key grid nav; starter template.

**Post-MVP shipped:** Shell topbar transport (`headerItems`) — Play/Stop (label on wide screens), name, tempo slider + number input, Save, dirty indicator; centered over canvas (offsets for left nav); studio-only. Dirty state is content-based (`areStudioEditsEqual`) — undoing edits restores "Saved" and clears leave guard. `beforeunload` when dirty warns on refresh/tab close (browser-native prompt).

---

## Common mistakes

1. Hand-rolling `pushState` without preserving shell query params — use `useAppSubRoute`.
2. Hard-coded colors instead of `--color-*` tokens.
3. Nested `<main>` inside Hub or Studio — use `role="region"`.
4. Throwing from storage parse into React render — return `StorageResult` and show banners.
5. Auto-deleting bad projects from `localStorage` on load — exclude from UI and warn; repair only on explicit user action.
6. Putting Tone synths or Transport event ids in React state or `localStorage`.
7. Assuming HMR applied new files — restart dev server when behavior diverges from source.
8. Custom left-nav studio blocks instead of shell `nav-item` — breaks collapsed icon-only layout.
9. Expecting shell-level or browser Back leave confirm — only **All projects** and nav **Projects** use `routing/leaveGuard`.
10. Calling global `Transport.cancel()` — clears every app's Transport events on the page.

---

## Testing

- **Pure helpers** (validate, migrate, factories, schedule, `isBarEnd`): Vitest colocated `*.test.ts`.
- **UI / routing / audio lifecycle:** manual checklists above; no `@vitest/browser` unless repo adds it.
- **CI:** `npm run check` always; `npm test` when app tests exist.
