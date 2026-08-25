# Market Access — Application Architecture

> **Progressive disclosure** — start at the top. Stop when you have enough context.
>
> This file describes the system **as implemented**. Intended work lives in [`plans/`](plans/README.md).

## Reading order

See [`DEVELOPMENT.md`](DEVELOPMENT.md). For the current design, read the [active plan](plans/README.md).

## Level 0 — What Is This?

Market Access is a **local-first** AIShell application for Global Market Access users. It will help them research pharmaceutical **analogs** and build evidence-backed assessments for one product/asset at a time.

The app name stays broad on purpose. An **assessment** is the user-facing workspace for one product/asset. The first workflow is an **AnalogAssessment**; later work may add landscape assessment, evidence research, knowledge exploration, and a possible assistant. Generated synthesis is never inherently authoritative — claims should stay traceable to source material and reviewable by a human.

```
source material / provenance
        ↓
structured or extracted project knowledge
        ↓
generated synthesis / assessment
```

**Implementation status:** PR 1 Phase 4 — in-memory assessments, session list cards, workspace overview with package metadata and placeholder sections. Active design: [`plans/pr-01-ui-foundation.md`](plans/pr-01-ui-foundation.md).

## Level 1 — File map

```
src/apps/market-access/
├── DEVELOPMENT.md              # Collaboration / workflow conventions
├── ARCHITECTURE.md             # ← You are here (implemented system)
├── AGENTS.md                   # How to modify the current implementation
├── manifest.tsx                # AppManifest — mainContent + leftNav
├── MarketAccessContent.tsx     # URL router + in-memory assessments
├── MarketAccessNav.tsx         # URL-only left nav
├── market-access.css           # Namespaced .market-access-* styles
├── types.ts                    # Assessment view-model
├── packageFile.ts              # Package extension/kind helpers
├── packageFile.test.ts
├── components/
│   ├── MarketAccessIcons.tsx   # SVG icons
│   └── PackageFilePicker.tsx   # Click + drop file selection (no upload)
├── views/
│   ├── AssessmentList.tsx      # List, empty state, session cards
│   ├── CreateAssessment.tsx    # Create form + colocated validate()
│   └── AssessmentWorkspace.tsx # Overview + placeholder sections
└── plans/
    ├── README.md
    └── pr-01-ui-foundation.md
```

Shell wiring: imported from [`src/apps/registry.ts`](../../apps/registry.ts); CSS imported from [`src/styles.css`](../../styles.css).

## Level 2 — Shell wiring

`marketAccessApp` exports `id: "market-access"`, `mainContent`, and `leftNav`. No panels, commands, or secrets.

## Level 3 — Routing

`MarketAccessContent` owns sub-routes via `useAppSubRoute("market-access")` and holds `useState<Assessment[]>` for the current browser session. Nav reads the same URL; it does not share React state with the canvas.

| URL | View |
| --- | --- |
| `/market-access` | `replace("assessments")` |
| `/market-access/assessments` | List (empty or session cards) |
| `/market-access/assessments/new` | Create form |
| `/market-access/assessments/:id` | Workspace overview |
| Other first segments | List + flash; URL replaced to `assessments` |
| `/assessments/:id/...` extra | Stripped to overview |
| Unknown `:id` | List + “not saved yet” flash |

Create validates product name and one Markdown/DOCX package file, appends an `Assessment` to root state, and navigates to the new workspace. Refresh clears assessments; unknown ids redirect to the list.

## Level 4 — State

| Concern | Owner |
| --- | --- |
| In-memory assessments | `useState<Assessment[]>` in `MarketAccessContent` |
| Create-form fields / errors | Local `useState` in `CreateAssessment` |
| Package on disk | Not stored — metadata `{ fileName, fileSize, kind }` only |
| Current view | URL via `useAppSubRoute` |

No `localStorage`, Zustand, or `/api/*` in PR 1.
