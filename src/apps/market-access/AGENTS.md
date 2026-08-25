# Market Access — Agent guidance

Operational rules for safely modifying **this app as it exists**. Workflow lives in [`DEVELOPMENT.md`](DEVELOPMENT.md). Intended work lives in [`plans/`](plans/README.md). Shell chassis rules live in the repository docs linked from `DEVELOPMENT.md`.

## Current status

**PR 1 (UI foundation) is complete.** Session-only create → list → workspace with product name and package file metadata. No disk persistence, parsing, or agent work yet.

Next: **PR 2 — local persistence** (not started). Historical design: [`plans/pr-01-ui-foundation.md`](plans/pr-01-ui-foundation.md).

## Conventions

See [`APP_DEVELOPMENT_GUIDE.md`](../../../APP_DEVELOPMENT_GUIDE.md) and [`.agents/AGENTS.md`](../../../.agents/AGENTS.md). App-specific highlights:

- **App ID / CSS:** `market-access` / `.market-access-*` (design tokens only)
- **Routing:** `useAppSubRoute("market-access")` — preserve shell query params
- **Icons:** SVG in `components/MarketAccessIcons.tsx` only; no emoji
- **Layout:** no nested `<main>`; views use `role="region"` + `aria-labelledby`
- **Left nav:** shell `nav-item` / `nav-item-icon` / `nav-item-label`
- **Spelling:** `analog` / `analogs` / `Analog` / `AnalogAssessment` — never “analogue”
- **PR 1 data:** store package `{ fileName, fileSize, kind }` only — not the `File` blob or a path

## File organization

| What | Where |
| --- | --- |
| Router + session state | `MarketAccessContent.tsx` |
| Views / components | `views/` / `components/` |
| Types | `types.ts` |
| Package helpers | `packageFile.ts` (+ `packageFile.test.ts`) |
| Styles | `market-access.css` |

No `server/` routes, FolderPicker, or agent modules unless the active plan says so.

## Verification

**Automated (every change):** `npm run check`; `npm test market-access` when touching pure helpers.

**Manual smoke (after routing, create, list, or workspace changes):**

1. Create assessment (name + package) → workspace shows metadata → **All assessments** → reopen from list card
2. Refresh clears session assessments; unknown `/assessments/<id>` → list + “not saved yet” banner
3. `?nav=collapsed` preserved when navigating; collapsed nav still shows icons

## Common mistakes

1. Hand-rolled `pushState` — use `useAppSubRoute`
2. Hard-coded colors or custom nav blocks (breaks collapsed mode)
3. Storing `File` blobs or filesystem paths in assessment state
4. Inline SVG / emoji outside `MarketAccessIcons.tsx`
