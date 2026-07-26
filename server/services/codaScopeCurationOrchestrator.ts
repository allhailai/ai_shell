/* ── CodaScope: Curation Orchestrator ─────────────────────────────────
   Orchestrates a curation run for an epic. Follows the
   codaScopeBuildOrchestrator.ts SSE streaming pattern.

   Pipeline:
     1. Clear accumulated reasons → recorded in log
     2. Create curation log entry (status: running)
     3. Build full context (definition, scope, wiki, sources, code map)
     4. Send to agent with do_curate_epic.md template
     5. Stream agent response via SSE
     6. Record results → update log (status: complete)
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeAgentService } from "./codaScopeAgentService.js";
import type { CodaScopeProjectService } from "./codaScopeProjectService.js";
import type { CodaScopeWikiService } from "./codaScopeWikiService.js";
import type { CodaScopeEpicService } from "./codaScopeEpicService.js";
import type { CodaScopeEpicKnowledgeService } from "./codaScopeEpicKnowledgeService.js";
import type { CodaScopeCurationService } from "./codaScopeCurationService.js";

import { CodaScopeCodeMapService } from "./codaScopeCodeMapService.js";
import { buildBaseVars, loadCommandOrSkill } from "./codaScopeCommandLoader.js";
import type { CurationReason, CurationResults } from "../../src/apps/codascope/codaScopeTypes.js";

// ── Types ───────────────────────────────────────────────────────────

export interface CurationOptions {
  projectId: string;
  epicId: string;
  modelId: string;
  actorId: string;
  /** Optional: manually specified reasons override accumulated reasons */
  manualReasons?: CurationReason[];
}

export interface CurationSseCallbacks {
  sendEvent: (event: string, data: unknown) => void;
  sendMessage: (msg: unknown) => void;
  isAborted: () => boolean;
}

export interface CurationServices {
  agentSvc: CodaScopeAgentService;
  projectSvc: CodaScopeProjectService;
  wikiSvc: CodaScopeWikiService;
  epicSvc: CodaScopeEpicService;
  epicKnowledgeSvc: CodaScopeEpicKnowledgeService;
  curationSvc: CodaScopeCurationService;

  codeMapSvc: CodaScopeCodeMapService;
}

// ── Orchestrator ────────────────────────────────────────────────────

/**
 * Run the curation pipeline for an epic.
 *
 * Assumes:
 * - SSE headers have already been written
 * - The `curation-started` event has been emitted by the route handler
 *
 * Handles: context build → agent send → result recording → done/error
 */
export async function runCurationPipeline(
  options: CurationOptions,
  callbacks: CurationSseCallbacks,
  services: CurationServices,
): Promise<void> {
  const { projectId, epicId, modelId, actorId } = options;
  const { sendEvent, sendMessage, isAborted } = callbacks;
  const { agentSvc, projectSvc, wikiSvc, epicSvc, epicKnowledgeSvc, curationSvc, codeMapSvc } = services;

  const startTime = Date.now();
  let curationId: string | undefined;

  try {
    // ── Step 1: Resolve reasons ──────────────────────────────────────

    sendEvent("pipeline-step", { step: "resolve-reasons", status: "running" });

    let reasons: CurationReason[];
    if (options.manualReasons && options.manualReasons.length > 0) {
      reasons = options.manualReasons;
    } else {
      reasons = await curationSvc.clearReasons(projectId, epicId);
    }

    if (reasons.length === 0) {
      // Add a default reason for manual trigger
      reasons = [{
        type: "manual",
        at: new Date().toISOString(),
        detail: "Manual curation trigger — no accumulated reasons",
      }];
    }

    sendEvent("pipeline-step", {
      step: "resolve-reasons",
      status: "complete",
      reasonCount: reasons.length,
      reasons: reasons.map((r) => ({ type: r.type, detail: r.detail })),
    });

    if (isAborted()) {
      return;
    }

    // ── Step 2: Create log entry ─────────────────────────────────────

    const logEntry = await curationSvc.createLog(projectId, epicId, {
      epicId,
      triggeredAt: new Date().toISOString(),
      status: "running",
      resolvedReasons: reasons,
      modelId,
    });
    curationId = logEntry.curationId;

    sendEvent("pipeline-step", { step: "create-log", status: "complete", curationId });

    // ── Step 3: Build context ────────────────────────────────────────

    sendEvent("pipeline-step", { step: "build-context", status: "running" });

    const project = await projectSvc.getProject(projectId);
    if (!project) throw new Error("Project not found.");

    const projectDir = projectSvc.getProjectDir(projectId);
    if (!projectDir) throw new Error("Project directory not found.");

    // Epic data
    const epicDetail = await epicSvc.getEpic(projectId, epicId);
    if (!epicDetail) throw new Error(`Epic "${epicId}" not found.`);

    // Wiki index
    const wikiTopics = await wikiSvc.listTopics(projectId);
    const wikiIndex = wikiTopics.length > 0
      ? wikiTopics.map((t: { id: string; title: string }) => `- ${t.title} (id: ${t.id})`).join("\n")
      : "_No wiki topics yet._";

    // Epic wiki pages
    const epicWikiPages = await epicKnowledgeSvc.listEpicWikiPages(projectId, epicId);
    const epicWikiIndex = epicWikiPages.length > 0
      ? epicWikiPages.map((p) => `- ${p.title} (id: ${p.id}, words: ${p.wordCount})`).join("\n")
      : "_No epic wiki pages yet._";

    // Research sources
    const sources = await epicKnowledgeSvc.listSources(projectId, epicId);
    const readySources = sources.filter((s) => s.status === "ready");
    const sourcesIndex = readySources.length > 0
      ? readySources.map((s) => `- ${s.title} [${s.type}] (id: ${s.id})`).join("\n")
      : "_No ready research sources._";

    // Code map summary (first repo)
    const repos = project.repositories ?? [];
    let codeMapSummary = "_No code map available._";
    if (repos.length > 0) {
      const slug = CodaScopeCodeMapService.repoSlug(repos[0].name || repos[0].path);
      const codeMap = codeMapSvc.readCodeMap(projectId, slug);
      if (codeMap) {
        // Truncate to ~2000 chars for context efficiency
        codeMapSummary = codeMap.length > 2000
          ? codeMap.slice(0, 2000) + "\n\n_[Code Map truncated — use read_code_map for full content]_"
          : codeMap;
      }
    }

    // Scope
    const scope = epicDetail.scope;
    const scopeText = scope && scope.entries.length > 0
      ? JSON.stringify(scope.entries.map((e) => ({
          topicId: e.topicId,
          topicTitle: e.topicTitle,
          type: e.type,
          included: e.included,
          targetDepth: e.targetDepth,
          currentDepth: e.currentDepth ?? "none",
        })), null, 2)
      : "_No scope entries yet._";

    // Format reasons for prompt
    const reasonsText = reasons.map((r) =>
      `- **${r.type}**: ${r.detail} (at: ${r.at})`,
    ).join("\n");

    sendEvent("pipeline-step", { step: "build-context", status: "complete" });

    if (isAborted()) {
      await curationSvc.updateLog(projectId, epicId, curationId, {
        status: "error",
        error: "Cancelled by user",
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      });
      return;
    }

    // ── Step 4: Build prompt and send to agent ───────────────────────

    sendEvent("pipeline-step", { step: "agent-curation", status: "running" });

    const vars = buildBaseVars({
      projectName: project.name,
      projectDir,
      repositories: repos,
    });
    vars.EPIC_TITLE = epicDetail.title;
    vars.EPIC_ID = epicId;
    vars.EPIC_STATUS = epicDetail.status;
    vars.EPIC_DEFINITION = epicDetail.definition || "_No definition._";
    vars.EPIC_SCOPE = scopeText;
    vars.WIKI_INDEX = wikiIndex;
    vars.EPIC_WIKI_INDEX = epicWikiIndex;
    vars.RESEARCH_SOURCES = sourcesIndex;
    vars.CODE_MAP_SUMMARY = codeMapSummary;
    vars.CURATION_REASONS = reasonsText;

    const prompt = loadCommandOrSkill("do_curate_epic", projectDir, vars);
    if (!prompt) {
      throw new Error("Curation command template (do_curate_epic.md) not found.");
    }

    // ── Step 5: Stream agent response ────────────────────────────────

    let fullResponse = "";

    await new Promise<void>((resolve, reject) => {
      agentSvc.send({
        scope: { kind: "project", projectId },
        actorId,
        message: prompt,
        modelId,
        systemPrompt:
          "You are CodaScope, an AI agent for codebase analysis and documentation curation. " +
          "Follow the instructions precisely. Use the provided tools to read and write " +
          "wiki pages, concepts, and scope entries. Do NOT modify source code files.",
        purpose: "curation",
        onMessage: (msg) => {
          if (isAborted()) return;

          // Accumulate text
          if (msg.type === "assistant" && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === "text") fullResponse += block.text;
            }
          }

          sendMessage(msg);
        },
        onDone: async () => {
          resolve();
        },
        onError: async (err) => {
          reject(err);
        },
      });
    });

    if (isAborted()) {
      await curationSvc.updateLog(projectId, epicId, curationId, {
        status: "error",
        error: "Cancelled by user",
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      });
      return;
    }

    // ── Step 6: Record results ───────────────────────────────────────

    sendEvent("pipeline-step", { step: "record-results", status: "running" });

    // Parse the summary from the agent response
    const results = parseCurationSummary(fullResponse);

    const durationMs = Date.now() - startTime;

    await curationSvc.updateLog(projectId, epicId, curationId, {
      status: "complete",
      completedAt: new Date().toISOString(),
      durationMs,
      results,
    });

    sendEvent("pipeline-step", { step: "record-results", status: "complete" });


  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;

    // Update log if we created one
    if (curationId) {
      try {
        await curationSvc.updateLog(projectId, epicId, curationId, {
          status: "error",
          error: errorMsg,
          completedAt: new Date().toISOString(),
          durationMs,
        });
      } catch {
        // Ignore log update failures
      }
    }

    // Re-throw so the route handler sends the standard `error` SSE event
    throw err;
  }
}

// ── Summary Parser ──────────────────────────────────────────────────

/**
 * Parse the CURATION SUMMARY block from the agent's response.
 * Returns a structured CurationResults object.
 * Falls back to empty counts if the summary can't be parsed.
 */
function parseCurationSummary(response: string): CurationResults {
  const defaults: CurationResults = {
    mainWiki: { enriched: [], created: [] },
    epicWiki: { created: [], updated: [] },
    scope: { added: 0, removed: 0 },
  };

  const summaryMatch = response.match(/CURATION SUMMARY:[\s\S]*?(?=```|$)/i);
  if (!summaryMatch) return defaults;

  const summary = summaryMatch[0];

  // Parse scope counts
  const scopeMatch = summary.match(/Scope:.*?Added\s+(\d+).*?updated\s+(\d+)/i);
  if (scopeMatch) {
    defaults.scope.added = parseInt(scopeMatch[1], 10);
    defaults.scope.removed = parseInt(scopeMatch[2], 10);
  }

  // Parse main wiki counts
  const wikiMatch = summary.match(/Main Wiki:.*?Enriched\s+(\d+).*?created\s+(\d+)/i);
  if (wikiMatch) {
    const enrichedCount = parseInt(wikiMatch[1], 10);
    const createdCount = parseInt(wikiMatch[2], 10);
    // We can't know the topic IDs from the summary, but we record the counts
    for (let i = 0; i < enrichedCount; i++) {
      defaults.mainWiki.enriched.push({
        topicId: `enriched-${i}`,
        previousDepth: "unknown",
        newDepth: "unknown",
      });
    }
    for (let i = 0; i < createdCount; i++) {
      defaults.mainWiki.created.push({
        topicId: `created-${i}`,
        depth: "unknown",
      });
    }
  }



  // Parse epic wiki counts
  const epicWikiMatch = summary.match(/Epic Wiki:.*?Created\s+(\d+).*?updated\s+(\d+)/i);
  if (epicWikiMatch) {
    const createdCount = parseInt(epicWikiMatch[1], 10);
    const updatedCount = parseInt(epicWikiMatch[2], 10);
    for (let i = 0; i < createdCount; i++) defaults.epicWiki.created.push(`epic-page-${i}`);
    for (let i = 0; i < updatedCount; i++) defaults.epicWiki.updated.push(`epic-page-updated-${i}`);
  }

  return defaults;
}
