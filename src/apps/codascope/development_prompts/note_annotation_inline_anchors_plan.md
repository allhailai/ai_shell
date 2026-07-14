# CodaScope Notes — Inline Annotation Anchors: Implementation Plan

## Purpose

Replace the current line/block-derived note annotation anchors with durable, hidden Markdown anchors. A comment is visibly pinned to its actual text in CodaScope, while its identity travels with the Markdown through ordinary edits, moves, exports, and imports.

This plan intentionally does **not** attempt real-time multi-user editing. CodaScope currently uses optimistic content-hash saves; the design must be correct under that model before adding CRDT/OT collaboration later.

## Product decision

Annotations are not attached to a line number. They are attached to a durable inline marker pair in the note body.

```md
The API returns <!-- codascope:ann-start id="nann_a1b2c3" -->a signed URL<!-- codascope:ann-end id="nann_a1b2c3" --> for the client.
```

- The markers are standard HTML comments, so ordinary Markdown renderers do not display them.
- CodaScope hides their source syntax and renders a comment pin beside the anchored range.
- The annotation's UUID is the only annotation payload in Markdown.
- The thread, authors, replies, reactions, status, audit history, and attachment state remain in the existing per-note annotation sidecar.

Do **not** serialize full thread JSON into the Markdown. It would create noisy note diffs, be fragile to manual edits, and rewrite the note for every reply. Export/import must continue to package the Markdown and its sidecar together.

### Initial scope

Implement range anchors first. A whole-paragraph comment is simply a range covering that paragraph. Do not introduce a second block-marker syntax in the first release; it adds parsing and UI variants without solving a distinct user need.

## Why this replaces the current model

The current `BlockAnchor` stores a hashed whole-block ID, quoted text, section, and line number. Any edit to a block changes its hash. Repair then matches text only at block granularity and can fall back to a nearby line, which can produce a convincing pin at the wrong text.

Inline marker pairs make the Markdown itself the primary placement authority. The sidecar's quote/context is a recovery aid, not the primary location signal.

## Required invariants

1. An open annotation is rendered inline only when exactly one valid marker pair with its ID exists in the note.
2. The comment pin is rendered at the marker location, never at a guessed nearby line.
3. Removing either marker or the selected text never silently reattaches the thread elsewhere.
4. A missing, duplicated, mismatched, or malformed marker pair puts the thread in `needs_review` or `orphaned` state with a clear recovery action.
5. Creating, reattaching, archiving, moving, importing, and exporting annotations preserve the Markdown/sidecar relationship.
6. Annotation control syntax must not be indexed as note text, shown in live preview, or leaked into normal CodaScope reading UI.
7. Every mutation is scoped to the authenticated note scope/visibility and included in the existing audit trail.

## Data model

### Markdown grammar

Use a deliberately narrow grammar, parsed outside fenced code blocks:

```text
<!-- codascope:ann-start id="nann_<stable-id>" -->
<!-- codascope:ann-end id="nann_<stable-id>" -->
```

- IDs must match the server-generated `nann_<hex>` format.
- The parser must report source offsets for both markers and the intervening range.
- Ignore marker-like strings inside fenced code blocks and inline code.
- Reject duplicate start/end markers, unmatched pairs, crossing pairs, and duplicate complete pairs for one ID.
- Never use user-provided IDs when creating a thread.

### Sidecar schema

Retain the per-note `_annotations/<note>-annotations.json` sidecar as the authoritative thread store. Replace the current `BlockAnchor` on `NoteAnnotation` with an inline-anchor record:

```ts
interface InlineAnnotationAnchor {
  kind: "range";
  markerId: string;               // equals annotation id
  quote: string;                  // selected markdown text, preserved for recovery/audit
  prefix: string;                 // bounded surrounding source context
  suffix: string;
  createdAtContentHash: string;
  attachmentState: "attached" | "needs_review" | "orphaned";
  lastVerifiedAt?: string;
  lastDetachedAt?: string;
  detachedReason?: "marker_removed" | "malformed_markers" | "duplicate_marker" | "external_edit";
}
```

Keep legacy anchors readable during migration, but do not keep block ID or line number as active placement data after migration. They may be retained under `legacyAnchor` for audit/debugging only.

## Service and API design

### New single-responsibility module

Add `server/services/codaScopeNoteAnnotationAnchorService.ts` for:

- parsing marker pairs and returning validated range records;
- inserting/removing/replacing marker pairs without corrupting Markdown;
- validating a note against its annotation sidecar;
- deriving attachment states and reconciliation reports;
- stripping marker syntax for search/index display helpers.

It must be a pure, directly tested parser/transformer where possible. It must not own annotation CRUD, note-path resolution, or UI concerns.

### Coordinated mutations

Add a small coordinator to the note annotation route/service boundary so an annotation mutation updates the note and sidecar as one logical operation:

1. Validate `expectedHash` for the note.
2. Insert or remove marker tokens in the Markdown body.
3. Write the note using the note service's normal versioning/index path.
4. Write the sidecar atomically.
5. If the second write fails, restore the prior note content or return a durable recovery error; never report a created annotation without an anchor.
6. Write an audit record with the annotation ID and operation correlation ID.

The current create-annotation API must evolve from “create sidecar record with caller-provided block anchor” to “create range annotation from selection positions plus `expectedHash`.” The server verifies that the selected text is present at those positions before placing the tokens.

### Reconciliation

Run reconciliation after every successful note-body write and whenever annotations are listed.

- Valid unique pair: `attached`; update `lastVerifiedAt`.
- Missing pair: `orphaned`; preserve the thread and its original quote/context.
- Duplicate, malformed, or crossing pairs: `needs_review`; do not render inline pins for that ID.
- The reconciler must persist state changes atomically, but it must never insert a new marker based only on fuzzy text matching.

An explicit **Reattach** action may use quote + prefix/suffix to propose candidate ranges. It must require an unambiguous match or user confirmation before creating a new marker pair.

## Editor behavior

### Creating a comment

1. User selects visible text and presses the compact annotation action.
2. The editor sends selected source positions, selected source text, and current content hash.
3. The server inserts marker pairs around the selected range and creates the sidecar thread.
4. The editor reloads/reconciles the note, hides tokens, and renders a pin beside the range.

### Rendering and editing markers

Create a shared CodeMirror extension for inline annotation tokens. It must:

- parse only validated marker pairs supplied by the server/reconciliation result;
- hide marker syntax in normal editing/live-preview presentation;
- add a persistent, subtle range decoration and compact pin widget at the range end;
- open the matching thread when the pin is clicked;
- treat marker tokens as atomic editor content so ordinary cursor, selection, delete, cut, and paste operations do not expose or strand one token;
- preserve markers when a user moves a range containing an annotation.

Do not render a pin from quote text, line number, block ID, or fuzzy client-side search. Remove the current text-search pin fallback before enabling the inline marker implementation.

### Annotation navigation and panel

Build ordered navigation from parsed marker positions:

- **Next annotation** and **Previous annotation** scroll to the next/previous attached range.
- The annotation panel lists threads in marker order and identifies unresolved/orphaned/review-needed states.
- Clicking a pin opens/focuses its thread; clicking a thread scrolls to its validated marker range.
- Resolve/reopen changes status but leaves the marker in place and muted.
- Archive/delete removes the marker pair and preserves the thread in the archive/audit record.
- Orphaned and review-needed threads show source context plus **Reattach**, **Archive**, and **Delete** actions; they do not show a deceptive in-note pin.

## Migration and compatibility

1. **Feature gate / staged rollout:** do not render the existing block/line pins once the new flow is enabled.
2. **Legacy annotations:** add a one-time migration evaluator. It may insert markers only when the legacy quote has exactly one safe match in the current note and the expected scope/section agrees. Otherwise mark `needs_review`; never pick the nearest line.
3. **Manual/external Markdown edits:** HTML comments usually survive and remain invisible in Markdown renderers, but tools may remove or duplicate them. Reconciliation makes those failures explicit instead of guessing.
4. **Search/index:** strip inline marker syntax before indexing, word counts, search snippets, and AI context extraction.
5. **Versions/diffs:** retain markers in raw versions. The CodaScope diff/viewer should hide control syntax by default while providing a way to inspect annotation-anchor changes for debugging.
6. **Export/import:** bump the notes export manifest to version 2. Include a per-item annotation-anchor format version. Import validates marker/sidecar consistency and reports warnings rather than silently attaching invalid threads.
7. **Moves and folders:** continue using `CodaScopeNoteTransferService` as the only move pipeline. The marker moves in the Markdown and the sidecar relocation remains part of the note bundle transaction.

## Concurrency boundary

For this release, marker insertion/removal and note edits use the existing content-hash conflict mechanism. A stale client must reload rather than overwriting marker changes.

Do not implement Yjs, OT, or real-time presence in this work. Those become necessary only when multiple editors can concurrently mutate the same note. The inline marker grammar and sidecar schema must remain compatible with a future CRDT-backed range mapping layer.

## Implementation sequence

1. **Remove unsafe presentation behavior**
   - Remove client-side quote/nearby-line anchor pinning.
   - Leave existing threads accessible in the annotation panel, clearly marked as legacy while migration is pending.

2. **Anchor parser and tests**
   - Implement `CodaScopeNoteAnnotationAnchorService` with parsing, validation, insertion, removal, and stripping helpers.
   - Add exhaustive unit tests before route/UI work.

3. **Schema and service migration**
   - Extend shared types and sidecar serialization with `InlineAnnotationAnchor` and attachment state.
   - Add safe legacy migration evaluation and annotation reconciliation.
   - Update the annotation API to create/re-attach/archive range anchors using `expectedHash`.

4. **Note mutation coordination**
   - Coordinate note write, version snapshot, sidecar write, reconciliation, and audit events.
   - Add rollback/recovery behavior for partial write failures.

5. **CodeMirror extension and UI**
   - Implement hidden marker decorations, persistent source pins, thread focus, and next/previous navigation.
   - Update the annotation panel for attachment states and recovery actions.

6. **Import/export and move verification**
   - Upgrade manifest/version validation.
   - Verify note/folder moves, archives, exports, and imports retain valid marker-to-thread relationships.

7. **Migration rollout**
   - Run safe automatic migration only for unambiguous legacy anchors.
   - Give users a review list for all unresolved legacy annotations.

## Acceptance test matrix

### Anchor correctness

- Create a range annotation; insert text before, inside, and after the range.
- Move the entire annotated paragraph via cut/paste.
- Move text that excludes one marker; verify `needs_review` or `orphaned`, never a wrong pin.
- Delete selected text, one marker, both markers, and a complete marker pair.
- Duplicate a marker pair or one marker; verify review state and no ambiguous pin.
- Use the same quoted text in multiple places; verify no automatic reattachment without a unique validated marker.
- Annotate text across line breaks and inside common Markdown formatting; ensure Markdown output stays valid.
- Ensure marker-like strings inside fenced code blocks are ignored.

### Product behavior

- Pin opens the intended thread; next/previous annotation follows source order.
- Resolved pins are muted; archive/delete removes pins.
- Orphaned/review threads remain readable and can be explicitly reattached.
- Search, word count, reader context, AI context, and normal Markdown viewer exclude syntax tokens.
- Annotation control syntax is invisible in CodaScope reading mode and ordinary Markdown renderers.

### Data integrity

- Content-hash conflict prevents stale annotation insertion/removal.
- Sidecar/write failure cannot leave a successful-looking orphan marker or sidecar-only thread.
- Move a note, move a folder, archive/restore, export/import, and collision-renamed import; verify marker IDs and sidecars remain paired.
- Raw version history preserves markers and sidecar state is recoverable.

## Files expected to change

- `server/services/codaScopeNoteAnnotationAnchorService.ts` — new parser/reconciler
- `server/services/codaScopeNoteAnnotationService.ts` — thread state and coordinated marker-aware operations
- `server/services/codaScopeNoteService.ts` — coordinated conditional writes only if needed
- `server/routes/codaScopeNoteRoutes.ts` — create/re-attach/archive and validation endpoints
- `server/services/codaScopeNoteTransferService.ts` — verification tests, not a new competing move path
- `server/services/codaScopeNoteExportService.ts` and `server/services/codaScopeNoteImportService.ts` — manifest v2 and validation
- `src/apps/codascope/codaScopeTypes.ts` — inline anchor and attachment-state types
- `src/shared/markdown/extensions/inlineAnnotationExtension.ts` — new shared CodeMirror decorations/widgets
- `src/shared/markdown/MarkdownEditor.tsx` and `src/shared/markdown/index.ts` — optional extension integration
- `src/apps/codascope/views/NoteEditor.tsx` and `src/apps/codascope/components/NoteAnnotationPanel.tsx` — creation, navigation, review/reattach UI
- Relevant service and extension test files

## Definition of done

An annotation follows its explicit marker pair through normal edits and note moves. If CodaScope cannot prove where a thread belongs, it says so and offers recovery; it never renders the thread as pinned to unrelated text.
