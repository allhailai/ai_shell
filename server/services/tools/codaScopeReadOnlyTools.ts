/* ── CodaScope: Read-Only Tools ──────────────────────────────────────
   Core knowledge discovery tools. Available to ALL agent purposes.
   These tools can discover and read CodaScope data but cannot modify it.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import type { ToolServices } from "../codaScopeToolServiceFactory.js";
import { CodaScopeCodeMapService } from "../codaScopeCodeMapService.js";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

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
    quality: qualityService,
    goldenRule: goldenRuleService,
    concept: conceptService,
    buildState: buildStateService,
    epic: epicService,
    designDoc: designDocService,
    annotation: annotationService,
  } = services;

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
        "List all configured repositories for this project, including their names and filesystem paths.",
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
            project.repositories.map((r: { id: string; name: string; path: string }) => ({
              id: r.id,
              name: r.name,
              path: r.path,
            })),
            null,
            2,
          );
        } catch {
          return "Failed to list repositories.";
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

    read_quality_report: {
      description:
        "Read the latest quality scan report for this project. Returns overall score, " +
        "category scores, issue counts by severity, and top issues. Use this when the " +
        "user asks about code quality, issues, or standards compliance.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        try {
          const report = qualityService.getLatestReport(projectId);
          if (!report) {
            return "No quality scan has been run yet. Suggest running a quality scan to analyze the codebase.";
          }
          // Return a compact summary with top issues
          const result: Record<string, unknown> = {
            scanId: report.scanId,
            timestamp: report.timestamp,
            scanScope: report.scanScope,
            duration: report.duration,
            summary: report.summary,
            categories: Object.fromEntries(
              Object.entries(report.categories).map(([name, cat]) => [
                name,
                {
                  score: cat.score,
                  issueCount: cat.issueCount,
                  bySeverity: cat.bySeverity,
                  // Include top 5 issues per category for context
                  topIssues: cat.issues.slice(0, 5).map((i) => ({
                    severity: i.severity,
                    title: i.title,
                    file: i.file,
                    line: i.line,
                    suggestion: i.suggestion,
                  })),
                },
              ]),
            ),
          };
          return JSON.stringify(result, null, 2);
        } catch {
          return "Failed to read quality report.";
        }
      },
    },

    list_golden_rules: {
      description:
        "List all golden rules (coding standards) configured for this project. " +
        "Returns rule names, descriptions, categories, severities, and enabled status. " +
        "Use this when the user asks about coding standards or golden rules.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        try {
          const rules = goldenRuleService.listRules(projectId);
          if (rules.length === 0) {
            return "No golden rules have been configured yet.";
          }
          return JSON.stringify(
            rules.map((r) => ({
              id: r.id,
              name: r.name,
              description: r.description,
              category: r.category,
              severity: r.severity,
              enabled: r.enabled,
              appliesTo: r.appliesTo,
            })),
            null,
            2,
          );
        } catch {
          return "Failed to list golden rules.";
        }
      },
    },

    list_concepts: {
      description:
        "List domain concepts extracted from the codebase. Concepts represent key " +
        "abstractions, patterns, and domain vocabulary. Use this when the user asks " +
        "about domain concepts, architecture patterns, or codebase terminology.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Optional category filter (architecture, backend, frontend, data, devops, cross-cutting, features, other)",
          },
        },
      },
      execute: async (args) => {
        try {
          const category = args.category as string | undefined;
          const concepts = conceptService.listConcepts(projectId, category);
          if (concepts.length === 0) {
            return category
              ? `No concepts found in category "${category}".`
              : "No domain concepts have been extracted yet. Run a codebase exploration to discover concepts.";
          }
          return JSON.stringify(
            concepts.map((c) => ({
              id: c.id,
              name: c.name,
              description: c.description,
              category: c.category,
              relatedConcepts: c.relatedConcepts,
              wikiTopicId: c.wikiTopicId,
            })),
            null,
            2,
          );
        } catch {
          return "Failed to list concepts.";
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
          const annotations = await annotationService.listAnnotations(projectId, epicId, documentId);
          if (annotations.length === 0) {
            return `No annotations on document "${documentId}" in epic "${epicId}".`;
          }
          return JSON.stringify(
            annotations.map((a) => ({
              id: a.id,
              author: a.author,
              status: a.status,
              anchor: {
                sectionSlug: a.anchor.sectionSlug,
                anchorText: a.anchor.anchorText?.slice(0, 80),
                blockId: a.anchor.blockId,
              },
              body: a.body.length > 200 ? a.body.slice(0, 200) + "..." : a.body,
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
          const allAnnotations = await annotationService.listAnnotations(projectId, epicId, documentId);
          const root = allAnnotations.find((a) => a.id === annotationId);
          if (!root) return `Annotation "${annotationId}" not found.`;

          // Collect the thread: root + all replies
          const replies = allAnnotations.filter((a) => a.parentId === annotationId);
          const thread = [root, ...replies].map((a) => ({
            id: a.id,
            author: a.author,
            status: a.status,
            body: a.body,
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
