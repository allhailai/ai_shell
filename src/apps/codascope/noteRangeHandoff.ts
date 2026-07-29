import { useSyncExternalStore } from "react";
import type {
  AssistantScope,
  CodaScopeAction,
} from "./codaScopeTypes";
import {
  normalizeCanonicalProjectNoteRangeAction,
} from "./projectNoteRangeMutationActionValidation";
import {
  normalizeCanonicalProjectNoteRangeTarget,
  type CanonicalProjectNoteRangeTarget,
} from "./projectNoteRangeTargetValidation";
import { getAssistantScopeKey } from "./assistantScope";
import {
  normalizeCanonicalWorkspaceMutationAction,
} from "./workspaceMutationActionValidation";
import {
  normalizeCanonicalWorkspaceNoteRangeTarget,
  type CanonicalWorkspaceNoteRangeTarget,
} from "./workspaceNoteRangeTargetValidation";

export type CanonicalNoteRangeTarget =
  | CanonicalWorkspaceNoteRangeTarget
  | CanonicalProjectNoteRangeTarget;

export type NoteRangeHandoffStatus =
  | "staged"
  | "in-flight"
  | "completed"
  | "failed";

export interface NoteRangeHandoff {
  /** Opaque client lifecycle identity. This value is never part of a request. */
  handoffId: string;
  /** Opaque editor-instance identity used only for cleanup. */
  sourceId: string;
  scopeKey: string;
  target: CanonicalNoteRangeTarget;
  status: NoteRangeHandoffStatus;
  terminalStatus?: "complete" | "error" | "cancelled";
  completionAction?: CodaScopeAction;
}

const handoffs = new Map<string, NoteRangeHandoff>();
const listeners = new Set<() => void>();
let fallbackId = 0;

function notify(): void {
  for (const listener of listeners) listener();
}

function opaqueId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `${prefix}-${randomId}`
    : `${prefix}-${Date.now()}-${++fallbackId}`;
}

export function createNoteRangeHandoffSource(): string {
  return opaqueId("note-range-source");
}

export function normalizeNoteRangeTargetForAssistantScope(
  scope: AssistantScope,
  value: unknown,
): CanonicalNoteRangeTarget | null {
  if (scope.kind === "workspace") {
    return normalizeCanonicalWorkspaceNoteRangeTarget(value);
  }
  const target = normalizeCanonicalProjectNoteRangeTarget(value);
  return target?.projectId === scope.projectId ? target : null;
}

export function stageNoteRangeHandoff(input: {
  scope: AssistantScope;
  sourceId: string;
  target: unknown;
}): NoteRangeHandoff | null {
  const target = normalizeNoteRangeTargetForAssistantScope(
    input.scope,
    input.target,
  );
  if (!target || !input.sourceId) return null;
  const scopeKey = getAssistantScopeKey(input.scope);
  const handoff: NoteRangeHandoff = {
    handoffId: opaqueId("note-range-handoff"),
    sourceId: input.sourceId,
    scopeKey,
    target,
    status: "staged",
  };
  handoffs.set(scopeKey, handoff);
  notify();
  return handoff;
}

export function getNoteRangeHandoff(
  scopeOrKey: AssistantScope | string,
): NoteRangeHandoff | null {
  const scopeKey = typeof scopeOrKey === "string"
    ? scopeOrKey
    : getAssistantScopeKey(scopeOrKey);
  return handoffs.get(scopeKey) ?? null;
}

export function markNoteRangeHandoffInFlight(
  scopeOrKey: AssistantScope | string,
  handoffId: string,
): NoteRangeHandoff | null {
  const current = getNoteRangeHandoff(scopeOrKey);
  if (!current
    || current.handoffId !== handoffId
    || current.status !== "staged") {
    return null;
  }
  const next: NoteRangeHandoff = { ...current, status: "in-flight" };
  handoffs.set(current.scopeKey, next);
  notify();
  return next;
}

export function settleNoteRangeHandoff(input: {
  scope: AssistantScope | string;
  handoffId: string;
  terminalStatus: "complete" | "error" | "cancelled";
  completionAction?: CodaScopeAction;
}): NoteRangeHandoff | null {
  const current = getNoteRangeHandoff(input.scope);
  if (!current
    || current.handoffId !== input.handoffId
    || current.status !== "in-flight") {
    return null;
  }
  const next: NoteRangeHandoff = {
    ...current,
    status: input.completionAction || input.terminalStatus === "complete"
      ? "completed"
      : "failed",
    terminalStatus: input.terminalStatus,
    ...(input.completionAction
      ? { completionAction: input.completionAction }
      : {}),
  };
  handoffs.set(current.scopeKey, next);
  notify();
  return next;
}

export function clearNoteRangeHandoff(
  scopeOrKey: AssistantScope | string,
  handoffId?: string,
): boolean {
  const current = getNoteRangeHandoff(scopeOrKey);
  if (!current || (handoffId && current.handoffId !== handoffId)) return false;
  handoffs.delete(current.scopeKey);
  notify();
  return true;
}

export function clearNoteRangeHandoffBySource(sourceId: string): boolean {
  let changed = false;
  for (const [scopeKey, handoff] of handoffs) {
    if (handoff.sourceId === sourceId) {
      handoffs.delete(scopeKey);
      changed = true;
    }
  }
  if (changed) notify();
  return changed;
}

export function findStrictMatchingNoteRangeAction(
  target: CanonicalNoteRangeTarget,
  actions: readonly unknown[],
): CodaScopeAction | null {
  for (const candidate of actions) {
    const action = target.scope === "codascope"
      ? normalizeCanonicalWorkspaceMutationAction(candidate)
      : normalizeCanonicalProjectNoteRangeAction(candidate);
    if (!action || !matchesTarget(action, target)) continue;
    return action;
  }
  return null;
}

function matchesTarget(
  action: CodaScopeAction,
  target: CanonicalNoteRangeTarget,
): boolean {
  const attributes = action.attributes;
  if (attributes.stableId !== target.stableId
    || attributes.scope !== target.scope
    || attributes.visibility !== target.visibility
    || attributes.path !== target.path) {
    return false;
  }
  if (target.scope === "codascope") {
    return attributes.operation === "replace_codascope_note_range";
  }
  return attributes.operation === "replace_note_range"
    && attributes.projectId === target.projectId
    && (target.scope === "project" || attributes.epicId === target.epicId);
}

export function useNoteRangeHandoff(
  scopeOrKey: AssistantScope | string,
): NoteRangeHandoff | null {
  const scopeKey = typeof scopeOrKey === "string"
    ? scopeOrKey
    : getAssistantScopeKey(scopeOrKey);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => handoffs.get(scopeKey) ?? null,
    () => handoffs.get(scopeKey) ?? null,
  );
}
