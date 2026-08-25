# Market Access — Agent guidance

Operational rules for safely modifying **this app as it exists**. Workflow lives in [`DEVELOPMENT.md`](DEVELOPMENT.md). Intended work lives in [`plans/`](plans/README.md). Shell chassis rules live in the repository docs linked from `DEVELOPMENT.md`.

## Current status

PR 1 Phase 3 is implemented: empty-state list, create form with product name and package file picker, colocated validation. Create navigates to the workspace with a stub id — in-memory assessment storage lands in Phase 4.

Do not implement further phases until asked.

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

After any implementation phase:

- [ ] `npm run check` passes
- [ ] Targeted Vitest tests pass when pure helpers exist (`npm test -- src/apps/market-access`)
- [ ] CSS classes are prefixed `market-access-` and use tokens
- [ ] No emoji in TSX
- [ ] No nested app `<main>`
- [ ] Sub-routes preserve shell query params (`?nav=`, `?rp=`, and similar)

**Phase 1 manual checks**

- [x] Shell landing page shows a **Market Access** card
- [x] Opening the card navigates to `/market-access`

**Phase 2 manual checks**

- [x] `/market-access` redirects to `/market-access/assessments`
- [x] Create assessment → `/market-access/assessments/new`; Cancel returns to the list
- [x] `/market-access/assessments/<id>` shows the workspace shell; All assessments returns to the list
- [x] Unknown path (e.g. `/market-access/nope`) returns to the list with a dismissible banner
- [x] Extra workspace segment (e.g. `/market-access/assessments/demo/analogs`) strips to overview
- [x] Browser back/forward restores the matching view
- [x] Collapsed left nav still shows icons; Analogs / Evidence / Knowledge are disabled
- [x] `?nav=collapsed` is preserved when navigating inside the app
- [x] No nested app `<main>`

**Phase 3 manual checks**

- [x] Empty state shows icon, title, honest session-only copy, and Create assessment CTA
- [x] Create form: product name auto-focused; package picker click + drop; Markdown/DOCX hint visible
- [x] Submit with empty fields shows `role="alert"` errors; `aria-invalid` on product name
- [x] Invalid file type on drop/select shows rejection message
- [x] Valid submit navigates to `/market-access/assessments/<id>` (stub — workspace has no stored metadata yet)
- [x] Cancel returns to list
