/* ── CodaScope: Workspace Per-Turn Note Grant ───────────────────────
   Server-generated, operation-specific, consumable authorization for one
   workspace assistant run. Clients and tool arguments never carry it.
   ──────────────────────────────────────────────────────────────────── */

import type { NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";
import type { CanonicalWorkspaceNoteRangeTarget } from "../../src/apps/codascope/workspaceNoteRangeTargetValidation.js";
import type { WorkspaceNoteMutationOperation } from "../../src/apps/codascope/workspaceMutationActionValidation.js";
import {
  WORKSPACE_NOTE_MAX_ACTIONS,
  WORKSPACE_NOTE_MAX_STABLE_ID,
} from "../../src/apps/codascope/workspaceMutationActionValidation.js";
import type {
  CodaScopeWorkspaceNoteService,
  WorkspaceCurrentNoteIdentity,
} from "./codaScopeWorkspaceNoteService.js";
import {
  revalidateWorkspaceNoteRangeTarget,
} from "./codaScopeWorkspaceNoteRangeTarget.js";
import { assertSafePathSegment } from "./codaScopePathSafety.js";

export interface WorkspaceNoteCreateGrant {
  maxSuccesses: number;
  visibility: NoteVisibility;
}

export interface WorkspaceNoteVisibilityGrant {
  stableId: string;
  visibility: NoteVisibility;
}

/**
 * Every stable ID in a mutation list authorizes one confirmed success. The
 * holder turns this immutable transfer DTO into an isolated consumable session.
 */
export interface WorkspaceTurnNoteGrant {
  create: WorkspaceNoteCreateGrant | null;
  readStableIds: readonly string[];
  editRangeTarget: CanonicalWorkspaceNoteRangeTarget | null;
  editBodyStableIds: readonly string[];
  editTitleStableIds: readonly string[];
  visibilityChanges: readonly WorkspaceNoteVisibilityGrant[];
  archiveStableIds: readonly string[];
}

export const EMPTY_WORKSPACE_TURN_NOTE_GRANT: WorkspaceTurnNoteGrant =
  freezeGrant({
    create: null,
    readStableIds: [],
    editRangeTarget: null,
    editBodyStableIds: [],
    editTitleStableIds: [],
    visibilityChanges: [],
    archiveStableIds: [],
  });

export interface WorkspaceNoteGrantReservation {
  commit(): void;
  release(): void;
}

export interface WorkspaceNoteRangeGrantReservation
  extends WorkspaceNoteGrantReservation {
  target: CanonicalWorkspaceNoteRangeTarget;
}

export class WorkspaceTurnNoteGrantHolder {
  current: WorkspaceTurnNoteGrant = EMPTY_WORKSPACE_TURN_NOTE_GRANT;
  private session = new ConsumableGrantSession(EMPTY_WORKSPACE_TURN_NOTE_GRANT);

  replace(grant: WorkspaceTurnNoteGrant): void {
    this.current = grant;
    this.session = new ConsumableGrantSession(grant);
  }

  clear(): void {
    this.current = EMPTY_WORKSPACE_TURN_NOTE_GRANT;
    this.session = new ConsumableGrantSession(EMPTY_WORKSPACE_TURN_NOTE_GRANT);
  }

  canRead(stableId: string): boolean {
    return this.current.readStableIds.includes(stableId);
  }

  reserveCreate(visibility: NoteVisibility): WorkspaceNoteGrantReservation | null {
    return this.session.reserve(`create:${visibility}`);
  }

  reserveRangeMutation(): WorkspaceNoteRangeGrantReservation | null {
    const target = this.current.editRangeTarget;
    if (!target) return null;
    const reservation = this.session.reserve(rangeMutationBudgetKey(target));
    return reservation ? { ...reservation, target } : null;
  }

  reserveMutation(
    operation: WorkspaceNoteMutationOperation,
    stableId: string,
    visibility?: NoteVisibility,
  ): WorkspaceNoteGrantReservation | null {
    return this.session.reserve(mutationBudgetKey(operation, stableId, visibility));
  }
}

class ConsumableGrantSession {
  private readonly remaining = new Map<string, number>();

  constructor(grant: WorkspaceTurnNoteGrant) {
    if (grant.create) {
      this.remaining.set(
        `create:${grant.create.visibility}`,
        grant.create.maxSuccesses,
      );
    }
    if (grant.editRangeTarget) {
      this.remaining.set(rangeMutationBudgetKey(grant.editRangeTarget), 1);
    }
    for (const stableId of grant.editBodyStableIds) {
      this.remaining.set(mutationBudgetKey("edit_codascope_note", stableId), 1);
    }
    for (const stableId of grant.editTitleStableIds) {
      this.remaining.set(
        mutationBudgetKey("set_codascope_note_title", stableId),
        1,
      );
    }
    for (const entry of grant.visibilityChanges) {
      this.remaining.set(
        mutationBudgetKey(
          "set_codascope_note_visibility",
          entry.stableId,
          entry.visibility,
        ),
        1,
      );
    }
    for (const stableId of grant.archiveStableIds) {
      this.remaining.set(
        mutationBudgetKey("archive_codascope_note", stableId),
        1,
      );
    }
  }

  reserve(key: string): WorkspaceNoteGrantReservation | null {
    const available = this.remaining.get(key) ?? 0;
    if (available <= 0) return null;
    this.remaining.set(key, available - 1);
    let pending = true;
    return {
      commit: () => {
        if (!pending) return;
        pending = false;
      },
      release: () => {
        if (!pending) return;
        pending = false;
        this.remaining.set(key, (this.remaining.get(key) ?? 0) + 1);
      },
    };
  }
}

export async function deriveWorkspaceTurnNoteGrant(options: {
  actorId?: string;
  message: string;
  currentNote?: WorkspaceCurrentNoteIdentity | null;
  noteRangeTarget?: CanonicalWorkspaceNoteRangeTarget | null;
  noteService: CodaScopeWorkspaceNoteService;
}): Promise<WorkspaceTurnNoteGrant> {
  if (!options.actorId?.trim()) return EMPTY_WORKSPACE_TURN_NOTE_GRANT;
  if (options.noteRangeTarget) {
    const target = await revalidateWorkspaceNoteRangeTarget({
      actorId: options.actorId,
      target: options.noteRangeTarget,
      noteService: options.noteService,
    });
    return freezeGrant({
      create: null,
      readStableIds: [target.stableId],
      editRangeTarget: target,
      editBodyStableIds: [],
      editTitleStableIds: [],
      visibilityChanges: [],
      archiveStableIds: [],
    });
  }
  const clauses = authorizingClauses(options.message);
  if (clauses.length === 0) return EMPTY_WORKSPACE_TURN_NOTE_GRANT;

  const create = deriveCreateGrant(clauses);
  const archiveRequested = clauses.some((clause) =>
    /\barchive\b/.test(clause) && noteReferenceLanguage(clause));
  const titleRequested = clauses.some((clause) =>
    (
      /\b(?:rename|retitle)\b/.test(clause)
      || /\b(?:change|set|update)\b[\s\S]{0,40}\btitle\b/.test(clause)
    ) && noteTargetLanguage(clause));
  const visibility = requestedVisibility(clauses);
  const bodyRequested = clauses.some((clause) => {
    if (!noteTargetLanguage(clause)) return false;
    const bodySignal = /\b(?:edit|rewrite|replace|append|revise)\b/.test(clause)
      || /\b(?:add|remove|change|update)\b[\s\S]{0,50}\b(?:body|content|text|section|note)\b/.test(clause);
    const titleOnly = titleRequested
      && /\btitle\b/.test(clause)
      && !/\b(?:body|content|text|section)\b/.test(clause);
    const visibilityOnly = visibility !== null
      && /\b(?:private|shared|visibility|publish|share)\b/.test(clause)
      && !/\b(?:body|content|text|section)\b/.test(clause);
    return bodySignal && !titleOnly && !visibilityOnly && !archiveRequested;
  });
  const readRequested = clauses.some((clause) =>
    /\b(?:read|inspect|review|show|open)\b/.test(clause)
    && noteReferenceLanguage(clause));

  const needsTarget = archiveRequested
    || titleRequested
    || visibility !== null
    || bodyRequested
    || readRequested;
  let targetStableId: string | null = null;
  if (needsTarget) {
    if (refersToCurrentNote(clauses)) {
      if (options.currentNote) {
        const current = await options.noteService.resolveCurrentContext(
          options.actorId,
          options.currentNote,
        );
        targetStableId = current?.stableId ?? null;
      }
    } else {
      const exact = await options.noteService.resolveExactReference(
        options.actorId,
        options.message,
      );
      targetStableId = exact?.stableId ?? null;
    }
  }

  const readStableIds = targetStableId && (
    readRequested
    || bodyRequested
    || titleRequested
    || visibility !== null
    || archiveRequested
  ) ? [targetStableId] : [];

  return freezeGrant(capGrantToReceiptCapacity({
    create,
    readStableIds,
    editRangeTarget: null,
    editBodyStableIds: targetStableId && bodyRequested ? [targetStableId] : [],
    editTitleStableIds: targetStableId && titleRequested ? [targetStableId] : [],
    visibilityChanges: targetStableId && visibility
      ? [{ stableId: targetStableId, visibility }]
      : [],
    archiveStableIds: targetStableId && archiveRequested ? [targetStableId] : [],
  }));
}

/**
 * Strictly parse and revalidate a grant at agent execution. Active resolution
 * is repeated for every granted stable ID; unknown fields fail closed.
 */
export async function validateWorkspaceTurnNoteGrant(
  value: unknown,
  actorId: string,
  noteService: CodaScopeWorkspaceNoteService,
): Promise<WorkspaceTurnNoteGrant> {
  if (!isRecord(value) || hasUnknown(value, [
    "create",
    "readStableIds",
    "editRangeTarget",
    "editBodyStableIds",
    "editTitleStableIds",
    "visibilityChanges",
    "archiveStableIds",
  ])) {
    throw invalidGrant();
  }
  let create: WorkspaceNoteCreateGrant | null = null;
  if (value.create !== null) {
    if (!isRecord(value.create)
      || hasUnknown(value.create, ["maxSuccesses", "visibility"])
      || !Number.isSafeInteger(value.create.maxSuccesses)
      || Number(value.create.maxSuccesses) < 1
      || Number(value.create.maxSuccesses) > WORKSPACE_NOTE_MAX_ACTIONS
      || (value.create.visibility !== "private"
        && value.create.visibility !== "shared")) {
      throw invalidGrant();
    }
    create = {
      maxSuccesses: Number(value.create.maxSuccesses),
      visibility: value.create.visibility,
    };
  }
  const readStableIds = validateIds(value.readStableIds);
  let editRangeTarget: CanonicalWorkspaceNoteRangeTarget | null = null;
  if (value.editRangeTarget !== null) {
    try {
      editRangeTarget = await revalidateWorkspaceNoteRangeTarget({
        actorId,
        target: value.editRangeTarget,
        noteService,
      });
    } catch {
      throw invalidGrant();
    }
  }
  const editBodyStableIds = validateIds(value.editBodyStableIds);
  const editTitleStableIds = validateIds(value.editTitleStableIds);
  const archiveStableIds = validateIds(value.archiveStableIds);
  if (!Array.isArray(value.visibilityChanges)
    || value.visibilityChanges.length > WORKSPACE_NOTE_MAX_ACTIONS) {
    throw invalidGrant();
  }
  const visibilityChanges: WorkspaceNoteVisibilityGrant[] = [];
  for (const entry of value.visibilityChanges) {
    if (!isRecord(entry)
      || hasUnknown(entry, ["stableId", "visibility"])
      || typeof entry.stableId !== "string"
      || (entry.visibility !== "private" && entry.visibility !== "shared")) {
      throw invalidGrant();
    }
    const stableId = safeId(entry.stableId);
    if (visibilityChanges.some((candidate) =>
      candidate.stableId === stableId
      && candidate.visibility === entry.visibility)) {
      continue;
    }
    visibilityChanges.push({ stableId, visibility: entry.visibility });
  }

  const everyId = new Set([
    ...readStableIds,
    ...(editRangeTarget ? [editRangeTarget.stableId] : []),
    ...editBodyStableIds,
    ...editTitleStableIds,
    ...archiveStableIds,
    ...visibilityChanges.map((entry) => entry.stableId),
  ]);
  for (const stableId of everyId) {
    if (!await noteService.resolveActiveNote(actorId, stableId)) {
      throw invalidGrant();
    }
  }
  for (const stableId of [
    ...(editRangeTarget ? [editRangeTarget.stableId] : []),
    ...editBodyStableIds,
    ...editTitleStableIds,
    ...archiveStableIds,
    ...visibilityChanges.map((entry) => entry.stableId),
  ]) {
    if (!readStableIds.includes(stableId)) throw invalidGrant();
  }
  if (editRangeTarget && (
    create !== null
    || readStableIds.length !== 1
    || readStableIds[0] !== editRangeTarget.stableId
    || editBodyStableIds.length > 0
    || editTitleStableIds.length > 0
    || visibilityChanges.length > 0
    || archiveStableIds.length > 0
  )) {
    throw invalidGrant();
  }
  const totalMutationBudget = (create?.maxSuccesses ?? 0)
    + (editRangeTarget ? 1 : 0)
    + editBodyStableIds.length
    + editTitleStableIds.length
    + visibilityChanges.length
    + archiveStableIds.length;
  if (totalMutationBudget > WORKSPACE_NOTE_MAX_ACTIONS) throw invalidGrant();

  return freezeGrant({
    create,
    readStableIds,
    editRangeTarget,
    editBodyStableIds,
    editTitleStableIds,
    visibilityChanges,
    archiveStableIds,
  });
}

export function canReadWorkspaceNote(
  grant: WorkspaceTurnNoteGrant,
  stableId: string,
): boolean {
  return grant.readStableIds.includes(stableId);
}

function deriveCreateGrant(
  clauses: readonly string[],
): WorkspaceNoteCreateGrant | null {
  const directives = clauses
    .filter(isCreateDirective)
    .map((clause) => parseCreateDirective(clause));
  if (directives.length !== 1 || !directives[0]) return null;
  return directives[0];
}

function parseCreateDirective(
  clause: string,
): WorkspaceNoteCreateGrant | null {
  const privateSignal = /\bprivate\b/.test(clause);
  const sharedSignal = /\bshared\b/.test(clause);
  if (privateSignal && sharedSignal) return null;
  const visibility: NoteVisibility = sharedSignal ? "shared" : "private";

  const numeric = clause.match(
    /\b(?:create|make|start|draft|write)\s+(\d{1,3})\s+(?:new\s+)?(?:shared\s+|private\s+)?(?:codascope\s+)?notes\b/,
  );
  if (numeric) {
    const requested = Number(numeric[1]);
    if (!Number.isSafeInteger(requested) || requested < 1) return null;
    return {
      maxSuccesses: Math.min(requested, WORKSPACE_NOTE_MAX_ACTIONS),
      visibility,
    };
  }

  const singular = /\b(?:create|make|start)\b[\s\S]{0,60}\b(?:a|an|one|new)\s+(?:shared\s+|private\s+)?(?:codascope\s+)?note\b/.test(clause)
    || /\b(?:create|make|start|draft|write)\s+(?:shared\s+|private\s+)?(?:codascope\s+)?note\b/.test(clause)
    || /\b(?:draft|write)\b[\s\S]{0,30}\b(?:a|an|one|the|new)\s+(?:shared\s+|private\s+)?(?:codascope\s+)?note\b/.test(clause)
    || /\bnew (?:shared\s+|private\s+)?(?:codascope\s+)?note\b/.test(clause);
  if (!singular || /\bnotes\b/.test(clause)) return null;
  return { maxSuccesses: 1, visibility };
}

function authorizingClauses(message: string): string[] {
  const withoutQuotes = message
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/'[^']*'/g, " ");
  const expanded = withoutQuotes.toLocaleLowerCase()
    .replace(/\b(?:don[’']?t|dont)\b/g, "do not")
    .replace(/\b(?:doesn[’']?t|doesnt)\b/g, "does not")
    .replace(/\b(?:can[’']?t|cant|cannot)\b/g, "can not")
    .replace(/\b(?:won[’']?t|wont)\b/g, "will not");
  return expanded.split(/[;!?\n]+|\.(?:\s+|$)|\b(?:but|however|instead)\b/)
    .map((clause) => clause.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((clause) => !/\b(?:do not|does not|did not|can not|will not|should not|never|without|avoid|skip|ignore|no need)\b/.test(clause))
    .filter((clause) => !/\b(?:hypothetically|what if|suppose|example|for example|explain|how would|could i|would i|if i|if we)\b/.test(clause));
}

function isCreateDirective(clause: string): boolean {
  if (!noteTargetLanguage(clause)) return false;
  return /\b(?:create|make|start)\b[\s\S]{0,60}\b(?:codascope )?note(?:s)?\b/.test(clause)
    || /\b(?:draft|write)\b[\s\S]{0,30}\b(?:a |an |one |the )?(?:new )?(?:codascope )?note(?:s)?\b/.test(clause)
    || /\bnew (?:codascope )?note\b/.test(clause);
}

function noteTargetLanguage(clause: string): boolean {
  return /\bnote(?:s)?\b/.test(clause);
}

function noteReferenceLanguage(clause: string): boolean {
  return noteTargetLanguage(clause)
    || /\b[a-z0-9._/-]+\.md\b/.test(clause)
    || /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/.test(clause);
}

function requestedVisibility(
  clauses: readonly string[],
): NoteVisibility | null {
  const requested = new Set<NoteVisibility>();
  for (const clause of clauses) {
    if (!noteTargetLanguage(clause) || isCreateDirective(clause)) continue;
    const visibilityDirective = /\b(?:make|set|change|move|publish|share)\b/.test(clause)
      && /\b(?:private|shared|visibility|publish|share)\b/.test(clause);
    if (!visibilityDirective) continue;
    if (/\bprivate\b/.test(clause)) requested.add("private");
    if (/\bshared\b|\bpublish\b|\bshare\b/.test(clause)) requested.add("shared");
  }
  return requested.size === 1 ? [...requested][0] : null;
}

function refersToCurrentNote(clauses: readonly string[]): boolean {
  return clauses.some((clause) => {
    const withoutNamedTitle = clause.replace(
      /\bnote\s+(?:named|titled)\s+[\s\S]*$/g,
      " ",
    );
    return /\b(?:this|current|that)\s+note\b/.test(withoutNamedTitle)
      || /\b(?:edit|update|rename|retitle|archive|read|inspect|review|show|open|share|publish|move)\s+it\b/.test(withoutNamedTitle);
  });
}

function mutationBudgetKey(
  operation: WorkspaceNoteMutationOperation,
  stableId: string,
  visibility?: NoteVisibility,
): string {
  return [operation, stableId, visibility ?? ""].join(":");
}

function rangeMutationBudgetKey(
  target: CanonicalWorkspaceNoteRangeTarget,
): string {
  return [
    "replace_codascope_note_range",
    target.stableId,
    target.selectionStart,
    target.selectionEnd,
    target.expectedHash,
  ].join(":");
}

function capGrantToReceiptCapacity(grant: {
  create: WorkspaceNoteCreateGrant | null;
  readStableIds: string[];
  editRangeTarget: CanonicalWorkspaceNoteRangeTarget | null;
  editBodyStableIds: string[];
  editTitleStableIds: string[];
  visibilityChanges: WorkspaceNoteVisibilityGrant[];
  archiveStableIds: string[];
}): typeof grant {
  const existingMutationBudget = (grant.editRangeTarget ? 1 : 0)
    + grant.editBodyStableIds.length
    + grant.editTitleStableIds.length
    + grant.visibilityChanges.length
    + grant.archiveStableIds.length;
  const createCapacity = Math.max(
    0,
    WORKSPACE_NOTE_MAX_ACTIONS - existingMutationBudget,
  );
  if (grant.create) {
    const maxSuccesses = Math.min(grant.create.maxSuccesses, createCapacity);
    grant.create = maxSuccesses > 0
      ? { ...grant.create, maxSuccesses }
      : null;
  }
  return grant;
}

function validateIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > WORKSPACE_NOTE_MAX_ACTIONS) {
    throw invalidGrant();
  }
  const ids = value.map((entry) => {
    if (typeof entry !== "string") throw invalidGrant();
    return safeId(entry);
  });
  return [...new Set(ids)];
}

function safeId(value: string): string {
  if (value.length > WORKSPACE_NOTE_MAX_STABLE_ID) throw invalidGrant();
  try {
    return assertSafePathSegment(value, "workspace note stable ID");
  } catch {
    throw invalidGrant();
  }
}

function freezeGrant(grant: {
  create: WorkspaceNoteCreateGrant | null;
  readStableIds: string[];
  editRangeTarget: CanonicalWorkspaceNoteRangeTarget | null;
  editBodyStableIds: string[];
  editTitleStableIds: string[];
  visibilityChanges: WorkspaceNoteVisibilityGrant[];
  archiveStableIds: string[];
}): WorkspaceTurnNoteGrant {
  if (grant.create) Object.freeze(grant.create);
  if (grant.editRangeTarget) Object.freeze(grant.editRangeTarget);
  for (const entry of grant.visibilityChanges) Object.freeze(entry);
  Object.freeze(grant.readStableIds);
  Object.freeze(grant.editBodyStableIds);
  Object.freeze(grant.editTitleStableIds);
  Object.freeze(grant.visibilityChanges);
  Object.freeze(grant.archiveStableIds);
  return Object.freeze(grant);
}

function hasUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const fields = new Set(allowed);
  return Object.keys(value).some((key) => !fields.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidGrant(): Error {
  return new Error("Invalid workspace note grant.");
}
