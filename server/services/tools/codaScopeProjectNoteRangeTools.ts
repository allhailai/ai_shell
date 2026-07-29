import type { SDKCustomTool } from "@cursor/sdk";
import {
  PROJECT_NOTE_RANGE_MAX_BODY,
} from "../../../src/apps/codascope/projectNoteRangeTargetValidation.js";
import type { ProjectNoteRangeGrantHolder } from "../codaScopeProjectNoteRangeGrant.js";
import type { ProjectNoteRangeActionCollectorHolder } from "../codaScopeProjectNoteRangeMutationActions.js";
import type { CodaScopeProjectNoteRangeService } from "../codaScopeProjectNoteRangeService.js";

export function buildProjectNoteRangeTools(options: {
  actorId: string;
  service: CodaScopeProjectNoteRangeService;
  grantHolder: ProjectNoteRangeGrantHolder;
  actionHolder: ProjectNoteRangeActionCollectorHolder;
}): Record<string, SDKCustomTool> {
  return {
    replace_note_range: {
      description:
        "Replace the one exact server-authorized selection in the current project or epic note. "
        + "Supply only replacementMarkdown; the server owns all note identity, range, line, text, and hash fields. "
        + "An empty replacement deletes the selection.",
      inputSchema: {
        type: "object",
        properties: {
          replacementMarkdown: {
            type: "string",
            maxLength: PROJECT_NOTE_RANGE_MAX_BODY,
            description: "Markdown that replaces the exact authorized selection",
          },
        },
        required: ["replacementMarkdown"],
        additionalProperties: false,
      },
      execute: async (rawArgs) => {
        const args = exactObject(rawArgs, ["replacementMarkdown"]);
        if (!args
          || typeof args.replacementMarkdown !== "string"
          || args.replacementMarkdown.length > PROJECT_NOTE_RANGE_MAX_BODY) {
          return "The exact-range replacement arguments are invalid.";
        }

        const grant = options.grantHolder.reserve();
        if (!grant) {
          return "No active project note-range grant authorizes this replacement.";
        }
        const action = options.actionHolder.reserve();
        if (!action) {
          grant.release();
          return "The project note-range completion action is unavailable.";
        }

        try {
          const note = await options.service.replaceExactRange(
            options.actorId,
            grant.target,
            args.replacementMarkdown,
          );
          action.commit(note, grant.target);
          grant.commit();
          return JSON.stringify({ ok: true, note });
        } catch {
          action.release();
          grant.release();
          return "The exact project note-range replacement could not be confirmed.";
        }
      },
    },
  };
}

function exactObject(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === fields.length
    && keys.every((key) => fields.includes(key))
    ? record
    : null;
}
