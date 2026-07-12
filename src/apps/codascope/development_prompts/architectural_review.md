# Architectural Review — CodaScope

> Reusable, read-only prompt for finding architectural risks and producing an implementation-ready remediation plan. For shell-wide or cross-app concerns, run `development_prompts/architectural_review.md` separately.

## Role and guardrails

Review the current CodaScope implementation; do not edit code, documentation, dependencies, or the git worktree.

- Read `.agents/AGENTS.md`, `src/apps/codascope/AGENTS.md`, and the relevant levels of `src/apps/codascope/ARCHITECTURE.md` before assessing compliance.
- Start with `git status --short`. Treat existing changes as in-scope context, not evidence of a defect; do not discard or overwrite them.
- Build an inventory from the filesystem and imports. Do not rely on line counts, route lists, or file maps embedded in this prompt or in potentially stale documentation.
- Report only observed issues. A suspicion without reproducible evidence is an **investigation**, not a finding.
- Prefer a few high-confidence, high-impact findings to broad cleanup speculation. Do not recommend deletions based solely on a text search.
- Do not prescribe a rewrite when a bounded extraction, contract, or test would solve the problem.

## Review procedure

### 1. Establish the baseline

1. Record the current branch, dirty files, package scripts, app/server TypeScript configuration, and test inventory.
2. Run the project’s documented build and test commands. Distinguish failures introduced by the current worktree from clearly pre-existing or unrelated failures; state the evidence for that distinction.
3. Inventory the live CodaScope surface:
   - `src/apps/codascope/**`
   - `server/routes/codaScope*Routes.ts` and `server/routes/codaScopeServiceContext.ts`
   - `server/services/codaScope*.ts` and `server/services/tools/**`
   - CodaScope tests, command templates, and shared dependencies used by CodaScope.

### 2. Check architectural invariants

Use imports, call sites, route registration, and tests as evidence.

#### Boundaries and dependency direction

- CodaScope reaches the shell through the manifest and approved shell hooks; it does not couple to shell UI internals, cross-app modules, or URL/command-bus internals.
- Views own page composition and URL-driven navigation; reusable components do not import views; the Zustand store and context assembler do not import UI components.
- Route modules validate and translate HTTP; services do not receive Express `req`/`res`; orchestration is not hidden in unrelated route handlers.
- Identify circular dependencies, service facades that add no behavior, and domain services with materially mixed responsibilities.

#### Data, persistence, and security

- For filesystem-backed data, check path containment, validation of user-controlled names, atomic-write/rollback behavior where loss matters, and index/cache invalidation.
- Verify user identity and authorization come from the authenticated session, not client query/body fields. Pay particular attention to private/shared notes, export/import, archive/audit, and cross-scope moves.
- Check optimistic concurrency, versioning, archive/restore, import collision handling, and audit trails for a coherent failure mode.
- Identify secrets, sensitive content, or private metadata that could cross a project, scope, or user boundary.

#### API and async contracts

- Trace representative frontend calls to registered backend routes and route responses back to their consumers. Prioritize mutation, upload/import/export, streaming, and notes endpoints.
- Check request validation, status codes, error shapes, pagination/size limits, and cancellation/cleanup behavior.
- Verify SSE event producers and consumers agree on names, payloads, terminal events, and cancellation semantics.
- Treat shared frontend/server types as contracts: flag unsafely duplicated shapes, stale fields, or a type-check configuration that misses server code only when demonstrated by a concrete mismatch.

#### Product and agent-system invariants

- Navigation remains URL-driven through `useAppSubRoute("codascope")`; deep links and back/forward behavior are not implemented with local routing state.
- UI follows CodaScope rules: token-based CSS, namespaced classes, centralized SVG icons, useful empty/error states, and no component-level fetch logic duplicated without a reason.
- Compare the design philosophy, `AGENTS.md`, command templates, tool composition, action parsing, and action-card dispatch. Explicitly call out contradictions, especially around whether agents may execute mutations or must propose user-confirmed actions.
- Check that manifest/context assembly remains bounded and that tools enforce their intended project/scope/permission boundary.

### 3. Targeted complexity and drift review

Use current measurements and call graphs, not a fixed “god file” list.

- Inspect the largest or fastest-changing files only when they have multiple independently testable responsibilities, repeated logic, high fan-in/out, or weak test coverage.
- Look for duplicate fetch/SSE/error-handling logic, split ownership of the same persisted file, duplicate route patterns, and conflicting UI state sources.
- Check documentation drift against the live route table, service ownership, tools, notes model, and test/build commands. Record the smallest precise documentation correction.
- For candidate dead code, require all of: no static imports/registrations, no dynamic lookup or documented external entry point, and no test/runtime use. Otherwise list it as an investigation.

### 4. Test strategy review

Map important invariants to actual tests. Prioritize missing tests that protect:

1. authorization, path traversal, import/export limits, and destructive operations;
2. persistence/concurrency and archive/restore failure paths;
3. route-to-client contracts and SSE/cancellation paths;
4. agent action/tool permission boundaries;
5. regressions in high-change components or services.

Do not use raw line count as the primary test-priority signal.

## Required output

Produce one concise report in this order:

1. **Baseline** — branch/worktree state; exact build/test commands and outcomes.
2. **Architecture health** — 3–6 bullets: strengths, material risks, and any documentation contradictions.
3. **Findings** — ordered by severity (`critical`, `high`, `medium`, `low`). For each finding include:
   - `Evidence:` exact file and tight line range, plus the relevant caller/consumer when applicable;
   - `Impact:` concrete failure or maintainability cost;
   - `Recommendation:` smallest viable change; and
   - `Verification:` exact test, build check, or manual behavior proving the fix.
4. **Investigations / non-findings** — only items with incomplete evidence, stating what would confirm or dismiss them.
5. **Remediation plan** — dependency-ordered tasks. Each task must name files, intended boundary/contract change, tests to add or update, and acceptance criteria. Separate safe mechanical cleanup from behavior or schema migrations.
6. **Documentation updates** — exact sections to correct in `ARCHITECTURE.md`, `AGENTS.md`, or command templates; no vague “refresh docs” item.

If no material issues are found, say so and report the evidence. Do not manufacture a plan.
