# Market Access — Plans

Local-first AIShell app for Global Market Access research: human-in-the-loop, evidence-oriented **assessments** for one pharmaceutical product/asset at a time. The first workflow is an **AnalogAssessment**. Generated claims should remain traceable to supporting sources.

## PR sequence

1. **PR 1 — UI foundation** (complete — [`pr-01-ui-foundation.md`](pr-01-ui-foundation.md))
2. **PR 2 —** local assessment creation and persistence
3. **PR 3 —** provider-agnostic agent harness (first implementation may use Cursor CLI)
4. **PR 4 —** agent-generated knowledge repository / initial analog research

Do not design PRs 2–4 in detail until those PRs are being planned. Add `pr-02-…md` (and later) only then.

## What to read

**For PR 1 work:** the plan below is a historical design record. For current behavior, read [`ARCHITECTURE.md`](../ARCHITECTURE.md) and [`AGENTS.md`](../AGENTS.md).

| Plan | Status |
| --- | --- |
| [`pr-01-ui-foundation.md`](pr-01-ui-foundation.md) | **Complete** — PR 1 UI foundation |

Completed plans stay as historical design records. They are not mandatory context for later work.

Future plans should reference durable architecture in [`ARCHITECTURE.md`](../ARCHITECTURE.md) rather than repeating earlier plans.

Cursor-managed `.cursor/plans/` files, if present, are tooling state only. **This directory is canonical.**
