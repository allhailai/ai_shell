/* ── CodaScope: Shared Build Pipeline Contracts ──────────────────────
   Neutral contracts and pure helpers shared by sibling build pipelines.
   This leaf module must not depend on orchestrators, routes, or service
   composition.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeAgentService } from "./codaScopeAgentService.js";
import type { CodaScopeBuildStateService, TokenUsageRecord } from "./codaScopeBuildStateService.js";
import type { CodaScopeCodeMapService } from "./codaScopeCodeMapService.js";
import type { CodaScopeProjectService } from "./codaScopeProjectService.js";
import type { CodaScopeWikiService } from "./codaScopeWikiService.js";
import type { CodaScopeWikiStateService } from "./codaScopeWikiStateService.js";

export interface BuildPipelineCallbacks {
  sendEvent: (event: string, data: unknown) => void;
  sendMessage: (msg: unknown) => void;
  isAborted: () => boolean;
}

export interface BuildPipelineCoreServices {
  agentSvc: CodaScopeAgentService;
  projectSvc: CodaScopeProjectService;
  wikiSvc: CodaScopeWikiService;
  buildSvc: CodaScopeBuildStateService;
  codeMapSvc: CodaScopeCodeMapService;
  wikiStateSvc: CodaScopeWikiStateService;
}

export function extractTokenUsage(
  result: { usage?: Record<string, number> } | undefined,
): TokenUsageRecord | undefined {
  if (!result?.usage) return undefined;
  return {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheReadTokens: result.usage.cacheReadTokens,
    cacheWriteTokens: result.usage.cacheWriteTokens,
    totalTokens: result.usage.totalTokens,
    reasoningTokens: result.usage.reasoningTokens,
  };
}

/** Count pages that demonstrate a wiki build produced actual topic content. */
export function countSubstantiveWikiTopics(topics: Array<{ id: string }>): number {
  return topics.filter((topic) => topic.id !== "index" && !topic.id.startsWith("_")).length;
}
