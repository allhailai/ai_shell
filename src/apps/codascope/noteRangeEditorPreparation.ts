import type {
  AssistantScope,
  NoteScope,
  NoteVisibility,
} from "./codaScopeTypes";
import {
  normalizeCanonicalProjectNoteRangeTarget,
} from "./projectNoteRangeTargetValidation";
import {
  normalizeCanonicalWorkspaceNoteRangeTarget,
} from "./workspaceNoteRangeTargetValidation";
import type { CanonicalNoteRangeTarget } from "./noteRangeHandoff";

export interface NoteSaveSnapshot {
  content: string;
  title: string;
  tags: string[];
  status?: "draft" | "ready";
}

export interface NoteRangeSelectionStatus {
  kind: "status" | "error";
  message: string;
}

export const NOTE_RANGE_STAGED_STATUS_MESSAGE =
  "Selection staged. The agent can edit only this range.";
export const NOTE_RANGE_REMOVED_STATUS_MESSAGE =
  "Selection removed.";

export function statusAfterClearedNoteRangeHandoff(
  current: NoteRangeSelectionStatus | null,
): NoteRangeSelectionStatus | null {
  return current?.message === NOTE_RANGE_STAGED_STATUS_MESSAGE
    ? {
        kind: "status",
        message: NOTE_RANGE_REMOVED_STATUS_MESSAGE,
      }
    : current;
}

export type NoteSaveResult =
  | { ok: true; hash: string; snapshot: NoteSaveSnapshot }
  | { ok: false; reason: "conflict" | "error" };

export interface CapturedNoteRangeState {
  identity: string;
  revision: number;
  stableId: string;
  scope: NoteScope;
  visibility: NoteVisibility;
  path: string;
  assistantScope: AssistantScope;
  projectId?: string;
  epicId?: string;
  snapshot: NoteSaveSnapshot;
  selection: {
    from: number;
    to: number;
    text: string;
    startLine: number;
    endLine: number;
  };
}

export interface CurrentNoteRangeState {
  identity: string;
  revision: number;
  stableId: string | null;
  snapshot: NoteSaveSnapshot;
}

export type PrepareNoteRangeResult =
  | { ok: true; target: CanonicalNoteRangeTarget }
  | { ok: false; reason: "invalid" | "conflict" | "save" | "changed" };

export function sameSaveSnapshot(
  left: NoteSaveSnapshot,
  right: NoteSaveSnapshot,
): boolean {
  return left.content === right.content
    && left.title === right.title
    && left.status === right.status
    && left.tags.length === right.tags.length
    && left.tags.every((tag, index) => tag === right.tags[index]);
}

function hasExactSelection(state: CapturedNoteRangeState): boolean {
  const { content } = state.snapshot;
  const { from, to, text, startLine, endLine } = state.selection;
  return Number.isSafeInteger(from)
    && Number.isSafeInteger(to)
    && from >= 0
    && to > from
    && to <= content.length
    && content.slice(from, to) === text
    && Number.isSafeInteger(startLine)
    && Number.isSafeInteger(endLine)
    && startLine > 0
    && endLine >= startLine;
}

export function buildCanonicalNoteRangeTarget(
  state: CapturedNoteRangeState,
  expectedHash: string,
): CanonicalNoteRangeTarget | null {
  if (!state.stableId || !hasExactSelection(state)) return null;
  const baseTarget = {
    kind: "note-range" as const,
    stableId: state.stableId,
    visibility: state.visibility,
    path: state.path,
    title: state.snapshot.title,
    selectionStart: state.selection.from,
    selectionEnd: state.selection.to,
    selectedText: state.selection.text,
    startLine: state.selection.startLine,
    endLine: state.selection.endLine,
    expectedHash,
  };

  if (state.scope === "codascope") {
    if (state.assistantScope.kind !== "workspace") return null;
    return normalizeCanonicalWorkspaceNoteRangeTarget({
      ...baseTarget,
      scope: "codascope",
    });
  }

  if (state.assistantScope.kind !== "project"
    || !state.projectId
    || state.assistantScope.projectId !== state.projectId) {
    return null;
  }
  if (state.scope === "epic"
    && (state.visibility !== "shared" || !state.epicId)) {
    return null;
  }
  return normalizeCanonicalProjectNoteRangeTarget({
    ...baseTarget,
    scope: state.scope,
    projectId: state.projectId,
    ...(state.scope === "epic" ? { epicId: state.epicId } : {}),
  });
}

export async function saveAndPrepareNoteRangeTarget(input: {
  captured: CapturedNoteRangeState;
  save: (snapshot: NoteSaveSnapshot) => Promise<NoteSaveResult>;
  readCurrent: () => CurrentNoteRangeState;
}): Promise<PrepareNoteRangeResult> {
  // Reject route/selection custody before creating a needless note version.
  if (!hasExactSelection(input.captured)
    || !buildCanonicalNoteRangeTarget(input.captured, "a".repeat(64))) {
    return { ok: false, reason: "invalid" };
  }

  const saved = await input.save(input.captured.snapshot);
  if (!saved.ok) {
    return {
      ok: false,
      reason: saved.reason === "conflict" ? "conflict" : "save",
    };
  }

  const current = input.readCurrent();
  if (current.identity !== input.captured.identity
    || current.revision !== input.captured.revision
    || current.stableId !== input.captured.stableId
    || !sameSaveSnapshot(current.snapshot, input.captured.snapshot)) {
    return { ok: false, reason: "changed" };
  }

  const target = buildCanonicalNoteRangeTarget(input.captured, saved.hash);
  return target
    ? { ok: true, target }
    : { ok: false, reason: "invalid" };
}

export interface SerializedTaskQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  drain(): Promise<void>;
}

export function createSerializedTaskQueue(): SerializedTaskQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    drain(): Promise<void> {
      return tail;
    },
  };
}
