/* ── CodaScope: Context Assembler ─────────────────────────────────────
   Lightweight current-view context for the right-panel assistant.
   
   Produces a MessageContext object with the current view, topicId,
   file info, and recent navigation history. The server-side prompt
   helpers handle formatting this into the agent prompt.
   ──────────────────────────────────────────────────────────────────── */

export interface MessageContext {
  view: string;
  topicId?: string | null;
  topicTitle?: string | null;
  filePath?: string | null;
  recentViews?: Array<{ view: string; label: string }>;
  projectName: string;
  projectId: string;
  /** Epic context (when viewing an epic) */
  epicId?: string | null;
  epicTitle?: string | null;
}

/* ── Recent Views Ring Buffer ──────────────────────────────────────── */

const MAX_RECENT_VIEWS = 5;
const recentViewsBuffer: Array<{ view: string; label: string }> = [];

/**
 * Record a view visit into the ring buffer.
 * Called each time the user navigates to a new view.
 */
export function recordViewVisit(view: string, label: string): void {
  // Don't record duplicate consecutive views
  const last = recentViewsBuffer[recentViewsBuffer.length - 1];
  if (last?.view === view && last?.label === label) return;

  recentViewsBuffer.push({ view, label });
  if (recentViewsBuffer.length > MAX_RECENT_VIEWS) {
    recentViewsBuffer.shift();
  }
}

/**
 * Get the current recent views snapshot.
 */
export function getRecentViews(): Array<{ view: string; label: string }> {
  return [...recentViewsBuffer];
}

/**
 * Clear the recent views buffer (e.g., on project switch).
 */
export function clearRecentViews(): void {
  recentViewsBuffer.length = 0;
}

/* ── View Labels ──────────────────────────────────────────────────── */

function viewLabel(view: string, topicId?: string | null, topicTitle?: string | null, epicTitle?: string | null): string {
  switch (view) {
    case "dashboard": return "Dashboard";
    case "wiki":
      if (topicId) return topicTitle ?? topicId;
      return "Wiki";
    case "quality": return "Quality";
    case "rules": return "Golden Rules";
    case "concepts": return "Concepts";
    case "settings": return "Settings";
    case "skills": return "Skills";
    case "epics": return "Epics";
    case "epic":
      return epicTitle ? `Epic: ${epicTitle}` : "Epic";
    default: return view;
  }
}

/* ── Main Assembler ───────────────────────────────────────────────── */

/**
 * Assemble a context object from the current URL state and optional metadata.
 * This is sent with each message so the server knows what the user
 * is currently viewing, including any file they're focused on.
 */
export function assembleContext(
  urlSegments: string[],
  projectName: string,
  projectId: string,
  options?: {
    topicTitle?: string | null;
    filePath?: string | null;
    epicId?: string | null;
    epicTitle?: string | null;
  },
): MessageContext | null {
  if (!urlSegments.length) return null;

  const section = urlSegments[0];
  if (section !== "project" || !urlSegments[1]) return null;

  const view = urlSegments[2] ?? "dashboard";
  const topicId = view === "wiki" ? (urlSegments[3] ?? null) : null;
  const topicTitle = options?.topicTitle ?? null;

  // Epic context: extract epicId from URL /project/:id/epic/:epicId/...
  const epicId = view === "epic" ? (urlSegments[3] ?? options?.epicId ?? null) : null;
  const epicTitle = options?.epicTitle ?? null;

  // Record this view visit
  recordViewVisit(view, viewLabel(view, topicId, topicTitle, epicTitle));

  return {
    view,
    topicId,
    topicTitle,
    filePath: options?.filePath ?? null,
    recentViews: getRecentViews(),
    projectName,
    projectId,
    epicId,
    epicTitle,
  };
}
