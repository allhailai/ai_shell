# Market Access — Agent guidance

Operational rules for safely modifying **this app as it exists**. Workflow lives in [`DEVELOPMENT.md`](DEVELOPMENT.md). Intended work lives in [`plans/`](plans/README.md). Shell chassis rules live in the repository docs linked from `DEVELOPMENT.md`.

## Current status

No application code is registered yet. Do not implement until asked, and then only the requested plan phase.

Active plan: [`plans/pr-01-ui-foundation.md`](plans/pr-01-ui-foundation.md).

## Conventions (apply as soon as code exists)

These match AIShell app norms. Details and examples: [`APP_DEVELOPMENT_GUIDE.md`](../../../APP_DEVELOPMENT_GUIDE.md), [`.agents/AGENTS.md`](../../../.agents/AGENTS.md).

- **App ID / CSS prefix:** `market-access` / `.market-access-*`
- **Design tokens only** — no hard-coded colors, spacing, or fonts
- **URL is the router** — `useAppSubRoute("market-access")`; do not hand-roll `pushState` without preserving shell query params
- **SVG icons only** — no emoji, no icon fonts; keep icons in `components/MarketAccessIcons.tsx` once that file exists
- **No nested `<main>`** — shell already owns document `main`; views use `role="region"` + `aria-labelledby`
- **Left nav** — shell `nav-item` / `nav-item-icon` / `nav-item-label` so collapsed mode works
- **No app Zustand** in PR 1; no `/api/*` calls in PR 1
- **Spelling:** `analog` / `analogs` / `Analog` / `AnalogAssessment` — never “analogue”

## File organization (once code exists)

| What | Where |
| --- | --- |
| Manifest | `manifest.tsx` |
| Router | `MarketAccessContent.tsx` |
| Left nav | `MarketAccessNav.tsx` |
| Views | `views/` |
| Reusable UI | `components/` |
| Styles | `market-access.css` (imported from `src/styles.css`) |
| Shared types | `types.ts` when more than one module needs them |

Do not add `server/` routes, shared FolderPicker usage, or agent/Cursor modules unless the active plan says so.

## Verification checklist

Fill in as views land. Until then, after any implementation phase:

- [ ] `npm run check` passes
- [ ] Targeted Vitest tests pass when pure helpers exist (`npm test -- src/apps/market-access`)
- [ ] CSS classes are prefixed `market-access-` and use tokens
- [ ] No emoji in TSX
- [ ] No nested app `<main>`
- [ ] Sub-routes preserve shell query params (`?nav=`, `?rp=`, and similar)

Phase-specific manual checks belong in the active plan until they describe implemented UI; then move the durable ones here.
