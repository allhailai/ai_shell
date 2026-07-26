import type { CodaScopeAction } from "./codaScopeTypes";
import type {
  CanonicalWorkspaceNoteState,
} from "./workspaceMutationActionValidation";
import {
  normalizeCanonicalWorkspaceMutationActions,
} from "./workspaceMutationActionValidation";
import type { WorkspaceNoteApi } from "./workspaceNoteApi";

export function distinctWorkspaceCreatedNoteActions(
  value: unknown,
): CodaScopeAction[] {
  const actions = normalizeCanonicalWorkspaceMutationActions(value);
  if (!actions) return [];
  const stableIds = new Set<string>();
  return actions.filter((action) => {
    if (action.type !== "note_created") return false;
    const stableId = action.attributes.stableId;
    if (stableIds.has(stableId)) return false;
    stableIds.add(stableId);
    return true;
  });
}

export function selectSingleCreatedNoteStableId(
  value: unknown,
): string | null {
  const actions = distinctWorkspaceCreatedNoteActions(value);
  return actions.length === 1 ? actions[0].attributes.stableId : null;
}

export function buildWorkspaceNoteSubRoute(
  note: CanonicalWorkspaceNoteState,
): string {
  const segments = note.path.split("/");
  const filename = segments.at(-1) ?? "";
  segments[segments.length - 1] = filename.slice(0, -3);
  return [
    "notes",
    note.visibility,
    ...segments.map((segment) => encodeURIComponent(segment)),
  ].join("/");
}

export function claimLiveTurnNavigation(
  claimedTurns: Set<number>,
  turnId: number,
): boolean {
  if (claimedTurns.has(turnId)) return false;
  claimedTurns.add(turnId);
  return true;
}

export async function navigateSingleLiveCreatedNote(
  value: unknown,
  api: WorkspaceNoteApi,
  isCurrent: () => boolean,
  navigate: (subRoute: string) => void,
): Promise<boolean> {
  const stableId = selectSingleCreatedNoteStableId(value);
  if (!stableId || !isCurrent()) return false;
  const result = await api.read(stableId);
  if (result.status !== "success" || !isCurrent()) return false;
  navigate(buildWorkspaceNoteSubRoute(result.note));
  return true;
}
