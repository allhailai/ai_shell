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
import type { ProjectNoteRangeGrantHolder } from "../codaScopeProjectNoteRangeGrant.js";
import { formatCompletedAction } from "../codaScopeActionParser.js";
import { stripInlineAnnotationMarkers } from "../codaScopeNoteAnnotationAnchorService.js";

const VALID_SCOPES: NoteScope[] = ["codascope", "project", "epic"];
const VALID_VISIBILITIES: NoteVisibility[] = ["shared", "private"];

/**
 * Build read-only note tools available to ALL agent purposes.
 */
export function buildNoteReadTools(
  projectId: string,
  services: ToolServices,
  actorId?: string,
): Record<string, SDKCustomTool> {
  const { note: noteService, noteDocuments: documentService } = services;
  const noteOpts = (epicId?: string) => ({ projectId, epicId, ...(actorId ? { userId: actorId } : {}) });

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
          const notes = await noteService.listNotes(scope, visibility, noteOpts(epicId), folder);

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
          const result = await noteService.readNote(scope, visibility, noteOpts(epicId), notePath);

          if (!result) return `Note not found: "${notePath}" at scope "${scope}" (${visibility}).`;

          return `# ${result.frontmatter.title}\n\n` +
            `_Tags: ${result.frontmatter.tags.join(", ") || "none"} | ` +
            `Created: ${result.frontmatter.created} | ` +
            `Updated: ${result.frontmatter.updated}_\n\n` +
            stripInlineAnnotationMarkers(result.content);
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
          const results = await noteService.searchNotes(query, scope, noteOpts(epicId));

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
          const folders = await noteService.listFolders(scope, visibility, noteOpts(epicId));

          if (folders.length === 0) return `No folders found at scope "${scope}" (${visibility}).`;

          return JSON.stringify(folders, null, 2);
        } catch {
          return `Failed to list folders at scope "${scope}" (${visibility}).`;
        }
      },
    },

    list_note_documents: {
      description:
        "List metadata for opaque documents associated with one authorized note. " +
        "Returns active and archived document metadata only; it never reads, previews, extracts, or exposes filesystem paths for document bytes.",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string", enum: VALID_SCOPES, description: "The note scope" },
          visibility: { type: "string", enum: VALID_VISIBILITIES, description: "The note visibility" },
          path: { type: "string", description: "The note path" },
          epicId: { type: "string", description: "Epic ID when scope is epic" },
        },
        required: ["scope", "visibility", "path"],
      },
      execute: async (args) => {
        const scope = args.scope as NoteScope;
        const visibility = args.visibility as NoteVisibility;
        const notePath = args.path as string;
        const epicId = args.epicId as string | undefined;
        if (!actorId) return "An authenticated actor context is required to inspect note documents.";
        if (!VALID_SCOPES.includes(scope) || !VALID_VISIBILITIES.includes(visibility) || !notePath) {
          return "scope, visibility, and path are required.";
        }
        try {
          const list = await documentService.listDocuments(scope, visibility, noteOpts(epicId), notePath);
          const metadata = (document: { id: string; displayName: string; originalFilename: string; sizeBytes: number; uploadedAt: string; uploadedBy: string; comment: string; pinnedAt?: string; pinnedBy?: string; archivedAt?: string; archivedBy?: string }) => ({
            id: document.id,
            displayName: document.displayName,
            originalFilename: document.originalFilename,
            sizeBytes: document.sizeBytes,
            uploadedAt: document.uploadedAt,
            uploadedBy: document.uploadedBy,
            comment: document.comment || undefined,
            pinnedAt: document.pinnedAt,
            pinnedBy: document.pinnedBy,
            archivedAt: document.archivedAt,
            archivedBy: document.archivedBy,
          });
          return JSON.stringify({
            active: list.active.map(metadata),
            archived: list.archived.map(metadata),
            totalBytes: list.totalBytes,
            maxBytes: list.maxBytes,
          }, null, 2);
        } catch (error) {
          return `Failed to list note documents: ${(error as Error).message}`;
        }
      },
    },

    get_note_document_path: {
      description:
        "Resolve the canonical filesystem path for one authorized associated document. " +
        "Call list_note_documents first when you need to discover document IDs. This is best used for text files; binary understanding is not guaranteed.",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string", enum: VALID_SCOPES, description: "The note scope" },
          visibility: { type: "string", enum: VALID_VISIBILITIES, description: "The note visibility" },
          path: { type: "string", description: "The parent note path" },
          documentId: { type: "string", description: "A document ID returned by list_note_documents" },
          epicId: { type: "string", description: "Epic ID when scope is epic" },
        },
        required: ["scope", "visibility", "path", "documentId"],
      },
      execute: async (args) => {
        const scope = args.scope as NoteScope;
        const visibility = args.visibility as NoteVisibility;
        const notePath = args.path as string;
        const documentId = args.documentId as string;
        const epicId = args.epicId as string | undefined;
        if (!actorId) return "An authenticated actor context is required to resolve a note document path.";
        if (!VALID_SCOPES.includes(scope) || !VALID_VISIBILITIES.includes(visibility) || !notePath || !documentId) {
          return "scope, visibility, path, and documentId are required.";
        }
        try {
          return await documentService.resolveAgentPath(scope, visibility, noteOpts(epicId), notePath, documentId);
        } catch (error) {
          return `Failed to resolve note document path: ${(error as Error).message}`;
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
  actorId?: string,
  projectNoteRangeGrantHolder?: ProjectNoteRangeGrantHolder,
): Record<string, SDKCustomTool> {
  const { note: noteService } = services;
  const noteOpts = (epicId?: string) => ({ projectId, epicId, ...(actorId ? { userId: actorId } : {}) });

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
        if (projectNoteRangeGrantHolder?.hasActiveTarget()) {
          return "Whole-note creation is unavailable while an exact note-range target is active.";
        }
        const scope = args.scope as NoteScope;
        const visibility = args.visibility as NoteVisibility;
        const notePath = args.path as string;
        const content = args.content as string | undefined;
        const epicId = args.epicId as string | undefined;
        if (!scope || !visibility || !notePath) return "scope, visibility, and path are required.";

        try {
          const result = await noteService.createNote(scope, visibility, noteOpts(epicId), notePath, content);

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
        if (projectNoteRangeGrantHolder?.hasActiveTarget()) {
          return "Whole-note editing is unavailable while an exact note-range target is active.";
        }
        const scope = args.scope as NoteScope;
        const visibility = args.visibility as NoteVisibility;
        const notePath = args.path as string;
        const content = args.content as string;
        const epicId = args.epicId as string | undefined;
        if (!scope || !visibility || !notePath || !content) return "scope, visibility, path, and content are required.";

        try {
          const result = await noteService.updateNote(scope, visibility, noteOpts(epicId), notePath, content);

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
