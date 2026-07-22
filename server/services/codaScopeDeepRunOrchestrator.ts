/* ── CodaScope: Deep Run Orchestrator ─────────────────────────────────
   Orchestrates the Deep Run pipeline — a full code-to-wiki sync.

   Extracted from codaScopeBuildOrchestrator.ts to separate the deep run
   pipeline (6 phases) from the standard analyze and epic deepen pipelines.

   Shared types and helpers (AnalyzeSseCallbacks, AnalyzeServices,
   extractTokenUsage) are imported from the original orchestrator.
   ──────────────────────────────────────────────────────────────────── */

import type { AnalyzeSseCallbacks, AnalyzeServices } from "./codaScopeBuildOrchestrator.js";
import { countSubstantiveWikiTopics, extractTokenUsage } from "./codaScopeBuildOrchestrator.js";
import type { CodaScopeWikiService } from "./codaScopeWikiService.js";
import { CodaScopeCodeMapService } from "./codaScopeCodeMapService.js";
import { buildBaseVars, loadCommandOrSkill } from "./codaScopeCommandLoader.js";

// ── Types ───────────────────────────────────────────────────────────

export interface DeepRunOptions {
  projectId: string;
  modelId: string;
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
    vars.REPOSITORY_PATH = "(configured repository; use read_source_file rather than a filesystem path)";
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
        "Follow the instructions precisely. Use CodaScope tools for all source reads and project writes; never use native filesystem write tools. " +
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
    const realTopics = existingTopics.filter((t) => t.id !== "index" && !t.id.startsWith("_"));

    if (realTopics.length === 0) {
      sendEvent("pipeline-step", { step: "deep-outline", status: "running" });

      const vars = buildBaseVars({
        projectName: project.name,
        projectDir,
        repositories: repos,
      });

      const prompt = loadCommandOrSkill("do_build_full_wiki", projectDir, vars);
      let outlineError: string | null = null;
      if (prompt) {
        await agentSvc.send({
          projectId,
          message: prompt,
          modelId,
          systemPrompt:
            "You are CodaScope, an AI agent for codebase analysis and documentation. " +
            "Follow the instructions precisely. Use CodaScope tools for all source reads and project writes; never use native filesystem write tools. " +
            "Do NOT modify files in the source repositories.",
          purpose: "wiki-build",
          onMessage: sendMessage,
          onDone: async (result) => {
            const tokenUsage = extractTokenUsage(result as { usage?: Record<string, number> });
            sendEvent("pipeline-step", { step: "deep-outline", status: "complete", tokenUsage });
          },
          onError: (err) => {
            outlineError = err.message;
            sendEvent("pipeline-step", { step: "deep-outline", status: "error", error: err.message });
          },
        });
      } else {
        outlineError = "Full Wiki command not found.";
        sendEvent("pipeline-step", { step: "deep-outline", status: "error", error: outlineError });
      }

      const outlineTopics = await wikiSvc.listTopics(projectId);
      if (outlineError || countSubstantiveWikiTopics(outlineTopics) === 0) {
        const error = outlineError ?? "Deep Run outline finished without creating any registered topic pages in the CodaScope project.";
        sendEvent("pipeline-step", { step: "deep-outline", status: "error", error });
        buildSvc.failBuild(projectId, runId, error);
        sendEvent("error", { error });
        return;
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
          "Use CodaScope source-read tools to read actual source files — do not just summarize the code map. " +
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
            "Use CodaScope tools for all project writes; never use native filesystem write tools. " +
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
          "Regenerate ONLY the index and _index wiki topics. All topic pages have already been written at deep depth. " +
          "Read the existing topic pages to build an accurate, rich index page. " +
          "Do NOT create or modify any individual topic pages — only the index and _index topics.\n\n" +
          prompt,
        modelId,
        systemPrompt:
          "You are CodaScope, an AI agent for codebase documentation. " +
          "Your ONLY task is to regenerate the wiki index page (index and _index topics). " +
          "Do NOT create or modify individual topic pages. Read existing topic pages to build an accurate index. " +
          "Use CodaScope tools for all project writes; never use native filesystem write tools. " +
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
        if (topic.id === "index" || topic.id.startsWith("_")) continue;
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
