# Market Access — Development workflow

Stable collaboration conventions for working on this app.

For AIShell architecture and shell rules, follow the repository guidance referenced by `AGENTS.md` and `ARCHITECTURE.md` rather than duplicating it here.

## Reading order

For a new implementation session:

1. `DEVELOPMENT.md`
2. `AGENTS.md`
3. Relevant sections of `ARCHITECTURE.md`
4. The active plan under `plans/`
5. Only the repository/reference files relevant to the current phase

Completed PR plans are historical context and do not need to be reread by default.

## Working style

- Inspect relevant repository guidance and reference implementations before coding.
- Prefer established AIShell patterns over inventing new ones.
- Work one bounded phase at a time and stop unless I explicitly ask to continue.
- Do not commit; I handle Git commits.
- Avoid speculative abstractions, modules, folders, or future-only code.
- Explain important tradeoffs, assumptions, and deviations from the active plan.
- I own final architecture decisions and sign-off; agents implement and advise.

## Reviewability

After each implementation phase:

- summarize behavior changed
- list files created or modified, with a brief reason for each change
- call out meaningful routing/state/data-flow impact
- identify deferred work
- report validation performed and remaining manual checks

## Commenting

Prefer readable code first.

Comment non-obvious:
- ownership and lifecycle
- persistence versus working state
- ordering or multi-step behavior
- intentional limitations
- business or architecture decisions where a future reader may ask “why?”

Do not narrate obvious JSX or restate what the code literally does.

## Verification

Follow repository testing conventions.

At minimum when relevant:

1. `npm run check`
2. targeted tests for pure logic
3. manual verification defined in `AGENTS.md`

Do not add browser-test infrastructure unless the repository adopts it.

## Documentation

Keep documentation progressive and update only files materially affected by a phase:

- **Plan** — future scope, phases, acceptance criteria, open decisions, and implementation progress
- **ARCHITECTURE** — the system as actually implemented
- **AGENTS** — operational guidance, verification steps, and known pitfalls
- **DEVELOPMENT** — stable collaboration conventions; update only when the workflow itself changes

When an implementation prompt says **“sync docs as needed”**, reconcile the relevant documents with the completed phase and skip any file with nothing meaningful to update.

Avoid duplicating detailed architecture, schemas, or rules across documents.

## Git

Do not commit automatically.

When useful, suggest an appropriate Conventional Commit-style message such as `feat`, `fix`, `docs`, `refactor`, `test`, or `chore`.