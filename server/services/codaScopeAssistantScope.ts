/* ── CodaScope: Assistant Scope ──────────────────────────────────────
   Canonical identity for backend agent runs. Workspace is a first-class
   scope and is never represented by a sentinel project identifier.
   ──────────────────────────────────────────────────────────────────── */

import { assertSafePathSegment } from "./codaScopePathSafety.js";

export type AssistantScope =
  | { kind: "workspace" }
  | { kind: "project"; projectId: string };

export const WORKSPACE_ASSISTANT_SCOPE: AssistantScope = Object.freeze({
  kind: "workspace",
});

export function projectAssistantScope(projectId: string): AssistantScope {
  assertSafePathSegment(projectId, "project ID");
  return Object.freeze({ kind: "project", projectId });
}

export function assistantScopeKey(scope: AssistantScope): string {
  if (scope.kind === "workspace") return "workspace";
  return `project:${assertSafePathSegment(scope.projectId, "project ID")}`;
}
