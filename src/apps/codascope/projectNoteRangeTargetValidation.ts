import {
  isCanonicalContentHash,
  isCanonicalNotePath,
  isCanonicalNoteTitle,
  isCanonicalStableId,
  WORKSPACE_NOTE_MAX_BODY,
} from "./workspaceMutationActionValidation";

export const PROJECT_NOTE_RANGE_MAX_BODY = WORKSPACE_NOTE_MAX_BODY;
export const PROJECT_NOTE_RANGE_MAX_SELECTED_TEXT = 50_000;
export const PROJECT_NOTE_RANGE_MAX_LINE = PROJECT_NOTE_RANGE_MAX_BODY + 1;

export interface CanonicalProjectNoteRangeTargetBase {
  kind: "note-range";
  stableId: string;
  visibility: "private" | "shared";
  projectId: string;
  path: string;
  title: string;
  selectionStart: number;
  selectionEnd: number;
  selectedText: string;
  startLine: number;
  endLine: number;
  expectedHash: string;
}

export interface CanonicalProjectScopedNoteRangeTarget
  extends CanonicalProjectNoteRangeTargetBase {
  scope: "project";
}

export interface CanonicalEpicScopedNoteRangeTarget
  extends CanonicalProjectNoteRangeTargetBase {
  scope: "epic";
  visibility: "shared";
  epicId: string;
}

export type CanonicalProjectNoteRangeTarget =
  | CanonicalProjectScopedNoteRangeTarget
  | CanonicalEpicScopedNoteRangeTarget;

const PROJECT_FIELDS = [
  "kind",
  "stableId",
  "scope",
  "visibility",
  "projectId",
  "path",
  "title",
  "selectionStart",
  "selectionEnd",
  "selectedText",
  "startLine",
  "endLine",
  "expectedHash",
] as const;

const EPIC_FIELDS = [
  ...PROJECT_FIELDS,
  "epicId",
] as const;

/**
 * Pure structural boundary for project-assistant note selections. It grants
 * no authority: authenticated server canonicalization owns that boundary.
 */
export function normalizeCanonicalProjectNoteRangeTarget(
  value: unknown,
): CanonicalProjectNoteRangeTarget | null {
  if (!isRecord(value)
    || value.kind !== "note-range"
    || (value.scope !== "project" && value.scope !== "epic")) {
    return null;
  }
  const expectedFields = value.scope === "epic" ? EPIC_FIELDS : PROJECT_FIELDS;
  if (!hasExactKeys(value, expectedFields)
    || !isCanonicalStableId(value.stableId)
    || !isCanonicalStableId(value.projectId)
    || (value.visibility !== "private" && value.visibility !== "shared")
    || (value.scope === "epic" && value.visibility !== "shared")
    || (value.scope === "epic" && !isCanonicalStableId(value.epicId))
    || !isCanonicalNotePath(value.path)
    || !isCanonicalNoteTitle(value.title)
    || !isBoundedOffset(value.selectionStart)
    || !isBoundedOffset(value.selectionEnd)
    || value.selectionEnd <= value.selectionStart
    || typeof value.selectedText !== "string"
    || value.selectedText.length === 0
    || value.selectedText.length > PROJECT_NOTE_RANGE_MAX_SELECTED_TEXT
    || value.selectedText.includes("\0")
    || value.selectionEnd - value.selectionStart !== value.selectedText.length
    || !isBoundedLine(value.startLine)
    || !isBoundedLine(value.endLine)
    || value.endLine < value.startLine
    || value.endLine - value.startLine !== countNewlines(value.selectedText)
    || !isCanonicalContentHash(value.expectedHash)) {
    return null;
  }

  const base: CanonicalProjectNoteRangeTargetBase = {
    kind: "note-range",
    stableId: value.stableId,
    visibility: value.visibility,
    projectId: value.projectId,
    path: value.path,
    title: value.title,
    selectionStart: value.selectionStart,
    selectionEnd: value.selectionEnd,
    selectedText: value.selectedText,
    startLine: value.startLine,
    endLine: value.endLine,
    expectedHash: value.expectedHash,
  };
  return value.scope === "epic"
    ? {
        ...base,
        scope: "epic",
        visibility: "shared",
        epicId: value.epicId as string,
      }
    : {
        ...base,
        scope: "project",
      };
}

function isBoundedOffset(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && Number(value) >= 0
    && Number(value) <= PROJECT_NOTE_RANGE_MAX_BODY;
}

function isBoundedLine(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && Number(value) >= 1
    && Number(value) <= PROJECT_NOTE_RANGE_MAX_LINE;
}

function countNewlines(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && keys.every((key) => expected.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
