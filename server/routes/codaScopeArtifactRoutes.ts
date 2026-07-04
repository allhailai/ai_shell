/* ── CodaScope: Artifact Routes ──────────────────────────────────────
   REST API endpoints for visual HTML artifacts.

   Domains:
   - Artifact CRUD  (create, read, update, delete, list)
   - Build pipeline  (trigger build, SSE status)
   - Preview         (serve HTML with annotation script injection)
   - Sections        (list, add, hide, unhide, reorder)
   - Annotations     (list, add, update, delete, toggle, batch-apply, retry)
   - Versions        (list, revert, revert-to-latest)
   ──────────────────────────────────────────────────────────────────── */

import type { Request, Response, NextFunction } from "express";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";

export function registerArtifactRoutes(ctx: CodaScopeRouteContext): void {
  const { app, httpError, ensureServices, wrap, param } = ctx;

  // ── Artifact CRUD ────────────────────────────────────────────────

  // List all artifacts for a project (optionally filtered by query param epicId)
  app.get("/api/codascope/projects/:id/artifacts", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = req.query.epicId as string | undefined;
    if (epicId) {
      const artifacts = await artifactSvc.listArtifacts(id, epicId);
      res.json({ artifacts });
    } else {
      // Return empty list — project-level listing not yet implemented
      res.json({ artifacts: [] });
    }
  }));

  // List artifacts for a specific epic
  app.get("/api/codascope/projects/:id/epics/:epicId/artifacts", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artifacts = await artifactSvc.listArtifacts(id, epicId);
    res.json({ artifacts });
  }));

  // Create artifact spec
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { title, body, modelId, sources, autoDiscoverContext, createdBy } = req.body as {
      title?: string;
      body?: string;
      modelId?: string | null;
      sources?: string[];
      autoDiscoverContext?: boolean;
      createdBy?: string;
    };
    if (!title || typeof title !== "string" || !title.trim()) {
      throw httpError("title is required.", 400, "invalid_input");
    }
    const artifact = await artifactSvc.createArtifact(id, epicId, {
      title: title.trim(),
      body,
      modelId,
      sources,
      autoDiscoverContext,
      createdBy,
    });
    res.status(201).json({ artifact });
  }));

  // Get artifact detail
  app.get("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const artifact = await artifactSvc.getArtifact(id, epicId, artId);
    if (!artifact) throw httpError("Artifact not found.", 404, "not_found");
    res.json({ artifact });
  }));

  // Update artifact spec
  app.put("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const { title, body, modelId, sources, autoDiscoverContext } = req.body as {
      title?: string;
      body?: string;
      modelId?: string | null;
      sources?: string[];
      autoDiscoverContext?: boolean;
    };
    const artifact = await artifactSvc.updateArtifact(id, epicId, artId, {
      title,
      body,
      modelId,
      sources,
      autoDiscoverContext,
    });
    if (!artifact) throw httpError("Artifact not found.", 404, "not_found");
    res.json({ artifact });
  }));

  // Delete artifact
  app.delete("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const deleted = await artifactSvc.deleteArtifact(id, epicId, artId);
    if (!deleted) throw httpError("Artifact not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // ── Build ────────────────────────────────────────────────────────

  // Trigger artifact build (async — returns immediately, client polls status)
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/build", wrap(async (req, res) => {
    const { artifactSvc, artifactVersionSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const { modelId } = req.body as { modelId?: string };

    const artifact = await artifactSvc.getArtifact(id, epicId, artId);
    if (!artifact) throw httpError("Artifact not found.", 404, "not_found");

    // Snapshot current build before overwriting (if exists)
    await artifactVersionSvc.snapshotCurrentBuild(id, epicId, artId);

    // Trigger build asynchronously — the actual agent wiring will be provided
    // by the calling context. For now, return a build-started response so the
    // frontend can poll status via the SSE endpoint.
    // NOTE: The actual build invocation happens when the agent service
    // integration is fully wired. This route sets the build in-progress state.
    try {
      await artifactSvc.buildArtifact(id, epicId, artId, modelId);
      res.json({ status: "complete", artifactId: artId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "Agent service not configured") {
        res.status(503).json({ error: "Agent service not yet configured for artifact builds.", code: "agent_not_configured" });
        return;
      }
      throw err;
    }
  }));

  // SSE build status
  app.get("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/status", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const { artifactSvc } = await ensureServices();
      const id = param(req, "id");
      const epicId = param(req, "epicId");
      const artId = param(req, "artId");

      // SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let aborted = false;
      req.on("close", () => { aborted = true; });

      // Poll build status every 500ms
      const poll = setInterval(() => {
        if (aborted) {
          clearInterval(poll);
          return;
        }
        const status = artifactSvc.getBuildStatus(id, epicId, artId);
        res.write(`data: ${JSON.stringify(status)}\n\n`);

        if (status.status === "complete" || status.status === "error" || status.status === "idle") {
          clearInterval(poll);
          if (!aborted) res.end();
        }
      }, 500);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(poll);
        if (!aborted) res.end();
      }, 5 * 60 * 1000);
    })().catch(next);
  });

  // ── Preview ──────────────────────────────────────────────────────

  // Serve preview HTML with annotation script injection
  app.get("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/preview", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");

    const html = await artifactSvc.getPreviewHtml(id, epicId, artId);
    if (!html) throw httpError("No built version available. Build the artifact first.", 404, "not_found");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  }));

  // ── Sections ─────────────────────────────────────────────────────

  // List sections
  app.get("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/sections", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const sections = await artifactSvc.extractSections(id, epicId, artId);
    res.json(sections);
  }));

  // Add section (creates a draft add_section annotation)
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/sections", wrap(async (req, res) => {
    const { artifactAnnotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const { title, instruction, afterSectionId } = req.body as {
      title?: string;
      instruction?: string;
      afterSectionId?: string | null;
    };
    if (!title || typeof title !== "string" || !title.trim()) {
      throw httpError("title is required.", 400, "invalid_input");
    }
    // Create an add_section annotation that the regeneration pipeline will process
    const annotation = await artifactAnnotationSvc.addAnnotation(id, epicId, artId, {
      sectionId: "__new__",
      sectionTitle: title.trim(),
      instruction: instruction ?? `Add a new section titled "${title.trim()}"`,
      type: "add_section",
      afterSectionId: afterSectionId ?? null,
    });
    res.status(201).json({ annotation });
  }));

  // Hide section
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/sections/:sid/hide", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const sid = param(req, "sid");
    const result = await artifactSvc.hideSection(id, epicId, artId, sid);
    res.json(result);
  }));

  // Unhide section
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/sections/:sid/unhide", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const sid = param(req, "sid");
    const result = await artifactSvc.unhideSection(id, epicId, artId, sid);
    res.json(result);
  }));

  // Reorder sections
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/sections/reorder", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const { orderedSectionIds } = req.body as { orderedSectionIds?: string[] };
    if (!orderedSectionIds || !Array.isArray(orderedSectionIds)) {
      throw httpError("orderedSectionIds array is required.", 400, "invalid_input");
    }
    const result = await artifactSvc.reorderSections(id, epicId, artId, orderedSectionIds);
    res.json(result);
  }));

  // ── Annotations ──────────────────────────────────────────────────

  // List annotations
  app.get("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/annotations", wrap(async (req, res) => {
    const { artifactAnnotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const annotations = await artifactAnnotationSvc.listAnnotations(id, epicId, artId);
    res.json({ annotations });
  }));

  // Add annotation
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/annotations", wrap(async (req, res) => {
    const { artifactAnnotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const { sectionId, sectionTitle, instruction, elementContext, type, afterSectionId } = req.body as {
      sectionId?: string;
      sectionTitle?: string;
      instruction?: string;
      elementContext?: { elementTag: string; elementId?: string; cssPath?: string; elementText?: string; elementHTML?: string } | null;
      type?: "modify" | "add_section";
      afterSectionId?: string | null;
    };
    if (!sectionId || !instruction) {
      throw httpError("sectionId and instruction are required.", 400, "invalid_input");
    }
    const annotation = await artifactAnnotationSvc.addAnnotation(id, epicId, artId, {
      sectionId,
      sectionTitle: sectionTitle ?? sectionId,
      instruction,
      elementContext: elementContext ?? null,
      type,
      afterSectionId,
    });
    res.status(201).json({ annotation });
  }));

  // Update annotation
  app.put("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/annotations/:annId", wrap(async (req, res) => {
    const { artifactAnnotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const annId = param(req, "annId");
    const { instruction, elementContext } = req.body as {
      instruction?: string;
      elementContext?: { elementTag: string; elementId?: string; cssPath?: string; elementText?: string; elementHTML?: string } | null;
    };
    const annotation = await artifactAnnotationSvc.updateAnnotation(id, epicId, artId, annId, {
      instruction,
      elementContext,
    });
    if (!annotation) throw httpError("Annotation not found.", 404, "not_found");
    res.json({ annotation });
  }));

  // Delete annotation
  app.delete("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/annotations/:annId", wrap(async (req, res) => {
    const { artifactAnnotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const annId = param(req, "annId");
    const deleted = await artifactAnnotationSvc.deleteAnnotation(id, epicId, artId, annId);
    if (!deleted) throw httpError("Annotation not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // Toggle annotation status
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/annotations/:annId/toggle", wrap(async (req, res) => {
    const { artifactAnnotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const annId = param(req, "annId");
    const annotation = await artifactAnnotationSvc.toggleAnnotation(id, epicId, artId, annId);
    if (!annotation) throw httpError("Annotation not found.", 404, "not_found");
    res.json({ annotation });
  }));

  // Batch apply pending annotations (triggers section regeneration)
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/annotations/apply", wrap(async (req, res) => {
    const { artifactAnnotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");

    const pendingBySection = await artifactAnnotationSvc.getPendingBySection(id, epicId, artId);
    if (pendingBySection.length === 0) {
      res.json({ applied: 0, sections: [] });
      return;
    }

    // For now, return the grouped annotations — the actual regeneration
    // will be invoked when the agent service is fully wired in Phase 2/3.
    // Mark all pending as applied (the frontend will trigger the regen via
    // the agent service).
    const allIds = pendingBySection.flatMap((g) => g.annotations.map((a) => a.id));
    await artifactAnnotationSvc.markApplied(id, epicId, artId, allIds);

    res.json({
      applied: allIds.length,
      sections: pendingBySection.map((g) => ({
        sectionId: g.sectionId,
        annotationCount: g.annotations.length,
      })),
    });
  }));

  // Retry failed annotations
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/annotations/retry", wrap(async (req, res) => {
    const { artifactAnnotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const count = await artifactAnnotationSvc.retryFailed(id, epicId, artId);
    res.json({ retriedCount: count });
  }));

  // ── Versions ─────────────────────────────────────────────────────

  // List build versions
  app.get("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/versions", wrap(async (req, res) => {
    const { artifactVersionSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const versions = await artifactVersionSvc.listVersions(id, epicId, artId);
    res.json({ versions });
  }));

  // Revert to a specific version
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/versions/:dir/revert", wrap(async (req, res) => {
    const { artifactVersionSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const dir = param(req, "dir");
    const reverted = await artifactVersionSvc.revertToVersion(id, epicId, artId, dir);
    if (!reverted) throw httpError("Version not found.", 404, "not_found");
    res.json({ reverted: true });
  }));

  // Revert to latest version
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/versions/latest/revert", wrap(async (req, res) => {
    const { artifactVersionSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const reverted = await artifactVersionSvc.revertToLatest(id, epicId, artId);
    if (!reverted) throw httpError("No versions available.", 404, "not_found");
    res.json({ reverted: true });
  }));
}
