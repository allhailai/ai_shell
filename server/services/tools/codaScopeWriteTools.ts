/* ── CodaScope: Write Tools ──────────────────────────────────────────
   Code Map write tools available ONLY to wiki-build purpose.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import type { ToolServices } from "../codaScopeToolServiceFactory.js";
import { CodaScopeCodeMapService } from "../codaScopeCodeMapService.js";
import type { ToolResultCollectorHolder } from "../codaScopeToolDefinitions.js";
import { formatCompletedAction } from "../codaScopeActionParser.js";

/**
 * Build write tools available ONLY to wiki-build purpose.
 * These tools can modify Code Map data.
 */
export function buildWriteTools(
  projectId: string,
  services: ToolServices,
  collector?: ToolResultCollectorHolder,
): Record<string, SDKCustomTool> {
  const completed = (
    operation: string,
    description: string,
    attributes: Record<string, string | number | undefined> = {},
  ): string => {
    const resultText = `${description}\n\n${formatCompletedAction(operation, description, attributes)}`;
    collector?.collect(resultText);
    return resultText;
  };

  return {
    write_code_map: {
      description:
        "Write the complete Code Map for a configured repository into the CodaScope project store. " +
        "Use this for Code Map builds; never write code_map_*.md with filesystem tools.",
      inputSchema: {
        type: "object",
        properties: {
          repoName: {
            type: "string",
            description: "The configured repository name",
          },
          content: {
            type: "string",
            description: "Complete Markdown content of the Code Map",
          },
        },
        required: ["repoName", "content"],
      },
      execute: async (args) => {
        const repoName = args.repoName as string;
        const content = args.content as string;
        if (!repoName || !content) return "repoName and content are required.";

        try {
          const project = await services.project.getProject(projectId);
          const repo = project?.repositories?.find((candidate: { id: string; name: string }) =>
            candidate.name === repoName || candidate.id === repoName,
          );
          if (!repo) return `Repository "${repoName}" is not configured for this project.`;

          const slug = CodaScopeCodeMapService.repoSlug(repo.name);
          services.codeMap.writeCodeMap(projectId, slug, content);
          return completed("write_code_map", `Code Map for "${repo.name}" has been written to the CodaScope project.`, {
            repoName: repo.name,
          });
        } catch (err) {
          return `Failed to write Code Map: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    write_project_wiki_topic: {
      description:
        "Write one complete main wiki page into the CodaScope project store. " +
        "Use this for every topic, including the special index and _index pages; never write wiki/*.md with filesystem tools.",
      inputSchema: {
        type: "object",
        properties: {
          topicId: {
            type: "string",
            description: "Topic slug (kebab-case), or the special IDs index and _index",
          },
          content: {
            type: "string",
            description: "Complete Markdown content for the wiki page",
          },
        },
        required: ["topicId", "content"],
      },
      execute: async (args) => {
        const topicId = args.topicId as string;
        const content = args.content as string;
        if (!topicId || !content) return "topicId and content are required.";

        try {
          await services.wiki.updateTopicContent(projectId, topicId, content);
          return completed("write_wiki_topic", `Wiki topic "${topicId}" has been written to the CodaScope project.`, { topicId });
        } catch (err) {
          return `Failed to write wiki topic "${topicId}": ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

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
          const slug = CodaScopeCodeMapService.repoSlug(repoName);
          const updated = services.codeMap.updateCodeMapSection(
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
