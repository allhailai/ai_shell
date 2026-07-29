import {
  normalizeCanonicalWorkspaceNoteRangeTarget,
  type CanonicalWorkspaceNoteRangeTarget,
} from "../../src/apps/codascope/workspaceNoteRangeTargetValidation.js";
import type {
  CodaScopeWorkspaceNoteService,
  WorkspaceCurrentNoteIdentity,
  WorkspaceEditableNoteDto,
} from "./codaScopeWorkspaceNoteService.js";

export class WorkspaceNoteRangeTargetInvalidError extends Error {
  readonly code = "invalid_input";
  readonly status = 400;

  constructor() {
    super("The selected CodaScope note range is invalid or stale.");
    this.name = "WorkspaceNoteRangeTargetInvalidError";
  }
}

/**
 * Bind an untrusted structurally valid target to the authenticated actor's
 * freshly resolved current root CodaScope note.
 */
export async function canonicalizeWorkspaceNoteRangeTarget(options: {
  actorId: string;
  currentNote?: WorkspaceCurrentNoteIdentity | null;
  target: unknown;
  noteService: CodaScopeWorkspaceNoteService;
}): Promise<CanonicalWorkspaceNoteRangeTarget> {
  const target = normalizeCanonicalWorkspaceNoteRangeTarget(options.target);
  if (!target
    || !options.currentNote
    || target.stableId !== options.currentNote.stableId
    || target.scope !== options.currentNote.scope) {
    throw new WorkspaceNoteRangeTargetInvalidError();
  }
  const current = await options.noteService.resolveCurrentContext(
    options.actorId,
    options.currentNote,
  );
  if (!current || current.stableId !== target.stableId) {
    throw new WorkspaceNoteRangeTargetInvalidError();
  }
  const editable = await options.noteService.readForEditing(
    options.actorId,
    target.stableId,
  );
  return verifyTargetAgainstEditable(target, editable, current);
}

/**
 * Revalidate a server-owned target immediately before an Agent run. The
 * exact-range mutation primitive performs the final atomic check during use.
 */
export async function revalidateWorkspaceNoteRangeTarget(options: {
  actorId: string;
  target: unknown;
  noteService: CodaScopeWorkspaceNoteService;
}): Promise<CanonicalWorkspaceNoteRangeTarget> {
  const target = normalizeCanonicalWorkspaceNoteRangeTarget(options.target);
  if (!target) throw new WorkspaceNoteRangeTargetInvalidError();
  const editable = await options.noteService.readForEditing(
    options.actorId,
    target.stableId,
  );
  return verifyTargetAgainstEditable(target, editable);
}

function verifyTargetAgainstEditable(
  target: CanonicalWorkspaceNoteRangeTarget,
  editable: WorkspaceEditableNoteDto | null,
  expectedIdentity?: {
    stableId: string;
    scope: "codascope";
    visibility: "private" | "shared";
    path: string;
    title: string;
    contentHash: string;
  },
): CanonicalWorkspaceNoteRangeTarget {
  if (!editable
    || (expectedIdentity !== undefined && !sameIdentity(editable, expectedIdentity))
    || editable.stableId !== target.stableId
    || editable.scope !== target.scope
    || editable.visibility !== target.visibility
    || editable.path !== target.path
    || editable.title !== target.title
    || editable.contentHash !== target.expectedHash
    || target.selectionEnd > editable.body.length
    || !isUnicodeCodePointBoundary(editable.body, target.selectionStart)
    || !isUnicodeCodePointBoundary(editable.body, target.selectionEnd)
    || editable.body.slice(target.selectionStart, target.selectionEnd)
      !== target.selectedText) {
    throw new WorkspaceNoteRangeTargetInvalidError();
  }
  const startLine = lineAtOffset(editable.body, target.selectionStart);
  const endLine = lineAtOffset(editable.body, target.selectionEnd);
  if (target.startLine !== startLine || target.endLine !== endLine) {
    throw new WorkspaceNoteRangeTargetInvalidError();
  }
  return Object.freeze({
    kind: "note-range",
    stableId: editable.stableId,
    scope: "codascope",
    visibility: editable.visibility,
    path: editable.path,
    title: editable.title,
    selectionStart: target.selectionStart,
    selectionEnd: target.selectionEnd,
    selectedText: target.selectedText,
    startLine,
    endLine,
    expectedHash: editable.contentHash,
  });
}

function sameIdentity(
  left: WorkspaceEditableNoteDto,
  right: {
    stableId: string;
    scope: "codascope";
    visibility: "private" | "shared";
    path: string;
    title: string;
    contentHash: string;
  },
): boolean {
  return left.stableId === right.stableId
    && left.scope === right.scope
    && left.visibility === right.visibility
    && left.path === right.path
    && left.title === right.title
    && left.contentHash === right.contentHash;
}

function lineAtOffset(body: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (body.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function isUnicodeCodePointBoundary(body: string, offset: number): boolean {
  if (offset <= 0 || offset >= body.length) return true;
  const preceding = body.charCodeAt(offset - 1);
  const following = body.charCodeAt(offset);
  return !(preceding >= 0xD800
    && preceding <= 0xDBFF
    && following >= 0xDC00
    && following <= 0xDFFF);
}
