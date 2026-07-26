/* ── CodaScope: Command Registry ──────────────────────────────────────
   Single source of truth for all slash commands. Drives the palette,
   docs sync, and agent self-awareness.

   Each command specifies:
   - behavior: "dispatch" (direct API / navigation) or "chat" (inject prompt)
   - relevance: view-context rules for soft-filtering
   ──────────────────────────────────────────────────────────────────── */

import type { AssistantScopeKind } from "./codaScopeTypes";

// ── Types ───────────────────────────────────────────────────────────

export type CommandCategory =
  | "build"
  | "analyze"
  | "navigate"
  | "epic"
  | "design"
  | "knowledge"
  | "help";

export interface RelevanceRule {
  view?: string;     // e.g. "wiki", "quality", "dashboard", "epic"
  condition?: string; // e.g. "no-wiki", "has-wiki", "has-epic"
}

export interface SlashCommand {
  id: string;
  slash: string;
  label: string;
  description: string;
  category: CommandCategory;
  behavior: "dispatch" | "chat";
  assistantScopes: AssistantScopeKind[];
  capability:
    | "help"
    | "read-only-chat"
    | "project-navigation"
    | "project-build"
    | "project-mutation";
  /** For chat commands — the prompt injected into the input */
  prompt?: string;
  /** When this command is most relevant (for soft-filtering) */
  relevance: RelevanceRule[];
  /** Only available when a project is selected */
  requiresProject?: boolean;
  /** Only available when viewing an epic */
  requiresEpic?: boolean;
}

export interface CommandContext {
  assistantScope: AssistantScopeKind;
  currentView: string | null;
  hasProject: boolean;
  isEpicView: boolean;
  epicId: string | null;
  hasWiki: boolean;
  hasCodeMap: boolean;
}

// ── Command Registry ────────────────────────────────────────────────

export const COMMANDS: SlashCommand[] = [
  // ── Build ──
  {
    id: "build-wiki",
    slash: "/build wiki",
    label: "Build Full Wiki",
    description: "Generate wiki docs from the code map",
    category: "build",
    behavior: "dispatch",
    assistantScopes: ["project"],
    capability: "project-build",
    relevance: [{ view: "dashboard" }, { view: "wiki" }],
    requiresProject: true,
  },
  {
    id: "build-wiki-page",
    slash: "/build wiki-page",
    label: "Build Single Page",
    description: "Generate or update a single wiki page",
    category: "build",
    behavior: "dispatch",
    assistantScopes: ["project"],
    capability: "project-build",
    relevance: [{ view: "wiki" }],
    requiresProject: true,
  },
  {
    id: "build-code-map",
    slash: "/build code-map",
    label: "Build Code Map",
    description: "Map the codebase structure for analysis",
    category: "build",
    behavior: "dispatch",
    assistantScopes: ["project"],
    capability: "project-build",
    relevance: [{ view: "dashboard" }],
    requiresProject: true,
  },
  {
    id: "deep-run",
    slash: "/deep-run",
    label: "Deep Run",
    description: "Run a full code-to-wiki deep sync",
    category: "build",
    behavior: "dispatch",
    assistantScopes: ["project"],
    capability: "project-build",
    relevance: [{ view: "dashboard" }, { view: "wiki" }],
    requiresProject: true,
  },
  {
    id: "build-artifact",
    slash: "/build artifact",
    label: "Build Artifact",
    description: "Create a visual artifact from design docs",
    category: "build",
    behavior: "chat",
    assistantScopes: ["project"],
    capability: "project-mutation",
    prompt: "Build a visual artifact from the current design document",
    relevance: [{ view: "epic" }],
    requiresProject: true,
    requiresEpic: true,
  },


  {
    id: "explore",
    slash: "/explore",
    label: "Explore Codebase",
    description: "Map and analyze the codebase structure",
    category: "analyze",
    behavior: "dispatch",
    assistantScopes: ["project"],
    capability: "project-build",
    relevance: [{ view: "dashboard" }],
    requiresProject: true,
  },
  {
    id: "scan-delta",
    slash: "/scan delta",
    label: "Delta Detection",
    description: "Find stale wiki pages that need updates",
    category: "analyze",
    behavior: "dispatch",
    assistantScopes: ["project"],
    capability: "project-build",
    relevance: [{ view: "wiki" }],
    requiresProject: true,
  },

  // ── Navigate ──
  {
    id: "goto-dashboard",
    slash: "/goto dashboard",
    label: "Go to Dashboard",
    description: "Navigate to the project dashboard",
    category: "navigate",
    behavior: "dispatch",
    assistantScopes: ["project"],
    capability: "project-navigation",
    relevance: [{ view: "*" }],
    requiresProject: true,
  },
  {
    id: "goto-wiki",
    slash: "/goto wiki",
    label: "Go to Wiki",
    description: "Navigate to the wiki",
    category: "navigate",
    behavior: "dispatch",
    assistantScopes: ["project"],
    capability: "project-navigation",
    relevance: [{ view: "*" }],
    requiresProject: true,
  },

  {
    id: "goto-skills",
    slash: "/goto skills",
    label: "Go to Skills",
    description: "Navigate to skills",
    category: "navigate",
    behavior: "dispatch",
    assistantScopes: ["project"],
    capability: "project-navigation",
    relevance: [{ view: "*" }],
    requiresProject: true,
  },
  {
    id: "goto-epics",
    slash: "/goto epics",
    label: "Go to Epics",
    description: "Navigate to the epics list",
    category: "navigate",
    behavior: "dispatch",
    assistantScopes: ["project"],
    capability: "project-navigation",
    relevance: [{ view: "*" }],
    requiresProject: true,
  },
  {
    id: "goto-settings",
    slash: "/goto settings",
    label: "Go to Settings",
    description: "Navigate to project settings",
    category: "navigate",
    behavior: "dispatch",
    assistantScopes: ["project"],
    capability: "project-navigation",
    relevance: [{ view: "*" }],
    requiresProject: true,
  },

  // ── Epic ──
  {
    id: "epic-create",
    slash: "/epic create",
    label: "Create Epic",
    description: "Start a new epic for feature planning",
    category: "epic",
    behavior: "dispatch",
    assistantScopes: ["project"],
    capability: "project-mutation",
    relevance: [{ view: "epics" }],
    requiresProject: true,
  },
  {
    id: "epic-define",
    slash: "/epic define",
    label: "Define Epic",
    description: "Run the interactive definition interview",
    category: "epic",
    behavior: "chat",
    assistantScopes: ["project"],
    capability: "project-mutation",
    prompt: "Help me define this epic — let's start with the interview",
    relevance: [{ view: "epic" }],
    requiresProject: true,
    requiresEpic: true,
  },
  {
    id: "epic-scope",
    slash: "/epic scope",
    label: "Scope Epic",
    description: "Map the epic to relevant code topics",
    category: "epic",
    behavior: "chat",
    assistantScopes: ["project"],
    capability: "project-mutation",
    prompt: "Help me scope this epic to the relevant parts of the codebase",
    relevance: [{ view: "epic" }],
    requiresProject: true,
    requiresEpic: true,
  },
  {
    id: "epic-curate",
    slash: "/epic curate",
    label: "Curate Knowledge",
    description: "Process and curate research knowledge",
    category: "epic",
    behavior: "chat",
    assistantScopes: ["project"],
    capability: "project-mutation",
    prompt: "Help me curate the knowledge for this epic — synthesize the research into wiki pages",
    relevance: [{ view: "epic" }],
    requiresProject: true,
    requiresEpic: true,
  },

  // ── Design ──
  {
    id: "design-create",
    slash: "/design create",
    label: "Create Design Doc",
    description: "Start a new design document",
    category: "design",
    behavior: "chat",
    assistantScopes: ["project"],
    capability: "project-mutation",
    prompt: "Create a design document for this epic. I'd like to cover the key technical decisions, architecture approach, and implementation plan.",
    relevance: [{ view: "epic" }],
    requiresProject: true,
    requiresEpic: true,
  },
  {
    id: "design-review",
    slash: "/design review",
    label: "Review Design",
    description: "Get feedback on a design document",
    category: "design",
    behavior: "chat",
    assistantScopes: ["project"],
    capability: "project-mutation",
    prompt: "Review the current design document and provide feedback on completeness, edge cases, and potential issues",
    relevance: [{ view: "epic" }],
    requiresProject: true,
    requiresEpic: true,
  },
  {
    id: "design-annotate",
    slash: "/design annotate",
    label: "Annotate Design",
    description: "Add targeted feedback annotations",
    category: "design",
    behavior: "chat",
    assistantScopes: ["project"],
    capability: "project-mutation",
    prompt: "Annotate the current design document with targeted feedback on specific sections",
    relevance: [{ view: "epic" }],
    requiresProject: true,
    requiresEpic: true,
  },

  // ── Knowledge ──
  {
    id: "research",
    slash: "/research",
    label: "Research Topic",
    description: "Research a topic from the web",
    category: "knowledge",
    behavior: "chat",
    assistantScopes: ["project"],
    capability: "project-mutation",
    prompt: "Help me research topics relevant to this epic. What areas should we investigate?",
    relevance: [{ view: "epic" }],
    requiresProject: true,
    requiresEpic: true,
  },
  {
    id: "process-sources",
    slash: "/process sources",
    label: "Process Sources",
    description: "Process and extract info from research sources",
    category: "knowledge",
    behavior: "chat",
    assistantScopes: ["project"],
    capability: "project-mutation",
    prompt: "Process the research sources for this epic and extract key insights",
    relevance: [{ view: "epic" }],
    requiresProject: true,
    requiresEpic: true,
  },

  // ── Help ──
  {
    id: "help",
    slash: "/help",
    label: "Open Guide",
    description: "Open the CodaScope guide",
    category: "help",
    behavior: "dispatch",
    assistantScopes: ["workspace", "project"],
    capability: "help",
    relevance: [{ view: "*" }],
  },
  {
    id: "commands",
    slash: "/commands",
    label: "Chat Agent Guide",
    description: "View what the assistant can do",
    category: "help",
    behavior: "dispatch",
    assistantScopes: ["workspace", "project"],
    capability: "help",
    relevance: [{ view: "*" }],
  },
  {
    id: "shortcuts",
    slash: "/shortcuts",
    label: "Keyboard Shortcuts",
    description: "View keyboard shortcuts",
    category: "help",
    behavior: "dispatch",
    assistantScopes: ["workspace", "project"],
    capability: "help",
    relevance: [{ view: "*" }],
  },
];

// ── Category labels ─────────────────────────────────────────────────

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  build: "Build",
  analyze: "Analyze",
  navigate: "Navigate",
  epic: "Epic",
  design: "Design",
  knowledge: "Knowledge",
  help: "Help",
};

export function getCategoryLabel(category: CommandCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

// ── Filtering & Sorting ─────────────────────────────────────────────

/**
 * Check if a command is relevant to the current context.
 * Returns true if at least one relevance rule matches.
 */
function isRelevant(cmd: SlashCommand, ctx: CommandContext): boolean {
  if (cmd.relevance.length === 0) return false;
  return cmd.relevance.some((rule) => {
    if (rule.view === "*") return true;
    if (rule.view && rule.view !== ctx.currentView) return false;
    if (rule.condition === "has-wiki" && !ctx.hasWiki) return false;
    if (rule.condition === "no-wiki" && ctx.hasWiki) return false;
    if (rule.condition === "has-epic" && !ctx.isEpicView) return false;
    return true;
  });
}

export function canDispatchCommand(
  command: SlashCommand,
  context: CommandContext,
): boolean {
  if (!command.assistantScopes.includes(context.assistantScope)) return false;
  if (context.assistantScope === "workspace"
    && command.capability !== "help"
    && command.capability !== "read-only-chat") {
    return false;
  }
  if (command.requiresProject && !context.hasProject) return false;
  if (command.requiresEpic && !context.isEpicView) return false;
  return true;
}

/**
 * Simple fuzzy-ish match: check if all query chars appear in order within the target.
 */
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Filter and soft-sort commands by relevance.
 * - Removes commands that don't match the query
 * - Removes commands whose requirements aren't met (requiresProject, requiresEpic)
 * - Relevant commands sort first
 */
export function getFilteredCommands(
  query: string,
  ctx: CommandContext,
): { relevant: SlashCommand[]; other: SlashCommand[] } {
  // Filter by query (fuzzy match on slash + label + description)
  const q = query.trim();
  const matchesQuery = (cmd: SlashCommand) => {
    if (!q) return true;
    const haystack = `${cmd.slash} ${cmd.label} ${cmd.description}`;
    return fuzzyMatch(q, haystack);
  };

  const relevant: SlashCommand[] = [];
  const other: SlashCommand[] = [];

  for (const cmd of COMMANDS) {
    if (!matchesQuery(cmd)) continue;
    if (!canDispatchCommand(cmd, ctx)) continue;

    if (isRelevant(cmd, ctx)) {
      relevant.push(cmd);
    } else {
      other.push(cmd);
    }
  }

  return { relevant, other };
}
