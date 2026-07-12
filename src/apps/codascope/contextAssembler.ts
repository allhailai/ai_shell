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
  /** Current epic tab (define/scope/knowledge/design/history) */
  epicTab?: string | null;
  /** Note context (when viewing a note) */
  noteScope?: string | null;
  noteVisibility?: string | null;
  notePath?: string | null;
}

/* ── Recent Views Ring Buffer ──────────────────────────────────────── */

const MAX_RECENT_VIEWS = 5;
const recentViewsBuffer: Array<{ view: string; label: string }> = [];

/**
 * Record a view visit into the ring buffer.
 * Called each time the user navigates to a new view.
 */
function recordViewVisit(view: string, label: string): void {
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
function getRecentViews(): Array<{ view: string; label: string }> {
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
    case "notes": return "Notes";
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
    epicTab?: string | null;
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
  // Epic tab: /project/:id/epic/:epicId/:tab
  const epicTab = view === "epic" ? (urlSegments[4] ?? options?.epicTab ?? "define") : null;

  // Note context: /project/:id/notes/<visibility>/<path> or
  //               /project/:id/epic/:epicId/notes/<visibility>/<path>
  let noteScope: string | null = null;
  let noteVisibility: string | null = null;
  let notePath: string | null = null;

  if (view === "notes") {
    // Project-level notes: /project/:id/notes/<visibility>/<path>
    noteScope = "project";
    noteVisibility = urlSegments[3] ?? "shared";
    const pathParts = urlSegments.slice(4);
    notePath = pathParts.length > 0 ? pathParts.join("/") : null;
  } else if (view === "epic" && urlSegments[4] === "notes") {
    // Epic-level notes: /project/:id/epic/:epicId/notes/<visibility>/<path>
    noteScope = "epic";
    noteVisibility = urlSegments[5] ?? "shared";
    const pathParts = urlSegments.slice(6);
    notePath = pathParts.length > 0 ? pathParts.join("/") : null;
  }

  // Record this view visit
  const effectiveView = noteScope ? "notes" : view;
  recordViewVisit(effectiveView, viewLabel(effectiveView, topicId, topicTitle, epicTitle));

  return {
    view: effectiveView,
    topicId,
    topicTitle,
    filePath: options?.filePath ?? null,
    recentViews: getRecentViews(),
    projectName,
    projectId,
    epicId,
    epicTitle,
    epicTab,
    noteScope,
    noteVisibility,
    notePath,
  };
}
