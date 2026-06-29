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
import { CodaScopeGoldenRuleService } from "./codaScopeGoldenRuleService.js";

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
 * Includes Code Map, Golden Rules, file inventory, and other Phase 2 variables.
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

  // Concepts JSON — load concepts.json if it exists
  const conceptsPath = path.join(ctx.projectDir, "concepts.json");
  if (existsSync(conceptsPath)) {
    try {
      vars.CONCEPTS_JSON = readFileSync(conceptsPath, "utf-8");
    } catch {
      vars.CONCEPTS_JSON = "[]";
    }
  } else {
    vars.CONCEPTS_JSON = "[]";
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

  // Golden Rules — formatted for prompt injection
  const goldenRuleService = new CodaScopeGoldenRuleService(path.dirname(ctx.projectDir));
  vars.GOLDEN_RULES = goldenRuleService.exportActiveRulesAsPrompt(projectId);

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
