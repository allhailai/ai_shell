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
import type {
  WorkspaceConversationMessage,
  WorkspaceMessageContext,
} from "./codaScopeWorkspaceConversationService.js";
import {
  normalizeCanonicalWorkspaceNoteRangeTarget,
  type CanonicalWorkspaceNoteRangeTarget,
} from "../../src/apps/codascope/workspaceNoteRangeTargetValidation.js";

export const WORKSPACE_MANIFEST_MAX_PROJECTS = 12;
export const WORKSPACE_MANIFEST_MAX_CHARS = 6_000;
const WORKSPACE_DESCRIPTION_MAX_CHARS = 160;
const WORKSPACE_HISTORY_MAX_MESSAGES = 20;
const WORKSPACE_HISTORY_MESSAGE_MAX_CHARS = 2_000;

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
  history: string,
  currentContext = "",
): string {
  const template = loadCommandTemplate("do_workspace_chat");
  if (!template) {
    return [
      "You are the CodaScope Workspace Assistant.",
      "Use progressive, wiki-first retrieval and never claim source-file access.",
      manifest,
      history,
      currentContext,
      "The current user request is supplied once as the agent user payload.",
    ].join("\n\n");
  }
  return substituteVars(template, {
    WORKSPACE_MANIFEST: manifest,
    WORKSPACE_CONVERSATION_HISTORY: history,
    WORKSPACE_CURRENT_CONTEXT: currentContext,
  });
}

export function formatWorkspaceConversationHistory(
  messages: readonly WorkspaceConversationMessage[],
): string {
  const selected = messages
    .filter((message) => (
      message.role === "user"
      || message.role === "assistant"
      || message.role === "system"
    ))
    .slice(-WORKSPACE_HISTORY_MAX_MESSAGES);
  if (selected.length === 0) return "No prior conversation messages.";
  return selected.map((message) => {
    const content = singleLine(message.content)
      .slice(0, WORKSPACE_HISTORY_MESSAGE_MAX_CHARS);
    const target = message.role === "user"
      ? normalizeCanonicalWorkspaceNoteRangeTarget(
          message.metadata.noteRangeTarget,
        )
      : null;
    const provenance = target
      ? ` [historical exact note-range target: "${singleLine(target.title)}" `
        + `(${singleLine(target.path)}), lines ${target.startLine}-${target.endLine}, `
        + `selected "${singleLine(target.selectedText).slice(0, 500)}"]`
      : "";
    return `${message.role.toUpperCase()}${provenance}: ${content}`;
  }).join("\n");
}

export function formatWorkspaceCurrentContext(
  context: WorkspaceMessageContext,
  noteRangeTarget?: CanonicalWorkspaceNoteRangeTarget | null,
): string {
  const lines = [
    `Current view: ${singleLine(context.currentView.view)}`,
    `Navigation identity: ${singleLine(context.currentView.identity ?? "none")}`,
    `View label: ${singleLine(context.currentView.label ?? "none")}`,
    `Explicit active project references: ${
      context.explicitlyReferencedProjectIds.join(", ") || "none"
    }`,
  ];
  if (context.currentNote) {
    lines.push(
      `Current CodaScope note: ${singleLine(context.currentNote.title)} `
        + `[${context.currentNote.stableId}]`,
      `Note scope/visibility: codascope/${context.currentNote.visibility}`,
      `Note path: ${singleLine(context.currentNote.path)}`,
      `Note content hash: ${context.currentNote.contentHash ?? "not supplied"}`,
      noteRangeTarget
        ? "The full note body is not supplied; the exact selected text is attached below."
        : "The note body is not available in this phase.",
    );
  } else {
    lines.push("Current CodaScope note: none");
  }
  if (noteRangeTarget) {
    lines.push(
      "",
      "### Exact current-turn CodaScope note edit target",
      "The user attached an exact edit target in the current note.",
      `Canonical note: ${singleLine(noteRangeTarget.title)} (${singleLine(noteRangeTarget.path)})`,
      `Display line range: ${noteRangeTarget.startLine}-${noteRangeTarget.endLine}`,
      "Exact selected text:",
      fencedSelection(noteRangeTarget.selectedText),
      "Operate only on this supplied target through replace_codascope_note_range.",
      "Line numbers are descriptive; the server-held exact target is authoritative.",
      "Do not rewrite the full note through this capability.",
      "If the requested replacement is ambiguous, ask one concise question.",
    );
  }
  return lines.join("\n");
}

function fencedSelection(value: string): string {
  const backticks = longestRun(value, "`");
  const tildes = longestRun(value, "~");
  const marker = backticks <= tildes ? "`" : "~";
  const fence = marker.repeat(Math.max(3, Math.min(backticks, tildes) + 1));
  return `${fence}markdown\n${value}\n${fence}`;
}

function longestRun(value: string, marker: string): number {
  let longest = 0;
  let current = 0;
  for (const character of value) {
    if (character === marker) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
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
