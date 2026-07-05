/* ── CodaScope: Command Loader ────────────────────────────────────────
   Loads agent command prompt templates (.md files) and performs
   mustache-style {{VARIABLE}} substitution with project context.

   Supports two tiers:
   - Framework commands: shipped in the app source at commands/
   - Project skills: stored in each project at skills/<id>/prompt.md
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodaScopeCodeMapService } from "./codaScopeCodeMapService.js";


/* ── Template Variable Substitution ──────────────────────────────── */

/**
 * Replace all {{VAR_NAME}} placeholders in a template string.
 * Unresolved variables are left as-is (the agent can still see them).
 */
export function substituteVars(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
}

/* ── Context Assembly Helpers ────────────────────────────────────── */

export interface ProjectContext {
  projectName: string;
  projectDir: string;
  repositories: Array<{ name: string; path: string }>;
}

/**
 * Build the standard set of template variables from project context.
 * Includes Code Map, file inventory, and other context variables.
 */
export function buildBaseVars(ctx: ProjectContext): Record<string, string> {
  const vars: Record<string, string> = {
    PROJECT_NAME: ctx.projectName,
    PROJECT_DIR: ctx.projectDir,
    TIMESTAMP: new Date().toISOString(),
    REPOSITORIES: ctx.repositories
      .map((r) => `- **${r.name}**: \`${r.path}\``)
      .join("\n"),
  };

  // Wiki index — list existing wiki topic titles
  const wikiDir = path.join(ctx.projectDir, "wiki");
  if (existsSync(wikiDir)) {
    const wikiFiles = readdirSync(wikiDir).filter(
      (f) => f.endsWith(".md") && !f.startsWith("_"),
    );
    if (wikiFiles.length > 0) {
      vars.WIKI_INDEX = wikiFiles
        .map((f) => `- ${f.replace(/\.md$/, "")}`)
        .join("\n");
    } else {
      vars.WIKI_INDEX = "(No wiki pages exist yet)";
    }
  } else {
    vars.WIKI_INDEX = "(No wiki pages exist yet)";
  }

  // Wiki context — abbreviated list for chat context
  if (vars.WIKI_INDEX && vars.WIKI_INDEX !== "(No wiki pages exist yet)") {
    vars.WIKI_CONTEXT = vars.WIKI_INDEX;
  } else {
    vars.WIKI_CONTEXT = "(No wiki context available)";
  }

  // ── Phase 2 Variables ──────────────────────────────────────────────

  // Code Map — concatenated Code Maps for all repos
  // This is the key context injection point for all downstream agents
  const codeMapService = new CodaScopeCodeMapService(path.dirname(ctx.projectDir));
  const projectId = path.basename(ctx.projectDir);

  // Build repo list with proper typing for getConcatenatedCodeMaps
  const reposForMap = ctx.repositories.map((r, i) => ({
    id: `repo-${i}`,
    name: r.name,
    path: r.path,
  }));
  const codeMaps = codeMapService.getConcatenatedCodeMaps(projectId, reposForMap);
  vars.CODE_MAP = codeMaps;


  // Default scan scope (can be overridden per-run)
  vars.SCAN_SCOPE = "Full repository scan — analyze all files and directories.";

  return vars;
}


/* ── Framework Command Loading ───────────────────────────────────── */

/**
 * Resolve the path to the framework commands directory.
 * Commands ship in the source tree at src/apps/codascope/commands/
 * but at runtime they may be at a different relative path depending
 * on whether we're running from source (tsx) or compiled (dist/).
 */
function getCommandsDir(): string {
  // Try relative to this file first (compiled output)
  const thisDir = path.dirname(fileURLToPath(import.meta.url));

  // Walk up to find the source commands directory
  const candidates = [
    path.resolve(thisDir, "../../src/apps/codascope/commands"),
    path.resolve(thisDir, "../src/apps/codascope/commands"),
    path.resolve(thisDir, "../../apps/codascope/commands"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Fallback: use the first candidate anyway
  return candidates[0];
}

/**
 * Load a framework command template by ID (e.g., "do_build_full_wiki").
 * Returns the raw template string with {{VARIABLE}} placeholders.
 */
export function loadCommandTemplate(commandId: string): string | null {
  const commandsDir = getCommandsDir();
  const filePath = path.join(commandsDir, `${commandId}.md`);

  if (!existsSync(filePath)) return null;

  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Load and substitute a framework command.
 */
export function loadCommand(
  commandId: string,
  vars: Record<string, string>,
): string | null {
  const template = loadCommandTemplate(commandId);
  if (!template) return null;
  return substituteVars(template, vars);
}

/* ── Project Skill Prompt Loading ────────────────────────────────── */

/**
 * Load a project-level skill prompt.
 * Looks in <projectDir>/skills/<skillId>/prompt.md
 */
export function loadSkillPrompt(
  projectDir: string,
  skillId: string,
  vars: Record<string, string>,
): string | null {
  const promptPath = path.join(projectDir, "skills", skillId, "prompt.md");

  if (!existsSync(promptPath)) return null;

  try {
    const template = readFileSync(promptPath, "utf-8");
    return substituteVars(template, vars);
  } catch {
    return null;
  }
}

/**
 * Load a command or skill prompt.
 * - If the skillId matches a framework command AND has a project override, use project.
 * - If it's a framework command with no override, use framework.
 * - If it's a project-only skill, load from the project directory.
 */
export function loadCommandOrSkill(
  commandId: string,
  projectDir: string,
  vars: Record<string, string>,
): string | null {
  // Check for project-level override first
  const projectPrompt = loadSkillPrompt(projectDir, commandId, vars);
  if (projectPrompt) return projectPrompt;

  // Fall back to framework command
  return loadCommand(commandId, vars);
}

/* ── Artifact Prompt Assembly ────────────────────────────────────── */

/**
 * Services needed for epic context assembly. Passed in by the route handler
 * so the command loader doesn't need to import them directly.
 */
export interface ArtifactPromptServices {
  epicSvc: {
    getEpic(projectId: string, epicId: string): Promise<{ title: string } | null>;
    getDefinition(projectId: string, epicId: string): Promise<string | null>;
    getScope(projectId: string, epicId: string): Promise<{ entries: Array<{ topicTitle: string; topicId: string; currentDepth?: string; included: boolean }> } | null>;
  };
  epicKnowledgeSvc: {
    listEpicWikiPages(projectId: string, epicId: string): Promise<Array<{ id: string; title: string }>>;
    readEpicWikiPage(projectId: string, epicId: string, pageId: string): Promise<string | null>;
  };
  designDocSvc: {
    listDesignDocs(projectId: string, epicId: string): Promise<Array<{ title: string; id: string; wordCount?: number }>>;
  };
  projectSvc: {
    getProject(projectId: string): Promise<{ name: string } | null>;
  };
  artifactSvc: {
    getArtifact(projectId: string, epicId: string, artifactId: string): Promise<{ title: string; body: string; modelId?: string | null; sources?: string[] } | null>;
  };
}

/**
 * Assemble epic context from services for artifact prompts.
 * Returns a markdown string with definition, scope, wiki, and design doc summaries.
 */
async function assembleEpicContext(
  projectId: string,
  epicId: string,
  svcs: ArtifactPromptServices,
): Promise<string> {
  const parts: string[] = [];

  // 1. Epic definition
  const definition = await svcs.epicSvc.getDefinition(projectId, epicId);
  if (definition) {
    parts.push("### Epic Definition\n\n" + definition);
  }

  // 2. Epic scope
  const scope = await svcs.epicSvc.getScope(projectId, epicId);
  if (scope?.entries?.length) {
    const scopeList = scope.entries
      .filter((e) => e.included)
      .map((e) => `- **${e.topicTitle}** (${e.topicId}) — depth: ${e.currentDepth ?? "none"}`)
      .join("\n");
    parts.push("### Scope Topics\n\n" + scopeList);
  }

  // 3. Wiki page summaries (up to 10)
  const pages = await svcs.epicKnowledgeSvc.listEpicWikiPages(projectId, epicId);
  if (pages.length > 0) {
    const summaries: string[] = [];
    for (const page of pages.slice(0, 10)) {
      const content = await svcs.epicKnowledgeSvc.readEpicWikiPage(projectId, epicId, page.id);
      if (content) {
        const preview = content.length > 500 ? content.slice(0, 500) + "..." : content;
        summaries.push(`#### ${page.title}\n\n${preview}`);
      }
    }
    if (summaries.length > 0) {
      parts.push("### Research Wiki\n\n" + summaries.join("\n\n"));
    }
  }

  // 4. Design doc summaries
  const docs = await svcs.designDocSvc.listDesignDocs(projectId, epicId);
  if (docs.length > 0) {
    const docSummaries = docs
      .map((d) => `- **${d.title}** (${d.id}) — ${d.wordCount ?? 0} words`)
      .join("\n");
    parts.push("### Design Documents\n\n" + docSummaries);
  }

  return parts.length > 0 ? parts.join("\n\n---\n\n") : "(No epic context available)";
}

/**
 * Load and assemble the artifact build prompt with full epic context.
 * Returns the substituted prompt string ready for the agent.
 */
export async function loadArtifactBuildPrompt(
  projectId: string,
  epicId: string,
  artifactId: string,
  svcs: ArtifactPromptServices,
): Promise<string | null> {
  const template = loadCommandTemplate("do_build_artifact");
  if (!template) return null;

  // Gather context
  const [project, epic, artifact, epicContext] = await Promise.all([
    svcs.projectSvc.getProject(projectId),
    svcs.epicSvc.getEpic(projectId, epicId),
    svcs.artifactSvc.getArtifact(projectId, epicId, artifactId),
    assembleEpicContext(projectId, epicId, svcs),
  ]);

  if (!artifact) return null;

  // Assemble manual sources if the spec has attached source hints
  let manualSources = "(No additional sources specified)";
  if (artifact.sources && artifact.sources.length > 0) {
    manualSources = artifact.sources
      .map((s) => `- ${s}`)
      .join("\n");
  }

  const vars: Record<string, string> = {
    PROJECT_NAME: project?.name ?? projectId,
    EPIC_TITLE: epic?.title ?? epicId,
    ARTIFACT_TITLE: artifact.title,
    ARTIFACT_SPEC_BODY: artifact.body,
    EPIC_CONTEXT: epicContext,
    MANUAL_SOURCES: manualSources,
  };

  return substituteVars(template, vars);
}

/**
 * Load and assemble the section regeneration prompt with pending annotations.
 * Returns the substituted prompt string ready for the agent.
 */
export async function loadSectionRegenPrompt(
  projectId: string,
  epicId: string,
  artifactId: string,
  pendingBySection: Array<{ sectionId: string; annotations: Array<{ id: string; instruction: string; elementContext?: unknown }> }>,
  svcs: ArtifactPromptServices,
): Promise<string | null> {
  const template = loadCommandTemplate("do_regen_sections");
  if (!template) return null;

  const [project, epic, artifact] = await Promise.all([
    svcs.projectSvc.getProject(projectId),
    svcs.epicSvc.getEpic(projectId, epicId),
    svcs.artifactSvc.getArtifact(projectId, epicId, artifactId),
  ]);

  // Format pending annotations as structured markdown
  const annotationsText = pendingBySection.map((group) => {
    const annotationList = group.annotations.map((a) => {
      const parts = [`- **Instruction:** ${a.instruction}`];
      if (a.elementContext) {
        const ctx = a.elementContext as Record<string, unknown>;
        if (ctx.elementTag) parts.push(`  - Element: \`<${ctx.elementTag}>\``);
        if (ctx.cssPath) parts.push(`  - CSS Path: \`${ctx.cssPath}\``);
        if (ctx.elementText) parts.push(`  - Text: "${String(ctx.elementText).slice(0, 100)}"`);
        if (ctx.elementHTML) parts.push(`  - HTML: \`${String(ctx.elementHTML).slice(0, 200)}\``);
      }
      return parts.join("\n");
    }).join("\n\n");
    return `#### Section: \`${group.sectionId}\`\n\n${annotationList}`;
  }).join("\n\n---\n\n");

  const vars: Record<string, string> = {
    PROJECT_NAME: project?.name ?? projectId,
    EPIC_TITLE: epic?.title ?? epicId,
    ARTIFACT_TITLE: artifact?.title ?? artifactId,
    PENDING_ANNOTATIONS: annotationsText,
  };

  return substituteVars(template, vars);
}
