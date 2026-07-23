/* ── CodaScope: Read-Only Tools ──────────────────────────────────────
   Core knowledge discovery tools. Available to ALL agent purposes.
   These tools can discover and read CodaScope data but cannot modify it.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import type { ToolServices } from "../codaScopeToolServiceFactory.js";
import { CodaScopeCodeMapService } from "../codaScopeCodeMapService.js";
import { existsSync, readdirSync, readFileSync, statSync, realpathSync, type Dirent } from "node:fs";
import path from "node:path";
import { collectAnnotationDescendants } from "../../../src/apps/codascope/codaScopeTypes.js";
import {
  isSameOrDescendantPath,
  resolveContainedRelativePath,
} from "../codaScopePathSafety.js";

const SOURCE_SKIP_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", "dist", "build", "coverage",
  ".next", ".turbo", "vendor", "target", "__pycache__",
]);
const MAX_SOURCE_FILE_BYTES = 256_000;
const MAX_SOURCE_FILE_LIST = 200;

function resolveConfiguredRepository(
  repositories: Array<{ id: string; name: string; path: string }> | undefined,
  repoName: string,
): { id: string; name: string; path: string } | null {
  return repositories?.find((repo) => repo.name === repoName || repo.id === repoName) ?? null;
}

function resolveRepositoryPath(repoPath: string, relativePath: string): string | null {
  try {
    return resolveContainedRelativePath(repoPath, relativePath, "repository path");
  } catch {
    return null;
  }
}

function isRealPathWithinRepository(repoPath: string, filePath: string): boolean {
  try {
    return isSameOrDescendantPath(realpathSync(repoPath), realpathSync(filePath));
  } catch {
    return false;
  }
}

function listRepositoryFiles(
  root: string,
  query: string | undefined,
  pathPrefix: string | undefined,
): string[] {
  const start = pathPrefix ? resolveRepositoryPath(root, pathPrefix) : root;
  if (!start || !existsSync(start)) return [];
  if (!isRealPathWithinRepository(root, start)) return [];

  const normalizedQuery = query?.toLowerCase();
  const files: string[] = [];
  const walk = (directory: string): void => {
    if (files.length >= MAX_SOURCE_FILE_LIST) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_SOURCE_FILE_LIST) return;
      if (SOURCE_SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(root, fullPath);
        if (!normalizedQuery || relativePath.toLowerCase().includes(normalizedQuery)) {
          files.push(relativePath);
        }
      }
    }
  };
  walk(start);
  return files;
}

/**
 * Build read-only tools available to ALL agent purposes.
 * These tools can discover and read CodaScope data but cannot modify it.
 */
export function buildReadOnlyTools(
  projectId: string,
  services: ToolServices,
): Record<string, SDKCustomTool> {
  const {
    wiki: wikiService,
    project: projectService,
    buildState: buildStateService,
    epic: epicService,
    designDoc: designDocService,
    annotation: annotationService,
  } = services;

  const loadAnnotationDocument = async (epicId: string, documentId: string): Promise<string | null> => {
    if (documentId === "definition") return epicService.getDefinition(projectId, epicId);
    return (await designDocService.getDesignDoc(projectId, epicId, documentId))?.content ?? null;
  };

  return {
    list_wiki_topics: {
      description:
        "List all available wiki topics for this project. Returns topic IDs and titles. " +
        "Use this to discover what documentation exists before reading specific topics.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        try {
          const topics = await wikiService.listTopics(projectId);
          if (topics.length === 0) {
            return "No wiki topics exist yet. The wiki has not been built for this project.";
          }
          return JSON.stringify(
            topics.map((t: { id: string; title: string }) => ({
              id: t.id,
              title: t.title,
            })),
            null,
            2,
          );
        } catch {
          return "Failed to list wiki topics.";
        }
      },
    },

    read_wiki_topic: {
      description:
        "Read the full content of a specific wiki topic by its ID. " +
        "Use list_wiki_topics first to discover available topic IDs.",
      inputSchema: {
        type: "object",
        properties: {
          topicId: {
            type: "string",
            description: "The topic ID to read (from list_wiki_topics)",
          },
        },
        required: ["topicId"],
      },
      execute: async (args) => {
        const topicId = args.topicId as string;
        if (!topicId) return "topicId is required.";
        try {
          const content = await wikiService.getTopicContent(projectId, topicId);
          if (content === null) return `Wiki topic "${topicId}" not found.`;
          return content;
        } catch {
          return `Failed to read wiki topic "${topicId}".`;
        }
      },
    },

    search_wiki: {
      description:
        "Search across all wiki topics for a keyword or phrase. " +
        "Returns matching topic IDs with a snippet of the matching content.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query (case-insensitive)",
          },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = (args.query as string)?.toLowerCase();
        if (!query) return "query is required.";
        try {
          const topics = await wikiService.listTopics(projectId);
          const matches: Array<{ topicId: string; title: string; snippet: string }> = [];

          for (const topic of topics) {
            const content = await wikiService.getTopicContent(projectId, topic.id);
            if (!content) continue;
            const lowerContent = content.toLowerCase();
            const idx = lowerContent.indexOf(query);
            if (idx >= 0) {
              const start = Math.max(0, idx - 80);
              const end = Math.min(content.length, idx + query.length + 80);
              matches.push({
                topicId: topic.id,
                title: topic.title,
                snippet: "..." + content.slice(start, end).replace(/\n/g, " ") + "...",
              });
            }
          }

          if (matches.length === 0) return `No wiki topics matched "${args.query}".`;
          return JSON.stringify(matches, null, 2);
        } catch {
          return "Failed to search wiki.";
        }
      },
    },

    list_repositories: {
      description:
        "List all configured repositories for this project by stable ID and name. Use the scoped source-read tools for repository contents.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        try {
          const project = await projectService.getProject(projectId);
          if (!project) return "Project not found.";
          if (!project.repositories || project.repositories.length === 0) {
            return "No repositories configured for this project.";
          }
          return JSON.stringify(
            project.repositories.map((r: { id: string; name: string }) => ({
              id: r.id,
              name: r.name,
            })),
            null,
            2,
          );
        } catch {
          return "Failed to list repositories.";
        }
      },
    },

    list_source_files: {
      description:
        "List source files from one configured repository. This is read-only and is the only way " +
        "wiki-build agents discover repository paths after their native workspace is isolated to the CodaScope project.",
      inputSchema: {
        type: "object",
        properties: {
          repoName: { type: "string", description: "Configured repository name or ID" },
          query: { type: "string", description: "Optional case-insensitive substring to match in relative paths" },
          pathPrefix: { type: "string", description: "Optional relative directory to search within the repository" },
        },
        required: ["repoName"],
      },
      execute: async (args) => {
        const repoName = args.repoName as string;
        if (!repoName) return "repoName is required.";
        try {
          const project = await projectService.getProject(projectId);
          const repo = resolveConfiguredRepository(project?.repositories, repoName);
          if (!repo) return `Repository "${repoName}" is not configured for this project.`;
          const pathPrefix = args.pathPrefix as string | undefined;
          if (pathPrefix && !resolveRepositoryPath(repo.path, pathPrefix)) {
            return "pathPrefix must remain within the configured repository.";
          }
          const files = listRepositoryFiles(repo.path, args.query as string | undefined, pathPrefix);
          if (files.length === 0) return "No source files matched.";
          const suffix = files.length === MAX_SOURCE_FILE_LIST ? "\n\nResults are limited to 200 files; narrow query or pathPrefix." : "";
          return files.map((file) => `- ${file}`).join("\n") + suffix;
        } catch {
          return "Failed to list source files.";
        }
      },
    },

    read_source_file: {
      description:
        "Read one text source file from a configured repository. The path must be repository-relative; " +
        "this tool cannot write or access paths outside the configured repository.",
      inputSchema: {
        type: "object",
        properties: {
          repoName: { type: "string", description: "Configured repository name or ID" },
          relativePath: { type: "string", description: "Repository-relative path to a source file" },
        },
        required: ["repoName", "relativePath"],
      },
      execute: async (args) => {
        const repoName = args.repoName as string;
        const relativePath = args.relativePath as string;
        if (!repoName || !relativePath) return "repoName and relativePath are required.";
        try {
          const project = await projectService.getProject(projectId);
          const repo = resolveConfiguredRepository(project?.repositories, repoName);
          if (!repo) return `Repository "${repoName}" is not configured for this project.`;
          const filePath = resolveRepositoryPath(repo.path, relativePath);
          if (!filePath) return "relativePath must remain within the configured repository.";
          if (!existsSync(filePath) || !statSync(filePath).isFile()) return `Source file "${relativePath}" was not found.`;
          if (!isRealPathWithinRepository(repo.path, filePath)) {
            return "relativePath must remain within the configured repository.";
          }
          if (statSync(filePath).size > MAX_SOURCE_FILE_BYTES) {
            return `Source file "${relativePath}" exceeds the ${MAX_SOURCE_FILE_BYTES} byte read limit.`;
          }
          return readFileSync(filePath, "utf-8");
        } catch {
          return `Failed to read source file "${relativePath}".`;
        }
      },
    },

    list_project_skills: {
      description:
        "List all skills (both framework and user-defined) available for this project.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        try {
          // Read framework commands
          const commandsDir = path.resolve(
            import.meta.dirname ?? __dirname,
            "../../../src/apps/codascope/commands",
          );
          const commands: string[] = [];
          if (existsSync(commandsDir)) {
            for (const f of readdirSync(commandsDir)) {
              if (f.endsWith(".md")) commands.push(f.replace(/\.md$/, ""));
            }
          }
          return JSON.stringify({ frameworkCommands: commands }, null, 2);
        } catch {
          return "Failed to list skills.";
        }
      },
    },

    read_code_map: {
      description:
        "Read the Code Map for a specific repository. The Code Map is a structured " +
        "document describing the repository's architecture, modules, and key files. " +
        "Use list_repositories to discover available repositories first, then pass " +
        "the repository name here.",
      inputSchema: {
        type: "object",
        properties: {
          repoName: {
            type: "string",
            description: "The repository name (from list_repositories)",
          },
        },
        required: ["repoName"],
      },
      execute: async (args) => {
        const repoName = args.repoName as string;
        if (!repoName) return "repoName is required.";
        try {
          const slug = CodaScopeCodeMapService.repoSlug(repoName);
          const content = services.codeMap.readCodeMap(projectId, slug);
          if (content === null) {
            return `No Code Map found for "${repoName}" (slug: ${slug}). Run an analysis to build it.`;
          }
          return content;
        } catch {
          return `Failed to read Code Map for "${repoName}".`;
        }
      },
    },

    read_build_status: {
      description:
        "Read the current build state for this project. Shows whether a build is " +
        "running, what the last build command was, and when it completed. Use this " +
        "when the user asks about build status or when you need to check data freshness.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        try {
          const state = buildStateService.getBuildState(projectId);
          if (!state) {
            return JSON.stringify({ status: "idle", lastBuild: null, message: "No builds have been run yet." });
          }
          return JSON.stringify(
            {
              status: state.status,
              runId: state.runId,
              command: state.command,
              modelId: state.modelId,
              startedAt: state.startedAt,
              completedAt: state.completedAt,
              summary: state.summary,
              error: state.error,
              pipelineSteps: state.pipelineSteps.map((s) => ({
                id: s.id,
                label: s.label,
                status: s.status,
              })),
            },
            null,
            2,
          );
        } catch {
          return "Failed to read build status.";
        }
      },
    },

    // ── Epic Design Tools (Read) ─────────────────────────────────────

    list_epic_designs: {
      description:
        "List all epic designs for this project. Returns epic IDs, titles, statuses, " +
        "and health indicators. Use this to discover what epics exist before reading " +
        "specific epic data.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        try {
          const epics = await epicService.listEpics(projectId);
          if (epics.length === 0) {
            return "No epic designs exist yet for this project.";
          }
          return JSON.stringify(
            epics.map((e) => ({
              id: e.id,
              title: e.title,
              status: e.status,
              health: e.health,
              collaborators: e.collaborators,
              currentVersion: e.currentVersion,
              updatedAt: e.updatedAt,
            })),
            null,
            2,
          );
        } catch {
          return "Failed to list epic designs.";
        }
      },
    },

    read_epic_definition: {
      description:
        "Read the full definition markdown for a specific epic. The definition contains " +
        "the epic's goal, context, scope, constraints, and success criteria. " +
        "Use list_epic_designs first to discover available epic IDs.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: {
            type: "string",
            description: "The epic ID to read (from list_epic_designs)",
          },
        },
        required: ["epicId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        if (!epicId) return "epicId is required.";
        try {
          const definition = await epicService.getDefinition(projectId, epicId);
          if (definition === null) return `Epic "${epicId}" not found or has no definition.`;
          return definition;
        } catch {
          return `Failed to read definition for epic "${epicId}".`;
        }
      },
    },

    read_epic_scope: {
      description:
        "Read the scope for a specific epic. The scope lists which wiki topics, concepts, " +
        "and new topics are relevant to the epic, including enrichment status and depth targets. " +
        "Use list_epic_designs first to discover available epic IDs.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: {
            type: "string",
            description: "The epic ID (from list_epic_designs)",
          },
        },
        required: ["epicId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        if (!epicId) return "epicId is required.";
        try {
          const scope = await epicService.getScope(projectId, epicId);
          if (scope === null) return `Epic "${epicId}" has no scope yet.`;
          return JSON.stringify(scope, null, 2);
        } catch {
          return `Failed to read scope for epic "${epicId}".`;
        }
      },
    },

    list_design_docs: {
      description:
        "List all design documents for a specific epic. Returns doc IDs, titles, " +
        "templates, word counts, and annotation/directive counts. " +
        "Use list_epic_designs first to discover available epic IDs.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: {
            type: "string",
            description: "The epic ID (from list_epic_designs)",
          },
        },
        required: ["epicId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        if (!epicId) return "epicId is required.";
        try {
          const docs = await designDocService.listDesignDocs(projectId, epicId);
          if (docs.length === 0) {
            return `No design documents exist yet for epic "${epicId}".`;
          }
          return JSON.stringify(
            docs.map((d) => ({
              id: d.id,
              title: d.title,
              template: d.template,
              wordCount: d.wordCount,
              blockCount: d.blockCount,
              annotationCount: d.annotationCount,
              directiveCount: d.directiveCount,
              updatedAt: d.updatedAt,
            })),
            null,
            2,
          );
        } catch {
          return `Failed to list design docs for epic "${epicId}".`;
        }
      },
    },

    read_design_doc: {
      description:
        "Read the full content of a specific design document. Returns the document " +
        "metadata and full markdown content. Use list_design_docs first to discover " +
        "available document IDs for an epic.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: {
            type: "string",
            description: "The epic ID (from list_epic_designs)",
          },
          docId: {
            type: "string",
            description: "The design document ID (from list_design_docs)",
          },
        },
        required: ["epicId", "docId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const docId = args.docId as string;
        if (!epicId || !docId) return "epicId and docId are required.";
        try {
          const result = await designDocService.getDesignDoc(projectId, epicId, docId);
          if (result === null) return `Design doc "${docId}" not found in epic "${epicId}".`;
          return `# ${result.doc.title}\n\n` +
            `_Template: ${result.doc.template || "blank"} | Words: ${result.doc.wordCount} | Updated: ${result.doc.updatedAt}_\n\n` +
            result.content;
        } catch {
          return `Failed to read design doc "${docId}" for epic "${epicId}".`;
        }
      },
    },

    list_annotations: {
      description:
        "List all annotations (comments/threads) on a specific document within an epic. " +
        "The documentId is either 'definition' for the epic definition, or a design doc ID. " +
        "Returns annotation IDs, authors, anchors, statuses, and body previews.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: {
            type: "string",
            description: "The epic ID (from list_epic_designs)",
          },
          documentId: {
            type: "string",
            description: "The document ID: 'definition' or a design doc ID (from list_design_docs)",
          },
        },
        required: ["epicId", "documentId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const documentId = args.documentId as string;
        if (!epicId || !documentId) return "epicId and documentId are required.";
        try {
          const documentContent = await loadAnnotationDocument(epicId, documentId);
          if (documentContent === null) throw new Error("document not found");
          const annotations = await annotationService.listAnnotations(projectId, epicId, documentId, documentContent);
          if (annotations.length === 0) {
            return `No annotations on document "${documentId}" in epic "${epicId}".`;
          }
          return JSON.stringify(
            annotations.map((a) => ({
              id: a.id,
              author: a.author,
              origin: a.origin,
              ownership: a.ownership,
              status: a.status,
              attachmentState: a.attachmentState,
              deleted: Boolean(a.deletedAt),
              anchor: {
                sectionSlug: a.anchor.sectionSlug,
                anchorText: a.anchor.anchorText?.slice(0, 80),
                blockId: a.anchor.blockId,
              },
              body: a.deletedAt ? "Comment deleted" : a.body.length > 200 ? a.body.slice(0, 200) + "..." : a.body,
              parentId: a.parentId,
              createdAt: a.createdAt,
              reactionCount: a.reactions?.length ?? 0,
            })),
            null,
            2,
          );
        } catch {
          return `Failed to list annotations for document "${documentId}" in epic "${epicId}".`;
        }
      },
    },

    read_annotation_thread: {
      description:
        "Read a full annotation thread by its ID, including all replies. Returns the root " +
        "annotation and all child annotations (replies) with full body content. " +
        "Use list_annotations first to discover annotation IDs.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: {
            type: "string",
            description: "The epic ID (from list_epic_designs)",
          },
          documentId: {
            type: "string",
            description: "The document ID: 'definition' or a design doc ID",
          },
          annotationId: {
            type: "string",
            description: "The root annotation ID (from list_annotations)",
          },
        },
        required: ["epicId", "documentId", "annotationId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const documentId = args.documentId as string;
        const annotationId = args.annotationId as string;
        if (!epicId || !documentId || !annotationId) {
          return "epicId, documentId, and annotationId are required.";
        }
        try {
          const documentContent = await loadAnnotationDocument(epicId, documentId);
          if (documentContent === null) throw new Error("document not found");
          const allAnnotations = await annotationService.listAnnotations(projectId, epicId, documentId, documentContent);
          const root = allAnnotations.find((a) => a.id === annotationId);
          if (!root) return `Annotation "${annotationId}" not found.`;

          // Collect the complete legacy-compatible graph in deterministic order.
          const replies = collectAnnotationDescendants(allAnnotations, root.id);
          const thread = [root, ...replies].map((a) => ({
            id: a.id,
            author: a.author,
            origin: a.origin,
            ownership: a.ownership,
            status: a.status,
            body: a.deletedAt ? "Comment deleted" : a.body,
            deletedAt: a.deletedAt,
            parentId: a.parentId,
            createdAt: a.createdAt,
            reactions: a.reactions,
          }));

          return JSON.stringify(
            {
              anchor: {
                sectionSlug: root.anchor.sectionSlug,
                anchorText: root.anchor.anchorText,
                blockId: root.anchor.blockId,
              },
              thread,
            },
            null,
            2,
          );
        } catch {
          return `Failed to read annotation thread "${annotationId}".`;
        }
      },
    },
  };
}
