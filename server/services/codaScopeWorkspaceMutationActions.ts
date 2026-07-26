/* ── CodaScope: Trusted Workspace Mutation Actions ──────────────────
   Typed server-only completion records. Model-authored action XML never
   enters this collector.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeAction } from "../../src/apps/codascope/codaScopeTypes.js";
import type { WorkspaceNoteDto } from "./codaScopeWorkspaceNoteService.js";
import { resolveContainedRelativePath } from "./codaScopePathSafety.js";

const MAX_ACTIONS = 25;
const MAX_DESCRIPTION = 500;
const MAX_ATTRIBUTE = 1_000;

export class WorkspaceMutationActionCollector {
  private readonly actions: CodaScopeAction[] = [];
  private readonly createdStableIds = new Set<string>();

  collectNoteCreated(note: WorkspaceNoteDto): void {
    if (this.createdStableIds.has(note.stableId)) return;
    this.createdStableIds.add(note.stableId);
    this.collect(canonicalAction(
      "note_created",
      note,
      `Created CodaScope note "${note.title}".`,
    ));
  }

  collectNoteMutation(
    operation: string,
    note: WorkspaceNoteDto,
    description: string,
  ): void {
    this.collect(canonicalAction("operation_completed", note, description, {
      operation,
    }));
  }

  drain(): CodaScopeAction[] {
    return this.actions.splice(0);
  }

  clear(): void {
    this.actions.splice(0);
    this.createdStableIds.clear();
  }

  private collect(action: CodaScopeAction): void {
    if (this.actions.length >= MAX_ACTIONS) return;
    this.actions.push(validateWorkspaceMutationAction(action));
  }
}

export class WorkspaceMutationActionCollectorHolder {
  current = new WorkspaceMutationActionCollector();

  collectNoteCreated(note: WorkspaceNoteDto): void {
    this.current.collectNoteCreated(note);
  }

  collectNoteMutation(
    operation: string,
    note: WorkspaceNoteDto,
    description: string,
  ): void {
    this.current.collectNoteMutation(operation, note, description);
  }
}

export function validateWorkspaceMutationActions(
  value: unknown,
): CodaScopeAction[] {
  if (!Array.isArray(value) || value.length > MAX_ACTIONS) {
    throw new Error("Invalid workspace mutation actions.");
  }
  const result: CodaScopeAction[] = [];
  const created = new Set<string>();
  for (const candidate of value) {
    const action = validateWorkspaceMutationAction(candidate);
    if (action.type === "note_created") {
      const stableId = action.attributes.stableId;
      if (created.has(stableId)) continue;
      created.add(stableId);
    }
    result.push(action);
  }
  return result;
}

export function validateWorkspaceMutationAction(
  value: unknown,
): CodaScopeAction {
  if (!isRecord(value)
    || hasUnknown(value, ["type", "attributes", "description"])
    || (value.type !== "note_created" && value.type !== "operation_completed")
    || typeof value.description !== "string"
    || value.description.length === 0
    || value.description.length > MAX_DESCRIPTION
    || !isRecord(value.attributes)) {
    throw new Error("Invalid workspace mutation action.");
  }
  const allowed = value.type === "note_created"
    ? ["stableId", "scope", "visibility", "path", "title", "contentHash"]
    : [
        "operation",
        "stableId",
        "scope",
        "visibility",
        "path",
        "title",
        "contentHash",
      ];
  const attributes = value.attributes;
  if (hasUnknown(attributes, allowed)
    || allowed.some((field) => typeof attributes[field] !== "string")
    || attributes.scope !== "codascope"
    || (attributes.visibility !== "private"
      && attributes.visibility !== "shared")
    || !/^[a-f0-9]{32,128}$/i.test(String(attributes.contentHash))
    || Object.values(attributes).some((entry) =>
      typeof entry !== "string" || entry.length === 0 || entry.length > MAX_ATTRIBUTE)) {
    throw new Error("Invalid workspace mutation action.");
  }
  resolveContainedRelativePath(
    "/workspace-note-action-root",
    String(value.attributes.path),
    "workspace note action path",
  );
  return {
    type: value.type,
    attributes: { ...(attributes as Record<string, string>) },
    description: value.description,
  };
}

function canonicalAction(
  type: "note_created" | "operation_completed",
  note: WorkspaceNoteDto,
  description: string,
  extra: Record<string, string> = {},
): CodaScopeAction {
  return {
    type,
    attributes: {
      ...extra,
      stableId: note.stableId,
      scope: "codascope",
      visibility: note.visibility,
      path: note.path,
      title: note.title,
      contentHash: note.contentHash,
    },
    description: description.slice(0, MAX_DESCRIPTION),
  };
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
