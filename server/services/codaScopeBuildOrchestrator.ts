/* ── CodaScope: Build Orchestrator ────────────────────────────────────
   Orchestrates the multi-step build analysis pipeline:
     1. Code Map — scans repository structure
     2. Wiki — generates/updates documentation (outline, delta, or full)
     3. Quality — runs quality analysis against golden rules

   Extracted from codaScopeRoutes.ts to keep the route file as a thin
   dispatcher. The route handler sets up SSE, creates the orchestrator
   options, and delegates all pipeline logic here.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeAgentService } from "./codaScopeAgentService.js";
import type { CodaScopeProjectService } from "./codaScopeProjectService.js";
import type { CodaScopeWikiService } from "./codaScopeWikiService.js";
import type { CodaScopeBuildStateService, TokenUsageRecord } from "./codaScopeBuildStateService.js";
import { CodaScopeCodeMapService } from "./codaScopeCodeMapService.js";
import type { CodaScopeWikiStateService } from "./codaScopeWikiStateService.js";
import { buildBaseVars, loadCommandOrSkill } from "./codaScopeCommandLoader.js";

// ── Types ───────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  projectId: string;
  modelId: string;
  wiki: "auto" | "full" | false;
  quality: boolean;
  scope?: string | { path: string };
}

export interface AnalyzeSseCallbacks {
  sendEvent: (event: string, data: unknown) => void;
  sendMessage: (msg: unknown) => void;
  isAborted: () => boolean;
}

export interface AnalyzeServices {
  agentSvc: CodaScopeAgentService;
  projectSvc: CodaScopeProjectService;
  wikiSvc: CodaScopeWikiService;
  buildSvc: CodaScopeBuildStateService;
  codeMapSvc: CodaScopeCodeMapService;
  wikiStateSvc: CodaScopeWikiStateService;
}

// ── Token Usage Helper ──────────────────────────────────────────────

function extractTokenUsage(result: { usage?: Record<string, number> } | undefined): TokenUsageRecord | undefined {
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

// ── Build Orchestrator ──────────────────────────────────────────────

/**
 * Run the full analysis pipeline for a project.
 *
 * This function assumes:
 * - SSE headers have already been written
 * - A build has been started via `buildSvc.startBuild()`
 * - The `run-started` event has already been emitted
 *
 * It handles: Code Map → Wiki → Quality → Done/Cancelled
 */
export async function runAnalyzePipeline(
  options: AnalyzeOptions,
  callbacks: AnalyzeSseCallbacks,
  services: AnalyzeServices,
  runId: string,
): Promise<void> {
  const { projectId, modelId, wiki, quality, scope } = options;
  const { sendEvent, sendMessage, isAborted } = callbacks;
  const { agentSvc, projectSvc, wikiSvc, buildSvc, codeMapSvc, wikiStateSvc } = services;

  const project = await projectSvc.getProject(projectId);
  if (!project) throw new Error("Project not found.");

  const projectDir = projectSvc.getProjectDir(projectId);
  if (!projectDir) throw new Error("Project directory not found.");

  // ── Build info tracker ─────────────────────────────────────────
  let buildMode: "outline" | "delta" | "full" | undefined;
  let topicsRebuilt = 0;

  // ── Step 1: Code Map (always runs if stale) ────────────────────
  const repos = project.repositories ?? [];
  const isStale = codeMapSvc.isAnyCodeMapStale(projectId, repos);

  if (isStale) {
    sendEvent("pipeline-step", { step: "code-map", status: "running" });

    for (const repo of repos) {
      const slug = CodaScopeCodeMapService.repoSlug(repo.name || repo.path);
      const inventory = codeMapSvc.generateFileInventory(repo.name, repo.path);
      const inventoryMd = codeMapSvc.formatInventoryAsMarkdown(inventory);
      const existingDocs = codeMapSvc.readExistingDocs(repo.path, inventory.existingDocs);

      const vars = buildBaseVars({
        projectName: project.name,
        projectDir,
        repositories: repos,
      });
      vars.REPOSITORY_NAME = repo.name;
      vars.REPOSITORY_PATH = repo.path;
      vars.REPO_SLUG = slug;
      vars.FILE_INVENTORY = inventoryMd;
      vars.EXISTING_DOCS = existingDocs;

      const prompt = loadCommandOrSkill("do_build_code_map", projectDir, vars);
      if (!prompt) {
        sendEvent("pipeline-step", { step: "code-map", status: "error", error: "Code Map command not found." });
        continue;
      }

      sendEvent("pipeline-step", { step: "code-map", status: "building", repo: repo.name });

      await agentSvc.send({
        projectId,
        message: prompt,
        modelId,
        systemPrompt:
          "You are CodaScope, an AI agent for codebase analysis and documentation. " +
          "Follow the instructions precisely. Write all output files to the project directory. " +
          "Do NOT modify files in the source repositories.",
        purpose: "wiki-build",
        onMessage: sendMessage,
        onDone: async (result) => {
          const currentHead = codeMapSvc.getGitHead(repo.path);
          codeMapSvc.saveCodeMapMeta(projectId, slug, {
            repoId: repo.id,
            repoSlug: slug,
            generatedAt: new Date().toISOString(),
            gitHead: currentHead,
            totalFiles: inventory.totalFiles,
            languages: Object.keys(inventory.languages),
          });
          const tokenUsage = extractTokenUsage(result as { usage?: Record<string, number> });
          sendEvent("pipeline-step", { step: "code-map", status: "complete", repo: repo.name, tokenUsage });
        },
        onError: (err) => {
          sendEvent("pipeline-step", { step: "code-map", status: "error", repo: repo.name, error: err.message });
        },
      });
    }
  } else {
    sendEvent("pipeline-step", { step: "code-map", status: "skipped", reason: "Code Map is fresh" });
  }

  // ── Step 2: Wiki (if toggled on) ───────────────────────────────
  if (wiki) {
    const wikiState = wikiStateSvc.getWikiState(projectDir);
    const isFullBuild = wiki === "full" || !wikiState || Object.keys(wikiState.topics).length === 0;
    buildMode = isFullBuild ? "outline" : "delta";

    if (isFullBuild) {
      // ── Outline Build: single LLM call, all topics at outline depth ──
      sendEvent("pipeline-step", { step: "wiki-outline", status: "running", mode: "outline" });

      const vars = buildBaseVars({
        projectName: project.name,
        projectDir,
        repositories: repos,
      });

      const prompt = loadCommandOrSkill("do_build_full_wiki", projectDir, vars);
      if (prompt) {
        await agentSvc.send({
          projectId,
          message: prompt,
          modelId,
          systemPrompt:
            "You are CodaScope, an AI agent for codebase analysis and documentation. " +
            "Follow the instructions precisely. Write all output files to the project's wiki/ directory. " +
            "Do NOT modify files in the source repositories.",
          purpose: "wiki-build",
          onMessage: sendMessage,
          onDone: async (result) => {
            const tokenUsage = extractTokenUsage(result as { usage?: Record<string, number> });
            sendEvent("pipeline-step", { step: "wiki-outline", status: "complete", tokenUsage });
          },
          onError: (err) => {
            sendEvent("pipeline-step", { step: "wiki-outline", status: "error", error: err.message });
          },
        });
      }
    } else {
      // ── Delta Build: only rebuild topics affected by git changes ──
      const gitHeadDebug = Object.entries(wikiState.gitHeads).map(([k, v]) => `${k}:${String(v).slice(0, 8)}`).join(", ");
      sendEvent("pipeline-step", { step: "wiki-delta", status: "running", mode: "delta", repoCount: repos.length, gitHeads: gitHeadDebug });

      // Collect all changed files across repos
      const allChangedFiles: string[] = [];
      for (const repo of repos) {
        const repoKey = repo.name || repo.path;
        const lastHead = wikiState.gitHeads[repoKey];
        const currentHead = codeMapSvc.getGitHead(repo.path);
        console.log(`[wiki-delta] repo=${repoKey} lastHead=${lastHead?.slice(0, 8) ?? "null"} currentHead=${currentHead?.slice(0, 8) ?? "null"} match=${lastHead === currentHead}`);
        if (lastHead && currentHead && lastHead !== currentHead) {
          const changed = codeMapSvc.getChangedFiles(repo.path, lastHead, currentHead);
          console.log(`[wiki-delta] ${changed.length} changed files for ${repoKey}`);
          allChangedFiles.push(...changed);
        } else if (!lastHead) {
          console.log(`[wiki-delta] no lastHead for ${repoKey} — gitHeads keys: ${Object.keys(wikiState.gitHeads).join(", ")}`);
        }
      }

      // Map changed files to affected topics
      const affectedTopics = wikiStateSvc.getAffectedTopics(wikiState, allChangedFiles);

      if (affectedTopics.length === 0) {
        const repoDebug = repos.map((r) => {
          const k = r.name || r.path;
          const last = wikiState.gitHeads[k];
          const cur = codeMapSvc.getGitHead(r.path);
          return `${k}[last=${last?.slice(0, 8) ?? "none"} cur=${cur?.slice(0, 8) ?? "none"} eq=${last === cur}]`;
        }).join("; ");
        sendEvent("pipeline-step", { step: "wiki-delta", status: "skipped", reason: `No wiki topics affected by ${allChangedFiles.length} changed file(s)`, debug: repoDebug });
      } else {
        sendEvent("pipeline-step", {
          step: "wiki-delta",
          status: "building",
          progress: `${affectedTopics.length} of ${Object.keys(wikiState.topics).length} topics affected`,
        });

        // Rebuild each affected topic
        for (const topicId of affectedTopics) {
          if (isAborted()) break;

          const existingContent = await wikiSvc.getTopicContent(projectId, topicId);
          const topicState = wikiState.topics[topicId];

          const vars = buildBaseVars({
            projectName: project.name,
            projectDir,
            repositories: repos,
          });
          vars.TOPIC_NAME = topicId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          vars.TOPIC_SLUG = topicId;
          vars.WIKI_PAGE_CONTENT = existingContent ?? "(No existing content)";
          vars.CHANGED_FILES = allChangedFiles.join("\n");
          vars.CURRENT_DEPTH = topicState?.depth ?? "outline";

          const prompt = loadCommandOrSkill("do_build_wiki_delta", projectDir, vars);
          if (prompt) {
            await agentSvc.send({
              projectId,
              message: prompt,
              modelId,
              systemPrompt:
                "You are CodaScope, a technical documentation specialist. " +
                "Update the wiki page to reflect recent code changes. Preserve the existing depth and quality. " +
                "Do NOT modify files in the source repositories.",
              purpose: "wiki-build",
              onMessage: sendMessage,
              onDone: async (result) => {
                const tokenUsage = extractTokenUsage(result as { usage?: Record<string, number> });
                sendEvent("pipeline-step", {
                  step: "wiki-delta",
                  status: "enriched",
                  topic: topicId,
                  tokenUsage,
                });
                topicsRebuilt++;
              },
              onError: (err) => {
                sendEvent("pipeline-step", {
                  step: "wiki-delta",
                  status: "error",
                  topic: topicId,
                  error: err.message,
                });
              },
            });
          }
        }
        sendEvent("pipeline-step", { step: "wiki-delta", status: "complete" });
      }
    }

    // ── Post-wiki: update wiki-state.json ──────────────────────────
    sendEvent("pipeline-step", { step: "wiki-state", status: "running" });
    try {
      const newState = wikiState ?? wikiStateSvc.createEmptyState();
      newState.lastBuildAt = new Date().toISOString();
      newState.lastBuildMode = isFullBuild ? "outline" : "delta";

      // Update git heads — only advance the HEAD when topics were
      // actually rebuilt (or on full/outline builds). Otherwise the
      // baseline stays at the pre-build HEAD so deltas can still be
      // detected on the next run.
      if (isFullBuild || topicsRebuilt > 0) {
        for (const repo of repos) {
          const repoKey = repo.name || repo.path;
          const currentHead = codeMapSvc.getGitHead(repo.path);
          if (currentHead) newState.gitHeads[repoKey] = currentHead;
        }
      }

      // Evaluate depth and extract deps for all topics
      const topics = await wikiSvc.listTopics(projectId);
      for (const topic of topics) {
        if (topic.id === "_index" || topic.id.startsWith("_")) continue;
        const content = await wikiSvc.getTopicContent(projectId, topic.id);
        if (!content) continue;

        const { depth, metrics } = wikiStateSvc.evaluateTopicDepth(content);
        const deps = wikiStateSvc.extractDepsFromContent(content);

        // Preserve existing state fields (lastDeepenedAt) if topic already tracked
        const existing = newState.topics[topic.id];
        newState.topics[topic.id] = {
          depth: existing?.depth === "deep" && depth !== "deep" ? existing.depth : depth, // never downgrade
          builtAt: new Date().toISOString(),
          lastDeepenedAt: existing?.lastDeepenedAt,
          deps,
          metrics,
        };
      }

      wikiStateSvc.saveWikiState(projectDir, newState);
      sendEvent("pipeline-step", { step: "wiki-state", status: "complete" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendEvent("pipeline-step", { step: "wiki-state", status: "error", error: msg });
    }
  }

  // ── Step 3: Quality (if toggled on) ────────────────────────────
  if (quality) {
    sendEvent("pipeline-step", { step: "quality", status: "running" });

    const vars = buildBaseVars({
      projectName: project.name,
      projectDir,
      repositories: repos,
    });
    vars.MODEL_ID = modelId;

    // Apply scope
    if (scope && typeof scope === "string" && scope !== "full") {
      vars.SCAN_SCOPE = `Scoped scan: focus on ${scope} areas only.`;
    } else if (scope && typeof scope === "object" && scope.path) {
      vars.SCAN_SCOPE = `Scoped scan: analyze only files under ${scope.path}`;
    }

    const prompt = loadCommandOrSkill("do_quality_scan", projectDir, vars);
    if (prompt) {
      await agentSvc.send({
        projectId,
        message: prompt,
        modelId,
        systemPrompt:
          "You are CodaScope, a senior code reviewer conducting a quality audit. " +
          "Follow the instructions precisely. Write the quality report to the project's quality/ directory. " +
          "Do NOT modify files in the source repositories.",
        purpose: "wiki-build",
        onMessage: sendMessage,
        onDone: async (result) => {
          const tokenUsage = extractTokenUsage(result as { usage?: Record<string, number> });
          sendEvent("pipeline-step", { step: "quality", status: "complete", tokenUsage });
        },
        onError: (err) => {
          sendEvent("pipeline-step", { step: "quality", status: "error", error: err.message });
        },
      });
    }
  }

  // ── Done / Cancelled ───────────────────────────────────────────
  let pageCount: number | undefined;
  try {
    const topics = await wikiSvc.listTopics(projectId);
    pageCount = topics.length;
    sendEvent("wiki-refresh", { topics });
  } catch { /* ignore */ }

  if (buildSvc.isCancelled(projectId)) {
    buildSvc.failBuild(projectId, runId, "Build cancelled by user");
    buildSvc.clearCancellation(projectId);
    sendEvent("cancelled", { runId });
  } else {
    buildSvc.completeBuild(projectId, runId, pageCount, { buildMode, topicsRebuilt });
    sendEvent("done", { runId, buildSummary: buildSvc.getBuildState(projectId)?.summary });
  }
}
