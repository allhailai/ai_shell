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
- For chat mutations, verify the process-local per-project queue encloses the
  final owned-state re-read and stable assistant-ID transition. Reject
  whole-conversation completion snapshots that can overwrite concurrent
  messages; verify stale `streaming` messages become interrupted `error`
  messages.
- Inspect chat index versions 1 and 2 as strict authoritative schemas. Verify
  the entire index and every record are validated, including duplicate
  IDs/files and the record limit, without filtering invalid entries. Test the
  missing-index distinction between a genuinely uninitialized store and
  stranded direct conversation JSON files; expected image directories alone
  must not initialize the index.
- Trace an indexed conversation read from index selection through file access.
  Verify ID/project/custody identity, message-ID uniqueness, and
  missing/malformed/invalid indexed-file corruption. Confirm custody is checked
  before the file read so unauthorized actors receive generic absence even
  when the selected authoritative file is corrupt.
- Verify `read_design_doc` exposes the exact current content hash and that a
  full `edit_design_doc` requires and forwards `expectedContentHash`. Confirm
  the service compares it only after the design/version locks are held, while
  section edits retain equivalent internal read/hash protection.
- Trace authenticated design authorship across creation, full and section tool
  edits, and HTTP revert. Verify assistant, chat, research, and curation runs
  fail before agent creation without an initiating actor, routes derive human
  authorship from the principal, and client/tool arguments cannot choose the
  effective author.
- For directive create/execute/apply/reject/undo/delete/update/batch, derive the
  actual transition table from service code and tests. Verify each check occurs
  after the sidecar lock and authoritative reread; routes must preserve
  not-found/404 for absence and map invalid existing-state operations to one
  sanitized 409.
- For applied directives, review service, route, and `InsertionPrompt` behavior
  together. Confirm execute/reject/delete/update/apply-again cannot mutate
  state; only bounded undo is available, generated content survives undo, the
  applied header says Close, Undo remains visible, Delete is absent, and a
  failed delete does not close optimistically.
- For directive apply/undo/batch, verify routes derive version authorship from
  the principal and delegate to `CodaScopeDirectiveService`. Confirm the
  document-before-sidecar lock order, strict sidecar reads, exact rollback,
  one design version per committed content-changing directive mutation, and
  hash/peer-position checks that reject unsafe undo without changing state.
- Identify secrets, sensitive content, or private metadata that could cross a project, scope, or user boundary.

#### API and async contracts

- Trace representative frontend calls to registered backend routes and route responses back to their consumers. Prioritize mutation, upload/import/export, streaming, and notes endpoints.
- Check request validation, status codes, error shapes, pagination/size limits, and cancellation/cleanup behavior.
- Verify SSE event producers and consumers agree on names, payloads, terminal events, and cancellation semantics.
- For chat SSE completion, verify the exact `done` payload is JSON-preflighted,
  completion persistence succeeds before `done`, failure emits only `error`,
  generated/partial content is persisted as `error` when possible, error-state
  persistence is best effort, completion-only actions are removed on error,
  and the response has one terminal owner and one end.
- Verify corruption is discovered before chat mutation or SSE publication and
  that route error mapping exposes only sanitized persistence codes/messages.
- On a stale full-document agent edit, verify the current bytes and version
  inventory are unchanged, the tool emits no completed action, and its
  instructions require a fresh read and reconsidered replacement before retry.
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
2. persistence/concurrency and archive/restore failure paths, including
   strict chat index/indexed-file corruption, missing-index stranded-file
   detection, concurrent chat appends, directive document/sidecar rollback,
   and byte-for-byte preservation after forbidden applied operations;
3. route-to-client contracts and SSE/cancellation paths, including persistence
   ordering, exactly-once chat terminals, sanitized 409/404 directive
   distinction, applied Close/Undo UI, and failed-delete UI behavior;
4. agent action/tool permission boundaries, including observed-hash exposure,
   required full-edit hashes, principal-derived creation/edit/revert
   attribution, no extra stale/no-op versions, and no completed action on a
   stale tool edit;
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
