/* ── CodaScope: Workspace Chat Prompt Helpers ────────────────────────
   Compact active-workspace manifest and workspace-only prompt assembly.
   No project prompt or conversation behavior is changed here.
   ──────────────────────────────────────────────────────────────────── */

import type {
  CodaScopeWorkspaceCatalogService,
  WorkspaceProjectOverview,
  WorkspaceStatus,
} from "./codaScopeWorkspaceCatalogService.js";
import {
  loadCommandTemplate,
  substituteVars,
} from "./codaScopeCommandLoader.js";

export const WORKSPACE_MANIFEST_MAX_PROJECTS = 12;
export const WORKSPACE_MANIFEST_MAX_CHARS = 6_000;
const WORKSPACE_DESCRIPTION_MAX_CHARS = 160;

export interface WorkspaceManifestInput {
  status: WorkspaceStatus;
  projects: readonly WorkspaceProjectOverview[];
  maxProjects?: number;
  maxChars?: number;
}

export async function buildWorkspaceManifestFromCatalog(
  catalog: CodaScopeWorkspaceCatalogService,
): Promise<string> {
  const [status, projects] = await Promise.all([
    catalog.getWorkspaceStatus(),
    catalog.listActiveProjects(),
  ]);
  return buildWorkspaceManifest({ status, projects });
}

export function buildWorkspaceManifest(input: WorkspaceManifestInput): string {
  const maxProjects = boundedInteger(
    input.maxProjects ?? WORKSPACE_MANIFEST_MAX_PROJECTS,
    1,
    WORKSPACE_MANIFEST_MAX_PROJECTS,
  );
  const maxChars = boundedInteger(
    input.maxChars ?? WORKSPACE_MANIFEST_MAX_CHARS,
    500,
    WORKSPACE_MANIFEST_MAX_CHARS,
  );
  const projects = [...input.projects].sort((a, b) => (
    a.name.localeCompare(b.name) || a.projectId.localeCompare(b.projectId)
  ));
  const header = [
    "### Active Workspace",
    `- Active projects: ${input.status.activeProjectCount}`,
    `- Projects with substantive wiki: ${input.status.projectsWithWiki}`,
    `- Projects currently building: ${input.status.projectsBuilding}`,
    `- Latest successful wiki publication: ${input.status.lastWikiBuildAt ?? "never"}`,
    `- Latest successful Deep Run: ${input.status.lastDeepRunAt ?? "never"}`,
    "",
    "### Active Project Summaries",
  ];

  const lines = [...header];
  let shown = 0;
  for (const project of projects) {
    if (shown >= maxProjects) break;
    const line = projectSummary(project);
    const reserved = 180;
    if ([...lines, line].join("\n").length + reserved > maxChars) break;
    lines.push(line);
    shown += 1;
  }
  if (projects.length === 0) lines.push("- No active projects.");

  const truncated = shown < projects.length;
  lines.push(
    "",
    `- Project summaries truncated: ${truncated ? "yes" : "no"}`,
    truncated
      ? `- Showing ${shown} of ${projects.length}; use \`list_projects\` for the complete active catalog.`
      : "- All active project summaries are shown.",
  );
  return lines.join("\n");
}

export function buildWorkspaceAssistantPrompt(
  manifest: string,
  userMessage: string,
): string {
  const template = loadCommandTemplate("do_workspace_chat");
  if (!template) {
    return [
      "You are the CodaScope Workspace Assistant.",
      "Use progressive, wiki-first retrieval and never claim source-file access.",
      manifest,
      `User: ${userMessage}`,
    ].join("\n\n");
  }
  return substituteVars(template, {
    WORKSPACE_MANIFEST: manifest,
    USER_MESSAGE: userMessage,
  });
}

function projectSummary(project: WorkspaceProjectOverview): string {
  const description = singleLine(project.description)
    .slice(0, WORKSPACE_DESCRIPTION_MAX_CHARS);
  const descriptionSuffix = singleLine(project.description).length
    > WORKSPACE_DESCRIPTION_MAX_CHARS
    ? "…"
    : "";
  return [
    `- ${singleLine(project.name)} [${project.projectId}]`,
    description ? `— ${description}${descriptionSuffix}` : "— no description",
    `| repositories: ${project.repositoryCount}`,
    `| wiki: ${project.substantiveWikiTopicCount} topics, ${project.lastWikiBuildAt ?? "never built"}`,
    `| Deep Run: ${project.lastDeepRunAt ?? "never"}`,
    `| latest attempt: ${project.lastBuildAttemptStatus ?? project.currentBuildStatus}`
      + `${project.lastBuildAttemptAt ? ` at ${project.lastBuildAttemptAt}` : ""}`,
  ].join(" ");
}

function singleLine(value: string): string {
  return value
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, "[redacted location]")
    .replace(/(^|[\s("'`])\/(?:Users|home|opt|private|var|tmp|Volumes|srv|mnt)\/[^\s)"'`]*/g, "$1[redacted location]")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("Invalid workspace manifest bound.");
  }
  return value;
}
