/* ── CodaScope: Workspace Per-Turn Note Grant ───────────────────────
   Server-generated, operation-specific authorization for one workspace
   assistant run. Clients and tool arguments never carry this contract.
   ──────────────────────────────────────────────────────────────────── */

import type { NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";
import type {
  CodaScopeWorkspaceNoteService,
  WorkspaceCurrentNoteIdentity,
} from "./codaScopeWorkspaceNoteService.js";
import { assertSafePathSegment } from "./codaScopePathSafety.js";

const MAX_GRANTED_NOTES = 25;

export interface WorkspaceNoteCreateGrant {
  allowed: true;
  sharedRequested: boolean;
}

export interface WorkspaceNoteVisibilityGrant {
  stableId: string;
  visibility: NoteVisibility;
}

export interface WorkspaceTurnNoteGrant {
  create: WorkspaceNoteCreateGrant | null;
  readStableIds: readonly string[];
  editBodyStableIds: readonly string[];
  editTitleStableIds: readonly string[];
  visibilityChanges: readonly WorkspaceNoteVisibilityGrant[];
  archiveStableIds: readonly string[];
}

export const EMPTY_WORKSPACE_TURN_NOTE_GRANT: WorkspaceTurnNoteGrant =
  freezeGrant({
    create: null,
    readStableIds: [],
    editBodyStableIds: [],
    editTitleStableIds: [],
    visibilityChanges: [],
    archiveStableIds: [],
  });

export class WorkspaceTurnNoteGrantHolder {
  current: WorkspaceTurnNoteGrant = EMPTY_WORKSPACE_TURN_NOTE_GRANT;

  replace(grant: WorkspaceTurnNoteGrant): void {
    this.current = grant;
  }

  clear(): void {
    this.current = EMPTY_WORKSPACE_TURN_NOTE_GRANT;
  }
}

export async function deriveWorkspaceTurnNoteGrant(options: {
  actorId?: string;
  message: string;
  currentNote?: WorkspaceCurrentNoteIdentity | null;
  noteService: CodaScopeWorkspaceNoteService;
}): Promise<WorkspaceTurnNoteGrant> {
  if (!options.actorId?.trim()) return EMPTY_WORKSPACE_TURN_NOTE_GRANT;
  const clauses = authorizingClauses(options.message);
  if (clauses.length === 0) return EMPTY_WORKSPACE_TURN_NOTE_GRANT;

  const createClause = clauses.find((clause) => isCreateDirective(clause));
  const archiveRequested = clauses.some((clause) =>
    /\barchive\b/.test(clause) && noteTargetLanguage(clause));
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
    && noteTargetLanguage(clause));

  const needsTarget = archiveRequested
    || titleRequested
    || visibility !== null
    || bodyRequested
    || readRequested;
  let targetStableId: string | null = null;
  if (needsTarget) {
    const exact = await options.noteService.resolveExactReference(
      options.actorId,
      options.message,
    );
    if (exact) {
      targetStableId = exact.stableId;
    } else if (options.currentNote && refersToCurrentNote(clauses)) {
      const current = await options.noteService.resolveCurrentContext(
        options.actorId,
        options.currentNote,
      );
      targetStableId = current?.stableId ?? null;
    }
  }

  const readStableIds = targetStableId && (
    readRequested
    || bodyRequested
    || titleRequested
    || visibility !== null
    || archiveRequested
  ) ? [targetStableId] : [];

  return freezeGrant({
    create: createClause ? {
      allowed: true,
      sharedRequested: /\bshared\b/.test(createClause),
    } : null,
    readStableIds,
    editBodyStableIds: targetStableId && bodyRequested ? [targetStableId] : [],
    editTitleStableIds: targetStableId && titleRequested ? [targetStableId] : [],
    visibilityChanges: targetStableId && visibility
      ? [{ stableId: targetStableId, visibility }]
      : [],
    archiveStableIds: targetStableId && archiveRequested ? [targetStableId] : [],
  });
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
      || hasUnknown(value.create, ["allowed", "sharedRequested"])
      || value.create.allowed !== true
      || typeof value.create.sharedRequested !== "boolean") {
      throw invalidGrant();
    }
    create = {
      allowed: true,
      sharedRequested: value.create.sharedRequested,
    };
  }
  const readStableIds = validateIds(value.readStableIds);
  const editBodyStableIds = validateIds(value.editBodyStableIds);
  const editTitleStableIds = validateIds(value.editTitleStableIds);
  const archiveStableIds = validateIds(value.archiveStableIds);
  if (!Array.isArray(value.visibilityChanges)
    || value.visibilityChanges.length > MAX_GRANTED_NOTES) {
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
    ...editBodyStableIds,
    ...editTitleStableIds,
    ...archiveStableIds,
    ...visibilityChanges.map((entry) => entry.stableId),
  ]) {
    if (!readStableIds.includes(stableId)) throw invalidGrant();
  }

  return freezeGrant({
    create,
    readStableIds,
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

export function canEditWorkspaceNoteBody(
  grant: WorkspaceTurnNoteGrant,
  stableId: string,
): boolean {
  return grant.editBodyStableIds.includes(stableId);
}

export function canEditWorkspaceNoteTitle(
  grant: WorkspaceTurnNoteGrant,
  stableId: string,
): boolean {
  return grant.editTitleStableIds.includes(stableId);
}

export function canChangeWorkspaceNoteVisibility(
  grant: WorkspaceTurnNoteGrant,
  stableId: string,
  visibility: NoteVisibility,
): boolean {
  return grant.visibilityChanges.some((entry) =>
    entry.stableId === stableId && entry.visibility === visibility);
}

export function canArchiveWorkspaceNote(
  grant: WorkspaceTurnNoteGrant,
  stableId: string,
): boolean {
  return grant.archiveStableIds.includes(stableId);
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
  return expanded.split(/[;.!?\n]+|\b(?:but|however|instead)\b/)
    .map((clause) => clause.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((clause) => !/\b(?:do not|does not|did not|can not|will not|should not|never|without|avoid|skip|ignore|no need)\b/.test(clause))
    .filter((clause) => !/\b(?:hypothetically|what if|suppose|example|for example|explain|how would|could i|would i|if i|if we)\b/.test(clause));
}

function isCreateDirective(clause: string): boolean {
  if (!noteTargetLanguage(clause)) return false;
  return /\b(?:create|make|start)\b[\s\S]{0,60}\b(?:new )?(?:codascope )?note\b/.test(clause)
    || /\b(?:draft|write)\b[\s\S]{0,30}\b(?:a |the )?(?:new )?(?:codascope )?note\b/.test(clause)
    || /\bnew (?:codascope )?note\b/.test(clause);
}

function noteTargetLanguage(clause: string): boolean {
  return /\bnote(?:s)?\b/.test(clause);
}

function requestedVisibility(
  clauses: readonly string[],
): NoteVisibility | null {
  const requested = new Set<NoteVisibility>();
  for (const clause of clauses) {
    if (!noteTargetLanguage(clause)) continue;
    const visibilityDirective = /\b(?:make|set|change|move|publish|share)\b/.test(clause)
      && /\b(?:private|shared|visibility|publish|share)\b/.test(clause);
    if (!visibilityDirective) continue;
    if (/\bprivate\b/.test(clause)) requested.add("private");
    if (/\bshared\b|\bpublish\b|\bshare\b/.test(clause)) requested.add("shared");
  }
  return requested.size === 1 ? [...requested][0] : null;
}

function refersToCurrentNote(clauses: readonly string[]): boolean {
  return clauses.some((clause) =>
    /\b(?:this|current|that)\s+note\b/.test(clause)
    || /\b(?:edit|update|rename|retitle|archive|read|inspect|share)\s+it\b/.test(clause));
}

function validateIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_GRANTED_NOTES) {
    throw invalidGrant();
  }
  const ids = value.map((entry) => {
    if (typeof entry !== "string") throw invalidGrant();
    return safeId(entry);
  });
  return [...new Set(ids)];
}

function safeId(value: string): string {
  try {
    return assertSafePathSegment(value, "workspace note stable ID");
  } catch {
    throw invalidGrant();
  }
}

function freezeGrant(grant: {
  create: WorkspaceNoteCreateGrant | null;
  readStableIds: string[];
  editBodyStableIds: string[];
  editTitleStableIds: string[];
  visibilityChanges: WorkspaceNoteVisibilityGrant[];
  archiveStableIds: string[];
}): WorkspaceTurnNoteGrant {
  if (grant.create) Object.freeze(grant.create);
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
