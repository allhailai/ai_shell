/* ── CodaScope: Note Tools ────────────────────────────────────────────
   Agent tools for reading and writing notes.
   Read tools available to ALL agent purposes.
   Write tools available to assistant/chat only.

   Uses scope (codascope, project, epic) + visibility (shared, private)
   model instead of the legacy level-based approach.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import type { ToolServices } from "../codaScopeToolServiceFactory.js";
import type { NoteScope, NoteVisibility } from "../../../src/apps/codascope/codaScopeTypes.js";
import type { ToolResultCollectorHolder } from "../codaScopeToolDefinitions.js";
import { formatCompletedAction } from "../codaScopeActionParser.js";

const VALID_SCOPES: NoteScope[] = ["codascope", "project", "epic"];
const VALID_VISIBILITIES: NoteVisibility[] = ["shared", "private"];

/**
 * Build read-only note tools available to ALL agent purposes.
 */
export function buildNoteReadTools(
  projectId: string,
  services: ToolServices,
): Record<string, SDKCustomTool> {
  const { note: noteService } = services;

  return {
    list_notes: {
      description:
        "List notes at a specific scope and visibility. Scopes: codascope, project, epic. " +
        "Visibilities: shared (visible to everyone), private (only the current user). " +
        "For project/epic scopes, the projectId is derived from the current project context. " +
        "Returns note entries with title, tags, dates, and word count.",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: VALID_SCOPES,
            description: "The note scope (where the note lives)",
          },
          visibility: {
            type: "string",
            enum: VALID_VISIBILITIES,
            description: "The note visibility (shared = everyone, private = current user only)",
          },
          folder: {
            type: "string",
            description: "Optional subfolder path to list (e.g., 'meeting-notes/2026')",
          },
          epicId: {
            type: "string",
            description: "Epic ID (required when scope is 'epic')",
          },
        },
        required: ["scope", "visibility"],
      },
      execute: async (args) => {
        const scope = args.scope as NoteScope;
        const visibility = args.visibility as NoteVisibility;
        const folder = args.folder as string | undefined;
        const epicId = args.epicId as string | undefined;
        if (!VALID_SCOPES.includes(scope)) return `Invalid scope: ${scope}`;
        if (!VALID_VISIBILITIES.includes(visibility)) return `Invalid visibility: ${visibility}`;

        try {
          const notes = await noteService.listNotes(scope, visibility, {
            projectId,
            epicId,
          }, folder);

          if (notes.length === 0) {
            return folder
              ? `No notes found in folder "${folder}" at scope "${scope}" (${visibility}).`
              : `No notes found at scope "${scope}" (${visibility}).`;
          }

          return JSON.stringify(
            notes.map((n) => ({
              path: n.path,
              title: n.title,
              tags: n.tags,
              updated: n.updated,
              wordCount: n.wordCount,
              isFolder: n.isFolder || undefined,
              childCount: n.childCount || undefined,
            })),
            null,
            2,
          );
        } catch {
          return `Failed to list notes at scope "${scope}" (${visibility}).`;
        }
      },
    },

    read_note: {
      description:
        "Read the full content of a specific note by scope, visibility, and path. " +
        "Returns the markdown content, frontmatter metadata, and content hash. " +
        "Use list_notes first to discover available note paths.",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: VALID_SCOPES,
            description: "The note scope",
          },
          visibility: {
            type: "string",
            enum: VALID_VISIBILITIES,
            description: "The note visibility",
          },
          path: {
            type: "string",
            description: "The note path (e.g., 'meeting-notes/2026-07-09-standup' or 'architecture-decisions.md')",
          },
          epicId: {
            type: "string",
            description: "Epic ID (required when scope is 'epic')",
          },
        },
        required: ["scope", "visibility", "path"],
      },
      execute: async (args) => {
        const scope = args.scope as NoteScope;
        const visibility = args.visibility as NoteVisibility;
        const notePath = args.path as string;
        const epicId = args.epicId as string | undefined;
        if (!scope || !visibility || !notePath) return "scope, visibility, and path are required.";

        try {
          const result = await noteService.readNote(scope, visibility, {
            projectId,
            epicId,
          }, notePath);

          if (!result) return `Note not found: "${notePath}" at scope "${scope}" (${visibility}).`;

          return `# ${result.frontmatter.title}\n\n` +
            `_Tags: ${result.frontmatter.tags.join(", ") || "none"} | ` +
            `Created: ${result.frontmatter.created} | ` +
            `Updated: ${result.frontmatter.updated}_\n\n` +
            result.content;
        } catch {
          return `Failed to read note "${notePath}" at scope "${scope}" (${visibility}).`;
        }
      },
    },

    search_notes: {
      description:
        "Search across notes for a keyword or phrase within a scope. " +
        "Searches both shared and private notes within the specified scope. " +
        "Returns matching note paths with context snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query (case-insensitive)",
          },
          scope: {
            type: "string",
            enum: VALID_SCOPES,
            description: "The scope to search within (defaults to codascope)",
          },
          epicId: {
            type: "string",
            description: "Epic ID (to search epic-scoped notes)",
          },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = args.query as string;
        const scope = (args.scope as NoteScope) ?? "codascope";
        const epicId = args.epicId as string | undefined;
        if (!query) return "query is required.";

        try {
          const results = await noteService.searchNotes(query, scope, {
            projectId,
            epicId,
          });

          if (results.length === 0) return `No notes matched "${query}" in scope "${scope}".`;

          return JSON.stringify(
            results.map((r) => ({
              scope: r.scope,
              visibility: r.visibility,
              path: r.path,
              title: r.title,
              matchLine: r.matchLine,
              lineNumber: r.lineNumber,
            })),
            null,
            2,
          );
        } catch {
          return `Failed to search notes for "${query}".`;
        }
      },
    },

    list_note_folders: {
      description:
        "List the folder structure for notes at a specific scope and visibility. " +
        "Returns a tree of folders with note counts.",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: VALID_SCOPES,
            description: "The note scope",
          },
          visibility: {
            type: "string",
            enum: VALID_VISIBILITIES,
            description: "The note visibility",
          },
          epicId: {
            type: "string",
            description: "Epic ID (required when scope is 'epic')",
          },
        },
        required: ["scope", "visibility"],
      },
      execute: async (args) => {
        const scope = args.scope as NoteScope;
        const visibility = args.visibility as NoteVisibility;
        const epicId = args.epicId as string | undefined;
        if (!VALID_SCOPES.includes(scope)) return `Invalid scope: ${scope}`;
        if (!VALID_VISIBILITIES.includes(visibility)) return `Invalid visibility: ${visibility}`;

        try {
          const folders = await noteService.listFolders(scope, visibility, {
            projectId,
            epicId,
          });

          if (folders.length === 0) return `No folders found at scope "${scope}" (${visibility}).`;

          return JSON.stringify(folders, null, 2);
        } catch {
          return `Failed to list folders at scope "${scope}" (${visibility}).`;
        }
      },
    },
  };
}

/**
 * Build write note tools — available to assistant/chat purposes only.
 */
export function buildNoteWriteTools(
  projectId: string,
  services: ToolServices,
  collector?: ToolResultCollectorHolder,
): Record<string, SDKCustomTool> {
  const { note: noteService } = services;

  return {
    create_note: {
      description:
        "Create a new note at a specific scope, visibility, and path. Optionally provide initial content. " +
        "If no content is provided, a note with default frontmatter is created. " +
        "The path should include the filename (e.g., 'meeting-notes/standup.md').",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: VALID_SCOPES,
            description: "The note scope to create at",
          },
          visibility: {
            type: "string",
            enum: VALID_VISIBILITIES,
            description: "The note visibility",
          },
          path: {
            type: "string",
            description: "Path for the new note (e.g., 'meeting-notes/standup.md')",
          },
          content: {
            type: "string",
            description: "Optional initial markdown content (frontmatter will be auto-generated if not included)",
          },
          epicId: {
            type: "string",
            description: "Epic ID (required when scope is 'epic')",
          },
        },
        required: ["scope", "visibility", "path"],
      },
      execute: async (args) => {
        const scope = args.scope as NoteScope;
        const visibility = args.visibility as NoteVisibility;
        const notePath = args.path as string;
        const content = args.content as string | undefined;
        const epicId = args.epicId as string | undefined;
        if (!scope || !visibility || !notePath) return "scope, visibility, and path are required.";

        try {
          const result = await noteService.createNote(scope, visibility, {
            projectId,
            epicId,
          }, notePath, content);

          const description = `Created note "${notePath}" at scope "${scope}" (${visibility}).`;
          const resultText = `${description}\n\n${formatCompletedAction("create_note", description, { scope, visibility, notePath, epicId })}`;
          collector?.collect(resultText);
          return resultText;
        } catch (e) {
          return `Failed to create note: ${(e as Error).message}`;
        }
      },
    },

    edit_note: {
      description:
        "Replace the content of an existing note. The content should include the complete " +
        "markdown with frontmatter. Use read_note first to get the current content, then " +
        "modify and pass back the full updated content.",
      inputSchema: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: VALID_SCOPES,
            description: "The note scope",
          },
          visibility: {
            type: "string",
            enum: VALID_VISIBILITIES,
            description: "The note visibility",
          },
          path: {
            type: "string",
            description: "The note path",
          },
          content: {
            type: "string",
            description: "The complete updated markdown content (including frontmatter)",
          },
          epicId: {
            type: "string",
            description: "Epic ID (required when scope is 'epic')",
          },
        },
        required: ["scope", "visibility", "path", "content"],
      },
      execute: async (args) => {
        const scope = args.scope as NoteScope;
        const visibility = args.visibility as NoteVisibility;
        const notePath = args.path as string;
        const content = args.content as string;
        const epicId = args.epicId as string | undefined;
        if (!scope || !visibility || !notePath || !content) return "scope, visibility, path, and content are required.";

        try {
          const result = await noteService.updateNote(scope, visibility, {
            projectId,
            epicId,
          }, notePath, content);

          if (!result) return `Note not found: "${notePath}" at scope "${scope}" (${visibility}).`;
          if ("conflict" in result) {
            return `Conflict: The note was modified since you last read it. Re-read the note and try again.`;
          }

          const description = `Updated note "${notePath}".`;
          const resultText = `${description}\n\n${formatCompletedAction("edit_note", description, { scope, visibility, notePath, epicId })}`;
          collector?.collect(resultText);
          return resultText;
        } catch (e) {
          return `Failed to edit note: ${(e as Error).message}`;
        }
      },
    },
  };
}
