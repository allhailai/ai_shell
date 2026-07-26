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
    explicitlyReferencedProjectIds:
      normalizeWorkspaceProjectReferenceIds(explicitlyReferencedProjectIds),
    currentView: buildWorkspaceCurrentView(segments, routeNote),
  };
}

export function normalizeWorkspaceProjectReferenceIds(
  projectIds: readonly string[],
): string[] {
  if (projectIds.length > 25) {
    throw new Error("Workspace messages support at most 25 project references.");
  }
  const unique = new Set<string>();
  for (const projectId of projectIds) {
    if (!isSafeWorkspaceProjectReferenceId(projectId)) {
      throw new Error("Invalid workspace project reference.");
    }
    unique.add(projectId);
  }
  return [...unique].sort();
}

function isSafeWorkspaceProjectReferenceId(value: string): boolean {
  return value.length > 0
    && value.length <= 255
    && value.trim() === value
    && value !== "."
    && value !== ".."
    && !value.includes("\0")
    && !value.includes("/")
    && !value.includes("\\")
    && !/%(?:25)*(?:2f|5c)/i.test(value)
    && !/^[a-z]:/i.test(value);
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
