/* ── CodaScope: Knowledge Routes ─────────────────────────────────────
   Knowledge sources, blocked downloads, epic wiki, research pipeline,
   and curation pipeline.
   ──────────────────────────────────────────────────────────────────── */

import {
  initSsePipeline,
  completeSsePipeline,
  failSsePipeline,
  handlePreStreamError,
} from "./utils/ssePipelineHelper.js";

import type { Request, Response } from "express";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import { runCurationPipeline } from "../services/codaScopeCurationOrchestrator.js";
import { runResearchPipeline } from "../services/codaScopeResearchOrchestrator.js";

export function registerKnowledgeRoutes(ctx: CodaScopeRouteContext): void {
  const { app, httpError, ensureServices, wrap, param, principal, upload, secretService } = ctx;

  // ── Knowledge Sources ─────────────────────────────────────────────

  // List sources for an epic
  app.get("/api/codascope/projects/:id/epics/:epicId/knowledge/sources", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const sources = await epicKnowledgeSvc.listSources(id, epicId);
    res.json({ sources });
  }));

  // Get a specific source (detail + content info)
  app.get("/api/codascope/projects/:id/epics/:epicId/knowledge/sources/:sourceId", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const sourceId = param(req, "sourceId");
    const source = await epicKnowledgeSvc.getSource(id, epicId, sourceId);
    if (!source) throw httpError("Source not found.", 404, "not_found");
    const content = await epicKnowledgeSvc.getSourceContent(id, epicId, sourceId);
    res.json({ source, hasMarkdown: !!content.markdown, hasOriginal: !!content.original });
  }));

  // Get source extracted markdown content
  app.get("/api/codascope/projects/:id/epics/:epicId/knowledge/sources/:sourceId/content", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const sourceId = param(req, "sourceId");
    const content = await epicKnowledgeSvc.getSourceContent(id, epicId, sourceId);
    if (!content.markdown) throw httpError("No extracted content available.", 404, "not_found");
    res.json({ markdown: content.markdown });
  }));

  // Download original source file
  app.get("/api/codascope/projects/:id/epics/:epicId/knowledge/sources/:sourceId/download", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const sourceId = param(req, "sourceId");
    const source = await epicKnowledgeSvc.getSource(id, epicId, sourceId);
    if (!source) throw httpError("Source not found.", 404, "not_found");
    const content = await epicKnowledgeSvc.getSourceContent(id, epicId, sourceId);
    if (!content.original) throw httpError("No original file available.", 404, "not_found");

    const filename = source.filename ?? `source-${sourceId}`;
    const contentType = source.contentType ?? "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(content.original);
  }));

  // Retry content extraction for a source that has an original file
  app.post("/api/codascope/projects/:id/epics/:epicId/knowledge/sources/:sourceId/retry-extract", wrap(async (req, res) => {
    const { epicKnowledgeSvc, contentSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const sourceId = param(req, "sourceId");
    const source = await epicKnowledgeSvc.getSource(id, epicId, sourceId);
    if (!source) throw httpError("Source not found.", 404, "not_found");
    const content = await epicKnowledgeSvc.getSourceContent(id, epicId, sourceId);
    if (!content.original) throw httpError("No original file to extract from.", 400, "no_original");

    // Write original to temp file for extraction
    const ext = path.extname(source.filename ?? "").replace(/^\./, "") || "bin";
    const tmpPath = path.join(os.tmpdir(), `codascope-retry-${crypto.randomBytes(4).toString("hex")}.${ext}`);
    const { writeFileSync: wfs, unlinkSync } = await import("node:fs");
    wfs(tmpPath, content.original);

    try {
      const markdown = await contentSvc.extractToMarkdown(tmpPath, source.contentType ?? "application/octet-stream");
      await epicKnowledgeSvc.storeExtractedMarkdown(id, epicId, sourceId, markdown);
      await epicKnowledgeSvc.updateSourceStatus(id, epicId, sourceId, "ready");
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      res.json({ success: true, sizeBytesMarkdown: Buffer.byteLength(markdown, "utf-8") });
    } catch (err) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      throw httpError(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`, 500, "extraction_failed");
    }
  }));

  // Add source via file upload (multipart/form-data)
  app.post("/api/codascope/projects/:id/epics/:epicId/knowledge/sources", upload.single("file"), wrap(async (req, res) => {
    const { epicKnowledgeSvc, curationSvc, contentSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");

    // Support both multipart upload and JSON-only metadata
    const file = (req as Request & { file?: Express.Multer.File }).file;

    // Validate: either a file or at least a title must be provided
    if (!file && (!req.body.title || typeof req.body.title !== "string" || !req.body.title.trim())) {
      throw httpError("A file upload or a non-empty title is required.", 400, "invalid_input");
    }

    const title = (req.body.title as string) ?? file?.originalname ?? "Untitled";

    // Validate topicAssociations if present
    let topicAssociations: string[] = [];
    if (req.body.topicAssociations) {
      try {
        topicAssociations = typeof req.body.topicAssociations === "string"
          ? JSON.parse(req.body.topicAssociations)
          : req.body.topicAssociations;
        if (!Array.isArray(topicAssociations)) {
          throw httpError("topicAssociations must be an array of strings.", 400, "invalid_input");
        }
      } catch (e) {
        if (e instanceof Error && "statusCode" in e) throw e; // re-throw httpError
        throw httpError("topicAssociations must be a valid JSON array.", 400, "invalid_input");
      }
    }

    // Create source entry
    const source = await epicKnowledgeSvc.addSource(id, epicId, {
      epicId,
      type: "human",
      origin: "upload",
      url: (req.body.url as string) ?? undefined,
      filename: file?.originalname ?? (req.body.filename as string) ?? "unknown",
      contentType: file?.mimetype ?? (req.body.contentType as string) ?? "application/octet-stream",
      title,
      status: file ? "processing" : "pending",
      addedAt: new Date().toISOString(),
      sizeBytesOriginal: file?.size ?? 0,
      topicAssociations,
    });

    // If a file was uploaded, store and extract
    if (file) {
      try {
        const ext = path.extname(file.originalname).replace(/^\./, "") || "bin";
        await epicKnowledgeSvc.storeOriginalFile(id, epicId, source.id, file.buffer, ext);

        // Extract content to markdown — write to temp file first
        const tmpPath = path.join(os.tmpdir(), `codascope-extract-${crypto.randomBytes(4).toString("hex")}.${ext}`);
        const { writeFileSync: wfs } = await import("node:fs");
        wfs(tmpPath, file.buffer);
        const markdown = await contentSvc.extractToMarkdown(tmpPath, file.mimetype);

        await epicKnowledgeSvc.storeExtractedMarkdown(id, epicId, source.id, markdown);
        await epicKnowledgeSvc.updateSourceStatus(id, epicId, source.id, "ready");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Source extraction failed for ${source.id}: ${msg}`);
        await epicKnowledgeSvc.updateSourceStatus(id, epicId, source.id, "error");
      }

      // Add curation reason
      await curationSvc.addReason(id, epicId, {
        type: "human_content_added",
        at: new Date().toISOString(),
        detail: `Human uploaded content: "${title}"`,
      });
    }

    res.status(201).json({ source });
  }));

  // Delete source
  app.delete("/api/codascope/projects/:id/epics/:epicId/knowledge/sources/:sourceId", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const sourceId = param(req, "sourceId");
    const deleted = await epicKnowledgeSvc.deleteSource(id, epicId, sourceId);
    if (!deleted) throw httpError("Source not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // ── Blocked Downloads ─────────────────────────────────────────────

  // List blocked downloads
  app.get("/api/codascope/projects/:id/epics/:epicId/knowledge/blocked", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const includeDismissed = req.query.includeDismissed === "true";
    const items = await epicKnowledgeSvc.listBlockedDownloads(id, epicId, includeDismissed);
    res.json({ items });
  }));

  // Dismiss or update a blocked download
  app.patch("/api/codascope/projects/:id/epics/:epicId/knowledge/blocked/:blockId", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const blockId = param(req, "blockId");
    const { action } = req.body as { action?: string };
    if (action === "dismiss") {
      await epicKnowledgeSvc.dismissBlockedDownload(id, epicId, blockId);
      res.json({ dismissed: true });
    } else {
      throw httpError("Invalid action. Use 'dismiss'.", 400, "invalid_input");
    }
  }));

  // Resolve a blocked download by uploading the content
  app.post("/api/codascope/projects/:id/epics/:epicId/knowledge/blocked/:blockId/resolve", upload.single("file"), wrap(async (req, res) => {
    const { epicKnowledgeSvc, curationSvc, contentSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const blockId = param(req, "blockId");

    const file = (req as Request & { file?: Express.Multer.File }).file;

    // Support both file upload and sourceId reference
    if (file) {
      const title = (req.body.title as string) ?? file.originalname ?? "Resolved content";

      // Create a new source from the uploaded file
      const source = await epicKnowledgeSvc.addSource(id, epicId, {
        epicId,
        type: "human",
        origin: "human-resolved",
        filename: file.originalname,
        contentType: file.mimetype,
        title,
        status: "processing",
        addedAt: new Date().toISOString(),
        sizeBytesOriginal: file.size,
        topicAssociations: [],
      });

      // Store original file
      const ext = path.extname(file.originalname).replace(/^\./, "") || "bin";
      await epicKnowledgeSvc.storeOriginalFile(id, epicId, source.id, file.buffer, ext);

      // Extract content
      try {
        const tmpPath = path.join(os.tmpdir(), `codascope-resolve-${crypto.randomBytes(4).toString("hex")}.${ext}`);
        const { writeFileSync: wfs } = await import("node:fs");
        wfs(tmpPath, file.buffer);
        const markdown = await contentSvc.extractToMarkdown(tmpPath, file.mimetype);
        await epicKnowledgeSvc.storeExtractedMarkdown(id, epicId, source.id, markdown);
        await epicKnowledgeSvc.updateSourceStatus(id, epicId, source.id, "ready");
      } catch {
        await epicKnowledgeSvc.updateSourceStatus(id, epicId, source.id, "error");
      }

      // Mark blocked download as resolved
      await epicKnowledgeSvc.resolveBlockedDownload(id, epicId, blockId, source.id);

      // Add curation reason
      await curationSvc.addReason(id, epicId, {
        type: "blocked_download_resolved",
        at: new Date().toISOString(),
        detail: `Blocked download resolved with uploaded content: "${title}"`,
      });

      res.json({ resolved: true, sourceId: source.id });
    } else {
      // Fallback: accept sourceId in body (for linking an existing source)
      const { sourceId } = req.body as { sourceId?: string };
      if (!sourceId) throw httpError("Either a file upload or sourceId is required.", 400, "invalid_input");
      await epicKnowledgeSvc.resolveBlockedDownload(id, epicId, blockId, sourceId);

      // Add curation reason
      await curationSvc.addReason(id, epicId, {
        type: "blocked_download_resolved",
        at: new Date().toISOString(),
        detail: `Blocked download resolved with existing source: ${sourceId}`,
      });

      res.json({ resolved: true });
    }
  }));

  // ── Epic Wiki (Research Synthesis) ────────────────────────────────

  // List epic wiki pages
  app.get("/api/codascope/projects/:id/epics/:epicId/knowledge/wiki", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const pages = await epicKnowledgeSvc.listEpicWikiPages(id, epicId);
    res.json({ pages });
  }));

  // Read an epic wiki page
  app.get("/api/codascope/projects/:id/epics/:epicId/knowledge/wiki/:pageId", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const pageId = param(req, "pageId");
    const content = await epicKnowledgeSvc.readEpicWikiPage(id, epicId, pageId);
    if (content === null) throw httpError("Epic wiki page not found.", 404, "not_found");
    res.json({ pageId, content });
  }));

  // Download an epic wiki page as markdown file
  app.get("/api/codascope/projects/:id/epics/:epicId/knowledge/wiki/:pageId/download", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const pageId = param(req, "pageId");
    const content = await epicKnowledgeSvc.readEpicWikiPage(id, epicId, pageId);
    if (content === null) throw httpError("Epic wiki page not found.", 404, "not_found");
    const filename = `${pageId}.md`;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(content);
  }));

  // Create or update an epic wiki page
  app.put("/api/codascope/projects/:id/epics/:epicId/knowledge/wiki/:pageId", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const pageId = param(req, "pageId");
    const { title, content, sourceRefs } = req.body as { title?: string; content?: string; sourceRefs?: string[] };
    if (!title || content === undefined) throw httpError("title and content are required.", 400, "invalid_input");
    const page = await epicKnowledgeSvc.writeEpicWikiPage(id, epicId, pageId, title, content, sourceRefs);
    res.json({ page });
  }));

  // Delete an epic wiki page
  app.delete("/api/codascope/projects/:id/epics/:epicId/knowledge/wiki/:pageId", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const pageId = param(req, "pageId");
    const deleted = await epicKnowledgeSvc.deleteEpicWikiPage(id, epicId, pageId);
    if (!deleted) throw httpError("Epic wiki page not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // ── Research Plan ─────────────────────────────────────────────────

  // Get research plan
  app.get("/api/codascope/projects/:id/epics/:epicId/knowledge/research-plan", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const plan = await epicKnowledgeSvc.getResearchPlan(id, epicId);
    res.json({ plan });
  }));

  // Update research plan
  app.put("/api/codascope/projects/:id/epics/:epicId/knowledge/research-plan", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { plan } = req.body as { plan?: any };
    if (!plan) throw httpError("plan is required.", 400, "invalid_input");
    await epicKnowledgeSvc.updateResearchPlan(id, epicId, plan);
    res.json({ saved: true });
  }));

  // ── Research Query Log ────────────────────────────────────────────

  // List research query log entries
  app.get("/api/codascope/projects/:id/epics/:epicId/knowledge/research-log", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const entries = await epicKnowledgeSvc.listResearchLogEntries(id, epicId);
    res.json({ entries });
  }));

  // Delete a research query log entry
  app.delete("/api/codascope/projects/:id/epics/:epicId/knowledge/research-log/:entryId", wrap(async (req, res) => {
    const { epicKnowledgeSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const entryId = param(req, "entryId");
    const deleted = await epicKnowledgeSvc.deleteResearchLogEntry(id, epicId, entryId);
    if (!deleted) throw httpError("Research log entry not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // ── Research Pipeline (SSE streaming with BuildState tracking) ─────

  app.post("/api/codascope/projects/:id/epics/:epicId/knowledge/research", async (req, res) => {
    try {
      const svcs = await ensureServices();
      const { buildSvc, projectSvc } = svcs;
      const id = param(req, "id");
      const epicId = param(req, "epicId");
      const actorId = principal(req).username;
      const { modelId, topics, parentQueryId } = req.body as { modelId?: string; topics?: string[]; parentQueryId?: string };

      if (!modelId) throw httpError("modelId is required.", 400, "invalid_input");
      if (!topics || topics.length === 0) throw httpError("topics array is required.", 400, "invalid_input");

      const scope = `research::${epicId}`;
      const pipeline = initSsePipeline(req, res, {
        projectId: id,
        scope,
        buildType: "research",
        modelId,
        buildSvc,
        projectDir: projectSvc.getProjectDir(id) ?? undefined,
      });
      if (!pipeline) return; // 409 already sent

      const { runId, callbacks } = pipeline;
      const { isAborted } = callbacks;

      // Wrap sendEvent to forward research events to build pipeline steps
      const sendEvent = (event: string, data: unknown) => {
        if (event === "research-step" || event === "research-plan-generated" || event === "research-download-complete") {
          const stepData = data as Record<string, unknown>;
          buildSvc.addPipelineStep(id, runId, {
            step: (stepData.step as string) ?? event,
            status: event === "research-step" ? "running" : "complete",
            progress: (stepData.progress as string) ?? (stepData.queryCount ? `${stepData.queryCount} queries, ${stepData.urlCount} URLs` : undefined),
          }, scope);
        }
        callbacks.sendEvent(event, data);
      };

      sendEvent("research-started", { projectId: id, epicId, modelId, topics, runId });

      try {
        await runResearchPipeline(
          { projectId: id, epicId, modelId, topics, parentQueryId, actorId },
          { sendEvent, sendMessage: callbacks.sendMessage, isAborted },
          {
            agentSvc: svcs.agentSvc,
            projectSvc: svcs.projectSvc,
            epicSvc: svcs.epicSvc,
            epicKnowledgeSvc: svcs.epicKnowledgeSvc,
            curationSvc: svcs.curationSvc,
            contentSvc: svcs.contentSvc,
            secretSvc: secretService,
          },
        );

        completeSsePipeline(res, { projectId: id, scope, buildSvc }, runId, callbacks);
      } catch (err) {
        failSsePipeline(res, { projectId: id, scope, buildSvc }, runId, err, callbacks);
      }
    } catch (err) {
      handlePreStreamError(res, err);
    }
  });

  // ── Curation ──────────────────────────────────────────────────────

  // Get curation reasons
  app.get("/api/codascope/projects/:id/epics/:epicId/curation/reasons", wrap(async (req, res) => {
    const { curationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const reasons = await curationSvc.getReasons(id, epicId);
    res.json({ reasons });
  }));

  // Trigger curation run (SSE streaming pipeline with BuildState tracking)
  app.post("/api/codascope/projects/:id/epics/:epicId/curation/run", async (req, res) => {
    try {
      const svcs = await ensureServices();
      const { buildSvc, projectSvc } = svcs;
      const id = param(req, "id");
      const epicId = param(req, "epicId");
      const actorId = principal(req).username;
      const { modelId } = req.body as { modelId?: string };

      if (!modelId) throw httpError("modelId is required.", 400, "invalid_input");

      const scope = `curation::${epicId}`;
      const pipeline = initSsePipeline(req, res, {
        projectId: id,
        scope,
        buildType: "curation",
        modelId,
        buildSvc,
        projectDir: projectSvc.getProjectDir(id) ?? undefined,
      });
      if (!pipeline) return; // 409 already sent

      const { runId, callbacks } = pipeline;
      const { sendEvent, sendMessage, isAborted } = callbacks;

      sendEvent("run-started", { projectId: id, epicId, modelId, runId });

      try {
        await runCurationPipeline(
          { projectId: id, epicId, modelId, actorId },
          { sendEvent, sendMessage, isAborted },
          {
            agentSvc: svcs.agentSvc,
            projectSvc: svcs.projectSvc,
            wikiSvc: svcs.wikiSvc,
            epicSvc: svcs.epicSvc,
            epicKnowledgeSvc: svcs.epicKnowledgeSvc,
            curationSvc: svcs.curationSvc,
            codeMapSvc: svcs.codeMapSvc,
          },
        );

        completeSsePipeline(res, { projectId: id, scope, buildSvc }, runId, callbacks);
      } catch (err) {
        failSsePipeline(res, { projectId: id, scope, buildSvc }, runId, err, callbacks);
      }
    } catch (err) {
      handlePreStreamError(res, err);
    }
  });

  // List curation logs
  app.get("/api/codascope/projects/:id/epics/:epicId/curation/logs", wrap(async (req, res) => {
    const { curationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const logs = await curationSvc.listLogs(id, epicId);
    res.json({ logs });
  }));

  // Get a specific curation log
  app.get("/api/codascope/projects/:id/epics/:epicId/curation/logs/:logId", wrap(async (req, res) => {
    const { curationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const logId = param(req, "logId");
    const log = await curationSvc.getLog(id, epicId, logId);
    if (!log) throw httpError("Curation log not found.", 404, "not_found");
    res.json({ log });
  }));
}
