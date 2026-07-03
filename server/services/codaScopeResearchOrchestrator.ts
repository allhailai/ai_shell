/* ── CodaScope: Research Pipeline Orchestrator ────────────────────────
   Orchestrates the full research workflow autonomously:
     Phase 1: Agent generates research plan (URLs to fetch)
     Phase 2: Deterministic downloads of all URLs (no user approval)
     Phase 3: Agent processes downloaded content into epic wiki pages

   Follows the codaScopeCurationOrchestrator.ts SSE streaming pattern.
   ──────────────────────────────────────────────────────────────────── */

import path from "node:path";
import os from "node:os";
import type { CodaScopeAgentService } from "./codaScopeAgentService.js";
import type { CodaScopeProjectService } from "./codaScopeProjectService.js";
import type { CodaScopeEpicService } from "./codaScopeEpicService.js";
import type { CodaScopeEpicKnowledgeService } from "./codaScopeEpicKnowledgeService.js";
import type { CodaScopeCurationService } from "./codaScopeCurationService.js";
import { CodaScopeContentService, type DownloadResult } from "./codaScopeContentService.js";
import { buildBaseVars, loadCommandOrSkill } from "./codaScopeCommandLoader.js";
import type {
  ResearchPlan,
  ResearchUrl,
  BlockedDownload,
  EpicKnowledgeSource,
} from "../../src/apps/codascope/codaScopeTypes.js";

// ── Types ───────────────────────────────────────────────────────────

export interface ResearchOptions {
  projectId: string;
  epicId: string;
  modelId: string;
  topics: string[];
}

export interface ResearchSseCallbacks {
  sendEvent: (event: string, data: unknown) => void;
  sendMessage: (msg: unknown) => void;
  isAborted: () => boolean;
}

export interface ResearchServices {
  agentSvc: CodaScopeAgentService;
  projectSvc: CodaScopeProjectService;
  epicSvc: CodaScopeEpicService;
  epicKnowledgeSvc: CodaScopeEpicKnowledgeService;
  curationSvc: CodaScopeCurationService;
  contentSvc: CodaScopeContentService;
}

export interface ResearchReport {
  plan: ResearchPlan | null;
  downloads: { succeeded: number; blocked: number; failed: number };
  sourcesProcessed: number;
  epicWikiPagesCreated: string[];
  blockedUrls: BlockedDownload[];
}

interface DownloadReport {
  succeeded: { sourceId: string; url: string; contentType: string }[];
  blocked: { url: string; reason: string }[];
  failed: { url: string; error: string }[];
}

// ── Orchestrator ────────────────────────────────────────────────────

/**
 * Run the full research pipeline for an epic.
 *
 * Assumes:
 * - SSE headers have already been written
 * - The `research-started` event has been emitted by the route handler
 */
export async function runResearchPipeline(
  options: ResearchOptions,
  callbacks: ResearchSseCallbacks,
  services: ResearchServices,
): Promise<ResearchReport> {
  const { projectId, epicId, modelId, topics } = options;
  const { sendEvent, sendMessage, isAborted } = callbacks;
  const { agentSvc, projectSvc, epicSvc, epicKnowledgeSvc, curationSvc, contentSvc } = services;

  const report: ResearchReport = {
    plan: null,
    downloads: { succeeded: 0, blocked: 0, failed: 0 },
    sourcesProcessed: 0,
    epicWikiPagesCreated: [],
    blockedUrls: [],
  };

  try {
    // Ensure knowledge directory structure exists for this epic
    // (may not exist if epic pre-dates the knowledge feature)
    const projDir = projectSvc.getProjectDir(projectId);
    if (projDir) {
      epicKnowledgeSvc.initializeKnowledgeDir(
        epicKnowledgeSvc.getEpicDirForInit(projDir, epicId),
      );
    }

    // ── Phase 1: Generate Research Plan ──────────────────────────────

    sendEvent("research-step", { step: "generate-plan", status: "running", topics });

    const plan = await generateResearchPlan(
      { projectId, epicId, modelId, topics },
      { sendEvent, sendMessage, isAborted },
      { agentSvc, projectSvc, epicSvc, epicKnowledgeSvc },
    );

    if (isAborted()) {
      sendEvent("research-cancelled", {});
      return report;
    }

    report.plan = plan;

    sendEvent("research-plan-generated", {
      queryCount: plan?.queries.length ?? 0,
      urlCount: plan?.queries.reduce((sum, q) => sum + q.urls.length, 0) ?? 0,
    });

    if (!plan || plan.queries.length === 0) {
      sendEvent("research-complete", { ...report, message: "No research plan generated." });
      return report;
    }

    // Save the plan
    await epicKnowledgeSvc.updateResearchPlan(projectId, epicId, plan);

    // Add curation reason for research topics
    await curationSvc.addReason(projectId, epicId, {
      type: "research_topics_changed",
      at: new Date().toISOString(),
      detail: `Research plan created with ${plan.queries.length} queries covering topics: ${topics.join(", ")}`,
    });

    // ── Phase 2: Deterministic Downloads ────────────────────────────

    sendEvent("research-step", { step: "execute-downloads", status: "running" });

    const downloadReport = await executeDownloads(
      { projectId, epicId, plan },
      { sendEvent, isAborted },
      { epicKnowledgeSvc, contentSvc },
    );

    if (isAborted()) {
      sendEvent("research-cancelled", {});
      return report;
    }

    report.downloads = {
      succeeded: downloadReport.succeeded.length,
      blocked: downloadReport.blocked.length,
      failed: downloadReport.failed.length,
    };

    // Record blocked URLs
    for (const blocked of downloadReport.blocked) {
      report.blockedUrls.push(
        await epicKnowledgeSvc.addBlockedDownload(projectId, epicId, {
          url: blocked.url,
          reason: blocked.reason,
          attemptedAt: new Date().toISOString(),
          status: "blocked",
        }),
      );
    }

    // Update research plan with download statuses
    await updatePlanStatuses(epicKnowledgeSvc, projectId, epicId, plan, downloadReport);

    sendEvent("research-download-complete", {
      succeeded: downloadReport.succeeded.length,
      blocked: downloadReport.blocked.length,
      failed: downloadReport.failed.length,
    });

    // Add curation reason for new sources
    if (downloadReport.succeeded.length > 0) {
      await curationSvc.addReason(projectId, epicId, {
        type: "research_sources_added",
        at: new Date().toISOString(),
        detail: `Downloaded ${downloadReport.succeeded.length} research sources`,
      });
    }

    // ── Phase 3: Process Sources ────────────────────────────────────

    if (downloadReport.succeeded.length > 0) {
      sendEvent("research-step", { step: "process-sources", status: "running" });

      const sourceIds = downloadReport.succeeded.map((s) => s.sourceId);
      const processed = await processSources(
        { projectId, epicId, modelId, sourceIds },
        { sendEvent, sendMessage, isAborted },
        { agentSvc, projectSvc, epicSvc, epicKnowledgeSvc },
      );

      report.sourcesProcessed = processed.processedCount;
      report.epicWikiPagesCreated = processed.pagesCreated;
    }

    if (isAborted()) {
      sendEvent("research-cancelled", {});
      return report;
    }

    sendEvent("research-complete", report);
    return report;

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    sendEvent("research-error", { error: errorMsg });
    return report;
  }
}

// ── Phase 1: Generate Research Plan ─────────────────────────────────

async function generateResearchPlan(
  options: { projectId: string; epicId: string; modelId: string; topics: string[] },
  callbacks: Pick<ResearchSseCallbacks, "sendEvent" | "sendMessage" | "isAborted">,
  services: {
    agentSvc: CodaScopeAgentService;
    projectSvc: CodaScopeProjectService;
    epicSvc: CodaScopeEpicService;
    epicKnowledgeSvc: CodaScopeEpicKnowledgeService;
  },
): Promise<ResearchPlan | null> {
  const { projectId, epicId, modelId, topics } = options;
  const { sendEvent, sendMessage, isAborted } = callbacks;
  const { agentSvc, projectSvc, epicSvc, epicKnowledgeSvc } = services;

  const project = await projectSvc.getProject(projectId);
  if (!project) throw new Error("Project not found.");

  const projectDir = projectSvc.getProjectDir(projectId);
  if (!projectDir) throw new Error("Project directory not found.");

  const epicDetail = await epicSvc.getEpic(projectId, epicId);
  if (!epicDetail) throw new Error(`Epic "${epicId}" not found.`);

  // Epic wiki pages
  const epicWikiPages = await epicKnowledgeSvc.listEpicWikiPages(projectId, epicId);
  const epicWikiIndex = epicWikiPages.length > 0
    ? epicWikiPages.map((p) => `- ${p.title} (id: ${p.id}, words: ${p.wordCount})`).join("\n")
    : "_No epic wiki pages yet._";

  // Existing sources
  const sources = await epicKnowledgeSvc.listSources(projectId, epicId);
  const existingSources = sources.length > 0
    ? sources.map((s) => `- ${s.title} [${s.type}/${s.status}] (id: ${s.id})`).join("\n")
    : "_No existing sources._";

  // Scope
  const scope = epicDetail.scope;
  const scopeText = scope && scope.entries.length > 0
    ? scope.entries.map((e) => `- ${e.topicTitle} (${e.type}, target: ${e.targetDepth ?? "unknown"})`).join("\n")
    : "_No scope entries yet._";

  // Build prompt
  const repos = project.repositories ?? [];
  const vars = buildBaseVars({
    projectName: project.name,
    projectDir,
    repositories: repos,
  });
  vars.EPIC_TITLE = epicDetail.title;
  vars.EPIC_ID = epicId;
  vars.EPIC_DEFINITION = epicDetail.definition || "_No definition._";
  vars.EPIC_SCOPE = scopeText;
  vars.EPIC_WIKI_INDEX = epicWikiIndex;
  vars.EXISTING_SOURCES = existingSources;
  vars.RESEARCH_TOPICS = topics.join(", ");

  const prompt = loadCommandOrSkill("do_research_epic", projectDir, vars);
  if (!prompt) {
    throw new Error("Research command template (do_research_epic.md) not found.");
  }

  // Send to agent
  let fullResponse = "";

  await new Promise<void>((resolve, reject) => {
    agentSvc.send({
      projectId,
      message: prompt,
      modelId,
      systemPrompt:
        "You are CodaScope, an AI research agent. Search the web for relevant content " +
        "and build a structured research plan. Use the search_web tool to find sources. " +
        "Return the research plan as a JSON structure.",
      purpose: "research",
      onMessage: (msg) => {
        if (isAborted()) return;
        if (msg.type === "assistant" && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === "text") fullResponse += block.text;
          }
        }
        sendMessage(msg);
      },
      onDone: () => resolve(),
      onError: (err) => reject(err),
    });
  });

  // Try to parse research plan from agent response
  return parseResearchPlanFromResponse(fullResponse);
}

/**
 * Parse a research plan from the agent's response.
 * Looks for JSON within code blocks or inline.
 */
function parseResearchPlanFromResponse(response: string): ResearchPlan | null {
  // Try to find JSON in a code block
  const codeBlockMatch = response.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  const jsonCandidate = codeBlockMatch ? codeBlockMatch[1] : response;

  // Try to find any JSON object with "queries"
  const jsonMatch = jsonCandidate.match(/\{[\s\S]*"queries"[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const now = new Date().toISOString();

    // Validate and normalize structure
    if (!Array.isArray(parsed.queries)) return null;

    const plan: ResearchPlan = {
      queries: parsed.queries.map((q: Record<string, unknown>) => ({
        topic: String(q.topic ?? ""),
        query: String(q.query ?? ""),
        urls: Array.isArray(q.urls) ? q.urls.map((u: Record<string, unknown>) => ({
          url: String(u.url ?? ""),
          type: (u.type as ResearchUrl["type"]) ?? "documentation",
          relevance: String(u.relevance ?? ""),
          status: "pending" as const,
        })).filter((u: ResearchUrl) => u.url) : [],
      })).filter((q: { topic: string; urls: ResearchUrl[] }) => q.topic && q.urls.length > 0),
      createdAt: parsed.createdAt ?? now,
      updatedAt: now,
    };

    return plan.queries.length > 0 ? plan : null;
  } catch {
    return null;
  }
}

// ── Phase 2: Deterministic Downloads ────────────────────────────────

async function executeDownloads(
  options: {
    projectId: string;
    epicId: string;
    plan: ResearchPlan;
  },
  callbacks: Pick<ResearchSseCallbacks, "sendEvent" | "isAborted">,
  services: {
    epicKnowledgeSvc: CodaScopeEpicKnowledgeService;
    contentSvc: CodaScopeContentService;
  },
): Promise<DownloadReport> {
  const { projectId, epicId, plan } = options;
  const { sendEvent, isAborted } = callbacks;
  const { epicKnowledgeSvc, contentSvc } = services;

  const report: DownloadReport = {
    succeeded: [],
    blocked: [],
    failed: [],
  };

  // Collect all URLs from the plan
  const allUrls: { url: string; topic: string; type: ResearchUrl["type"]; relevance: string }[] = [];
  for (const query of plan.queries) {
    for (const urlEntry of query.urls) {
      if (urlEntry.status === "pending") {
        allUrls.push({
          url: urlEntry.url,
          topic: query.topic,
          type: urlEntry.type,
          relevance: urlEntry.relevance,
        });
      }
    }
  }

  const totalUrls = allUrls.length;
  let completedUrls = 0;

  for (const urlItem of allUrls) {
    if (isAborted()) break;

    completedUrls++;
    sendEvent("research-download-progress", {
      current: completedUrls,
      total: totalUrls,
      url: urlItem.url,
      topic: urlItem.topic,
    });

    // Create a source entry first (status: pending)
    const source = await epicKnowledgeSvc.addSource(projectId, epicId, {
      epicId,
      type: "machine",
      origin: "download",
      url: urlItem.url,
      filename: filenameFromUrl(urlItem.url),
      contentType: "application/octet-stream", // will be updated after download
      title: urlItem.relevance.slice(0, 100) || urlItem.url,
      status: "pending",
      addedAt: new Date().toISOString(),
      sizeBytesOriginal: 0,
      topicAssociations: [urlItem.topic],
    });

    // Download
    const sourceDir = await getSourceDir(epicKnowledgeSvc, projectId, epicId, source.id);
    const result: DownloadResult = await contentSvc.downloadUrl(urlItem.url, sourceDir);

    if (result.success && result.filePath) {
      // Extract content to markdown
      try {
        const markdown = await contentSvc.extractToMarkdown(result.filePath, result.contentType ?? "text/html");
        await epicKnowledgeSvc.storeExtractedMarkdown(projectId, epicId, source.id, markdown);

        await epicKnowledgeSvc.updateSourceStatus(projectId, epicId, source.id, "ready", {
          contentType: result.contentType ?? "application/octet-stream",
          sizeBytesOriginal: result.sizeBytes ?? 0,
        });

        report.succeeded.push({
          sourceId: source.id,
          url: urlItem.url,
          contentType: result.contentType ?? "unknown",
        });
      } catch (extractErr) {
        const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
        await epicKnowledgeSvc.updateSourceStatus(projectId, epicId, source.id, "error");
        report.failed.push({ url: urlItem.url, error: `Extraction failed: ${msg}` });
      }
    } else if (result.blocked) {
      // Delete the pending source entry — we'll track it as blocked instead
      await epicKnowledgeSvc.deleteSource(projectId, epicId, source.id);
      report.blocked.push({
        url: urlItem.url,
        reason: result.blockReason ?? "Unknown block reason",
      });
    } else {
      await epicKnowledgeSvc.updateSourceStatus(projectId, epicId, source.id, "error");
      report.failed.push({
        url: urlItem.url,
        error: result.error ?? "Unknown download error",
      });
    }
  }

  return report;
}

// ── Phase 3: Process Sources ────────────────────────────────────────

async function processSources(
  options: {
    projectId: string;
    epicId: string;
    modelId: string;
    sourceIds: string[];
  },
  callbacks: Pick<ResearchSseCallbacks, "sendEvent" | "sendMessage" | "isAborted">,
  services: {
    agentSvc: CodaScopeAgentService;
    projectSvc: CodaScopeProjectService;
    epicSvc: CodaScopeEpicService;
    epicKnowledgeSvc: CodaScopeEpicKnowledgeService;
  },
): Promise<{ processedCount: number; pagesCreated: string[] }> {
  const { projectId, epicId, modelId, sourceIds } = options;
  const { sendEvent, sendMessage, isAborted } = callbacks;
  const { agentSvc, projectSvc, epicSvc, epicKnowledgeSvc } = services;

  const project = await projectSvc.getProject(projectId);
  if (!project) throw new Error("Project not found.");

  const projectDir = projectSvc.getProjectDir(projectId);
  if (!projectDir) throw new Error("Project directory not found.");

  const epicDetail = await epicSvc.getEpic(projectId, epicId);
  if (!epicDetail) throw new Error(`Epic "${epicId}" not found.`);

  // Scope
  const scope = epicDetail.scope;
  const scopeText = scope && scope.entries.length > 0
    ? scope.entries.map((e) => `- ${e.topicTitle} (${e.type})`).join("\n")
    : "_No scope entries yet._";

  // Epic wiki pages
  const epicWikiPages = await epicKnowledgeSvc.listEpicWikiPages(projectId, epicId);
  const epicWikiIndex = epicWikiPages.length > 0
    ? epicWikiPages.map((p) => `- ${p.title} (id: ${p.id}, words: ${p.wordCount})`).join("\n")
    : "_No epic wiki pages yet._";

  let processedCount = 0;
  const pagesCreated: string[] = [];

  // Process each source individually
  for (const sourceId of sourceIds) {
    if (isAborted()) break;

    const source = await epicKnowledgeSvc.getSource(projectId, epicId, sourceId);
    if (!source || source.status !== "ready") continue;

    const content = await epicKnowledgeSvc.getSourceContent(projectId, epicId, sourceId);
    if (!content.markdown) continue;

    sendEvent("research-processing", {
      sourceId,
      sourceTitle: source.title,
      progress: `${processedCount + 1}/${sourceIds.length}`,
    });

    // Build prompt for this source
    const repos = project.repositories ?? [];
    const vars = buildBaseVars({
      projectName: project.name,
      projectDir,
      repositories: repos,
    });
    vars.EPIC_TITLE = epicDetail.title;
    vars.EPIC_ID = epicId;
    vars.SOURCE_ID = sourceId;
    vars.SOURCE_TITLE = source.title;
    vars.SOURCE_TYPE = `${source.type}/${source.origin}`;
    vars.TOPIC_ASSOCIATIONS = source.topicAssociations.join(", ") || "none specified";
    vars.SOURCE_CONTENT = truncateContent(content.markdown, 15_000); // ~15k chars max
    vars.EPIC_WIKI_INDEX = epicWikiIndex;
    vars.EPIC_SCOPE = scopeText;

    const prompt = loadCommandOrSkill("do_process_source", projectDir, vars);
    if (!prompt) {
      console.error("Process source command template (do_process_source.md) not found.");
      continue;
    }

    // Send to agent
    let responseText = "";

    try {
      await new Promise<void>((resolve, reject) => {
        agentSvc.send({
          projectId,
          message: prompt,
          modelId,
          systemPrompt:
            "You are CodaScope, an AI agent synthesizing research content. " +
            "Read the source content and create/update epic wiki pages. " +
            "Use the provided tools. Do NOT modify source code files.",
          purpose: "research",
          onMessage: (msg) => {
            if (isAborted()) return;
            if (msg.type === "assistant" && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === "text") responseText += block.text;
              }
            }
            sendMessage(msg);
          },
          onDone: () => resolve(),
          onError: (err) => reject(err),
        });
      });

      processedCount++;

      // Check for newly created pages
      const updatedPages = await epicKnowledgeSvc.listEpicWikiPages(projectId, epicId);
      for (const page of updatedPages) {
        if (!epicWikiPages.find((p) => p.id === page.id) && !pagesCreated.includes(page.id)) {
          pagesCreated.push(page.id);
        }
      }

      // Update the index for the next iteration
      epicWikiPages.push(...updatedPages.filter((p) => !epicWikiPages.find((ep) => ep.id === p.id)));
    } catch (err) {
      console.error(`Error processing source ${sourceId}:`, err);
      // Continue with next source
    }
  }

  return { processedCount, pagesCreated };
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Update research plan URL statuses based on download results.
 */
async function updatePlanStatuses(
  epicKnowledgeSvc: CodaScopeEpicKnowledgeService,
  projectId: string,
  epicId: string,
  plan: ResearchPlan,
  downloadReport: DownloadReport,
): Promise<void> {
  const succeededUrls = new Set(downloadReport.succeeded.map((s) => s.url));
  const blockedUrls = new Set(downloadReport.blocked.map((b) => b.url));

  for (const query of plan.queries) {
    for (const urlEntry of query.urls) {
      if (succeededUrls.has(urlEntry.url)) {
        urlEntry.status = "downloaded";
      } else if (blockedUrls.has(urlEntry.url)) {
        urlEntry.status = "blocked";
      } else if (downloadReport.failed.find((f) => f.url === urlEntry.url)) {
        urlEntry.status = "error";
      }
    }
  }

  plan.updatedAt = new Date().toISOString();
  await epicKnowledgeSvc.updateResearchPlan(projectId, epicId, plan);
}

/**
 * Extract a filename from a URL.
 */
function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const basename = path.basename(pathname);
    return basename || "index.html";
  } catch {
    return "unknown";
  }
}

/**
 * Get the filesystem path for a source directory.
 * Uses the knowledge service's internal path resolution.
 */
async function getSourceDir(
  epicKnowledgeSvc: CodaScopeEpicKnowledgeService,
  projectId: string,
  epicId: string,
  sourceId: string,
): Promise<string> {
  // The source directory is created by addSource, so we know it exists
  // We need to derive the path — the knowledge service stores sources at:
  // <epicDir>/knowledge/sources/<sourceId>/
  // Since we can't directly access the epicDir from here, we use the
  // storeOriginalFile method's path logic indirectly.
  // For now, we pass the sourceId and let downloadUrl write to a temp location,
  // then storeOriginalFile moves it to the right place.
  // Actually, the addSource method already creates the directory.
  // We just need the path. Let's derive it from the source metadata.
  const source = await epicKnowledgeSvc.getSource(projectId, epicId, sourceId);
  if (!source) throw new Error(`Source ${sourceId} not found.`);

  // The knowledge service creates source dirs at a predictable path.
  // We need to find it. The simplest approach: return a temp dir and use
  // storeOriginalFile after download. But downloadUrl writes directly.
  // Let's adjust: we'll download to a temp path and then store.
  // Actually, the download target dir is passed to downloadUrl.
  // We'll create a temporary download directory.
  const tmpDir = path.join(os.tmpdir(), `codascope-download-${sourceId}`);
  return tmpDir;
}

/**
 * Truncate content to a maximum character length, adding an ellipsis note.
 */
function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + "\n\n_[Content truncated — use read_research_source for full content]_";
}
