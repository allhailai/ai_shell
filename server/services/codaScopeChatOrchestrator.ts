/* ── CodaScope: Chat Orchestrator ─────────────────────────────────────
   Shared orchestration logic for the CodaScope assistant chat endpoints.

   Handles:
   - Building the project manifest from services
   - Constructing the system prompt (manifest + history + view + message)
   - Streaming the agent response via SSE
   - Extracting action tags from the response

   Each route handler manages its own persistence strategy (pre-create
   placeholder vs. append after-the-fact), SSE setup, and error handling.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeAgentService } from "./codaScopeAgentService.js";
import type { CodaScopeChatService } from "./codaScopeChatService.js";
import type { CodaScopeProjectService } from "./codaScopeProjectService.js";
import type { CodaScopeWikiService } from "./codaScopeWikiService.js";
import type { CodaScopeBuildStateService } from "./codaScopeBuildStateService.js";

import type { CodaScopeWikiStateService } from "./codaScopeWikiStateService.js";
import type { CodaScopeEpicService } from "./codaScopeEpicService.js";
import { CodaScopeCodeMapService } from "./codaScopeCodeMapService.js";
import { buildProjectManifest, formatConversationHistory, formatViewContext, buildEpicContext, formatReferences, formatSelectionContext, type ManifestInput, type ViewContext, type EpicContextInput, type ReferenceItem, type SelectionContext } from "./codaScopeChatPromptHelpers.js";
import { loadCommandTemplate, substituteVars } from "./codaScopeCommandLoader.js";
import { extractActions, type CodaScopeAction } from "./codaScopeActionParser.js";

// ── Types ───────────────────────────────────────────────────────────

export interface ChatServices {
  agentSvc: CodaScopeAgentService;
  chatSvc: CodaScopeChatService;
  projectSvc: CodaScopeProjectService;
  wikiSvc: CodaScopeWikiService;
  buildSvc: CodaScopeBuildStateService;
  wikiStateSvc: CodaScopeWikiStateService;
  codeMapSvc: CodaScopeCodeMapService;
  epicSvc?: CodaScopeEpicService;
}

export interface StreamResult {
  fullResponse: string;
  actions: CodaScopeAction[];
  agentResult: unknown;
}

// ── Manifest Builder ────────────────────────────────────────────────

/**
 * Build a lightweight project manifest from services.
 * All lookups are fast (titles/counts only, no full content).
 */
export async function buildManifestFromServices(
  projectId: string,
  svcs: ChatServices,
): Promise<ManifestInput> {
  const project = await svcs.projectSvc.getProject(projectId);
  const repos = project?.repositories ?? [];
  const topics = await svcs.wikiSvc.listTopics(projectId);
  const buildState = svcs.buildSvc.getBuildState(projectId);

  // Get wiki build freshness from wiki-state
  const projectDir = svcs.projectSvc.getProjectDir(projectId);
  let lastWikiBuildTimestamp: string | null = null;
  let lastCodeMapBuildTimestamp: string | null = null;
  if (projectDir) {
    const wikiState = svcs.wikiStateSvc.getWikiState(projectDir);
    lastWikiBuildTimestamp = wikiState?.lastBuildAt ?? null;
    // Code map freshness from first repo's meta
    if (repos.length > 0) {
      const slug = CodaScopeCodeMapService.repoSlug(repos[0].name || repos[0].path);
      const meta = svcs.codeMapSvc.getCodeMapMeta(projectId, slug);
      lastCodeMapBuildTimestamp = meta?.generatedAt ?? null;
    }
  }

  return {
    projectName: project?.name ?? "Unknown",
    projectId,
    repositoryCount: repos.length,
    repositories: repos.map((r: { name: string; path: string }) => ({ name: r.name, path: r.path })),
    wikiTopicTitles: topics.map((t: { id: string; title: string }) => ({ id: t.id, title: t.title })),
    currentBuildStatus: buildState?.status ?? "idle",
    lastBuildTimestamp: buildState?.completedAt ?? buildState?.startedAt ?? null,
    lastBuildCommand: buildState?.command ?? null,
    lastWikiBuildTimestamp,
    lastCodeMapBuildTimestamp,
  };
}

// ── Prompt Builder ──────────────────────────────────────────────────

/**
 * Load the assistant system prompt (do_chat.md), substitute all context placeholders.
 */
export function buildAssistantPrompt(
  manifest: string,
  history: string,
  viewContext: string,
  userMessage: string,
): string {
  const template = loadCommandTemplate("do_chat");
  if (!template) {
    // Fallback if do_chat.md is missing
    return `You are a helpful CodaScope assistant.\n\n${manifest}\n\n${history}\n\n${viewContext}\n\nUser: ${userMessage}`;
  }
  return substituteVars(template, {
    PROJECT_MANIFEST: manifest,
    CONVERSATION_HISTORY: history,
    VIEW_CONTEXT: viewContext,
    USER_MESSAGE: userMessage,
  });
}

// ── Stream Helper ───────────────────────────────────────────────────

/**
 * Stream an assistant response, accumulating the full text and extracting actions.
 *
 * This handles the shared concerns of:
 * - Calling agentSvc.send with the correct purpose/prompt
 * - Accumulating text blocks into a full response string
 * - Extracting action tags from the final response
 *
 * The caller is responsible for SSE setup and persistence.
 */
export async function streamAssistantResponse(options: {
  projectId: string;
  actorId: string;
  message: string;
  modelId: string;
  systemPrompt: string;
  agentSvc: CodaScopeAgentService;
  images?: Array<{ data: string; mimeType: string }>;
  onMessage: (msg: unknown) => void;
}): Promise<StreamResult> {
  const { projectId, actorId, message, modelId, systemPrompt, agentSvc, images, onMessage } = options;

  let fullResponse = "";
  let toolResultText = "";

  return new Promise<StreamResult>((resolve, reject) => {
    agentSvc.send({
      scope: { kind: "project", projectId },
      actorId,
      message,
      modelId,
      systemPrompt,
      images,
      purpose: "assistant",
      onMessage: (msg) => {
        // Accumulate text from model responses
        if (msg.type === "assistant" && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === "text") fullResponse += block.text;
          }
        }
        // Accumulate text from tool results (custom tool return values)
        const msgAny = msg as unknown as { type: string; text?: string };
        if (msgAny.type === "tool-result" && typeof msgAny.text === "string") {
          toolResultText += msgAny.text + "\n";
        }
        onMessage(msg);
      },
      onDone: async (result) => {
        // Extract actions from both model text and tool results
        const textActions = extractActions(fullResponse);
        const toolActions = extractActions(toolResultText);
        // Merge while retaining distinct completed mutations in the same run.
        // A document ID is insufficient for notes, wiki pages, and generic
        // completion cards, which otherwise collapse into one card.
        const actionKey = (action: { type: string; attributes?: Record<string, string> }) =>
          [
            action.type,
            action.attributes?.docId,
            action.attributes?.artifactId,
            action.attributes?.topicId,
            action.attributes?.pageId,
            action.attributes?.notePath,
            action.attributes?.operation,
          ].filter(Boolean).join(":");
        const seen = new Set(textActions.map(actionKey));
        const merged = [...textActions];
        for (const ta of toolActions) {
          const key = actionKey(ta);
          if (!seen.has(key)) {
            merged.push(ta);
            seen.add(key);
          }
        }
        resolve({ fullResponse, actions: merged, agentResult: result });
      },
      onError: async (err) => {
        reject(Object.assign(err, { fullResponse }));
      },
    });
  });
}

// ── Re-exports for Route Convenience ────────────────────────────────

export { buildProjectManifest, formatConversationHistory, formatViewContext, buildEpicContext, formatReferences, formatSelectionContext };
export type { ViewContext, EpicContextInput, ReferenceItem, SelectionContext };
