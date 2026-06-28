/* ── CodaScope: Context Assembler ─────────────────────────────────────
   Lightweight current-view context for the right-panel assistant.
   
   Instead of dumping full wiki content, this provides a brief summary
   of what the user is currently looking at. The agent discovers deeper
   content via custom tools (list_wiki_topics, read_wiki_topic, etc).
   ──────────────────────────────────────────────────────────────────── */

export interface AssistantContext {
  view: string;
  projectName: string;
  summary: string;
}

/**
 * Assemble a lightweight context string from the current URL state.
 * This is prepended to the user's message so the agent knows what view
 * they're looking at.
 */
export function assembleContext(
  urlSegments: string[],
  projectName: string,
): AssistantContext | null {
  if (!urlSegments.length) return null;

  const section = urlSegments[0];
  if (section !== "project" || !urlSegments[1]) return null;

  const view = urlSegments[2] ?? "dashboard";
  const topicId = view === "wiki" ? (urlSegments[3] ?? null) : null;

  switch (view) {
    case "dashboard":
      return {
        view: "dashboard",
        projectName,
        summary: `The user is viewing the project dashboard for "${projectName}". They can see project stats, repository list, and quick actions.`,
      };

    case "wiki":
      if (topicId) {
        return {
          view: "wiki",
          projectName,
          summary: `The user is reading wiki topic "${topicId}" in project "${projectName}". Use the read_wiki_topic tool with topicId="${topicId}" to see what they're reading if needed.`,
        };
      }
      return {
        view: "wiki",
        projectName,
        summary: `The user is browsing the wiki topic list for project "${projectName}". Use list_wiki_topics to see available topics.`,
      };

    case "chat":
      return {
        view: "chat",
        projectName,
        summary: `The user is in the full-screen codebase chat for project "${projectName}".`,
      };

    case "skills":
      return {
        view: "skills",
        projectName,
        summary: `The user is viewing the skills manager for project "${projectName}". Use list_project_skills to see available skills.`,
      };

    case "settings":
      return {
        view: "settings",
        projectName,
        summary: `The user is viewing project settings for "${projectName}". Use list_repositories to see configured repos.`,
      };

    default:
      return {
        view,
        projectName,
        summary: `The user is viewing the "${view}" section of project "${projectName}".`,
      };
  }
}

/**
 * Format the context into a string suitable for the agent system prompt.
 */
export function formatContextForAgent(ctx: AssistantContext | null): string | undefined {
  if (!ctx) return undefined;
  return `[Current View: ${ctx.view}] ${ctx.summary}`;
}
