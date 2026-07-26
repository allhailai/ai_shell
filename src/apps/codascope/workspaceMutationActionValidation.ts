import type { CodaScopeAction } from "./codaScopeTypes";

export const WORKSPACE_NOTE_MAX_STABLE_ID = 255;
export const WORKSPACE_NOTE_MAX_PATH = 1_000;
export const WORKSPACE_NOTE_MAX_TITLE = 300;
export const WORKSPACE_NOTE_MAX_BODY = 200_000;
export const WORKSPACE_NOTE_MAX_ACTIONS = 25;
export const WORKSPACE_NOTE_MAX_ACTION_DESCRIPTION = 500;

export const WORKSPACE_NOTE_MUTATION_OPERATIONS = [
  "edit_codascope_note",
  "set_codascope_note_title",
  "set_codascope_note_visibility",
  "archive_codascope_note",
] as const;

export type WorkspaceNoteMutationOperation =
  typeof WORKSPACE_NOTE_MUTATION_OPERATIONS[number];

export interface CanonicalWorkspaceNoteState {
  stableId: string;
  scope: "codascope";
  visibility: "private" | "shared";
  path: string;
  title: string;
  contentHash: string;
}

const OPERATION_SET = new Set<string>(WORKSPACE_NOTE_MUTATION_OPERATIONS);
const ENCODED_SEPARATOR_RE = /%(?:25)*(?:2f|5c)/i;
const WINDOWS_DRIVE_RE = /^[a-z]:/i;

export function normalizeCanonicalWorkspaceNoteState(
  value: unknown,
  expectedStableId?: string,
): CanonicalWorkspaceNoteState | null {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "stableId",
      "scope",
      "visibility",
      "path",
      "title",
      "contentHash",
    ])
    || !isCanonicalStableId(value.stableId)
    || (expectedStableId !== undefined && value.stableId !== expectedStableId)
    || value.scope !== "codascope"
    || (value.visibility !== "private" && value.visibility !== "shared")
    || !isCanonicalNotePath(value.path)
    || !isCanonicalNoteTitle(value.title)
    || !isCanonicalContentHash(value.contentHash)) {
    return null;
  }
  return {
    stableId: value.stableId,
    scope: "codascope",
    visibility: value.visibility,
    path: value.path,
    title: value.title,
    contentHash: value.contentHash,
  };
}

export function normalizeCanonicalWorkspaceMutationActions(
  value: unknown,
): CodaScopeAction[] | null {
  if (!Array.isArray(value) || value.length > WORKSPACE_NOTE_MAX_ACTIONS) {
    return null;
  }
  const actions: CodaScopeAction[] = [];
  const delivered = new Set<string>();
  for (const candidate of value) {
    const action = normalizeCanonicalWorkspaceMutationAction(candidate);
    if (!action) return null;
    const deliveryKey = canonicalDeliveryKey(action);
    if (delivered.has(deliveryKey)) continue;
    delivered.add(deliveryKey);
    actions.push(action);
  }
  return actions;
}

export function normalizeCanonicalWorkspaceMutationAction(
  value: unknown,
): CodaScopeAction | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ["type", "attributes", "description"])
    || (value.type !== "note_created" && value.type !== "operation_completed")
    || !isBoundedNonempty(value.description, WORKSPACE_NOTE_MAX_ACTION_DESCRIPTION)
    || !isRecord(value.attributes)) {
    return null;
  }

  const identityFields = [
    "stableId",
    "scope",
    "visibility",
    "path",
    "title",
    "contentHash",
  ];
  const required = value.type === "note_created"
    ? identityFields
    : ["operation", ...identityFields];
  const attributes = value.attributes;
  if (!hasExactKeys(attributes, required)
    || required.some((field) => typeof attributes[field] !== "string")
    || !isCanonicalStableId(attributes.stableId)
    || attributes.scope !== "codascope"
    || (attributes.visibility !== "private"
      && attributes.visibility !== "shared")
    || !isCanonicalNotePath(attributes.path)
    || !isCanonicalNoteTitle(attributes.title)
    || !isCanonicalContentHash(attributes.contentHash)
    || (value.type === "operation_completed"
      && (typeof attributes.operation !== "string"
        || !OPERATION_SET.has(attributes.operation)))) {
    return null;
  }

  return {
    type: value.type,
    attributes: { ...(attributes as Record<string, string>) },
    description: value.description,
  };
}

function canonicalDeliveryKey(action: CodaScopeAction): string {
  return [
    action.type,
    action.attributes.operation ?? "",
    action.attributes.stableId,
    action.attributes.contentHash,
    action.description,
  ].join("\u0000");
}

export function isCanonicalStableId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= WORKSPACE_NOTE_MAX_STABLE_ID
    && value !== "."
    && value !== ".."
    && !value.includes("\0")
    && !value.includes("/")
    && !value.includes("\\")
    && !ENCODED_SEPARATOR_RE.test(value)
    && !WINDOWS_DRIVE_RE.test(value);
}

export function isCanonicalNotePath(value: unknown): value is string {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > WORKSPACE_NOTE_MAX_PATH
    || value.includes("\0")
    || value.includes("\\")
    || ENCODED_SEPARATOR_RE.test(value)
    || value.startsWith("/")
    || WINDOWS_DRIVE_RE.test(value)
    || !value.endsWith(".md")) {
    return false;
  }
  const segments = value.split("/");
  const filename = segments.at(-1) ?? "";
  return segments.every((segment) =>
    Boolean(segment) && segment !== "." && segment !== "..")
    && !filename.startsWith("_")
    && !filename.startsWith(".")
    && !segments.slice(0, -1).some((segment) =>
      segment.startsWith(".")
      || (segment.startsWith("_") && segment !== "_inbox"));
}

export function isCanonicalNoteTitle(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= WORKSPACE_NOTE_MAX_TITLE
    && value.trim() === value
    && !/[\r\n\u0000]/.test(value);
}

export function isCanonicalContentHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32,128}$/i.test(value);
}

function isBoundedNonempty(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length <= maximum
    && Boolean(value.trim());
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
