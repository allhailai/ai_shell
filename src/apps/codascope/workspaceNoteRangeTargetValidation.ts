import {
  isCanonicalContentHash,
  isCanonicalNotePath,
  isCanonicalNoteTitle,
  isCanonicalStableId,
  WORKSPACE_NOTE_MAX_BODY,
} from "./workspaceMutationActionValidation";

export const WORKSPACE_NOTE_RANGE_MAX_SELECTED_TEXT = 50_000;
export const WORKSPACE_NOTE_RANGE_MAX_LINE = WORKSPACE_NOTE_MAX_BODY + 1;

export interface CanonicalWorkspaceNoteRangeTarget {
  kind: "note-range";
  stableId: string;
  scope: "codascope";
  visibility: "private" | "shared";
  path: string;
  title: string;
  selectionStart: number;
  selectionEnd: number;
  selectedText: string;
  startLine: number;
  endLine: number;
  expectedHash: string;
}

const TARGET_FIELDS = [
  "kind",
  "stableId",
  "scope",
  "visibility",
  "path",
  "title",
  "selectionStart",
  "selectionEnd",
  "selectedText",
  "startLine",
  "endLine",
  "expectedHash",
] as const;

/**
 * Pure structural boundary shared by request producers, transport consumers,
 * and persisted-conversation readers. Passing this check does not grant note
 * access; authenticated server canonicalization owns that boundary.
 */
export function normalizeCanonicalWorkspaceNoteRangeTarget(
  value: unknown,
): CanonicalWorkspaceNoteRangeTarget | null {
  if (!isRecord(value)
    || !hasExactKeys(value, TARGET_FIELDS)
    || value.kind !== "note-range"
    || !isCanonicalStableId(value.stableId)
    || value.scope !== "codascope"
    || (value.visibility !== "private" && value.visibility !== "shared")
    || !isCanonicalNotePath(value.path)
    || !isCanonicalNoteTitle(value.title)
    || !isBoundedOffset(value.selectionStart)
    || !isBoundedOffset(value.selectionEnd)
    || value.selectionEnd <= value.selectionStart
    || typeof value.selectedText !== "string"
    || value.selectedText.length === 0
    || value.selectedText.length > WORKSPACE_NOTE_RANGE_MAX_SELECTED_TEXT
    || value.selectedText.includes("\0")
    || value.selectionEnd - value.selectionStart !== value.selectedText.length
    || !isBoundedLine(value.startLine)
    || !isBoundedLine(value.endLine)
    || value.endLine < value.startLine
    || value.endLine - value.startLine !== countNewlines(value.selectedText)
    || !isCanonicalContentHash(value.expectedHash)) {
    return null;
  }
  return {
    kind: "note-range",
    stableId: value.stableId,
    scope: "codascope",
    visibility: value.visibility,
    path: value.path,
    title: value.title,
    selectionStart: value.selectionStart,
    selectionEnd: value.selectionEnd,
    selectedText: value.selectedText,
    startLine: value.startLine,
    endLine: value.endLine,
    expectedHash: value.expectedHash,
  };
}

function isBoundedOffset(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && Number(value) >= 0
    && Number(value) <= WORKSPACE_NOTE_MAX_BODY;
}

function isBoundedLine(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && Number(value) >= 1
    && Number(value) <= WORKSPACE_NOTE_RANGE_MAX_LINE;
}

function countNewlines(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character === "\n") count += 1;
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
