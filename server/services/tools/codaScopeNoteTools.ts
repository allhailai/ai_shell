/* ── CodaScope: Note Tools ────────────────────────────────────────────
   Agent tools for reading and writing notes.
   Read tools available to ALL agent purposes.
   Write tools available to assistant/chat only.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import type { ToolServices } from "../codaScopeToolServiceFactory.js";
import type { NoteLevel } from "../../../src/apps/codascope/codaScopeTypes.js";

const VALID_LEVELS: NoteLevel[] = ["personal", "public", "project", "epic"];

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
        "List notes at a specific level and optional folder. Levels: personal, public, project, epic. " +
        "For project/epic levels, the projectId is derived from the current project context. " +
        "Returns note entries with title, tags, dates, and word count.",
      inputSchema: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: VALID_LEVELS,
            description: "The note level to list",
          },
          folder: {
            type: "string",
            description: "Optional subfolder path to list (e.g., 'meeting-notes/2026')",
          },
          epicId: {
            type: "string",
            description: "Epic ID (required when level is 'epic')",
          },
        },
        required: ["level"],
      },
      execute: async (args) => {
        const level = args.level as NoteLevel;
        const folder = args.folder as string | undefined;
        const epicId = args.epicId as string | undefined;
        if (!VALID_LEVELS.includes(level)) return `Invalid level: ${level}`;

        try {
          const notes = await noteService.listNotes(level, {
            projectId,
            epicId,
          }, folder);

          if (notes.length === 0) {
            return folder
              ? `No notes found in folder "${folder}" at level "${level}".`
              : `No notes found at level "${level}".`;
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
          return `Failed to list notes at level "${level}".`;
        }
      },
    },

    read_note: {
      description:
        "Read the full content of a specific note by level and path. " +
        "Returns the markdown content, frontmatter metadata, and content hash. " +
        "Use list_notes first to discover available note paths.",
      inputSchema: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: VALID_LEVELS,
            description: "The note level",
          },
          path: {
            type: "string",
            description: "The note path (e.g., 'meeting-notes/2026-07-09-standup' or 'architecture-decisions.md')",
          },
          epicId: {
            type: "string",
            description: "Epic ID (required when level is 'epic')",
          },
        },
        required: ["level", "path"],
      },
      execute: async (args) => {
        const level = args.level as NoteLevel;
        const notePath = args.path as string;
        const epicId = args.epicId as string | undefined;
        if (!level || !notePath) return "level and path are required.";

        try {
          const result = await noteService.readNote(level, {
            projectId,
            epicId,
          }, notePath);

          if (!result) return `Note not found: "${notePath}" at level "${level}".`;

          return `# ${result.frontmatter.title}\n\n` +
            `_Tags: ${result.frontmatter.tags.join(", ") || "none"} | ` +
            `Created: ${result.frontmatter.created} | ` +
            `Updated: ${result.frontmatter.updated}_\n\n` +
            result.content;
        } catch {
          return `Failed to read note "${notePath}" at level "${level}".`;
        }
      },
    },

    search_notes: {
      description:
        "Search across notes for a keyword or phrase. Searches across all accessible levels " +
        "(personal, public, project, epic). Returns matching note paths with context snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query (case-insensitive)",
          },
          epicId: {
            type: "string",
            description: "Epic ID (to include epic-level notes in search)",
          },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = args.query as string;
        const epicId = args.epicId as string | undefined;
        if (!query) return "query is required.";

        try {
          const results = await noteService.searchNotes(query, {
            projectId,
            epicId,
          });

          if (results.length === 0) return `No notes matched "${query}".`;

          return JSON.stringify(
            results.map((r) => ({
              level: r.level,
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
        "List the folder structure for notes at a specific level. " +
        "Returns a tree of folders with note counts.",
      inputSchema: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: VALID_LEVELS,
            description: "The note level",
          },
          epicId: {
            type: "string",
            description: "Epic ID (required when level is 'epic')",
          },
        },
        required: ["level"],
      },
      execute: async (args) => {
        const level = args.level as NoteLevel;
        const epicId = args.epicId as string | undefined;
        if (!VALID_LEVELS.includes(level)) return `Invalid level: ${level}`;

        try {
          const folders = await noteService.listFolders(level, {
            projectId,
            epicId,
          });

          if (folders.length === 0) return `No folders found at level "${level}".`;

          return JSON.stringify(folders, null, 2);
        } catch {
          return `Failed to list folders at level "${level}".`;
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
): Record<string, SDKCustomTool> {
  const { note: noteService } = services;

  return {
    create_note: {
      description:
        "Create a new note at a specific level and path. Optionally provide initial content. " +
        "If no content is provided, a note with default frontmatter is created. " +
        "The path should include the filename (e.g., 'meeting-notes/standup.md').",
      inputSchema: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: VALID_LEVELS,
            description: "The note level to create at",
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
            description: "Epic ID (required when level is 'epic')",
          },
        },
        required: ["level", "path"],
      },
      execute: async (args) => {
        const level = args.level as NoteLevel;
        const notePath = args.path as string;
        const content = args.content as string | undefined;
        const epicId = args.epicId as string | undefined;
        if (!level || !notePath) return "level and path are required.";

        try {
          const result = await noteService.createNote(level, {
            projectId,
            epicId,
          }, notePath, content);

          return `Created note "${notePath}" at level "${level}". Hash: ${result.contentHash}`;
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
          level: {
            type: "string",
            enum: VALID_LEVELS,
            description: "The note level",
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
            description: "Epic ID (required when level is 'epic')",
          },
        },
        required: ["level", "path", "content"],
      },
      execute: async (args) => {
        const level = args.level as NoteLevel;
        const notePath = args.path as string;
        const content = args.content as string;
        const epicId = args.epicId as string | undefined;
        if (!level || !notePath || !content) return "level, path, and content are required.";

        try {
          const result = await noteService.updateNote(level, {
            projectId,
            epicId,
          }, notePath, content);

          if (!result) return `Note not found: "${notePath}" at level "${level}".`;
          if ("conflict" in result) {
            return `Conflict: The note was modified since you last read it. Re-read the note and try again.`;
          }

          return `Updated note "${notePath}". New hash: ${result.contentHash}`;
        } catch (e) {
          return `Failed to edit note: ${(e as Error).message}`;
        }
      },
    },
  };
}
