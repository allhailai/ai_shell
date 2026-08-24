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

**Implementation status:** PR 1 Phase 2 — URL routing and left nav with list/create/workspace shells. No create form, file picker, or persistence. Active design: [`plans/pr-01-ui-foundation.md`](plans/pr-01-ui-foundation.md).

## Level 1 — File map

```
src/apps/market-access/
├── DEVELOPMENT.md              # Collaboration / workflow conventions
├── ARCHITECTURE.md             # ← You are here (implemented system)
├── AGENTS.md                   # How to modify the current implementation
├── manifest.tsx                # AppManifest — mainContent + leftNav
├── MarketAccessContent.tsx     # URL router (useAppSubRoute)
├── MarketAccessNav.tsx         # URL-only left nav
├── market-access.css           # Namespaced .market-access-* styles
├── components/
│   └── MarketAccessIcons.tsx   # SVG icons
├── views/
│   ├── AssessmentList.tsx      # List shell
│   ├── CreateAssessment.tsx    # Create-route shell (no form yet)
│   └── AssessmentWorkspace.tsx # Workspace overview shell
└── plans/
    ├── README.md
    └── pr-01-ui-foundation.md
```

Shell wiring: imported from [`src/apps/registry.ts`](../../apps/registry.ts); CSS imported from [`src/styles.css`](../../styles.css).

## Level 2 — Shell wiring

`marketAccessApp` exports `id: "market-access"`, `mainContent`, and `leftNav`. No panels, commands, or secrets.

## Level 3 — Routing

`MarketAccessContent` owns sub-routes via `useAppSubRoute("market-access")`. Nav reads the same URL; it does not share React state with the canvas.

| URL | View |
| --- | --- |
| `/market-access` | `replace("assessments")` |
| `/market-access/assessments` | List shell |
| `/market-access/assessments/new` | Create shell (`new` reserved) |
| `/market-access/assessments/:id` | Workspace overview shell |
| Other first segments | List + flash; URL replaced to `assessments` |
| `/assessments/:id/...` extra | Stripped to overview |

In-memory assessments and unknown-id handling are not implemented.

## Level 4+

Omitted until later PR 1 phases land.
