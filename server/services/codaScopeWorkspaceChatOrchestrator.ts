/* ── CodaScope: Workspace Chat Orchestrator ─────────────────────────
   Root-graph collaborators only: manifest, conservative intent/grant,
   bounded context, dedicated workspace agent scope, and per-run provenance.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeAgentService } from "./codaScopeAgentService.js";
import type { CodaScopeWorkspaceCatalogService } from "./codaScopeWorkspaceCatalogService.js";
import type {
  WorkspaceConversationMessage,
  WorkspaceMessageContext,
} from "./codaScopeWorkspaceConversationService.js";
import type {
  CodaScopeWorkspaceIntentService,
  WorkspaceIntentResolution,
} from "./codaScopeWorkspaceIntentService.js";
import type { WorkspaceRetrievedSourceReference } from "./codaScopeWorkspaceProvenance.js";
import type { CodaScopeAction } from "../../src/apps/codascope/codaScopeTypes.js";
import type { CanonicalWorkspaceNoteRangeTarget } from "../../src/apps/codascope/workspaceNoteRangeTargetValidation.js";
import {
  contextualizeWorkspaceAssistantFailure,
  reportWorkspaceAssistantFailure,
  WorkspaceAssistantDiagnosticError,
} from "./codaScopeWorkspaceAssistantDiagnostics.js";
import {
  buildWorkspaceAssistantPrompt,
  buildWorkspaceManifestFromCatalog,
  formatWorkspaceConversationHistory,
  formatWorkspaceCurrentContext,
} from "./codaScopeWorkspaceChatPromptHelpers.js";

export interface WorkspaceStreamResult {
  fullResponse: string;
  agentResult: unknown;
  retrievedSources: WorkspaceRetrievedSourceReference[];
  actions: CodaScopeAction[];
}

export class WorkspaceAssistantCancelledError extends Error {
  readonly cancelled = true;
  readonly fullResponse: string;
  readonly actions: CodaScopeAction[];

  constructor(fullResponse: string, actions: CodaScopeAction[] = []) {
    super("Workspace assistant run was cancelled.");
    this.name = "WorkspaceAssistantCancelledError";
    this.fullResponse = fullResponse;
    this.actions = actions;
  }
}

export async function streamWorkspaceAssistantResponse(options: {
  actorId: string;
  message: string;
  modelId: string;
  context: WorkspaceMessageContext;
  noteRangeTarget?: CanonicalWorkspaceNoteRangeTarget | null;
  history: readonly WorkspaceConversationMessage[];
  catalog: CodaScopeWorkspaceCatalogService;
  intentService: CodaScopeWorkspaceIntentService;
  agentService: CodaScopeAgentService;
  images?: Array<{ data: string; mimeType: string }>;
  onMessage: (message: unknown) => void;
}): Promise<WorkspaceStreamResult> {
  let manifest: string;
  try {
    manifest = await buildWorkspaceManifestFromCatalog(options.catalog);
  } catch (error) {
    throw reportWorkspaceAssistantFailure("manifest_load", error);
  }
  const history = formatWorkspaceConversationHistory(options.history);
  const currentContext = formatWorkspaceCurrentContext(
    options.context,
    options.noteRangeTarget,
  );
  const prompt = buildWorkspaceAssistantPrompt(manifest, history, currentContext);
  let resolution: WorkspaceIntentResolution;
  try {
    resolution = await options.intentService.resolveTurn(
      options.message,
      options.context.explicitlyReferencedProjectIds,
      {
        actorId: options.actorId,
        currentNote: options.context.currentNote,
        noteRangeTarget: options.noteRangeTarget,
      },
    );
  } catch (error) {
    throw reportWorkspaceAssistantFailure("intent_resolution", error);
  }

  let fullResponse = "";
  return new Promise<WorkspaceStreamResult>((resolve, reject) => {
    const rejectAgentFailure = (
      error: unknown,
      actions: CodaScopeAction[] = [],
    ) => {
      if (error instanceof Error
        && error.message === "Agent cancelled by user.") {
        reject(new WorkspaceAssistantCancelledError(fullResponse, actions));
        return;
      }
      const diagnostic = error instanceof WorkspaceAssistantDiagnosticError
        ? contextualizeWorkspaceAssistantFailure(error, {
            fullResponse,
            actions,
          })
        : reportWorkspaceAssistantFailure("agent_execution", error, {
            fullResponse,
            actions,
          });
      reject(diagnostic);
    };

    void options.agentService.send({
      scope: { kind: "workspace" },
      purpose: "workspace-assistant",
      actorId: options.actorId,
      message: options.message,
      modelId: options.modelId,
      systemPrompt: prompt,
      workspaceReadGrant: resolution.grant,
      workspaceNoteGrant: resolution.noteGrant,
      images: options.images,
      onMessage: (message) => {
        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === "text") fullResponse += block.text;
          }
        }
        options.onMessage(message);
      },
      onDone: (agentResult, retrievedSources = [], actions = []) => {
        resolve({ fullResponse, agentResult, retrievedSources, actions });
      },
      onError: (error, actions = []) => {
        rejectAgentFailure(error, actions);
      },
    }).catch(rejectAgentFailure);
  });
}
