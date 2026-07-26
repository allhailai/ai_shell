import type {
  AssistantScope,
  WorkspaceCurrentNoteMetadata,
  WorkspaceCurrentView,
  WorkspaceMessageContext,
} from "./codaScopeTypes";

export function resolveAssistantScope(
  segments: readonly string[],
): AssistantScope {
  if (segments[0] === "project" && segments[1]) {
    return { kind: "project", projectId: segments[1] };
  }
  return { kind: "workspace" };
}

export function getAssistantScopeKey(scope: AssistantScope): string {
  return scope.kind === "workspace"
    ? "workspace"
    : `project:${scope.projectId}`;
}

export function getAssistantRestorationKey(scope: AssistantScope): string {
  return scope.kind === "workspace"
    ? "codascope:lastConv:workspace"
    : `codascope:lastConv:${scope.projectId}`;
}

export function canUseProjectMentions(scope: AssistantScope): boolean {
  return scope.kind === "project";
}

export function rootNoteMatchesRoute(
  note: WorkspaceCurrentNoteMetadata | null,
  segments: readonly string[],
): boolean {
  if (!note || segments[0] !== "notes") return false;
  const visibility = segments[1] === "private" ? "private" : "shared";
  const path = segments
    .slice(2)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
  if (!path) return false;
  const notePath = path.endsWith(".md") ? path : `${path}.md`;
  return note.visibility === visibility && note.path === notePath;
}

export function buildWorkspaceCurrentView(
  segments: readonly string[],
  currentNote: WorkspaceCurrentNoteMetadata | null,
): WorkspaceCurrentView {
  const view = segments[0] ?? "projects";
  if (view === "notes") {
    const visibility = segments[1] === "private" ? "private" : "shared";
    const path = segments.slice(2).join("/");
    return {
      view: "notes",
      identity: path
        ? `codascope:${visibility}:${path}`
        : `codascope:${visibility}`,
      label: currentNote?.title ?? `${visibility === "private" ? "Private" : "Shared"} notes`,
    };
  }
  return {
    view,
    identity: segments.length > 0 ? segments.join("/") : "codascope",
    label: workspaceViewLabel(view),
  };
}

export function buildWorkspaceMessageContext(
  segments: readonly string[],
  currentNote: WorkspaceCurrentNoteMetadata | null,
  explicitlyReferencedProjectIds: readonly string[] = [],
): WorkspaceMessageContext {
  const routeNote = rootNoteMatchesRoute(currentNote, segments)
    ? currentNote
    : null;
  return {
    assistantScope: { kind: "workspace" },
    ...(routeNote ? { currentNote: { ...routeNote } } : {}),
    explicitlyReferencedProjectIds: [...explicitlyReferencedProjectIds],
    currentView: buildWorkspaceCurrentView(segments, routeNote),
  };
}

function workspaceViewLabel(view: string): string {
  switch (view) {
    case "projects":
      return "Projects";
    case "notes":
      return "Notes";
    case "settings":
      return "CodaScope settings";
    default:
      return view.charAt(0).toUpperCase() + view.slice(1);
  }
}
