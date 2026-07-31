/* ── CodaScope: Workspace Assistant Diagnostics ─────────────────────
   Keeps browser-visible workspace failures path-free while correlating them
   with the original exception in restricted server logs.
   ──────────────────────────────────────────────────────────────────── */

import { randomUUID } from "node:crypto";
import type { CodaScopeAction } from "../../src/apps/codascope/codaScopeTypes.js";

export type WorkspaceAssistantFailureStage =
  | "manifest_load"
  | "intent_resolution"
  | "agent_prerequisites"
  | "agent_grant_validation"
  | "agent_creation"
  | "agent_start"
  | "agent_execution"
  | "response_finalization"
  | "failure_persistence";

const PUBLIC_STAGE_MESSAGES: Record<WorkspaceAssistantFailureStage, string> = {
  manifest_load:
    "Workspace assistant could not load the all-project manifest.",
  intent_resolution:
    "Workspace assistant could not resolve the current workspace request.",
  agent_prerequisites:
    "Workspace assistant runtime prerequisites are unavailable.",
  agent_grant_validation:
    "Workspace assistant authorization could not be validated.",
  agent_creation:
    "Workspace assistant could not initialize the agent runtime.",
  agent_start:
    "Workspace assistant could not start the model run.",
  agent_execution:
    "Workspace assistant model execution failed.",
  response_finalization:
    "Workspace assistant response could not be finalized.",
  failure_persistence:
    "Workspace assistant failure state could not be finalized.",
};

export class WorkspaceAssistantDiagnosticError extends Error {
  readonly diagnosticId: string;
  readonly stage: WorkspaceAssistantFailureStage;
  readonly fullResponse: string;
  readonly actions: CodaScopeAction[];

  constructor(options: {
    diagnosticId: string;
    stage: WorkspaceAssistantFailureStage;
    fullResponse?: string;
    actions?: readonly CodaScopeAction[];
  }) {
    super(
      `${PUBLIC_STAGE_MESSAGES[options.stage]} `
      + `Diagnostic ID: ${options.diagnosticId}.`,
    );
    this.name = "WorkspaceAssistantDiagnosticError";
    this.diagnosticId = options.diagnosticId;
    this.stage = options.stage;
    this.fullResponse = options.fullResponse ?? "";
    this.actions = [...(options.actions ?? [])];
  }
}

/**
 * Record the original exception only in the restricted server log. No actor,
 * prompt, model, context, grant, or note content is included by this boundary.
 */
export function reportWorkspaceAssistantFailure(
  stage: WorkspaceAssistantFailureStage,
  cause: unknown,
  context: {
    fullResponse?: string;
    actions?: readonly CodaScopeAction[];
  } = {},
): WorkspaceAssistantDiagnosticError {
  if (cause instanceof WorkspaceAssistantDiagnosticError) {
    return contextualizeWorkspaceAssistantFailure(cause, context);
  }

  const diagnosticId = `wsdiag_${randomUUID()}`;
  const error = cause instanceof Error ? cause : new Error(String(cause));
  console.error(
    "[CodaScope] workspace assistant diagnostic.",
    { diagnosticId, stage },
    error,
  );
  return new WorkspaceAssistantDiagnosticError({
    diagnosticId,
    stage,
    ...context,
  });
}

export function contextualizeWorkspaceAssistantFailure(
  error: WorkspaceAssistantDiagnosticError,
  context: {
    fullResponse?: string;
    actions?: readonly CodaScopeAction[];
  },
): WorkspaceAssistantDiagnosticError {
  return new WorkspaceAssistantDiagnosticError({
    diagnosticId: error.diagnosticId,
    stage: error.stage,
    fullResponse: context.fullResponse ?? error.fullResponse,
    actions: context.actions ?? error.actions,
  });
}

export function workspaceAssistantFailureMetadata(
  error: WorkspaceAssistantDiagnosticError,
): {
  diagnosticId: string;
  failureStage: WorkspaceAssistantFailureStage;
} {
  return {
    diagnosticId: error.diagnosticId,
    failureStage: error.stage,
  };
}
