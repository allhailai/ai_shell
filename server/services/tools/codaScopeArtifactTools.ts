/* ── CodaScope: Artifact Tools ───────────────────────────────────────
   Tools for artifact-build and artifact-section-regen agent purposes.
   Handle reading/writing artifact HTML and reading assembled epic
   context.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool } from "@cursor/sdk";
import type { ToolServices } from "../codaScopeToolServiceFactory.js";
import type { ToolResultCollectorHolder } from "../codaScopeToolDefinitions.js";

/**
 * Build artifact-specific tools for the artifact-build and artifact-section-regen
 * agent purposes. These tools handle reading/writing artifact HTML and reading
 * assembled epic context.
 */
export function buildArtifactTools(
  projectId: string,
  services: ToolServices,
  collector?: ToolResultCollectorHolder,
): Record<string, SDKCustomTool> {
  const {
    epic: epicService,
    epicKnowledge: epicKnowledgeService,
    designDoc: designDocService,
    artifact: artifactService,
  } = services;

  return {
    write_artifact_html: {
      description:
        "Write the generated HTML to the artifact build directory. " +
        "Use mode='full' to write the complete index.html, or mode='section' to replace " +
        "a single section's inner HTML in the existing document.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          artifactId: { type: "string", description: "The artifact ID" },
          html: { type: "string", description: "The HTML content to write" },
          mode: {
            type: "string",
            enum: ["full", "section"],
            description: "'full' to write entire index.html, 'section' to replace a single section",
          },
          sectionId: {
            type: "string",
            description: "Required when mode='section': the data-section-id of the section to replace",
          },
        },
        required: ["epicId", "artifactId", "html", "mode"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const artifactId = args.artifactId as string;
        const html = args.html as string;
        const mode = args.mode as string;
        const sectionId = args.sectionId as string | undefined;

        if (!epicId || !artifactId || !html) {
          return "epicId, artifactId, and html are required.";
        }

        try {
          const svc = artifactService;

          if (mode === "section") {
            if (!sectionId) return "sectionId is required when mode='section'.";

            // Read current HTML, find the section, replace its inner HTML
            const currentHtml = await svc.getPreviewHtml(projectId, epicId, artifactId);
            if (!currentHtml) return "No existing HTML found. Use mode='full' for the initial build.";

            // Find the section and replace its inner content
            const escapedId = sectionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`(<section\\s[^>]*id="${escapedId}"[^>]*>)[\\s\\S]*?(<\\/section>)`);
            const match = currentHtml.match(regex);
            if (!match) return `Section "${sectionId}" not found in the current HTML.`;

            const newHtml = currentHtml.replace(regex, `$1\n${html}\n$2`);

            // Write the updated full HTML
            const previewPath = svc.getPreviewPath(projectId, epicId, artifactId);
            if (!previewPath) return "Cannot determine build path.";

            const { writeFileSync } = await import("node:fs");
            writeFileSync(previewPath, newHtml, "utf-8");

            // Emit action tag for frontend auto-navigation
            const sectionResultText = `Section "${sectionId}" updated successfully.\n\n` +
              `<codascope_action type="artifact_built" epicId="${epicId}" artifactId="${artifactId}">` +
              `Visual artifact section "${sectionId}" updated` +
              `</codascope_action>`;
            collector?.collect(sectionResultText);
            return sectionResultText;
          }

          // mode === "full"
          const previewPath = svc.getPreviewPath(projectId, epicId, artifactId);
          if (!previewPath) {
            // Ensure builds directory exists
            return "Cannot determine build path. Ensure the artifact exists.";
          }

          const { writeFileSync, mkdirSync, existsSync } = await import("node:fs");
          const { dirname } = await import("node:path");
          const dir = dirname(previewPath);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(previewPath, html, "utf-8");

          // Emit action tag for frontend auto-navigation
          const resultText = `Artifact HTML written successfully (${html.length} bytes). Sections will be extracted automatically.\n\n` +
            `<codascope_action type="artifact_built" epicId="${epicId}" artifactId="${artifactId}">` +
            `Visual artifact updated successfully` +
            `</codascope_action>`;
          collector?.collect(resultText);
          return resultText;
        } catch (err) {
          return `Failed to write artifact HTML: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    read_artifact_html: {
      description:
        "Read the current HTML content of a built artifact. Use this to understand " +
        "the document's structure before making section-level changes.",
      inputSchema: {
        type: "object",
        properties: {
          epicId: { type: "string", description: "The epic ID" },
          artifactId: { type: "string", description: "The artifact ID" },
        },
        required: ["epicId", "artifactId"],
      },
      execute: async (args) => {
        const epicId = args.epicId as string;
        const artifactId = args.artifactId as string;
        if (!epicId || !artifactId) return "epicId and artifactId are required.";

        try {
          const svc = artifactService;
          const html = await svc.getPreviewHtml(projectId, epicId, artifactId);
          if (!html) return "No built HTML found for this artifact. Build the artifact first.";
          return html;
        } catch (err) {
          return `Failed to read artifact HTML: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    read_epic_context: {
      description:
        "Read assembled epic context for artifact generation. Returns the epic's " +
        "definition, scope, wiki summaries, and design doc summaries to ground " +
        "the artifact in real project data.",
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
          const parts: string[] = [];

          // 1. Epic definition
          const definition = await epicService.getDefinition(projectId, epicId);
          if (definition) {
            parts.push("## Epic Definition\n\n" + definition);
          }

          // 2. Epic scope
          const scope = await epicService.getScope(projectId, epicId);
          if (scope?.entries?.length) {
            const scopeList = scope.entries
              .filter((e: { included: boolean }) => e.included)
              .map((e: { topicTitle: string; topicId: string; currentDepth?: string }) =>
                `- **${e.topicTitle}** (${e.topicId}) — depth: ${e.currentDepth ?? "none"}`,
              )
              .join("\n");
            parts.push("## Epic Scope\n\n" + scopeList);
          }

          // 3. Epic wiki pages (research synthesis)
          const pages = await epicKnowledgeService.listEpicWikiPages(projectId, epicId);
          if (pages.length > 0) {
            const summaries: string[] = [];
            for (const page of pages.slice(0, 10)) {
              const content = await epicKnowledgeService.readEpicWikiPage(projectId, epicId, page.id);
              if (content) {
                const preview = content.length > 500 ? content.slice(0, 500) + "..." : content;
                summaries.push(`### ${page.title}\n\n${preview}`);
              }
            }
            if (summaries.length > 0) {
              parts.push("## Epic Research Wiki\n\n" + summaries.join("\n\n"));
            }
          }

          // 4. Design doc summaries
          const docs = await designDocService.listDesignDocs(projectId, epicId);
          if (docs.length > 0) {
            const docSummaries = docs.map((d: { title: string; id: string; wordCount?: number }) =>
              `- **${d.title}** (${d.id}) — ${d.wordCount ?? 0} words`,
            ).join("\n");
            parts.push("## Design Documents\n\n" + docSummaries);
          }

          if (parts.length === 0) {
            return `No context available for epic "${epicId}". The epic may not have a definition, scope, or wiki pages yet.`;
          }

          return parts.join("\n\n---\n\n");
        } catch (err) {
          return `Failed to read epic context: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  };
}
