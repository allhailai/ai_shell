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
import { loadArtifactBuildPrompt, loadSectionRegenPrompt } from "../services/codaScopeCommandLoader.js";
import type { ArtifactSpec } from "../../src/apps/codascope/codaScopeTypes.js";

export function registerArtifactRoutes(ctx: CodaScopeRouteContext): void {
  const { app, httpError, ensureServices, wrap, param, principal } = ctx;

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

  // Create artifact
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { title } = req.body as {
      title?: string;
    };
    if (!title || typeof title !== "string" || !title.trim()) {
      throw httpError("title is required.", 400, "invalid_input");
    }
    const artifact = await artifactSvc.createArtifact(id, epicId, {
      title: title.trim(),
      createdBy: principal(req).username,
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

  // Update artifact
  app.put("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const { title } = req.body as {
      title?: string;
    };
    const artifact = await artifactSvc.updateArtifact(id, epicId, artId, {
      title,
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

  // Pin artifact
  app.patch("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/pin", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const pinned = await artifactSvc.pinArtifact(id, epicId, artId);
    if (!pinned) throw httpError("Artifact not found.", 404, "not_found");
    res.json({ success: true });
  }));

  // Unpin artifact
  app.patch("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/unpin", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const unpinned = await artifactSvc.unpinArtifact(id, epicId, artId);
    if (!unpinned) throw httpError("Artifact not found or not pinned.", 404, "not_found");
    res.json({ success: true });
  }));

  // Archive artifact
  app.patch("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/archive", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const archived = await artifactSvc.archiveArtifact(id, epicId, artId);
    if (!archived) throw httpError("Artifact not found.", 404, "not_found");
    res.json({ success: true });
  }));

  // Unarchive artifact
  app.patch("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/unarchive", wrap(async (req, res) => {
    const { artifactSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const unarchived = await artifactSvc.unarchiveArtifact(id, epicId, artId);
    if (!unarchived) throw httpError("Artifact not found or not archived.", 404, "not_found");
    res.json({ success: true });
  }));

  // ── Build ────────────────────────────────────────────────────────

  // Trigger artifact build (async — returns immediately, client polls SSE status)
  app.post("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/build", wrap(async (req, res) => {
    const { artifactSvc, artifactVersionSvc, agentSvc, epicSvc, epicKnowledgeSvc, designDocSvc, projectSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");
    const { modelId } = req.body as { modelId?: string };

    const artifact = await artifactSvc.getArtifact(id, epicId, artId);
    if (!artifact) throw httpError("Artifact not found.", 404, "not_found");

    // Load the assembled prompt with epic context
    const assembledPrompt = await loadArtifactBuildPrompt(id, epicId, artId, {
      epicSvc, epicKnowledgeSvc, designDocSvc, projectSvc, artifactSvc,
    });
    if (!assembledPrompt) throw httpError("Failed to load artifact build prompt.", 500, "prompt_load_failed");

    // Snapshot current build before overwriting (if exists)
    await artifactVersionSvc.snapshotCurrentBuild(id, epicId, artId);

    // Create agent callback that invokes the Cursor SDK agent
    const agentCallback = async (spec: ArtifactSpec): Promise<string> => {
      return new Promise<string>((resolve, reject) => {
        agentSvc.send({
          scope: { kind: "project", projectId: id },
          message: assembledPrompt,
          modelId: modelId ?? "default",
          purpose: "artifact-build",
          onMessage: () => {
            // Update build progress for SSE polling
            artifactSvc.setBuildProgress(id, epicId, artId, {
              artifactId: artId,
              status: "building",
              progress: "Agent generating HTML...",
            });
          },
          onDone: () => {
            // The HTML was written to disk by the write_artifact_html tool.
            // Read it back to return to buildArtifact() for section extraction.
            const html = artifactSvc.getBuiltHtml(id, epicId, artId);
            resolve(html ?? "");
          },
          onError: (err) => reject(err),
        }).catch(reject);
      });
    };

    // Fire build asynchronously — respond immediately so the client can poll status
    artifactSvc.buildArtifact(id, epicId, artId, modelId, agentCallback).catch((err) => {
      console.error(`[artifact-build] Build failed for ${artId}:`, err);
    });

    res.json({ status: "building", artifactId: artId });
  }));

  // SSE build status
  app.get("/api/codascope/projects/:id/epics/:epicId/artifacts/:artId/status", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const { artifactSvc } = await ensureServices();
      const id = param(req, "id");
      const epicId = param(req, "epicId");
      const artId = param(req, "artId");

      const artifact = await artifactSvc.getArtifact(id, epicId, artId);
      if (!artifact) throw httpError("Artifact not found.", 404, "not_found");

      // SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let aborted = false;
      res.on("close", () => { aborted = true; });

      // Poll build status every 500ms
      const poll = setInterval(() => {
        if (aborted) {
          clearInterval(poll);
          return;
        }
        try {
          const status = artifactSvc.getBuildStatus(id, epicId, artId);
          res.write(`data: ${JSON.stringify(status)}\n\n`);

          if (status.status === "complete" || status.status === "error" || status.status === "idle") {
            clearInterval(poll);
            if (!aborted) res.end();
          }
        } catch (err) {
          clearInterval(poll);
          if (!aborted) {
            res.write(`data: ${JSON.stringify({
              artifactId: artId,
              status: "error",
              error: err instanceof Error ? err.message : String(err),
            })}\n\n`);
            res.end();
          }
        }
      }, 500);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(poll);
        if (!aborted && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({
            artifactId: artId,
            status: "error",
            error: "Artifact build status stream timed out.",
          })}\n\n`);
          res.end();
        }
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
    const { artifactAnnotationSvc, artifactSvc, artifactVersionSvc, agentSvc, epicSvc, epicKnowledgeSvc, designDocSvc, projectSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const artId = param(req, "artId");

    const pendingBySection = await artifactAnnotationSvc.getPendingBySection(id, epicId, artId);
    if (pendingBySection.length === 0) {
      res.json({ applied: 0, sections: [] });
      return;
    }

    // Snapshot current build before regenerating (so user can revert)
    await artifactVersionSvc.snapshotCurrentBuild(id, epicId, artId);

    // Mark all pending as applied
    const allIds = pendingBySection.flatMap((g) => g.annotations.map((a) => a.id));
    await artifactAnnotationSvc.markApplied(id, epicId, artId, allIds);

    // Load the regen prompt with the affected sections + their annotations
    const regenPrompt = await loadSectionRegenPrompt(
      id, epicId, artId, pendingBySection,
      { epicSvc, epicKnowledgeSvc, designDocSvc, projectSvc, artifactSvc },
    );

    if (regenPrompt) {
      // Get artifact for model preference
      const artifact = await artifactSvc.getArtifact(id, epicId, artId);

      // Set build progress to "regenerating"
      artifactSvc.setBuildProgress(id, epicId, artId, {
        artifactId: artId,
        status: "regenerating",
        progress: `Regenerating ${pendingBySection.length} section(s)...`,
      });

      // Fire and forget — the SSE status endpoint will track progress
      agentSvc.send({
        scope: { kind: "project", projectId: id },
        message: regenPrompt,
        modelId: "default",
        purpose: "artifact-section-regen",
        onMessage: () => {
          artifactSvc.setBuildProgress(id, epicId, artId, {
            artifactId: artId,
            status: "regenerating",
            progress: "Agent regenerating sections...",
          });
        },
        onDone: () => {
          // Re-extract sections from the updated HTML
          const html = artifactSvc.getBuiltHtml(id, epicId, artId);
          if (html) {
            artifactSvc.reExtractSections(id, epicId, artId, html);
          }
          artifactSvc.setBuildProgress(id, epicId, artId, {
            artifactId: artId,
            status: "complete",
          });
        },
        onError: (err) => {
          console.error(`[artifact-regen] Section regeneration failed for ${artId}:`, err);
          artifactSvc.setBuildProgress(id, epicId, artId, {
            artifactId: artId,
            status: "error",
            error: err.message,
          });
        },
      }).catch((err) => {
        console.error(`[artifact-regen] Agent send failed for ${artId}:`, err);
      });
    }

    // Return immediately to client (async regeneration)
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
