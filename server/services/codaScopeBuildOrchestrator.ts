/* ── CodaScope: Build Orchestrator ────────────────────────────────────
   Orchestrates the multi-step build analysis pipeline:
     1. Code Map — scans repository structure
     2. Wiki — generates/updates documentation (outline, delta, or full)

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
import type { CodaScopeCurationService } from "./codaScopeCurationService.js";
import type { CodaScopeEpicService } from "./codaScopeEpicService.js";
import { buildBaseVars, loadCommandOrSkill } from "./codaScopeCommandLoader.js";

// ── Types ───────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  projectId: string;
  modelId: string;
  wiki: "auto" | "full" | false;
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
  curationSvc?: CodaScopeCurationService;
  epicSvc?: CodaScopeEpicService;
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
 * It handles: Code Map → Wiki → Done/Cancelled
 */
export async function runAnalyzePipeline(
  options: AnalyzeOptions,
  callbacks: AnalyzeSseCallbacks,
  services: AnalyzeServices,
  runId: string,
): Promise<void> {
  const { projectId, modelId, wiki, scope } = options;
  const { sendEvent, sendMessage, isAborted } = callbacks;
  const { agentSvc, projectSvc, wikiSvc, buildSvc, codeMapSvc, wikiStateSvc, curationSvc, epicSvc } = services;

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



  // ── Post-build: fire code_delta_processed curation reason ──────
  if (topicsRebuilt > 0 && curationSvc && epicSvc) {
    try {
      const epics = await epicSvc.listEpics(projectId);
      const activeStatuses = new Set(["defining", "curating", "designing", "in-review"]);
      for (const epic of epics) {
        if (activeStatuses.has(epic.status)) {
          await curationSvc.addReason(projectId, epic.id, {
            type: "code_delta_processed",
            at: new Date().toISOString(),
            detail: `Build analysis rebuilt ${topicsRebuilt} wiki topic(s) from code changes`,
          });
        }
      }
    } catch { /* non-fatal — curation dirs may not exist for old epics */ }
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

// ── Epic Deepen Pipeline (P1) ───────────────────────────────────────

export interface EpicDeepenOptions {
  projectId: string;
  epicId: string;
  modelId: string;
  entries: Array<{
    topicId: string;
    topicTitle: string;
    type: "existing-wiki" | "new";
    targetDepth?: string;
  }>;
}

export interface EpicDeepenServices extends AnalyzeServices {
  epicSvc: { updateScopeEntry: (pid: string, eid: string, tid: string, changes: Record<string, unknown>) => Promise<unknown> };
}

/**
 * Run the wiki enrichment pipeline for scoped epic topics.
 *
 * For each included scope entry:
 * - "existing-wiki" → run do_build_wiki_page to deepen the topic
 * - "new" → run do_build_wiki_page to create a new page
 *
 * Updates scope entry status as each completes.
 */
export async function runEpicDeepenPipeline(
  options: EpicDeepenOptions,
  callbacks: AnalyzeSseCallbacks,
  services: EpicDeepenServices,
  runId: string,
  buildScope?: string,
): Promise<void> {
  const { projectId, epicId, modelId, entries } = options;
  const { sendEvent, sendMessage, isAborted } = callbacks;
  const { agentSvc, projectSvc, wikiSvc, buildSvc, epicSvc } = services;

  const project = await projectSvc.getProject(projectId);
  if (!project) throw new Error("Project not found.");

  const projectDir = projectSvc.getProjectDir(projectId);
  if (!projectDir) throw new Error("Project directory not found.");

  const repos = project.repositories ?? [];

  sendEvent("pipeline-step", {
    step: "epic-deepen-start",
    status: "running",
    detail: `Deepening ${entries.length} topic(s) for epic`,
  });

  let completed = 0;
  let errored = 0;

  for (const entry of entries) {
    if (isAborted()) break;

    const stepId = `deepen-${entry.topicId}`;
    sendEvent("pipeline-step", {
      step: stepId,
      status: "running",
      topic: entry.topicTitle,
      progress: `${completed + 1}/${entries.length}`,
    });

    // Mark entry as enriching
    try {
      await epicSvc.updateScopeEntry(projectId, epicId, entry.topicId, {
        enrichmentRunId: runId,
      });
    } catch { /* best effort */ }

    // Build variables for the wiki page builder
    const vars = buildBaseVars({
      projectName: project.name,
      projectDir,
      repositories: repos,
    });
    vars.TOPIC_NAME = entry.topicTitle;
    vars.TOPIC_SLUG = entry.topicId;

    // Use the existing wiki page builder command
    const prompt = loadCommandOrSkill("do_build_wiki_page", projectDir, vars);
    if (!prompt) {
      sendEvent("pipeline-step", {
        step: stepId,
        status: "error",
        topic: entry.topicTitle,
        error: "Wiki page builder command not found",
      });
      errored++;
      continue;
    }

    try {
      await agentSvc.send({
        projectId,
        message: prompt,
        modelId,
        systemPrompt:
          "You are CodaScope, an AI agent for codebase analysis and documentation. " +
          "Follow the instructions precisely. Write the wiki page to the project's wiki/ directory. " +
          `Focus on the topic: "${entry.topicTitle}". ` +
          (entry.targetDepth
            ? `Target depth: ${entry.targetDepth}. `
            : "") +
          "Do NOT modify files in the source repositories.",
        purpose: "wiki-build",
        onMessage: sendMessage,
        onDone: async (result) => {
          const tokenUsage = extractTokenUsage(result as { usage?: Record<string, number> });
          sendEvent("pipeline-step", {
            step: stepId,
            status: "complete",
            topic: entry.topicTitle,
            tokenUsage,
          });

          // Mark entry as enriched
          try {
            await epicSvc.updateScopeEntry(projectId, epicId, entry.topicId, {
              enrichedAt: new Date().toISOString(),
              enrichmentRunId: runId,
            });
          } catch { /* best effort */ }

          completed++;
        },
        onError: (err) => {
          sendEvent("pipeline-step", {
            step: stepId,
            status: "error",
            topic: entry.topicTitle,
            error: err.message,
          });
          errored++;
        },
      });
    } catch (err) {
      sendEvent("pipeline-step", {
        step: stepId,
        status: "error",
        topic: entry.topicTitle,
        error: err instanceof Error ? err.message : String(err),
      });
      errored++;
    }
  }

  // Refresh wiki topics
  let pageCount: number | undefined;
  try {
    const topics = await wikiSvc.listTopics(projectId);
    pageCount = topics.length;
    sendEvent("wiki-refresh", { topics });
  } catch { /* ignore */ }

  // Complete or fail based on results
  if (buildSvc.isCancelled(projectId, buildScope)) {
    buildSvc.failBuild(projectId, runId, "Deepen cancelled by user", buildScope);
    buildSvc.clearCancellation(projectId, buildScope);
    sendEvent("cancelled", { runId });
  } else {
    buildSvc.completeBuild(projectId, runId, pageCount, {
      buildMode: "epic-deepen",
      topicsRebuilt: completed,
    }, buildScope);
    sendEvent("done", {
      runId,
      epicId,
      completed,
      errored,
      total: entries.length,
      buildSummary: buildSvc.getBuildState(projectId, buildScope)?.summary,
    });
  }
}

// ── Wiki Link Index Builder ─────────────────────────────────────────

/**
 * Build a compact text index of all wiki topics and their current [[wiki links]].
 * Used by the batched cross-reference pass so each batch knows the full link graph
 * without reading every page.
 *
 * Output format (one line per topic):
 *   - **topic-slug** (Title): links to → [[other-topic]], [[another-topic]]
 *   - **orphan-topic** (Orphan Title): no wiki links
 */
async function buildWikiLinkIndex(
  wikiSvc: CodaScopeWikiService,
  projectId: string,
  topics: Array<{ id: string; title: string }>,
): Promise<string> {
  const lines: string[] = [];

  for (const topic of topics) {
    const content = await wikiSvc.getTopicContent(projectId, topic.id);
    if (!content) {
      lines.push(`- **${topic.id}** (${topic.title}): no content`);
      continue;
    }

    // Extract [[wiki links]] from the page content
    const wikiLinks: string[] = [];
    const regex = /\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      // Deduplicate
      if (!wikiLinks.includes(match[1])) {
        wikiLinks.push(match[1]);
      }
    }

    if (wikiLinks.length > 0) {
      lines.push(
        `- **${topic.id}** (${topic.title}): links to → ${wikiLinks.map((l) => `[[${l}]]`).join(", ")}`,
      );
    } else {
      lines.push(`- **${topic.id}** (${topic.title}): no wiki links`);
    }
  }

  return lines.join("\n");
}

// ── Deep Run Pipeline ───────────────────────────────────────────────

export interface DeepRunOptions {
  projectId: string;
  modelId: string;
}

/**
 * Run the Deep Run pipeline — a full code-to-wiki sync.
 *
 * 5+1 phases:
 *   1. Force-refresh all code maps (regardless of staleness)
 *   2. Create wiki outline if no topics exist yet
 *   3. Deep-enrich each wiki topic sequentially
 *   4. Cross-reference consistency pass
 *   5. Regenerate wiki/index.md
 *   6. Finalize — update wiki-state.json with sync point metadata
 *
 * Git HEADs are captured at the START of the pipeline as the sync
 * point baseline.
 */
export async function runDeepRunPipeline(
  options: DeepRunOptions,
  callbacks: AnalyzeSseCallbacks,
  services: AnalyzeServices,
  runId: string,
): Promise<void> {
  const { projectId, modelId } = options;
  const { sendEvent, sendMessage, isAborted } = callbacks;
  const { agentSvc, projectSvc, wikiSvc, buildSvc, codeMapSvc, wikiStateSvc } = services;

  const project = await projectSvc.getProject(projectId);
  if (!project) throw new Error("Project not found.");

  const projectDir = projectSvc.getProjectDir(projectId);
  if (!projectDir) throw new Error("Project directory not found.");

  const repos = project.repositories ?? [];
  let topicsRebuilt = 0;

  // ── Capture git HEADs at pipeline start (sync point baseline) ──
  const syncGitHeads: Record<string, string> = {};
  for (const repo of repos) {
    const repoKey = repo.name || repo.path;
    const head = codeMapSvc.getGitHead(repo.path);
    if (head) syncGitHeads[repoKey] = head;
  }

  // ── Phase 1: Force-refresh ALL code maps ───────────────────────
  sendEvent("pipeline-step", { step: "deep-code-map", status: "running" });

  for (const repo of repos) {
    if (isAborted()) break;

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
      sendEvent("pipeline-step", { step: "deep-code-map", status: "error", error: "Code Map command not found." });
      continue;
    }

    sendEvent("pipeline-step", { step: "deep-code-map", status: "building", repo: repo.name });

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
        sendEvent("pipeline-step", { step: "deep-code-map", status: "complete", repo: repo.name, tokenUsage });
      },
      onError: (err) => {
        sendEvent("pipeline-step", { step: "deep-code-map", status: "error", repo: repo.name, error: err.message });
      },
    });
  }

  if (!isAborted()) {
    sendEvent("pipeline-step", { step: "deep-code-map", status: "complete" });
  }

  // ── Phase 2: Create wiki outline if no topics exist ────────────
  if (!isAborted()) {
    const existingTopics = await wikiSvc.listTopics(projectId);
    const realTopics = existingTopics.filter((t) => t.id !== "_index" && !t.id.startsWith("_"));

    if (realTopics.length === 0) {
      sendEvent("pipeline-step", { step: "deep-outline", status: "running" });

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
            sendEvent("pipeline-step", { step: "deep-outline", status: "complete", tokenUsage });
          },
          onError: (err) => {
            sendEvent("pipeline-step", { step: "deep-outline", status: "error", error: err.message });
          },
        });
      }
    } else {
      sendEvent("pipeline-step", { step: "deep-outline", status: "skipped", reason: `${realTopics.length} topics already exist` });
    }
  }

  // ── Phase 3: Deep-enrich each topic sequentially ───────────────
  if (!isAborted()) {
    const topics = await wikiSvc.listTopics(projectId);
    const realTopics = topics.filter((t) => t.id !== "_index" && !t.id.startsWith("_") && t.id !== "index");
    const totalTopics = realTopics.length;

    for (let i = 0; i < realTopics.length; i++) {
      if (isAborted()) break;

      const topic = realTopics[i];
      const stepId = `deep-topic-${topic.id}`;

      sendEvent("pipeline-step", {
        step: stepId,
        status: "running",
        topic: topic.title || topic.id,
        progress: `${i + 1}/${totalTopics}`,
      });

      const existingContent = await wikiSvc.getTopicContent(projectId, topic.id);

      const vars = buildBaseVars({
        projectName: project.name,
        projectDir,
        repositories: repos,
      });
      vars.TOPIC_NAME = topic.title || topic.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      vars.TOPIC_SLUG = topic.id;
      vars.EXISTING_CONTENT = existingContent ?? "(No existing content — create the page from scratch)";

      const prompt = loadCommandOrSkill("do_deep_wiki_page", projectDir, vars);
      if (!prompt) {
        sendEvent("pipeline-step", {
          step: stepId,
          status: "error",
          topic: topic.title || topic.id,
          error: "Deep wiki page command not found",
        });
        continue;
      }

      await agentSvc.send({
        projectId,
        message: prompt,
        modelId,
        systemPrompt:
          "You are CodaScope, a senior technical documentation specialist. " +
          "You are producing an exhaustive, source-level wiki page. " +
          "READ actual source files — do not just summarize the code map. " +
          `Focus on the topic: "${vars.TOPIC_NAME}". ` +
          "Target ≥1,500 words with ≥5 code examples, ≥2 Mermaid diagrams, and ≥3 [[wiki links]]. " +
          "Do NOT modify files in the source repositories.",
        purpose: "wiki-build",
        onMessage: sendMessage,
        onDone: async (result) => {
          const tokenUsage = extractTokenUsage(result as { usage?: Record<string, number> });
          sendEvent("pipeline-step", {
            step: stepId,
            status: "complete",
            topic: topic.title || topic.id,
            tokenUsage,
          });
          topicsRebuilt++;
        },
        onError: (err) => {
          sendEvent("pipeline-step", {
            step: stepId,
            status: "error",
            topic: topic.title || topic.id,
            error: err.message,
          });
        },
      });
    }
  }

  // ── Phase 4: Cross-reference consistency pass (BATCHED) ─────────
  //
  // Instead of one mega agent call that must read ALL wiki pages,
  // split topics into batches of ~6. Each batch agent reads only its
  // assigned pages + a compact link index of all topics' current links.
  // The link index is rebuilt between batches so later batches see
  // links added by earlier ones.
  //
  if (!isAborted()) {
    const allTopics = await wikiSvc.listTopics(projectId);
    const crossRefTopics = allTopics.filter(
      (t) => t.id !== "_index" && !t.id.startsWith("_") && t.id !== "index",
    );

    const CROSS_REF_BATCH_SIZE = 6;
    const batches: typeof crossRefTopics[] = [];
    for (let i = 0; i < crossRefTopics.length; i += CROSS_REF_BATCH_SIZE) {
      batches.push(crossRefTopics.slice(i, i + CROSS_REF_BATCH_SIZE));
    }

    // Build initial link index (compact: topic → outgoing [[wiki links]])
    let linkIndex = await buildWikiLinkIndex(wikiSvc, projectId, crossRefTopics);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (isAborted()) break;

      const batch = batches[batchIdx];
      const stepId = `deep-cross-ref-batch-${batchIdx + 1}`;
      const batchLabel = batch.map((t) => t.title || t.id).slice(0, 3).join(", ");
      const batchSuffix = batch.length > 3 ? ` +${batch.length - 3} more` : "";

      sendEvent("pipeline-step", {
        step: stepId,
        status: "running",
        progress: `Batch ${batchIdx + 1}/${batches.length}`,
        topic: `${batchLabel}${batchSuffix}`,
      });

      const vars = buildBaseVars({
        projectName: project.name,
        projectDir,
        repositories: repos,
      });
      vars.BATCH_TOPICS = batch
        .map((t) => `- **${t.id}** — ${t.title || t.id} (file: wiki/${t.id}.md)`)
        .join("\n");
      vars.WIKI_LINK_INDEX = linkIndex;

      const prompt = loadCommandOrSkill("do_wiki_cross_reference", projectDir, vars);
      if (prompt) {
        await agentSvc.send({
          projectId,
          message: prompt,
          modelId,
          systemPrompt:
            "You are CodaScope, a documentation quality specialist. " +
            `Review the following ${batch.length} wiki pages for cross-reference consistency. ` +
            "ONLY modify pages in your assigned batch. " +
            "Ensure [[wiki links]] are bidirectional and complete. " +
            "Do NOT modify files in the source repositories.",
          purpose: "wiki-build",
          onMessage: sendMessage,
          onDone: async (result) => {
            const tokenUsage = extractTokenUsage(result as { usage?: Record<string, number> });
            sendEvent("pipeline-step", { step: stepId, status: "complete", tokenUsage });
          },
          onError: (err) => {
            sendEvent("pipeline-step", { step: stepId, status: "error", error: err.message });
          },
        });

        // Rebuild link index after each batch so later batches see newly added links
        if (batchIdx < batches.length - 1) {
          linkIndex = await buildWikiLinkIndex(wikiSvc, projectId, crossRefTopics);
        }
      } else {
        sendEvent("pipeline-step", { step: stepId, status: "error", error: "Cross-reference command not found" });
      }
    }
  }

  // ── Phase 5: Regenerate wiki/index.md ──────────────────────────
  if (!isAborted()) {
    sendEvent("pipeline-step", { step: "deep-index", status: "running" });

    const vars = buildBaseVars({
      projectName: project.name,
      projectDir,
      repositories: repos,
    });

    const prompt = loadCommandOrSkill("do_build_full_wiki", projectDir, vars);
    if (prompt) {
      // Use a focused system prompt that only regenerates the index
      await agentSvc.send({
        projectId,
        message:
          "Regenerate ONLY the wiki/index.md file. All topic pages have already been written at deep depth. " +
          "Read the existing topic pages to build an accurate, rich index page. " +
          "Do NOT create or modify any individual topic pages — only wiki/index.md and wiki/_index.md.\n\n" +
          prompt,
        modelId,
        systemPrompt:
          "You are CodaScope, an AI agent for codebase documentation. " +
          "Your ONLY task is to regenerate the wiki index page (wiki/index.md and wiki/_index.md). " +
          "Do NOT create or modify individual topic pages. Read existing topic pages to build an accurate index. " +
          "Do NOT modify files in the source repositories.",
        purpose: "wiki-build",
        onMessage: sendMessage,
        onDone: async (result) => {
          const tokenUsage = extractTokenUsage(result as { usage?: Record<string, number> });
          sendEvent("pipeline-step", { step: "deep-index", status: "complete", tokenUsage });
        },
        onError: (err) => {
          sendEvent("pipeline-step", { step: "deep-index", status: "error", error: err.message });
        },
      });
    } else {
      sendEvent("pipeline-step", { step: "deep-index", status: "error", error: "Full wiki command not found" });
    }
  }

  // ── Phase 6: Finalize — update wiki-state.json ─────────────────
  if (!isAborted()) {
    sendEvent("pipeline-step", { step: "deep-finalize", status: "running" });

    try {
      const wikiState = wikiStateSvc.getWikiState(projectDir) ?? wikiStateSvc.createEmptyState();
      const now = new Date().toISOString();

      // Update build metadata
      wikiState.lastBuildAt = now;
      wikiState.lastBuildMode = "deep-run";

      // Record sync point
      wikiState.lastSyncAt = now;
      wikiState.lastSyncGitHeads = syncGitHeads;
      wikiState.lastSyncRunId = runId;

      // Advance git heads
      for (const repo of repos) {
        const repoKey = repo.name || repo.path;
        const currentHead = codeMapSvc.getGitHead(repo.path);
        if (currentHead) wikiState.gitHeads[repoKey] = currentHead;
      }

      // Evaluate depth and extract deps for all topics, marking them as "deep"
      const topics = await wikiSvc.listTopics(projectId);
      for (const topic of topics) {
        if (topic.id === "_index" || topic.id.startsWith("_")) continue;
        const content = await wikiSvc.getTopicContent(projectId, topic.id);
        if (!content) continue;

        const { depth, metrics } = wikiStateSvc.evaluateTopicDepth(content);
        const deps = wikiStateSvc.extractDepsFromContent(content);

        const existing = wikiState.topics[topic.id];
        wikiState.topics[topic.id] = {
          depth: "deep",  // Deep Run forces all topics to "deep"
          builtAt: now,
          lastDeepenedAt: now,
          deps,
          metrics,
        };
      }

      wikiStateSvc.saveWikiState(projectDir, wikiState);
      sendEvent("pipeline-step", { step: "deep-finalize", status: "complete" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendEvent("pipeline-step", { step: "deep-finalize", status: "error", error: msg });
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
    buildSvc.failBuild(projectId, runId, "Deep Run cancelled by user");
    buildSvc.clearCancellation(projectId);
    sendEvent("cancelled", { runId });
  } else {
    buildSvc.completeBuild(projectId, runId, pageCount, {
      buildType: "deep-run",
      topicsRebuilt,
      syncGitHeads,
    });
    sendEvent("done", { runId, buildSummary: buildSvc.getBuildState(projectId)?.summary });
  }
}
