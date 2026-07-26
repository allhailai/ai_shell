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
import type { CodaScopeWorkspaceIntentService } from "./codaScopeWorkspaceIntentService.js";
import type { WorkspaceRetrievedSourceReference } from "./codaScopeWorkspaceProvenance.js";
import type { CodaScopeAction } from "../../src/apps/codascope/codaScopeTypes.js";
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
  history: readonly WorkspaceConversationMessage[];
  catalog: CodaScopeWorkspaceCatalogService;
  intentService: CodaScopeWorkspaceIntentService;
  agentService: CodaScopeAgentService;
  images?: Array<{ data: string; mimeType: string }>;
  onMessage: (message: unknown) => void;
}): Promise<WorkspaceStreamResult> {
  const manifest = await buildWorkspaceManifestFromCatalog(options.catalog);
  const history = formatWorkspaceConversationHistory(options.history);
  const currentContext = formatWorkspaceCurrentContext(options.context);
  const prompt = buildWorkspaceAssistantPrompt(manifest, history, currentContext);
  const resolution = await options.intentService.resolveTurn(
    options.message,
    options.context.explicitlyReferencedProjectIds,
    {
      actorId: options.actorId,
      currentNote: options.context.currentNote,
    },
  );

  let fullResponse = "";
  return new Promise<WorkspaceStreamResult>((resolve, reject) => {
    options.agentService.send({
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
        if (error.message === "Agent cancelled by user.") {
          reject(new WorkspaceAssistantCancelledError(fullResponse, actions));
          return;
        }
        reject(Object.assign(
          new Error("Workspace assistant run failed."),
          { fullResponse, actions },
        ));
      },
    });
  });
}
