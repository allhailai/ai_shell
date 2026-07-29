import type { CodaScopeAction } from "./codaScopeTypes";
import {
  isCanonicalContentHash,
  isCanonicalNotePath,
  isCanonicalNoteTitle,
  isCanonicalStableId,
} from "./workspaceMutationActionValidation";
import { PROJECT_NOTE_RANGE_MAX_LINE } from "./projectNoteRangeTargetValidation";

export const PROJECT_NOTE_RANGE_OPERATION = "replace_note_range";
export const PROJECT_NOTE_RANGE_MAX_ACTION_DESCRIPTION = 500;

const PROJECT_ATTRIBUTE_FIELDS = [
  "operation",
  "stableId",
  "scope",
  "visibility",
  "projectId",
  "path",
  "title",
  "contentHash",
  "startLine",
  "endLine",
] as const;

const EPIC_ATTRIBUTE_FIELDS = [
  ...PROJECT_ATTRIBUTE_FIELDS,
  "epicId",
] as const;

export function normalizeCanonicalProjectNoteRangeAction(
  value: unknown,
): CodaScopeAction | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ["type", "attributes", "description"])
    || value.type !== "operation_completed"
    || typeof value.description !== "string"
    || !value.description.trim()
    || value.description.length > PROJECT_NOTE_RANGE_MAX_ACTION_DESCRIPTION
    || !isRecord(value.attributes)) {
    return null;
  }
  const attributes = value.attributes;
  const scope = attributes.scope;
  const expectedFields = scope === "epic"
    ? EPIC_ATTRIBUTE_FIELDS
    : PROJECT_ATTRIBUTE_FIELDS;
  if (!hasExactKeys(attributes, expectedFields)
    || expectedFields.some((field) => typeof attributes[field] !== "string")
    || attributes.operation !== PROJECT_NOTE_RANGE_OPERATION
    || (scope !== "project" && scope !== "epic")
    || !isCanonicalStableId(attributes.stableId)
    || !isCanonicalStableId(attributes.projectId)
    || (attributes.visibility !== "private" && attributes.visibility !== "shared")
    || (scope === "epic"
      && (attributes.visibility !== "shared"
        || !isCanonicalStableId(attributes.epicId)))
    || !isCanonicalNotePath(attributes.path)
    || !isCanonicalNoteTitle(attributes.title)
    || !isCanonicalContentHash(attributes.contentHash)
    || !isCanonicalLine(attributes.startLine)
    || !isCanonicalLine(attributes.endLine)
    || Number(attributes.endLine) < Number(attributes.startLine)) {
    return null;
  }
  return {
    type: "operation_completed",
    attributes: { ...(attributes as Record<string, string>) },
    description: value.description,
  };
}

export function isProjectNoteRangeActionCandidate(value: unknown): boolean {
  return isRecord(value)
    && value.type === "operation_completed"
    && isRecord(value.attributes)
    && value.attributes.operation === PROJECT_NOTE_RANGE_OPERATION;
}

function isCanonicalLine(value: unknown): value is string {
  return typeof value === "string"
    && /^[1-9]\d{0,6}$/.test(value)
    && Number(value) <= PROJECT_NOTE_RANGE_MAX_LINE;
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
