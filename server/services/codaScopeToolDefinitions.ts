/* ── CodaScope: Agent Tool Definitions ────────────────────────────────
   Factory functions that build the custom SDK tools available to
   CodaScope agents. Extracted from CodaScopeAgentService to keep the
   service class focused on lifecycle (pool, cancel, send) concerns.

   Two tiers:
   - Read-only tools: available to all agent purposes (assistant, chat)
   - Write tools: only available to wiki-build agents

   Each tool follows the SDKCustomTool interface:
     { description, inputSchema, execute(args) → string }
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import { CodaScopeWikiService } from "./codaScopeWikiService.js";
import { CodaScopeProjectService } from "./codaScopeProjectService.js";
import { CodaScopeCodeMapService } from "./codaScopeCodeMapService.js";
import { CodaScopeQualityService } from "./codaScopeQualityService.js";
import { CodaScopeGoldenRuleService } from "./codaScopeGoldenRuleService.js";
import { CodaScopeConceptService } from "./codaScopeConceptService.js";
import { CodaScopeBuildStateService } from "./codaScopeBuildStateService.js";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// ── Types ───────────────────────────────────────────────────────────

export type AgentPurpose = "chat" | "assistant" | "wiki-build";

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
  };
}

// ── Write Tools ─────────────────────────────────────────────────────

/**
 * Build write tools available ONLY to wiki-build purpose.
 * These tools can modify CodaScope data and should never be
 * exposed to the assistant/chat.
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
 * - assistant / chat: read-only tools only
 * - wiki-build: read-only + write tools
 */
export function getToolsForPurpose(
  projectId: string,
  projectsRoot: string,
  purpose: AgentPurpose | string,
): Record<string, SDKCustomTool> {
  const readOnly = buildReadOnlyTools(projectId, projectsRoot);

  if (purpose === "wiki-build") {
    const write = buildWriteTools(projectId, projectsRoot);
    return { ...readOnly, ...write };
  }

  // assistant and chat get read-only only
  return readOnly;
}
