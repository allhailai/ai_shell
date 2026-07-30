# Music Creator — Application Architecture

> **Progressive Disclosure Document** — Start reading from the top. Stop when you have enough context.

---

## Level 0 — What Is This?

Music Creator is a **browser-based miniature music tool** hosted in AIShell. Users manage projects on a **Project Hub** and compose in a single **Studio** view (drum sequencer + melody grid + transport). Projects persist in `localStorage`; playback uses Tone.js via a module singleton (`audioEngine`).

**MVP assumption:** single browser tab, single user — no cross-tab sync; last-write-wins on `localStorage` is acceptable for this POC.

---

## Level 1 — File Map

```
src/apps/music-creator/
├── manifest.tsx              # AppManifest — leftNav + mainContent + headerItems (studio transport)
├── music-creator.css         # Namespaced .music-creator-* — grids, transport, hub, focus rings
├── types.ts                  # MusicProject, envelope, StorageResult, drum/melody shapes
├── constants/
│   ├── music.ts              # STEPS, tempo bounds, drum ids/labels, melody scale MIDI, isBarEnd
│   ├── storageMessages.ts    # StorageErrorCode user copy, recoverable codes
│   └── index.ts              # Re-exports for convenient imports
├── project/
│   ├── createProject.ts      # createEmptyProject, createEmptyStoreEnvelope — default patterns
│   ├── projectUtils.ts       # duplicateProject, renameProject, commitStudioProject (Studio Save)
│   ├── sortProjects.ts       # Hub list ordering by updatedAt desc
│   └── formatProject.ts      # updatedAt display strings for ProjectCard
├── components/
│   ├── ProjectCard.tsx       # Hub row — open, inline rename, duplicate, delete
│   ├── ConfirmDeleteDialog.tsx
│   ├── TransportBar.tsx      # Shell topbar transport UI (via headerItems)
│   ├── StepCell.tsx          # Native button cell — aria-pressed, playhead, bar divider
│   ├── DrumSequencer.tsx     # 4×16 drum grid + per-lane mute
│   ├── MelodyGrid.tsx        # 8×16 monophonic melody grid + melody mute
│   ├── MuteToggle.tsx        # Per-track M button — aria-pressed when muted
│   ├── ConfirmLeaveStudioDialog.tsx  # Unsaved leave confirm (Stay / Leave)
│   └── storage/              # Load/recovery UI paired with storage/ module
│       ├── LoadingPanel.tsx
│       ├── LoadWarningsBanner.tsx    # Invalid projects — explicit repair action
│       ├── StorageRecoveryPanel.tsx  # Fatal load error + reset entry point
│       └── ConfirmResetStorageDialog.tsx
├── storage/
│   ├── storage.ts            # loadStore, saveStore, resetStore — typed StorageResult I/O
│   ├── migrate.ts            # schemaVersion migration chain (v1 only today)
│   ├── validate.ts           # Envelope + per-project validation; warnings not throws
│   └── *.test.ts             # Vitest — load warnings, migrate, validate
├── routing/
│   ├── projectRoute.ts       # sessionStorage registry + isKnownProjectId store lookup
│   ├── leaveGuard.ts         # tryLeaveStudio — dirty guard for app-controlled nav only
│   ├── studioSession.ts      # Module store — Studio ↔ headerItems bridge (useSyncExternalStore)
│   └── useDirtyBeforeUnload.ts  # Native refresh/tab-close prompt when dirty
├── audio/
│   ├── drumSynths.ts         # createDrumSynths — four-lane synthesized kit + dispose()
│   ├── melodySynth.ts        # createMelodySynth — monophonic Tone.Synth factory
│   ├── schedulePattern.ts    # Pure buildSchedule(project) → ScheduledStep[16]
│   ├── schedulePattern.test.ts
│   └── audioEngine.ts        # Module singleton — load, play, stop, dispose, updatePattern
├── MusicCreatorContent.tsx   # Router — store owner, hub CRUD, studio route guards
├── MusicCreatorHeaderItems.tsx  # Shell topbar transport — studio-only via studioSession
├── MusicCreatorNav.tsx       # Left nav — Projects link + studio context (shell nav-item)
├── views/
│   ├── ProjectHub.tsx        # Hub layout — list, empty state, recovery orchestration
│   └── Studio.tsx            # workingCopy, isDirty, playback wiring, leave guard registration
├── ARCHITECTURE.md           # This file
└── AGENTS.md                 # Dev conventions, verification checklists, common mistakes
```

---

## Level 2 — Routing

Navigation uses `useAppSubRoute("music-creator")` from the shell.

| URL | View |
|-----|------|
| `/music-creator` | Redirects to `/music-creator/projects` |
| `/music-creator/projects` | Project Hub |
| `/music-creator/studio/:projectId` | Studio |

Shell query params (`?rp=`, `?nav=`, etc.) are preserved by the hook.

---

## Level 3 — Data model & persistence

Types and factories: `types.ts`, `constants/music.ts`, `project/createProject.ts`.

New projects default to name `"Untitled"`, tempo 120, empty drums, melody all rests, all tracks unmuted.

**Storage key:** `music-creator:store` — single envelope `{ schemaVersion, projects: Record<id, MusicProject> }`.

| Module | Role |
| ------ | ---- |
| `storage/storage.ts` | `loadStore`, `saveStore`, `resetStore` — all return `StorageResult` |
| `storage/migrate.ts` | Schema version migration (v1 only today) |
| `storage/validate.ts` | Envelope + per-project validation; invalid projects become warnings, not throws |

**Load rule:** Invalid projects are omitted from the returned envelope but **disk is not auto-repaired** on load. User must explicitly repair (save validated subset) or reset.

**Vitest:** Colocated tests under `project/*.test.ts`, `storage/*.test.ts`, `audio/schedulePattern.test.ts`, `constants/music.test.ts`.

---

## Level 4 — Project Hub

`MusicCreatorContent` loads the store on mount and owns create/save/navigation. Hub CRUD mutations go through `persistEnvelope` → `saveStore`.

| Flow / action | Behavior |
| ------------- | -------- |
| Hub mount | `loadStore()` → project list sorted by `updatedAt` desc |
| New project | `createEmptyProject` → `saveStore` → navigate studio |
| Open project | Card click → navigate studio |
| Route guard | Waits for `storeReady`; `isKnownProjectId(id, envelope)` then session fallback |
| Rename | Inline on `ProjectCard` → immediate `saveStore` (separate from Studio Save) |
| Duplicate | New uuid, `" (copy)"` suffix → `saveStore`; stays on hub |
| Delete | `ConfirmDeleteDialog` → remove key → `saveStore` |

**Hub UI states**

| State | UI |
| ----- | -- |
| Loading | `LoadingPanel` while `!storeReady` (sync load — spinner rarely visible) |
| Fatal load error | `StorageRecoveryPanel` + reset confirm → `resetStore()` |
| Valid + warnings | `LoadWarningsBanner` → **Remove invalid from storage** |
| Empty / populated | Empty-state panel or sorted `ProjectCard` list |

Studio shows `LoadingPanel` until store is ready on refresh/deep link.

---

## Level 5 — Studio

Studio loads the URL project into **`workingCopy`** (`structuredClone` of saved `MusicProject`). Edits stay in memory until explicit Save.

### State ownership

| State | Owner | Notes |
| ----- | ----- | ----- |
| `workingCopy` | Studio | Clone on mount / id change |
| `isDirty` | Studio | Derived — `!areStudioEditsEqual(workingCopy, savedBaseline)` |
| `isPlaying`, `currentStep` | Studio | Playback UI from `audioEngine` callbacks |
| Persisted project | `localStorage` | Unchanged until Save |

### Transport & Save

Transport lives in the **shell topbar** via `headerItems` (`MusicCreatorHeaderItems`), not in the Studio canvas. Studio publishes snapshot + action callbacks through `routing/studioSession.ts` (Arcade-style module store + `useSyncExternalStore`). Controls: Play/Stop toggle, editable project name, tempo (live BPM while playing), Save, dirty indicator.

**Save:** `commitStudioProject` → router `saveStore` → `savedProject` prop refresh → `isDirty` clears. Save failure shows inline banner; working copy retained.

**Leave guard:** App-controlled nav (**All projects**, left nav **Projects**) uses `routing/leaveGuard` with a custom Stay / Leave dialog. Browser refresh, tab close, and leaving the site use the native `beforeunload` prompt when dirty. Shell app switch / Home still unmounts Studio without confirm (by design).

### Sequencer UI

| Piece | Role |
| ----- | ---- |
| `DrumSequencer` | 4 lanes × 16 steps; toggles `workingCopy.drums` |
| `MelodyGrid` | 8 pitches × 16 steps; monophonic — one note or rest per column |
| `StepCell` | Native `<button>` per step — `aria-label`, `aria-pressed`, playhead + bar dividers |
| `MuteToggle` | Per-track mute; grids stay editable while muted |

**Melody rule:** `melody[stepIndex]` is one MIDI number or `null`. Click sets pitch; click again clears; new pitch in same column replaces. High pitches at top (piano-roll style). Grids share column template inside `.music-creator-sequencer-stack` for alignment.

**Bar dividers:** Vertical rule after steps 4, 8, 12 (indices 3, 7, 11) — not after the final column.

**Dirty tracking:** Compares editable fields (name, tempo, drums, melody, mutes) to the last saved snapshot via `areStudioEditsEqual`. Undoing edits back to the saved state clears dirty and re-enables navigation without a leave confirm.

---

## Level 6 — Audio playback

Tone synth nodes and Transport event ids live in **`audioEngine`** module singleton — never in React state or `localStorage`. Music Creator is the only AIShell app using Tone today; **never call global `Transport.cancel()`** — clear owned event ids only.

### Pipeline

| Layer | Role |
| ----- | ---- |
| `drumSynths.ts` / `melodySynth.ts` | Factories — create nodes, no scheduling |
| `buildSchedule(source)` | Pure: drums / melody / mutes → `ScheduledStep[16]` |
| `audioEngine` | Owns synths, schedule ids, `activeSchedule`; triggers sounds |

### Engine API

| API | Role |
| --- | ---- |
| `load()` | Create synths if disposed |
| `play(snapshot, { onStep })` | `Tone.start()` → schedule → `Transport.start()` |
| `stop()` | Halt Transport, clear owned ids, **keep** synths |
| `dispose()` | `stop()` + destroy synths — Studio unmount / project id change |
| `updatePattern(source)` | Rebuild `activeSchedule` while playing — live grid/mute edits |
| `setTempo(bpm)` | Live `Transport.bpm` while playing |

**Scheduling:** One owned `scheduleRepeat("16n")` reads mutable `activeSchedule`. Playhead UI uses `getDraw().schedule()` for clock alignment.

**Live edit rule:** Pattern and mute changes during playback call `updatePattern` from Studio — next steps use the new schedule. Tempo slider calls `setTempo` live.

**Lifecycle**

| Event | Handler |
| ----- | ------- |
| Stop button | `audioEngine.stop()` — synths retained for replay |
| Leave Studio / switch project | `audioEngine.dispose()` — full teardown |
| Play after Stop | Reuses synths; fresh schedule from current `workingCopy` |

---

## Level 7 — MVP complete & stretch

**Shipped (M1–M5):** Hub + Studio routes, persistence, explicit Save, Tone.js playback, QA audit, doc sync, shell topbar transport (`headerItems`).

**Post-MVP stretch (not implemented):** autosave, command bus, document-level Space/Escape shortcuts, arrow-key grid nav, starter template, WAV export, swing.

See `AGENTS.md` for verification checklists and dev conventions.
