/* ── CodaScope: Write Tools ──────────────────────────────────────────
   Code Map write tools available ONLY to wiki-build purpose.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import type { ToolServices } from "../codaScopeToolServiceFactory.js";
import { CodaScopeCodeMapService } from "../codaScopeCodeMapService.js";

/**
 * Build write tools available ONLY to wiki-build purpose.
 * These tools can modify Code Map data.
 */
export function buildWriteTools(
  projectId: string,
  services: ToolServices,
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
