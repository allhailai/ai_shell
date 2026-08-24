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

**Implementation status:** registered placeholder canvas only (PR 1 Phase 1). No assessment list, create form, or workspace yet. Active design: [`plans/pr-01-ui-foundation.md`](plans/pr-01-ui-foundation.md).

## Level 1 — File map

```
src/apps/market-access/
├── DEVELOPMENT.md              # Collaboration / workflow conventions
├── ARCHITECTURE.md             # ← You are here (implemented system)
├── AGENTS.md                   # How to modify the current implementation
├── manifest.tsx                # AppManifest — id market-access, mainContent only
├── MarketAccessContent.tsx     # Placeholder canvas
├── market-access.css           # Namespaced .market-access-* styles
└── plans/
    ├── README.md               # Roadmap and which plan is active
    └── pr-01-ui-foundation.md  # Canonical PR 1 plan (active)
```

Shell wiring: imported from [`src/apps/registry.ts`](../../apps/registry.ts); CSS imported from [`src/styles.css`](../../styles.css).

## Level 2 — Shell wiring

`marketAccessApp` exports `id: "market-access"`, display name **Market Access**, and `mainContent: MarketAccessContent`. No `leftNav`, panels, commands, or secrets.

`MarketAccessContent` is a static region. Sub-routes and in-memory assessments are not implemented.

## Level 3+

Omitted until later PR 1 phases land. Do not treat the active plan as implemented architecture.
