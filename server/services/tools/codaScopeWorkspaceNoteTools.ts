/* ── CodaScope: Workspace Note Tools ────────────────────────────────
   Dedicated stable-ID tools for CodaScope notes. No project tool tier is
   reused and no caller-controlled scope or actor authority is accepted.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool, SDKJsonValue } from "@cursor/sdk";
import type { NoteVisibility } from "../../../src/apps/codascope/codaScopeTypes.js";
import type { CodaScopeWorkspaceNoteService } from "../codaScopeWorkspaceNoteService.js";
import {
  WorkspaceNoteConflictError,
  WorkspaceNoteInvalidInputError,
  WorkspaceNoteUnavailableError,
} from "../codaScopeWorkspaceNoteService.js";
import type { WorkspaceTurnNoteGrantHolder } from "../codaScopeWorkspaceNoteGrant.js";
import type { WorkspaceNoteGrantReservation } from "../codaScopeWorkspaceNoteGrant.js";
import type {
  WorkspaceMutationActionCollectorHolder,
  WorkspaceMutationActionReservation,
} from "../codaScopeWorkspaceMutationActions.js";
import {
  WORKSPACE_NOTE_MAX_BODY,
  WORKSPACE_NOTE_MAX_PATH,
  WORKSPACE_NOTE_MAX_STABLE_ID,
  WORKSPACE_NOTE_MAX_TITLE,
} from "../../../src/apps/codascope/workspaceMutationActionValidation.js";

const UNAUTHORIZED =
  "This CodaScope note operation is not authorized for the current turn. Ask the user to clarify the exact note and operation.";
const UNAVAILABLE = "The requested CodaScope note is unavailable.";
const INVALID = "The CodaScope note operation input is invalid.";
const MAX_BODY = WORKSPACE_NOTE_MAX_BODY;
const MAX_TITLE = WORKSPACE_NOTE_MAX_TITLE;
const MAX_PATH = WORKSPACE_NOTE_MAX_PATH;
const MAX_REASON = 500;

type ToolArgs = Record<string, unknown>;

export function buildWorkspaceNoteTools(
  actorId: string,
  noteService: CodaScopeWorkspaceNoteService,
  grantHolder: WorkspaceTurnNoteGrantHolder,
  actionHolder: WorkspaceMutationActionCollectorHolder,
): Record<string, SDKCustomTool> {
  return {
    read_codascope_note: {
      description:
        "Read the current body and canonical metadata of one explicitly authorized active CodaScope note by stable ID. Use the returned contentHash for a mutation.",
      inputSchema: objectSchema({
        stableId: idProperty(),
      }, ["stableId"]),
      execute: async (rawArgs) => controlled(async () => {
        const args = exactArgs(rawArgs, ["stableId"]);
        const stableId = requiredString(
          args,
          "stableId",
          WORKSPACE_NOTE_MAX_STABLE_ID,
        );
        if (!grantHolder.canRead(stableId)) {
          throw new WorkspaceNoteGrantRefusal();
        }
        const note = await noteService.readForEditing(actorId, stableId);
        if (!note) throw new WorkspaceNoteUnavailableError();
        if (typeof note.body !== "string" || note.body.length > MAX_BODY) {
          throw new WorkspaceNoteUnavailableError();
        }
        return JSON.stringify(note);
      }),
    },

    create_codascope_note: {
      description:
        "Create a structured active CodaScope note. New notes default private; visibility may be shared only when the user explicitly requested shared creation for this turn. Body text is never interpreted as frontmatter.",
      inputSchema: objectSchema({
        path: {
          type: "string",
          description: "Contained relative CodaScope note path ending in .md",
          minLength: 1,
          maxLength: MAX_PATH,
        },
        title: {
          type: "string",
          description: "Display title",
          minLength: 1,
          maxLength: MAX_TITLE,
        },
        body: {
          type: "string",
          description: "Markdown body without client-authored frontmatter",
          maxLength: MAX_BODY,
        },
        visibility: {
          type: "string",
          enum: ["private", "shared"],
          description: "Optional visibility; defaults to private",
        },
      }, ["path", "title", "body"]),
      execute: async (rawArgs) => controlled(async () => {
        const args = exactArgs(rawArgs, ["path", "title", "body", "visibility"]);
        const visibility = optionalVisibility(args, "visibility") ?? "private";
        const note = await withMutationReservations(
          grantHolder.reserveCreate(visibility),
          actionHolder,
          () => noteService.createNote(actorId, {
            path: requiredString(args, "path", MAX_PATH),
            title: requiredString(args, "title", MAX_TITLE),
            body: requiredString(args, "body", MAX_BODY, true),
            visibility,
          }, {
            sharedRequested: visibility === "shared",
          }),
          (reservation, created) => reservation.commitNoteCreated(created),
        );
        return JSON.stringify({ ok: true, note });
      }),
    },

    edit_codascope_note: {
      description:
        "Replace only the Markdown body of one explicitly authorized active CodaScope note by stable ID. Requires the exact contentHash returned by read_codascope_note.",
      inputSchema: objectSchema({
        stableId: idProperty(),
        body: {
          type: "string",
          description: "Complete replacement Markdown body",
          maxLength: MAX_BODY,
        },
        expectedHash: hashProperty(),
      }, ["stableId", "body", "expectedHash"]),
      execute: async (rawArgs) => controlled(async () => {
        const args = exactArgs(rawArgs, ["stableId", "body", "expectedHash"]);
        const stableId = requiredString(
          args,
          "stableId",
          WORKSPACE_NOTE_MAX_STABLE_ID,
        );
        const note = await withMutationReservations(
          grantHolder.reserveMutation("edit_codascope_note", stableId),
          actionHolder,
          () => noteService.replaceBody(
            actorId,
            stableId,
            requiredString(args, "body", MAX_BODY, true),
            requiredHash(args),
          ),
          (reservation, updated) => reservation.commitNoteMutation(
            "edit_codascope_note",
            updated,
            `Updated CodaScope note "${updated.title}".`,
          ),
        );
        return JSON.stringify({ ok: true, note });
      }),
    },

    set_codascope_note_title: {
      description:
        "Change only the display title of one explicitly authorized active CodaScope note. The relative note path is preserved.",
      inputSchema: objectSchema({
        stableId: idProperty(),
        title: {
          type: "string",
          description: "New display title",
          minLength: 1,
          maxLength: MAX_TITLE,
        },
        expectedHash: hashProperty(),
      }, ["stableId", "title", "expectedHash"]),
      execute: async (rawArgs) => controlled(async () => {
        const args = exactArgs(rawArgs, ["stableId", "title", "expectedHash"]);
        const stableId = requiredString(
          args,
          "stableId",
          WORKSPACE_NOTE_MAX_STABLE_ID,
        );
        const note = await withMutationReservations(
          grantHolder.reserveMutation("set_codascope_note_title", stableId),
          actionHolder,
          () => noteService.setTitle(
            actorId,
            stableId,
            requiredString(args, "title", MAX_TITLE),
            requiredHash(args),
          ),
          (reservation, updated) => reservation.commitNoteMutation(
            "set_codascope_note_title",
            updated,
            `Changed the display title to "${updated.title}".`,
          ),
        );
        return JSON.stringify({ ok: true, note });
      }),
    },

    set_codascope_note_visibility: {
      description:
        "Move the complete managed bundle of one explicitly authorized active CodaScope note between private and shared visibility.",
      inputSchema: objectSchema({
        stableId: idProperty(),
        visibility: {
          type: "string",
          enum: ["private", "shared"],
          description: "Requested destination visibility",
        },
        expectedHash: hashProperty(),
      }, ["stableId", "visibility", "expectedHash"]),
      execute: async (rawArgs) => controlled(async () => {
        const args = exactArgs(rawArgs, [
          "stableId",
          "visibility",
          "expectedHash",
        ]);
        const stableId = requiredString(
          args,
          "stableId",
          WORKSPACE_NOTE_MAX_STABLE_ID,
        );
        const visibility = requiredVisibility(args, "visibility");
        const note = await withMutationReservations(
          grantHolder.reserveMutation(
            "set_codascope_note_visibility",
            stableId,
            visibility,
          ),
          actionHolder,
          () => noteService.setVisibility(
            actorId,
            stableId,
            visibility,
            requiredHash(args),
          ),
          (reservation, updated) => reservation.commitNoteMutation(
            "set_codascope_note_visibility",
            updated,
            `Changed CodaScope note visibility to ${visibility}.`,
          ),
        );
        return JSON.stringify({ ok: true, note });
      }),
    },

    archive_codascope_note: {
      description:
        "Recoverably archive one explicitly authorized active CodaScope note and its complete managed bundle. Permanent deletion is unavailable.",
      inputSchema: objectSchema({
        stableId: idProperty(),
        expectedHash: hashProperty(),
        reason: {
          type: "string",
          description: "Optional bounded archive reason",
          maxLength: MAX_REASON,
        },
      }, ["stableId", "expectedHash"]),
      execute: async (rawArgs) => controlled(async () => {
        const args = exactArgs(rawArgs, ["stableId", "expectedHash", "reason"]);
        const stableId = requiredString(
          args,
          "stableId",
          WORKSPACE_NOTE_MAX_STABLE_ID,
        );
        const note = await withMutationReservations(
          grantHolder.reserveMutation("archive_codascope_note", stableId),
          actionHolder,
          () => noteService.archiveNote(
            actorId,
            stableId,
            requiredHash(args),
            optionalString(args, "reason", MAX_REASON),
          ),
          (reservation, archived) => reservation.commitNoteMutation(
            "archive_codascope_note",
            archived,
            `Archived CodaScope note "${archived.title}".`,
          ),
        );
        return JSON.stringify({ ok: true, archived: true, note });
      }),
    },
  };
}

class WorkspaceNoteGrantRefusal extends Error {}

async function withMutationReservations<T>(
  grantReservation: WorkspaceNoteGrantReservation | null,
  actionHolder: WorkspaceMutationActionCollectorHolder,
  mutation: () => Promise<T>,
  commitReceipt: (
    reservation: WorkspaceMutationActionReservation,
    result: T,
  ) => void,
): Promise<T> {
  if (!grantReservation) throw new WorkspaceNoteGrantRefusal();
  const actionReservation = actionHolder.reserve();
  if (!actionReservation) {
    grantReservation.release();
    throw new WorkspaceNoteGrantRefusal();
  }
  try {
    const result = await mutation();
    commitReceipt(actionReservation, result);
    grantReservation.commit();
    return result;
  } catch (error) {
    if (isConfirmedNonMutationFailure(error)) {
      grantReservation.release();
      actionReservation.release();
    } else {
      grantReservation.commit();
      actionReservation.abandon();
    }
    throw error;
  }
}

function isConfirmedNonMutationFailure(error: unknown): boolean {
  return error instanceof WorkspaceNoteConflictError
    || error instanceof WorkspaceNoteUnavailableError
    || error instanceof WorkspaceNoteInvalidInputError;
}

async function controlled(operation: () => Promise<string>): Promise<string> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkspaceNoteGrantRefusal) return UNAUTHORIZED;
    if (error instanceof WorkspaceNoteConflictError) {
      return JSON.stringify({
        ok: false,
        error: "conflict",
        message: "The note changed. Read it again before retrying.",
        currentHash: error.currentHash,
      });
    }
    if (error instanceof WorkspaceNoteUnavailableError) return UNAVAILABLE;
    if (error instanceof WorkspaceNoteInvalidInputError) return INVALID;
    return UNAVAILABLE;
  }
}

function exactArgs(
  value: unknown,
  fields: readonly string[],
): ToolArgs {
  if (!isRecord(value)) throw new WorkspaceNoteInvalidInputError(INVALID);
  const allowed = new Set(fields);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new WorkspaceNoteInvalidInputError(INVALID);
  }
  return value;
}

function requiredString(
  args: ToolArgs,
  key: string,
  maximum: number,
  allowEmpty = false,
): string {
  const value = args[key];
  if (typeof value !== "string"
    || value.length > maximum
    || (!allowEmpty && !value.trim())) {
    throw new WorkspaceNoteInvalidInputError(INVALID);
  }
  return allowEmpty ? value : value.trim();
}

function optionalString(
  args: ToolArgs,
  key: string,
  maximum: number,
): string | undefined {
  if (args[key] === undefined) return undefined;
  return requiredString(args, key, maximum, true);
}

function requiredHash(args: ToolArgs): string {
  const value = requiredString(args, "expectedHash", 128);
  if (!/^[a-f0-9]{32,128}$/i.test(value)) {
    throw new WorkspaceNoteInvalidInputError(INVALID);
  }
  return value;
}

function requiredVisibility(
  args: ToolArgs,
  key: string,
): NoteVisibility {
  const value = args[key];
  if (value !== "private" && value !== "shared") {
    throw new WorkspaceNoteInvalidInputError(INVALID);
  }
  return value;
}

function optionalVisibility(
  args: ToolArgs,
  key: string,
): NoteVisibility | undefined {
  return args[key] === undefined ? undefined : requiredVisibility(args, key);
}

function idProperty(): SDKJsonValue {
  return {
    type: "string",
    description: "Server-issued stable CodaScope note ID",
    minLength: 1,
    maxLength: WORKSPACE_NOTE_MAX_STABLE_ID,
  };
}

function hashProperty(): SDKJsonValue {
  return {
    type: "string",
    description: "Exact current content hash",
    minLength: 32,
    maxLength: 128,
  };
}

function objectSchema(
  properties: Record<string, SDKJsonValue>,
  required: string[],
): Record<string, SDKJsonValue> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
