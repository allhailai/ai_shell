/* ── CodaScope: Chat Prompt Helpers ───────────────────────────────────
   Utilities for constructing the agent system prompt at request time.

   - buildProjectManifest()  — lightweight project overview (~500 tokens)
   - formatHistoryMessage()  — role-prefixed, truncated for assistant msgs
   - formatViewContext()     — human-readable current view description
   ──────────────────────────────────────────────────────────────────── */

/* ── Types ──────────────────────────────────────────────────────────── */

export interface ManifestInput {
  /** Project basics */
  projectName: string;
  projectId: string;
  repositoryCount: number;
  repositories: Array<{ name: string; path: string }>;

  /** Wiki */
  wikiTopicTitles: Array<{ id: string; title: string }>;

  /** Build state */
  currentBuildStatus: string;
  lastBuildTimestamp: string | null;
  lastBuildCommand: string | null;

  /** Wiki build freshness */
  lastWikiBuildTimestamp: string | null;

  /** Code map freshness */
  lastCodeMapBuildTimestamp: string | null;
}

export interface HistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
}

export interface ViewContext {
  view: string;
  topicId?: string | null;
  topicTitle?: string | null;
  filePath?: string | null;
  recentViews?: Array<{ view: string; label: string }>;
  projectName?: string;
  projectId?: string;
  /** Epic context (when viewing an epic) */
  epicId?: string | null;
  epicTitle?: string | null;
  /** Current epic tab (define/scope/knowledge/design/history) */
  epicTab?: string | null;
  /** Note context (when viewing a note) */
  noteScope?: string | null;
  noteVisibility?: string | null;
  notePath?: string | null;
}

/* ── Constants ──────────────────────────────────────────────────────── */

const MAX_ASSISTANT_HISTORY_CHARS = 300;
const MAX_WIKI_TOPICS_IN_MANIFEST = 30;

/** Only include messages created within this window */
const HISTORY_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/* ── Manifest Builder ──────────────────────────────────────────────── */

/**
 * Build a lightweight project manifest string for injection into
 * the agent system prompt. Keeps token budget around ~500 tokens
 * by truncating lists and using compact formatting.
 */
export function buildProjectManifest(input: ManifestInput): string {
  const sections: string[] = [];

  // Project summary
  sections.push(
    `### Project: ${input.projectName}`,
    `- Repositories: ${input.repositoryCount}`,
    `- Wiki topics: ${input.wikiTopicTitles.length}`,
  );

  // Repositories
  if (input.repositories.length > 0) {
    sections.push(
      "",
      "### Repositories",
      ...input.repositories.map((r) => `- **${r.name}** → \`${r.path}\``),
    );
  }

  // Wiki topics (truncated)
  if (input.wikiTopicTitles.length > 0) {
    const shown = input.wikiTopicTitles.slice(0, MAX_WIKI_TOPICS_IN_MANIFEST);
    const remaining = input.wikiTopicTitles.length - shown.length;
    sections.push(
      "",
      "### Wiki Topics",
      ...shown.map((t) => `- ${t.title} (id: ${t.id})`),
    );
    if (remaining > 0) {
      sections.push(`- _(+${remaining} more — use list_wiki_topics to see all)_`);
    }
  } else {
    sections.push("", "### Wiki Topics", "- _No wiki pages yet. Consider running a wiki build._");
  }

  // Data freshness
  sections.push(
    "",
    "### Data Freshness",
    `- Current build: ${input.currentBuildStatus}`,
    `- Last build: ${input.lastBuildTimestamp ?? "never"}${input.lastBuildCommand ? ` (${input.lastBuildCommand})` : ""}`,
    `- Last wiki build: ${input.lastWikiBuildTimestamp ?? "never"}`,
    `- Last code map build: ${input.lastCodeMapBuildTimestamp ?? "never"}`,
  );

  return sections.join("\n");
}

/* ── History Formatter ─────────────────────────────────────────────── */

/**
 * Format a conversation message for inclusion in the agent prompt.
 *
 * - User messages: full content with [User]: prefix
 * - Assistant messages: truncated to ~300 chars with [Assistant]: prefix
 * - System messages: full content with [System]: prefix
 */
export function formatHistoryMessage(msg: HistoryMessage): string {
  const { role, content } = msg;

  switch (role) {
    case "user":
      return `[User]: ${content}`;

    case "assistant": {
      if (content.length <= MAX_ASSISTANT_HISTORY_CHARS) {
        return `[Assistant]: ${stripMarkdownForHistory(content)}`;
      }
      const truncated = stripMarkdownForHistory(content).slice(0, MAX_ASSISTANT_HISTORY_CHARS);
      return `[Assistant]: ${truncated}...`;
    }

    case "system":
      return `[System]: ${content}`;

    default:
      return `[${role}]: ${content}`;
  }
}

/**
 * Format an array of conversation messages into a single prompt string.
 *
 * Applies two filters before formatting:
 * 1. **Recency**: Only includes messages created within the last 7 days.
 *    Stale conversations should not waste tokens on outdated history.
 * 2. **Count**: Takes the last `maxMessages` after freshness filtering.
 *    Defaults to 5 — enough for conversational context without bloating
 *    the prompt in a multi-user environment.
 */
export function formatConversationHistory(
  messages: HistoryMessage[],
  maxMessages = 5,
): string {
  if (messages.length === 0) return "_No prior messages in this conversation._";

  const now = Date.now();
  const cutoff = now - HISTORY_FRESHNESS_MS;

  // Filter to messages within the freshness window
  const fresh = messages.filter((m) => {
    if (!m.createdAt) return true; // if no timestamp, include it (backwards compat)
    const ts = Date.parse(m.createdAt);
    return Number.isFinite(ts) && ts > cutoff;
  });

  if (fresh.length === 0) {
    return "_Prior messages in this conversation are older than 7 days._";
  }

  const recent = fresh.slice(-maxMessages);
  return recent.map(formatHistoryMessage).join("\n\n");
}

/* ── View Context Formatter ────────────────────────────────────────── */

/**
 * Produce a human-readable description of what the user is currently viewing.
 *
 * Includes:
 * - The current CodaScope view (dashboard, wiki, quality, etc.)
 * - The specific topic or file the user is focused on
 * - A breadcrumb of recent views for navigation awareness
 */
export function formatViewContext(ctx: ViewContext | null | undefined): string {
  if (!ctx) return "The user's current view is unknown.";

  const { view, topicId, topicTitle, filePath, recentViews, projectName } = ctx;
  const project = projectName ? ` in project "${projectName}"` : "";

  const lines: string[] = [];

  // Current view
  switch (view) {
    case "dashboard":
      lines.push(`The user is viewing the project dashboard${project}. They can see project stats, repository list, and quick actions.`);
      break;

    case "wiki":
      if (topicId) {
        const topicLabel = topicTitle ? `"${topicTitle}" (id: ${topicId})` : `"${topicId}"`;
        lines.push(
          `The user is reading wiki topic ${topicLabel}${project}.`,
          `Use read_wiki_topic(topicId="${topicId}") to see what they're reading.`,
        );
      } else {
        lines.push(`The user is browsing the wiki topic list${project}. Use list_wiki_topics to see available topics.`);
      }
      break;

    case "settings":
      lines.push(`The user is viewing project settings${project}. Use list_repositories to see configured repos.`);
      break;

    case "skills":
      lines.push(`The user is viewing the skills manager${project}. Use list_project_skills to see available skills.`);
      break;

    case "notes":
    case "note": {
      const noteScope = ctx.noteScope ?? "codascope";
      const noteVisibility = ctx.noteVisibility ?? "shared";
      const notePath = ctx.notePath;
      if (notePath) {
        lines.push(
          `The user is viewing a note at scope "${noteScope}" (${noteVisibility}): "${notePath}"${project}.`,
          `Use read_note(scope="${noteScope}", visibility="${noteVisibility}", path="${notePath}") to see the full content.`,
          `When associated files matter, call list_note_documents for this note; request one path with get_note_document_path only when needed.`,
          `The user may ask you to help edit, expand, or reorganize this note.`,
        );
      } else {
        lines.push(`The user is browsing notes at scope "${noteScope}" (${noteVisibility})${project}. Use list_notes to see available notes.`);
      }
      break;
    }

    case "epics":
      lines.push(`The user is viewing the epic designs list${project}. They can see all epics with status and health indicators.`);
      break;

    case "epic": {
      const epicLabel = ctx.epicTitle ? `"${ctx.epicTitle}"` : (ctx.epicId ?? "unknown");
      const tabLabel = ctx.epicTab ?? "define";
      lines.push(
        `The user is viewing epic ${epicLabel}${project}, currently on the **${tabLabel}** tab.`,
        `This is an epic design document. The user may ask you to help define, scope, or refine this epic.`,
        `Use the epic context below (if provided) to understand the current state of this epic.`,
      );
      if (tabLabel === "design") {
        lines.push(
          `The user is on the Design tab. If curated knowledge or research exists, you can:`,
          `- Recommend relevant design-document archetypes, such as an API specification, data model, system design, user flow, or decision record, and explain why they fit this epic`,
          `- Draft design docs grounded in curated research (reference epic wiki pages and research sources)`,
          `- Review existing design documents and use create_annotation to leave targeted feedback`,
          `CodaScope has no selectable design-document catalog or picker. When the user requests creation, read the current epic and research context, draft substantial complete markdown, then call create_design_doc(epicId, title, content). Do not create a confirmation action card for that explicit request.`,
        );
      }
      break;
    }

    default:
      lines.push(`The user is viewing the "${view}" section${project}.`);
  }

  // Current file context
  if (filePath) {
    lines.push(`The user is currently focused on file: \`${filePath}\`. You can read this file directly if relevant to their question.`);
  }

  // Recent navigation breadcrumbs
  if (recentViews && recentViews.length > 0) {
    const trail = recentViews
      .slice(0, 5)
      .map((rv) => rv.label)
      .join(" → ");
    lines.push(`Recent navigation: ${trail}`);
  }

  return lines.join("\n");
}

/* ── Epic Context Builder ────────────────────────────────────────── */

export interface EpicContextInput {
  epicId: string;
  title: string;
  status: string;
  definition: string;
  scope: { entryCount: number; lastScopedAt: string | null } | null;
  designDocCount: number;
  conversationId: string | null;
  /** Knowledge context (Phase 3) */
  epicWikiPageCount?: number;
  epicWikiPageTitles?: Array<{ id: string; title: string }>;
  researchSources?: {
    total: number;
    ready: number;
    pending: number;
    error: number;
  };
  curation?: {
    pendingReasonCount: number;
    lastCuratedAt: string | null;
    lastCurationStatus: string | null;
  };
}

/**
 * Build a concise epic context block (~300 tokens) for injection
 * into the chat agent system prompt when the user is viewing an epic.
 * Enhanced with knowledge and curation status data.
 */
export function buildEpicContext(input: EpicContextInput): string {
  const lines: string[] = [
    `### Active Epic: ${input.title}`,
    `- **ID**: ${input.epicId}`,
    `- **Status**: ${input.status}`,
  ];

  // Definition summary (first 200 chars)
  if (input.definition) {
    const summary = input.definition
      .replace(/^#.*$/gm, "")          // strip headings
      .replace(/\n{2,}/g, " ")         // collapse blank lines
      .replace(/\n/g, " ")             // single line
      .trim()
      .slice(0, 200);
    lines.push(`- **Definition preview**: ${summary}${input.definition.length > 200 ? "..." : ""}`);
  } else {
    lines.push(`- **Definition**: _No definition yet — the user may want to start a guided interview_`);
  }

  // Scope summary
  if (input.scope) {
    lines.push(`- **Scope**: ${input.scope.entryCount} topics${input.scope.lastScopedAt ? ` (last scoped: ${input.scope.lastScopedAt})` : ""}`);
  } else {
    lines.push(`- **Scope**: _Not scoped yet_`);
  }

  // Design docs
  lines.push(`- **Design docs**: ${input.designDocCount}`);

  // Knowledge context (Phase 3)
  if (input.epicWikiPageCount !== undefined) {
    lines.push(`- **Epic wiki pages**: ${input.epicWikiPageCount}`);
    if (input.epicWikiPageTitles && input.epicWikiPageTitles.length > 0) {
      const shown = input.epicWikiPageTitles.slice(0, 5);
      const titleList = shown.map((p) => p.title).join(", ");
      lines.push(`  - _Pages: ${titleList}${input.epicWikiPageTitles.length > 5 ? ` (+${input.epicWikiPageTitles.length - 5} more)` : ""}_`);
    }
  }

  // Research sources
  if (input.researchSources) {
    const rs = input.researchSources;
    lines.push(`- **Research sources**: ${rs.total} (${rs.ready} ready, ${rs.pending} pending, ${rs.error} error)`);
  }

  // Curation status
  if (input.curation) {
    const cur = input.curation;
    if (cur.lastCuratedAt) {
      lines.push(`- **Last curated**: ${cur.lastCuratedAt} (${cur.lastCurationStatus})`);
    } else {
      lines.push(`- **Curation**: _Not yet curated_`);
    }
    if (cur.pendingReasonCount > 0) {
      lines.push(`- **Curation triggers pending**: ${cur.pendingReasonCount}`);
    }
  }

  // Conversation
  if (input.conversationId) {
    lines.push(`- **Dedicated conversation**: ${input.conversationId}`);
  }

  return lines.join("\n");
}

/* ── Internal Helpers ──────────────────────────────────────────────── */

/**
 * Strip heavy markdown formatting for compact history summaries.
 * Keeps content readable but removes formatting that wastes tokens.
 */
function stripMarkdownForHistory(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "[code block]")  // collapse code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")      // [text](url) → text
    .replace(/[#*_~`>]/g, "")                      // strip formatting chars
    .replace(/\n{2,}/g, " ")                       // collapse blank lines
    .replace(/\n/g, " ")                           // single line
    .trim();
}

/* ── Reference Formatter ─────────────────────────────────────────── */

export interface ReferenceItem {
  category: string;
  id: string;
  label?: string;
}

/**
 * Format @-mention references into a system prompt section.
 * Tells the agent what context the user has referenced so it can
 * use its read tools to access the full content.
 */
export function formatReferences(references: ReferenceItem[]): string {
  if (!references || references.length === 0) return "";

  const lines: string[] = [
    "## Referenced Context",
    "",
    "The user has referenced the following items using @-mentions. Use the appropriate " +
    "read tools to access their full content when relevant to your response:",
    "",
  ];

  for (const ref of references) {
    const label = ref.label ? ` — "${ref.label}"` : "";
    switch (ref.category) {
      case "wiki":
        lines.push(`- **Wiki page**: \`${ref.id}\`${label} — use \`read_wiki_topic("${ref.id}")\``);
        break;
      case "source":
        lines.push(`- **Research source**: \`${ref.id}\`${label} — use \`read_research_source(epicId, "${ref.id}")\``);
        break;
      case "design":
        lines.push(`- **Design document**: \`${ref.id}\`${label} — use \`read_design_doc(epicId, "${ref.id}")\``);
        break;
      case "code":
        lines.push(`- **Code file/repo**: \`${ref.id}\`${label}`);
        break;
      case "definition":
        lines.push(`- **Epic definition** — use \`read_epic_definition(epicId)\``);
        break;
      default:
        lines.push(`- **${ref.category}**: \`${ref.id}\`${label}`);
    }
  }

  return lines.join("\n");
}

/* ── Selection Context Formatter ─────────────────────────────────── */

export interface SelectionContext {
  blockId: string;
  text: string;
  startLine: number;
  endLine: number;
  docId: string;
  epicId?: string;
}

/**
 * Format selection context into a system prompt section.
 * Tells the agent what text the user has selected in the document
 * and instructs it to make targeted edits to that specific area.
 */
export function formatSelectionContext(selection: SelectionContext): string {
  if (!selection || !selection.text) return "";

  const lines: string[] = [
    "## Selection Context",
    "",
    `The user has selected text in design document \`${selection.docId}\` ` +
    `(lines ${selection.startLine}–${selection.endLine}):`,
    "",
    "```",
    selection.text,
    "```",
    "",
    "**Instructions**: When the user asks you to edit or modify something, " +
    "focus your changes on this specific selected area. Use the `edit_design_doc_section` tool " +
    `with startLine=${selection.startLine} and endLine=${selection.endLine} to make targeted edits. ` +
    "Do NOT rewrite the entire document unless the user explicitly asks for a broad rewrite.",
  ];

  return lines.join("\n");
}
