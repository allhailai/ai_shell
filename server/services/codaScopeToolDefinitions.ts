/* ── CodaScope: Agent Tool Definitions ────────────────────────────────
   Factory functions that build the custom SDK tools available to
   CodaScope agents. Extracted from CodaScopeAgentService to keep the
   service class focused on lifecycle (pool, cancel, send) concerns.

   Three tiers:
   - Read-only tools: core knowledge discovery tools
   - Epic tools: read + write tools for epics, wiki, concepts, scope
   - Write tools: code map write tools for wiki-build purpose

   All tiers are available to assistant/chat — the agent has full autonomy.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import { CodaScopeWikiService } from "./codaScopeWikiService.js";
import { CodaScopeProjectService } from "./codaScopeProjectService.js";
import { CodaScopeCodeMapService } from "./codaScopeCodeMapService.js";
import { CodaScopeQualityService } from "./codaScopeQualityService.js";
import { CodaScopeGoldenRuleService } from "./codaScopeGoldenRuleService.js";
import { CodaScopeConceptService } from "./codaScopeConceptService.js";
import { CodaScopeBuildStateService } from "./codaScopeBuildStateService.js";
import { CodaScopeEpicService } from "./codaScopeEpicService.js";
import { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";
import { CodaScopeAnnotationService } from "./codaScopeAnnotationService.js";
import { CodaScopeEpicKnowledgeService } from "./codaScopeEpicKnowledgeService.js";
import { CodaScopeCurationService } from "./codaScopeCurationService.js";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { TopicDepth, CurationReasonType } from "../../src/apps/codascope/codaScopeTypes.js";

// ── Types ───────────────────────────────────────────────────────────

export type AgentPurpose = "chat" | "assistant" | "wiki-build" | "curation" | "research";

// ── Tool Result Collector ───────────────────────────────────────────
// Module-level collector for tool return values that contain action tags.
// The agent service drains this after each run completes.

const toolResultCollector: string[] = [];

/** Push a tool result text for later action-tag extraction. */
function collectToolResult(text: string): void {
  toolResultCollector.push(text);
}

/** Drain all collected tool results (clears the collector). */
export function drainToolResults(): string[] {
  return toolResultCollector.splice(0);  // returns and clears
}

// ── Read-Only Tools ─────────────────────────────────────────────────

/**
 * Build read-only tools available to ALL agent purposes.
 * These tools can discover and read CodaScope data but cannot modify it.
 */
export function buildReadOnlyTools(
  projectId: string,
  projectsRoot: string,
): Record<string, SDKCustomTool> {
  const wikiService = new CodaScopeWikiService(projectsRoot);
  const projectService = new CodaScopeProjectService(projectsRoot);
  const qualityService = new CodaScopeQualityService(projectsRoot);
  const goldenRuleService = new CodaScopeGoldenRuleService(projectsRoot);
  const conceptService = new CodaScopeConceptService(projectsRoot);
  const buildStateService = new CodaScopeBuildStateService(projectsRoot);
  const epicService = new CodaScopeEpicService(projectsRoot);
  const designDocService = new CodaScopeDesignDocService(projectsRoot);
  const annotationService = new CodaScopeAnnotationService(projectsRoot);

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
            "../../src/apps/codascope/commands",
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
          const codeMapService = new CodaScopeCodeMapService(projectsRoot);
          const slug = CodaScopeCodeMapService.repoSlug(repoName);
          const content = codeMapService.readCodeMap(projectId, slug);
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

// ── Epic Write + Read Tools ─────────────────────────────────────────

/**
 * Build epic-related write tools and new read tools (Phase 3).
 * These tools are available to assistant/chat (full agent autonomy)
 * and to the curation pipeline.
 */
export function buildEpicTools(
  projectId: string,
  projectsRoot: string,
): Record<string, SDKCustomTool> {
  const wikiService = new CodaScopeWikiService(projectsRoot);
  const epicService = new CodaScopeEpicService(projectsRoot);
  const conceptService = new CodaScopeConceptService(projectsRoot);
  const annotationService = new CodaScopeAnnotationService(projectsRoot);
  const epicKnowledgeService = new CodaScopeEpicKnowledgeService(projectsRoot);
  const curationService = new CodaScopeCurationService(projectsRoot);

  return {
    // ── Write Tools ─────────────────────────────────────────────────

    write_wiki_topic: {
      description:
        "Create or enrich a main wiki page. If the topic exists, the content is replaced. " +
        "Use read_wiki_topic first to check existing content and enrich rather than replace. " +
        "Main wiki pages contain code-derived knowledge ONLY — never put research or designs here.",
      inputSchema: {
        type: "object",
        properties: {
          topicId: { type: "string", description: "The topic slug (kebab-case, e.g. 'auth-flow')" },
          content: { type: "string", description: "Full markdown content for the wiki page" },
          title: { type: "string", description: "Optional human-readable title (derived from topicId if not provided)" },
        },
        required: ["topicId", "content"],
      },
      execute: async (args) => {
        const topicId = args.topicId as string;
        const content = args.content as string;
        if (!topicId || !content) return "topicId and content are required.";
        try {
          await wikiService.updateTopicContent(projectId, topicId, content);
          return `Wiki topic "${topicId}" has been written successfully.`;
        } catch (err) {
          return `Failed to write wiki topic "${topicId}": ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    delete_wiki_topic: {
      description:
        "Request deletion of a main wiki page. This does NOT immediately delete the page — " +
        "it creates a pending deletion record that requires human approval. " +
        "The page remains unchanged until a human approves the deletion in the UI. " +
        "You must provide a reason explaining why the page should be deleted.",
      inputSchema: {
        type: "object",
        properties: {
          topicId: { type: "string", description: "The topic ID to request deletion for" },
          reason: { type: "string", description: "Explanation of why this page should be deleted" },
          epicId: { type: "string", description: "Optional: the epic that triggered this deletion request" },
          curationId: { type: "string", description: "Optional: the curation run that triggered this" },
        },
        required: ["topicId", "reason"],
      },
      execute: async (args) => {
        const topicId = args.topicId as string;
        const reason = args.reason as string;
        if (!topicId || !reason) return "topicId and reason are required.";
        try {
          await wikiService.addPendingDeletion(projectId, {
            topicId,
            requestedBy: "agent",
            requestedAt: new Date().toISOString(),
            reason,
            epicId: args.epicId as string | undefined,
            curationId: args.curationId as string | undefined,
          });
          return `Deletion of '${topicId}' queued for human approval. The page remains unchanged until approved.`;
        } catch (err) {
          return `Failed to request deletion of "${topicId}": ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    write_epic_wiki_page: {
      description:
        "Create or update an epic-scoped research wiki page. Epic wiki pages contain " +
        "research synthesis — information gathered from external sources, NOT code knowledge. " +
        "Use list_epic_wiki_pages to see existing pages before creating new ones.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          pageId: { type: "string", description: "Page slug (kebab-case)" },
          title: { type: "string", description: "Human-readable page title" },
          content: { type: "string", description: "Full markdown content" },
          sourceRefs: {
            type: "array",
            items: { type: "string" },
            description: "Optional: source IDs that contributed to this page",
          },
        },
        required: ["epicId", "pageId", "title", "content"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const pageId = args.pageId as string;
        const title = args.title as string;
        const content = args.content as string;
        if (!epicId || !pageId || !title || !content) return "epicId, pageId, title, and content are required.";
        try {
          const page = await epicKnowledgeService.writeEpicWikiPage(
            projectId, epicId, pageId, title, content,
            args.sourceRefs as string[] | undefined,
          );
          return `Epic wiki page "${title}" (${pageId}) written successfully. Word count: ${page.wordCount}`;
        } catch (err) {
          return `Failed to write epic wiki page: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    create_concept: {
      description:
        "Create a new domain concept. Concepts represent key abstractions, patterns, " +
        "and vocabulary discovered in the codebase.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Concept name" },
          category: {
            type: "string",
            description: "Category: architecture, backend, frontend, data, devops, cross-cutting, features, other",
          },
          description: { type: "string", description: "Description of the concept" },
          relatedConcepts: {
            type: "array",
            items: { type: "string" },
            description: "Optional: IDs of related concepts",
          },
        },
        required: ["name", "category", "description"],
      },
      execute: async (args) => {
        const name = args.name as string;
        const category = args.category as string;
        const description = args.description as string;
        if (!name || !category || !description) return "name, category, and description are required.";
        try {
          const concept = conceptService.createConcept(projectId, {
            name, category, description,
            relatedConcepts: args.relatedConcepts as string[] | undefined,
          });
          return `Concept "${name}" created with ID: ${concept.id}`;
        } catch (err) {
          return `Failed to create concept: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    update_concept: {
      description:
        "Update an existing domain concept. Use list_concepts to find concept IDs. " +
        "Only provided fields are updated.",
      inputSchema: {
        type: "object",
        properties: {
          conceptId: { type: "string", description: "The concept ID to update" },
          name: { type: "string", description: "New name (optional)" },
          description: { type: "string", description: "New description (optional)" },
          category: { type: "string", description: "New category (optional)" },
        },
        required: ["conceptId"],
      },
      execute: async (args) => {
        const conceptId = args.conceptId as string;
        if (!conceptId) return "conceptId is required.";
        try {
          const updated = conceptService.updateConcept(projectId, conceptId, {
            name: args.name as string | undefined,
            description: args.description as string | undefined,
            category: args.category as string | undefined,
          });
          if (!updated) return `Concept "${conceptId}" not found.`;
          return `Concept "${updated.name}" updated successfully.`;
        } catch (err) {
          return `Failed to update concept: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    add_scope_entry: {
      description:
        "Add a topic to an epic's scope. The scope tracks which topics are relevant " +
        "to the epic and their enrichment depth targets.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          topicId: { type: "string", description: "The topic slug to add" },
          topicTitle: { type: "string", description: "Human-readable topic title" },
          type: {
            type: "string",
            description: "Topic type: existing-wiki, existing-concept, or new",
          },
          targetDepth: {
            type: "string",
            description: "Target enrichment depth: none, stub, outline, developed, comprehensive",
          },
          currentDepth: {
            type: "string",
            description: "Current enrichment depth (defaults to 'none')",
          },
        },
        required: ["epicId", "topicId", "topicTitle", "type", "targetDepth"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const topicId = args.topicId as string;
        const topicTitle = args.topicTitle as string;
        const type = args.type as "existing-wiki" | "existing-concept" | "new";
        const targetDepth = args.targetDepth as TopicDepth;
        const currentDepth = (args.currentDepth as TopicDepth) ?? "none";
        if (!epicId || !topicId || !topicTitle || !type || !targetDepth) {
          return "epicId, topicId, topicTitle, type, and targetDepth are required.";
        }
        try {
          const added = await epicService.addScopeEntry(projectId, epicId, {
            topicId, topicTitle, type,
            source: "agent",
            included: true,
            targetDepth,
            currentDepth,
          });
          if (!added) return `Topic "${topicId}" already exists in scope for epic "${epicId}".`;
          return `Added "${topicTitle}" to epic scope with target depth "${targetDepth}".`;
        } catch (err) {
          return `Failed to add scope entry: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    update_scope_entry: {
      description:
        "Update a scope entry for an epic. Use this to track enrichment progress " +
        "by updating currentDepth after enriching a topic.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          topicId: { type: "string", description: "The topic ID in scope to update" },
          included: { type: "boolean", description: "Whether the topic is still included" },
          targetDepth: { type: "string", description: "Updated target depth" },
          currentDepth: { type: "string", description: "Current enrichment depth after enrichment" },
        },
        required: ["epicId", "topicId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const topicId = args.topicId as string;
        if (!epicId || !topicId) return "epicId and topicId are required.";
        try {
          const changes: Record<string, unknown> = {};
          if (args.included !== undefined) changes.included = args.included;
          if (args.targetDepth) changes.targetDepth = args.targetDepth;
          if (args.currentDepth) {
            changes.currentDepth = args.currentDepth;
            changes.enrichedAt = new Date().toISOString();
          }
          const updated = await epicService.updateScopeEntry(projectId, epicId, topicId, changes);
          if (!updated) return `Scope entry "${topicId}" not found in epic "${epicId}".`;
          return `Scope entry "${topicId}" updated. Current depth: ${updated.currentDepth ?? "unchanged"}.`;
        } catch (err) {
          return `Failed to update scope entry: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    add_curation_reason: {
      description:
        "Register a curation trigger reason. Reasons accumulate until a curation " +
        "run processes them. Use this when you detect changes that warrant curation.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          type: {
            type: "string",
            description: "Reason type: definition_changed, code_delta_processed, research_sources_added, human_content_added, blocked_download_resolved, research_topics_changed, manual",
          },
          detail: { type: "string", description: "Human-readable detail about the reason" },
        },
        required: ["epicId", "type", "detail"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const type = args.type as CurationReasonType;
        const detail = args.detail as string;
        if (!epicId || !type || !detail) return "epicId, type, and detail are required.";
        try {
          await curationService.addReason(projectId, epicId, {
            type, at: new Date().toISOString(), detail,
          });
          return `Curation reason "${type}" added for epic "${epicId}".`;
        } catch (err) {
          return `Failed to add curation reason: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    trigger_curation: {
      description:
        "Trigger a curation run for an epic. This kicks off the curation pipeline " +
        "which processes pending reasons and enriches wiki pages. The pipeline runs " +
        "asynchronously — the UI will show a progress banner automatically. " +
        "Always call get_curation_status first to check pending reasons before triggering.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID to curate" },
          modelId: { type: "string", description: "The model ID to use for curation (use the same model you are running on)" },
        },
        required: ["epicId", "modelId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const modelId = args.modelId as string;
        if (!epicId) return "epicId is required.";
        if (!modelId) return "modelId is required. Pass the model ID you are running on.";

        // Check if already running via build state
        const scope = `curation::${epicId}`;
        const buildService = new CodaScopeBuildStateService(projectsRoot);
        const existing = buildService.getBuildState(projectId, scope);
        if (existing?.status === "building") {
          return `Curation is already running for this epic (run ${existing.runId}). The UI should show a progress banner.`;
        }

        // Fire the curation pipeline via internal HTTP POST to the SSE endpoint.
        // We consume the SSE stream in the background so the connection stays alive
        // and the pipeline runs to completion.
        const port = process.env.AISHELL_PORT ?? "5175";
        const url = `http://localhost:${port}/api/codascope/projects/${projectId}/epics/${epicId}/curation/run`;

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelId }),
          });

          if (!res.ok) {
            const text = await res.text();
            let errorMsg: string;
            try {
              const parsed = JSON.parse(text);
              errorMsg = parsed.error ?? text;
            } catch {
              errorMsg = text;
            }
            return `Failed to start curation: ${errorMsg}`;
          }

          // Consume the SSE stream in the background so the connection stays alive.
          // The pipeline runs server-side; we just need to keep the client connection open.
          if (res.body) {
            const reader = (res.body as unknown as ReadableStream<Uint8Array>).getReader();
            const pump = (): void => {
              void reader.read().then(({ done }) => { if (!done) pump(); });
            };
            pump();
          }

          return `Curation pipeline started for epic "${epicId}". The UI will show a progress ` +
            `banner with live step-by-step updates. Pending curation reasons are being processed.`;
        } catch (err) {
          return `Failed to trigger curation: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    trigger_research: {
      description:
        "Start autonomous research for specific topics. The research pipeline searches " +
        "the web, downloads content, and processes sources into epic wiki pages.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          topics: {
            type: "array",
            items: { type: "string" },
            description: "Topics to research",
          },
        },
        required: ["epicId", "topics"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const topics = args.topics as string[];
        if (!epicId || !topics?.length) return "epicId and topics are required.";
        // Research pipeline runs via SSE — direct to the API
        return `Research pipeline for epic "${epicId}" on topics [${topics.join(", ")}] ` +
          `should be triggered via the UI or ` +
          `POST /api/codascope/projects/${projectId}/epics/${epicId}/knowledge/research. ` +
          `The pipeline runs autonomously: plan → download → process.`;
      },
    },

    search_web: {
      description:
        "Search the web for research content. Returns web search results " +
        "with titles, URLs, and snippets that can inform research plans.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = args.query as string;
        if (!query) return "query is required.";

        try {
          // Use DuckDuckGo HTML search as a free, no-API-key approach
          const encodedQuery = encodeURIComponent(query);
          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

          const response = await fetch(searchUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; CodaScopeResearch/1.0)",
              "Accept": "text/html",
            },
          });

          if (!response.ok) {
            return `Web search failed: HTTP ${response.status}. Try a different query.`;
          }

          const html = await response.text();

          // Parse results from DuckDuckGo HTML response
          const results: { title: string; url: string; snippet: string }[] = [];
          const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
          let match;
          while ((match = resultRegex.exec(html)) !== null && results.length < 10) {
            const rawUrl = match[1];
            const title = match[2].replace(/<[^>]+>/g, "").trim();
            const snippet = match[3].replace(/<[^>]+>/g, "").trim();
            // DuckDuckGo wraps URLs in a redirect — extract the actual URL
            const urlMatch = rawUrl.match(/uddg=([^&]+)/);
            const url = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
            if (url && title) {
              results.push({ title, url, snippet });
            }
          }

          if (results.length === 0) {
            // Fallback: try simpler regex for different HTML structure
            const simpleRegex = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
            while ((match = simpleRegex.exec(html)) !== null && results.length < 10) {
              const url = match[1];
              const title = match[2].replace(/<[^>]+>/g, "").trim();
              if (url && title && url.startsWith("http")) {
                results.push({ title, url, snippet: "" });
              }
            }
          }

          if (results.length === 0) {
            return `No web search results found for "${query}". Try a different or broader query.`;
          }

          // Format results
          const formatted = results.map((r, i) =>
            `${i + 1}. **${r.title}**\n   URL: ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`,
          ).join("\n\n");

          return `Web search results for "${query}":\n\n${formatted}`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Web search failed: ${msg}. Try again or use a different query.`;
        }
      },
    },

    create_annotation: {
      description:
        "Create an annotation (comment thread) on a specific block of a design document. " +
        "Use this to suggest improvements, flag gaps, or reference research findings. " +
        "The annotation will appear inline next to the referenced block.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          documentId: { type: "string", description: "The design document ID" },
          blockId: { type: "string", description: "The block ID to annotate (from read_design_doc)" },
          body: { type: "string", description: "Annotation content (supports markdown)" },
          category: {
            type: "string",
            enum: ["suggestion", "question", "gap", "research-ref"],
            description: "Annotation category",
          },
        },
        required: ["epicId", "documentId", "blockId", "body"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const documentId = args.documentId as string;
        const blockId = args.blockId as string;
        const body = args.body as string;
        const category = args.category as string | undefined;
        if (!epicId || !documentId || !blockId || !body) {
          return "epicId, documentId, blockId, and body are required.";
        }
        try {
          const categoryPrefix = category ? `[${category}] ` : "";
          const annotation = await annotationService.createAnnotation(projectId, epicId, documentId, {
            anchor: {
              blockId,
              sectionSlug: "",
              anchorText: "",
              lineNumber: 0,
            },
            author: "agent",
            body: `${categoryPrefix}${body}`,
          });
          return `Annotation created (ID: ${annotation.id}) on block "${blockId}" in document "${documentId}".`;
        } catch (err) {
          return `Failed to create annotation: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ── New Read Tools ──────────────────────────────────────────────

    list_epic_wiki_pages: {
      description:
        "List all epic-scoped research wiki pages for an epic. These contain " +
        "research synthesis — different from main wiki pages which are code knowledge.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
        },
        required: ["epicId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        if (!epicId) return "epicId is required.";
        try {
          const pages = await epicKnowledgeService.listEpicWikiPages(projectId, epicId);
          if (pages.length === 0) return `No epic wiki pages exist yet for epic "${epicId}".`;
          return JSON.stringify(pages, null, 2);
        } catch {
          return `Failed to list epic wiki pages for "${epicId}".`;
        }
      },
    },

    read_epic_wiki_page: {
      description:
        "Read the full content of an epic wiki page. These pages contain research " +
        "synthesis for the epic.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          pageId: { type: "string", description: "The page ID (slug)" },
        },
        required: ["epicId", "pageId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const pageId = args.pageId as string;
        if (!epicId || !pageId) return "epicId and pageId are required.";
        try {
          const content = await epicKnowledgeService.readEpicWikiPage(projectId, epicId, pageId);
          if (content === null) return `Epic wiki page "${pageId}" not found in epic "${epicId}".`;
          return content;
        } catch {
          return `Failed to read epic wiki page "${pageId}".`;
        }
      },
    },

    list_research_sources: {
      description:
        "List all research sources (downloaded and uploaded) for an epic. Shows title, " +
        "type, status, URL, and topic associations.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
        },
        required: ["epicId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        if (!epicId) return "epicId is required.";
        try {
          const sources = await epicKnowledgeService.listSources(projectId, epicId);
          if (sources.length === 0) return `No research sources exist for epic "${epicId}".`;
          return JSON.stringify(
            sources.map((s) => ({
              id: s.id,
              title: s.title,
              type: s.type,
              origin: s.origin,
              status: s.status,
              url: s.url,
              filename: s.filename,
              topicAssociations: s.topicAssociations,
              addedAt: s.addedAt,
            })),
            null,
            2,
          );
        } catch {
          return `Failed to list research sources for "${epicId}".`;
        }
      },
    },

    read_research_source: {
      description:
        "Read the extracted markdown content of a research source. Use list_research_sources " +
        "first to discover source IDs.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          sourceId: { type: "string", description: "The source ID" },
        },
        required: ["epicId", "sourceId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const sourceId = args.sourceId as string;
        if (!epicId || !sourceId) return "epicId and sourceId are required.";
        try {
          const content = await epicKnowledgeService.getSourceContent(projectId, epicId, sourceId);
          if (!content.markdown) {
            return `Source "${sourceId}" has no extracted markdown yet (may still be processing).`;
          }
          return content.markdown;
        } catch {
          return `Failed to read source "${sourceId}".`;
        }
      },
    },

    get_curation_status: {
      description:
        "Get the current curation status for an epic: pending reasons and latest " +
        "curation log summary.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
        },
        required: ["epicId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        if (!epicId) return "epicId is required.";
        try {
          const reasons = await curationService.getReasons(projectId, epicId);
          const latestLog = await curationService.getLatestLog(projectId, epicId);

          const result: Record<string, unknown> = {
            pendingReasons: reasons.length,
            reasons: reasons.map((r) => ({ type: r.type, detail: r.detail, at: r.at })),
          };

          if (latestLog) {
            result.lastCuration = {
              curationId: latestLog.curationId,
              status: latestLog.status,
              triggeredAt: latestLog.triggeredAt,
              completedAt: latestLog.completedAt,
              durationMs: latestLog.durationMs,
              results: latestLog.results,
            };
          } else {
            result.lastCuration = null;
          }

          return JSON.stringify(result, null, 2);
        } catch {
          return `Failed to get curation status for "${epicId}".`;
        }
      },
    },

    // ── Design Doc Write Tools (Reimagined) ─────────────────────────

    create_design_doc: {
      description:
        "Create a new design document within the current epic. The document will appear " +
        "in the Design tab and the user will be notified via an action tag. Always provide " +
        "substantial initial content — never create empty documents.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID to create the doc in" },
          title: { type: "string", description: "Document title" },
          content: { type: "string", description: "Full markdown content for the document" },
        },
        required: ["epicId", "title", "content"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const title = args.title as string;
        const content = args.content as string;
        if (!epicId || !title || !content) return "epicId, title, and content are required.";
        try {
          const designDocService = new CodaScopeDesignDocService(projectsRoot);
          const doc = await designDocService.createDesignDoc(projectId, epicId, {
            title,
            content,
            createdBy: "agent",
          });
          // Emit action tag for frontend auto-navigation
          const resultText = `Created design document "${title}" (ID: ${doc.id}) with ${doc.wordCount} words.\n\n` +
            `<codascope_action type="design_doc_created" epicId="${epicId}" docId="${doc.id}">\n` +
            `Created design document "${title}"\n` +
            `</codascope_action>`;
          collectToolResult(resultText);
          return resultText;
        } catch (err) {
          return `Failed to create design doc: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    edit_design_doc: {
      description:
        "Replace the entire content of a design document. Use edit_design_doc_section " +
        "for targeted edits. Always read the document first before editing.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          docId: { type: "string", description: "The design document ID" },
          content: { type: "string", description: "Full replacement markdown content" },
          editSummary: { type: "string", description: "Brief description of what changed (for version history)" },
        },
        required: ["epicId", "docId", "content", "editSummary"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const docId = args.docId as string;
        const content = args.content as string;
        const editSummary = args.editSummary as string;
        if (!epicId || !docId || !content || !editSummary) {
          return "epicId, docId, content, and editSummary are required.";
        }
        try {
          const designDocService = new CodaScopeDesignDocService(projectsRoot);
          // Create a version snapshot before editing (Phase 4: version history)
          try { await designDocService.createVersion(projectId, epicId, docId, "agent", editSummary); } catch { /* best effort */ }
          const updated = await designDocService.updateDesignDoc(projectId, epicId, docId, content);
          if (!updated) return `Design doc "${docId}" not found in epic "${epicId}".`;
          if ("conflict" in updated) return `Design doc "${docId}" was modified concurrently. Please re-read and retry.`;

          const resultText = `Updated design document "${updated.doc.title}" — ${updated.doc.wordCount} words. Summary: ${editSummary}\n\n` +
            `<codascope_action type="design_doc_edited" epicId="${epicId}" docId="${docId}" summary="${editSummary}">\n` +
            `${editSummary}\n` +
            `</codascope_action>`;
          collectToolResult(resultText);
          return resultText;
        } catch (err) {
          return `Failed to edit design doc: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    edit_design_doc_section: {
      description:
        "Edit a specific section of a design document by replacing a range of lines. " +
        "Preferred over edit_design_doc for targeted changes. Read the document first " +
        "to determine the correct line range.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          docId: { type: "string", description: "The design document ID" },
          startLine: { type: "number", description: "Start line number (1-indexed)" },
          endLine: { type: "number", description: "End line number (1-indexed, inclusive)" },
          newContent: { type: "string", description: "Replacement content for the specified line range" },
          editSummary: { type: "string", description: "Brief description of what changed" },
        },
        required: ["epicId", "docId", "startLine", "endLine", "newContent", "editSummary"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const docId = args.docId as string;
        const startLine = args.startLine as number;
        const endLine = args.endLine as number;
        const newContent = args.newContent as string;
        const editSummary = args.editSummary as string;
        if (!epicId || !docId || !startLine || !endLine || newContent === undefined || !editSummary) {
          return "epicId, docId, startLine, endLine, newContent, and editSummary are required.";
        }
        try {
          const designDocService = new CodaScopeDesignDocService(projectsRoot);
          const result = await designDocService.getDesignDoc(projectId, epicId, docId);
          if (!result) return `Design doc "${docId}" not found in epic "${epicId}".`;

          // Create a version snapshot before editing (Phase 4: version history)
          try { await designDocService.createVersion(projectId, epicId, docId, "agent", editSummary); } catch { /* best effort */ }

          const lines = result.content.split("\n");
          const before = lines.slice(0, startLine - 1);
          const after = lines.slice(endLine);
          const updatedContent = [...before, newContent, ...after].join("\n");

          const updated = await designDocService.updateDesignDoc(projectId, epicId, docId, updatedContent);
          if (!updated) return `Failed to update design doc "${docId}".`;
          if ("conflict" in updated) return `Design doc "${docId}" was modified concurrently. Please re-read and retry.`;

          const resultText = `Updated lines ${startLine}-${endLine} of "${updated.doc.title}". Summary: ${editSummary}\n\n` +
            `<codascope_action type="design_doc_edited" epicId="${epicId}" docId="${docId}" summary="${editSummary}" startLine="${startLine}" endLine="${endLine}">\n` +
            `${editSummary}\n` +
            `</codascope_action>`;
          collectToolResult(resultText);
          return resultText;
        } catch (err) {
          return `Failed to edit design doc section: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  };
}

// ── Write Tools ─────────────────────────────────────────────────────

/**
 * Build write tools available ONLY to wiki-build purpose.
 * These tools can modify Code Map data.
 */
export function buildWriteTools(
  projectId: string,
  projectsRoot: string,
): Record<string, SDKCustomTool> {
  return {
    update_code_map_section: {
      description:
        "Update a specific section of the Code Map by its heading. Use this to " +
        "correct or enrich the Code Map when the user asks you to modify it. " +
        "The section heading must match an existing ## heading in the Code Map. " +
        "The new content replaces everything between that heading and the next heading.",
      inputSchema: {
        type: "object",
        properties: {
          repoName: {
            type: "string",
            description: "The repository name",
          },
          sectionHeading: {
            type: "string",
            description: "The section heading text to update (e.g., 'Key Modules' or 'Architecture')",
          },
          newContent: {
            type: "string",
            description: "The new content for the section (markdown formatted)",
          },
        },
        required: ["repoName", "sectionHeading", "newContent"],
      },
      execute: async (args) => {
        const repoName = args.repoName as string;
        const sectionHeading = args.sectionHeading as string;
        const newContent = args.newContent as string;
        if (!repoName || !sectionHeading || !newContent) {
          return "repoName, sectionHeading, and newContent are all required.";
        }
        try {
          const codeMapService = new CodaScopeCodeMapService(projectsRoot);
          const slug = CodaScopeCodeMapService.repoSlug(repoName);
          const updated = codeMapService.updateCodeMapSection(
            projectId, slug, sectionHeading, newContent,
          );
          if (updated) {
            return `Successfully updated section "${sectionHeading}" in the Code Map for "${repoName}".`;
          }
          return `Could not find a section matching "${sectionHeading}" in the Code Map for "${repoName}". ` +
            `Make sure the heading exists. Use read_code_map to view current sections.`;
        } catch {
          return `Failed to update Code Map section.`;
        }
      },
    },
  };
}

// ── Assembly ────────────────────────────────────────────────────────

/**
 * Get the appropriate tools for a given agent purpose.
 * - assistant / chat: ALL tools (read + epic write + code map write) — full autonomy
 * - wiki-build: read-only + code map write tools
 * - curation: read-only + epic tools (for the curation pipeline)
 */
export function getToolsForPurpose(
  projectId: string,
  projectsRoot: string,
  purpose: AgentPurpose | string,
): Record<string, SDKCustomTool> {
  const readOnly = buildReadOnlyTools(projectId, projectsRoot);
  const epicTools = buildEpicTools(projectId, projectsRoot);

  if (purpose === "wiki-build") {
    const write = buildWriteTools(projectId, projectsRoot);
    return { ...readOnly, ...write };
  }

  if (purpose === "curation" || purpose === "research") {
    return { ...readOnly, ...epicTools };
  }

  // assistant and chat get ALL tools — full agent autonomy
  const write = buildWriteTools(projectId, projectsRoot);
  return { ...readOnly, ...epicTools, ...write };
}
