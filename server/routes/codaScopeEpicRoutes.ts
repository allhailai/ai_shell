/* ── CodaScope: Epic Routes ──────────────────────────────────────────
   Epic CRUD, scope management, deepen, design docs, versions,
   rendering, brief, epic conversation, and lock heartbeat.
   ──────────────────────────────────────────────────────────────────── */

import type { Request, Response, NextFunction } from "express";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import {
  initSsePipeline,
  completeSsePipeline,
  failSsePipeline,
  handlePreStreamError,
} from "./utils/ssePipelineHelper.js";

export function registerEpicRoutes(ctx: CodaScopeRouteContext): void {
  const { app, httpError, ensureServices, wrap, param, upload } = ctx;

  // ── Epics — CRUD ──────────────────────────────────────────────────

  // List epics for a project
  app.get("/api/codascope/projects/:id/epics", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epics = await epicSvc.listEpics(id);
    res.json({ epics });
  }));

  // Create epic
  app.post("/api/codascope/projects/:id/epics", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const { title, createdBy } = req.body as { title?: string; createdBy?: string };
    if (!title || typeof title !== "string" || !title.trim()) {
      throw httpError("title is required.", 400, "invalid_input");
    }
    const epic = await epicSvc.createEpic(id, { title: title.trim(), createdBy });
    res.status(201).json({ epic });
  }));

  // Get full epic detail
  app.get("/api/codascope/projects/:id/epics/:epicId", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const epic = await epicSvc.getEpic(id, epicId);
    if (!epic) throw httpError("Epic not found.", 404, "not_found");
    res.json({ epic });
  }));

  // Update epic metadata
  app.patch("/api/codascope/projects/:id/epics/:epicId", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { title, status, collaborators } = req.body as {
      title?: string; status?: string; collaborators?: string[];
    };
    const epic = await epicSvc.updateEpic(id, epicId, { title, status: status as any, collaborators });
    if (!epic) throw httpError("Epic not found.", 404, "not_found");
    res.json({ epic });
  }));

  // Delete epic
  app.delete("/api/codascope/projects/:id/epics/:epicId", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const deleted = await epicSvc.deleteEpic(id, epicId);
    if (!deleted) throw httpError("Epic not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // Get definition markdown
  app.get("/api/codascope/projects/:id/epics/:epicId/definition", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const definition = await epicSvc.getDefinition(id, epicId);
    if (definition === null) throw httpError("Epic not found.", 404, "not_found");
    res.json({ definition });
  }));

  // Update definition markdown
  app.put("/api/codascope/projects/:id/epics/:epicId/definition", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { content } = req.body as { content?: string };
    if (content === undefined) throw httpError("content is required.", 400, "invalid_input");
    const updated = await epicSvc.updateDefinition(id, epicId, content);
    if (!updated) throw httpError("Epic not found.", 404, "not_found");
    res.json({ saved: true });
  }));

  // Download definition as markdown file
  app.get("/api/codascope/projects/:id/epics/:epicId/definition/download", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const definition = await epicSvc.getDefinition(id, epicId);
    if (definition === null) throw httpError("Epic not found.", 404, "not_found");
    const epic = await epicSvc.getEpic(id, epicId);
    const slug = (epic?.title ?? epicId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const filename = `${slug}-definition.md`;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(definition);
  }));

  // Acquire edit lock
  app.post("/api/codascope/projects/:id/epics/:epicId/lock", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { documentId, lockedBy } = req.body as { documentId?: string; lockedBy?: string };
    if (!documentId) throw httpError("documentId is required.", 400, "invalid_input");
    const result = await epicSvc.acquireLock(id, epicId, {
      documentId,
      lockedBy: lockedBy ?? "user",
    });
    if ("error" in result) {
      res.status(409).json(result);
      return;
    }
    res.json({ lock: result });
  }));

  // Release edit lock
  app.delete("/api/codascope/projects/:id/epics/:epicId/lock", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const documentId = req.query.documentId as string ?? "definition";
    const released = await epicSvc.releaseLock(id, epicId, documentId);
    res.json({ released });
  }));

  // Check lock status
  app.get("/api/codascope/projects/:id/epics/:epicId/lock", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const locks = await epicSvc.getLockStatus(id, epicId);
    res.json({ locks });
  }));

  // Get computed health
  app.get("/api/codascope/projects/:id/epics/:epicId/health", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const health = await epicSvc.getHealth(id, epicId);
    if (!health) throw httpError("Epic not found.", 404, "not_found");
    res.json({ health });
  }));

  // Archive an epic (move to _archive/)
  app.post("/api/codascope/projects/:id/epics/:epicId/archive", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const archived = await epicSvc.archiveEpic(id, epicId);
    if (!archived) throw httpError("Epic not found.", 404, "not_found");
    res.json({ archived: true });
  }));

  // Restore an archived epic
  app.post("/api/codascope/projects/:id/epics/:epicId/restore", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const epic = await epicSvc.restoreEpic(id, epicId);
    if (!epic) throw httpError("Archived epic not found.", 404, "not_found");
    res.json({ epic });
  }));

  // List archived epics
  app.get("/api/codascope/projects/:id/epics-archived", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epics = await epicSvc.listArchivedEpics(id);
    res.json({ epics });
  }));

  // ── Epic Scope ────────────────────────────────────────────────────

  // Get scope state
  app.get("/api/codascope/projects/:id/epics/:epicId/scope", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const scope = await epicSvc.getScope(id, epicId);
    res.json({ scope: scope ?? { entries: [], lastScopedAt: null, lastScopedBy: null } });
  }));

  // Update full scope (agent or user)
  app.put("/api/codascope/projects/:id/epics/:epicId/scope", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { scope } = req.body as { scope?: unknown };
    if (!scope || typeof scope !== "object") throw httpError("scope is required and must be an object.", 400, "invalid_input");

    // Validate scope structure matches EpicScope shape
    const s = scope as Record<string, unknown>;
    if (!Array.isArray(s.entries)) throw httpError("scope.entries must be an array.", 400, "invalid_input");
    for (let i = 0; i < s.entries.length; i++) {
      const entry = s.entries[i] as Record<string, unknown> | undefined;
      if (!entry || typeof entry !== "object") {
        throw httpError(`scope.entries[${i}] must be an object.`, 400, "invalid_input");
      }
      if (typeof entry.topicId !== "string" || !entry.topicId) {
        throw httpError(`scope.entries[${i}].topicId must be a non-empty string.`, 400, "invalid_input");
      }
      if (typeof entry.included !== "boolean") {
        throw httpError(`scope.entries[${i}].included must be a boolean.`, 400, "invalid_input");
      }
    }

    const saved = await epicSvc.setScope(id, epicId, scope as any);
    if (!saved) throw httpError("Epic not found.", 404, "not_found");
    res.json({ saved: true });
  }));

  // Toggle include/exclude for a single topic
  app.patch("/api/codascope/projects/:id/epics/:epicId/scope/:topicId", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const topicId = param(req, "topicId");
    const { included, targetDepth } = req.body as { included?: boolean; targetDepth?: string };
    const changes: Record<string, unknown> = {};
    if (included !== undefined) changes.included = included;
    if (targetDepth !== undefined) changes.targetDepth = targetDepth;
    const entry = await epicSvc.updateScopeEntry(id, epicId, topicId, changes as any);
    if (!entry) throw httpError("Scope entry not found.", 404, "not_found");
    res.json({ entry });
  }));

  // Add a topic to scope
  app.post("/api/codascope/projects/:id/epics/:epicId/scope/add", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { entry } = req.body as { entry?: unknown };
    if (!entry) throw httpError("entry is required.", 400, "invalid_input");
    const added = await epicSvc.addScopeEntry(id, epicId, entry as any);
    if (!added) {
      res.status(409).json({ error: "Topic already in scope", code: "duplicate_entry" });
      return;
    }
    res.status(201).json({ added: true });
  }));

  // Remove a topic from scope
  app.delete("/api/codascope/projects/:id/epics/:epicId/scope/:topicId", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const topicId = param(req, "topicId");
    const removed = await epicSvc.removeScopeEntry(id, epicId, topicId);
    if (!removed) throw httpError("Scope entry not found.", 404, "not_found");
    res.json({ removed: true });
  }));

  // Apply approved scope diff
  app.post("/api/codascope/projects/:id/epics/:epicId/scope/apply-diff", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { accepted, fullDiff } = req.body as {
      accepted?: { addedTopicIds?: string[]; removedTopicIds?: string[]; changedTopicIds?: string[] };
      fullDiff?: unknown;
    };
    if (!accepted || typeof accepted !== "object") {
      throw httpError("accepted must be an object with addedTopicIds, removedTopicIds, and/or changedTopicIds arrays.", 400, "invalid_input");
    }
    if (!fullDiff || typeof fullDiff !== "object") {
      throw httpError("fullDiff is required and must be an object.", 400, "invalid_input");
    }
    // Validate array fields within accepted
    const { addedTopicIds, removedTopicIds, changedTopicIds } = accepted;
    if (addedTopicIds !== undefined && !Array.isArray(addedTopicIds)) {
      throw httpError("accepted.addedTopicIds must be an array.", 400, "invalid_input");
    }
    if (removedTopicIds !== undefined && !Array.isArray(removedTopicIds)) {
      throw httpError("accepted.removedTopicIds must be an array.", 400, "invalid_input");
    }
    if (changedTopicIds !== undefined && !Array.isArray(changedTopicIds)) {
      throw httpError("accepted.changedTopicIds must be an array.", 400, "invalid_input");
    }
    const scope = await epicSvc.applyScopeDiff(id, epicId, {
      addedTopicIds: addedTopicIds ?? [],
      removedTopicIds: removedTopicIds ?? [],
      changedTopicIds: changedTopicIds ?? [],
    }, fullDiff as any);
    if (!scope) throw httpError("Epic not found.", 404, "not_found");
    res.json({ scope });
  }));

  // ── Deepen (SSE streaming pipeline) ───────────────────────────────

  app.post("/api/codascope/projects/:id/epics/:epicId/deepen", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const svcs = await ensureServices();
      const { epicSvc, buildSvc, projectSvc } = svcs;
      const id = param(req, "id");
      const epicId = param(req, "epicId");
      const { modelId } = req.body as { modelId?: string };

      if (!modelId || typeof modelId !== "string") {
        throw httpError("modelId is required.", 400, "invalid_input");
      }

      const project = await projectSvc.getProject(id);
      if (!project) throw httpError("Project not found.", 404, "not_found");

      const projectDir = projectSvc.getProjectDir(id);
      if (!projectDir) throw httpError("Project directory not found.", 404, "not_found");

      const scope = await epicSvc.getScope(id, epicId);
      if (!scope || scope.entries.length === 0) {
        throw httpError("No scope entries to deepen.", 400, "empty_scope");
      }

      const includedEntries = scope.entries.filter((e) => e.included);
      if (includedEntries.length === 0) {
        throw httpError("No included scope entries to deepen.", 400, "no_included_entries");
      }

      const buildScope = `epic-deepen::${epicId}`;
      const pipeline = initSsePipeline(req, res, {
        projectId: id,
        scope: buildScope,
        buildType: "epic-deepen",
        modelId,
        buildSvc,
        projectDir,
      });
      if (!pipeline) return; // 409 already sent

      const { runId, callbacks } = pipeline;
      const { isAborted } = callbacks;

      // Wrap sendEvent to forward pipeline-step events to build state
      const sendEvent = (event: string, data: unknown) => {
        if (event === "pipeline-step") {
          buildSvc.addPipelineStep(id, runId, data as any, buildScope);
        }
        callbacks.sendEvent(event, data);
      };

      sendEvent("run-started", { runId, epicId, entryCount: includedEntries.length });

      try {
        const { runEpicDeepenPipeline } = await import("../services/codaScopeBuildOrchestrator.js");
        await runEpicDeepenPipeline(
          { projectId: id, epicId, modelId, entries: includedEntries },
          { sendEvent, sendMessage: callbacks.sendMessage, isAborted },
          svcs as any,
          runId,
          buildScope,
        );

        completeSsePipeline(res, { projectId: id, scope: buildScope, buildSvc }, runId, isAborted);
      } catch (err) {
        failSsePipeline(res, { projectId: id, scope: buildScope, buildSvc }, runId, err, isAborted);
      }
    })().catch(next);
  });

  // ── Design Documents ──────────────────────────────────────────────

  // List design docs for an epic
  app.get("/api/codascope/projects/:id/epics/:epicId/designs", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docs = await designDocSvc.listDesignDocs(id, epicId);
    res.json({ docs });
  }));

  // Create design doc
  app.post("/api/codascope/projects/:id/epics/:epicId/designs", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { title, content, createdBy } = req.body as {
      title?: string;
      content?: string;
      createdBy?: string;
    };
    if (!title || typeof title !== "string" || !title.trim()) {
      throw httpError("title is required.", 400, "invalid_input");
    }
    const doc = await designDocSvc.createDesignDoc(id, epicId, {
      title: title.trim(),
      content,
      createdBy,
    });
    res.status(201).json({ doc });
  }));

  // Get design doc content
  app.get("/api/codascope/projects/:id/epics/:epicId/designs/:docId", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const result = await designDocSvc.getDesignDoc(id, epicId, docId);
    if (!result) throw httpError("Design doc not found.", 404, "not_found");
    res.json(result); // includes { doc, content, contentHash }
  }));

  // Download design doc as markdown file
  app.get("/api/codascope/projects/:id/epics/:epicId/designs/:docId/download", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const result = await designDocSvc.getDesignDoc(id, epicId, docId);
    if (!result) throw httpError("Design doc not found.", 404, "not_found");
    const slug = result.doc.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const filename = `${slug}.md`;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(result.content);
  }));

  // Update design doc content (manual save — creates a version snapshot)
  app.put("/api/codascope/projects/:id/epics/:epicId/designs/:docId", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const { content, expectedHash } = req.body as { content?: string; expectedHash?: string };
    if (content === undefined || typeof content !== "string") {
      throw httpError("content is required.", 400, "invalid_input");
    }
    // Create a version snapshot before saving (best effort — don't fail the save)
    try { await designDocSvc.createVersion(id, epicId, docId, "user", "Manual save"); } catch { /* ignore */ }
    const result = await designDocSvc.updateDesignDoc(id, epicId, docId, content, expectedHash);
    if (!result) throw httpError("Design doc not found.", 404, "not_found");
    if ("conflict" in result) {
      res.status(409).json({
        error: "conflict",
        message: "Document was modified by another user or agent since you loaded it.",
        currentHash: result.currentHash,
        currentContent: result.currentContent,
      });
      return;
    }
    res.json({ doc: result.doc, contentHash: result.contentHash });
  }));

  // Resize / delete metadata — server-side atomic mutation
  app.patch("/api/codascope/projects/:id/epics/:epicId/designs/:docId/resize", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const body = req.body as { type: string; index: number; width?: number; height?: number };
    if (!body || !body.type || body.index === undefined) {
      throw httpError("type and index are required.", 400, "invalid_input");
    }
    if (body.type === "mermaid" && body.height === undefined) {
      throw httpError("height is required for mermaid resize.", 400, "invalid_input");
    }
    if (body.type === "image" && (body.width === undefined || body.height === undefined)) {
      throw httpError("width and height are required for image resize.", 400, "invalid_input");
    }

    const isDelete = body.type.startsWith("delete-");

    let resizeOp: import("../services/codaScopeDesignDocService.js").ResizeOp;
    switch (body.type) {
      case "mermaid":
        resizeOp = { type: "mermaid", index: body.index, height: body.height! };
        break;
      case "image":
        resizeOp = { type: "image", index: body.index, width: body.width!, height: body.height! };
        break;
      case "delete-mermaid":
        resizeOp = { type: "delete-mermaid", index: body.index };
        break;
      case "delete-image":
        resizeOp = { type: "delete-image", index: body.index };
        break;
      case "delete-codeblock":
        resizeOp = { type: "delete-codeblock", index: body.index };
        break;
      default:
        throw httpError(`Unknown operation type: ${body.type}`, 400, "invalid_input");
    }

    // Create a version snapshot before destructive deletes (best effort)
    if (isDelete) {
      try { await designDocSvc.createVersion(id, epicId, docId, "user", `Delete ${body.type.replace("delete-", "")}`); } catch { /* ignore */ }
    }

    const result = await designDocSvc.applyResizeMetadata(id, epicId, docId, resizeOp);
    if (!result) throw httpError("Design doc not found or target not found.", 404, "not_found");
    res.json({ doc: result.doc, content: result.content, contentHash: result.contentHash });
  }));

  // ── Design Doc Images ─────────────────────────────────────────────

  // Upload image to a design doc
  app.post("/api/codascope/projects/:id/epics/:epicId/designs/:docId/images",
    upload.single("image"),
    wrap(async (req, res) => {
      const { designDocSvc } = await ensureServices();
      const id = param(req, "id");
      const epicId = param(req, "epicId");
      const docId = param(req, "docId");

      const file = (req as any).file;
      if (!file) throw httpError("No image file provided.", 400, "invalid_input");
      if (!file.mimetype.startsWith("image/")) {
        throw httpError("File must be an image.", 400, "invalid_input");
      }

      const result = await designDocSvc.uploadDocImage(id, epicId, docId, file.buffer, file.mimetype);
      res.status(201).json(result);
    }),
  );

  // Serve a design doc image
  app.get("/api/codascope/projects/:id/epics/:epicId/designs/:docId/images/:filename", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const filename = param(req, "filename");

    const imagePath = designDocSvc.getDocImagePath(id, epicId, docId, filename);
    if (!imagePath) throw httpError("Image not found.", 404, "not_found");

    res.sendFile(imagePath);
  }));

  // Archive design doc (soft delete)
  app.patch("/api/codascope/projects/:id/epics/:epicId/designs/:docId/archive", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const archived = await designDocSvc.archiveDesignDoc(id, epicId, docId);
    if (!archived) throw httpError("Design doc not found.", 404, "not_found");
    res.json({ success: true });
  }));

  // Unarchive design doc (restore)
  app.patch("/api/codascope/projects/:id/epics/:epicId/designs/:docId/unarchive", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const restored = await designDocSvc.unarchiveDesignDoc(id, epicId, docId);
    if (!restored) throw httpError("Design doc not found or not archived.", 404, "not_found");
    res.json({ success: true });
  }));

  // Pin design doc
  app.patch("/api/codascope/projects/:id/epics/:epicId/designs/:docId/pin", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const pinned = await designDocSvc.pinDesignDoc(id, epicId, docId);
    if (!pinned) throw httpError("Design doc not found.", 404, "not_found");
    res.json({ success: true });
  }));

  // Unpin design doc
  app.patch("/api/codascope/projects/:id/epics/:epicId/designs/:docId/unpin", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const unpinned = await designDocSvc.unpinDesignDoc(id, epicId, docId);
    if (!unpinned) throw httpError("Design doc not found or not pinned.", 404, "not_found");
    res.json({ success: true });
  }));

  // ── Design Doc Versions ───────────────────────────────────────────

  // List versions for a design doc
  app.get("/api/codascope/projects/:id/epics/:epicId/designs/:docId/versions", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const versions = await designDocSvc.listDocVersions(id, epicId, docId);
    res.json({ versions });
  }));

  // Get a specific version's content
  app.get("/api/codascope/projects/:id/epics/:epicId/designs/:docId/versions/:num", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const num = parseInt(param(req, "num"), 10);
    if (isNaN(num)) throw httpError("Invalid version number.", 400, "invalid_input");
    const result = await designDocSvc.getDocVersion(id, epicId, docId, num);
    if (!result) throw httpError("Version not found.", 404, "not_found");
    res.json(result);
  }));

  // Revert design doc to a specific version
  app.post("/api/codascope/projects/:id/epics/:epicId/designs/:docId/revert/:num", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const num = parseInt(param(req, "num"), 10);
    if (isNaN(num)) throw httpError("Invalid version number.", 400, "invalid_input");
    const result = await designDocSvc.revertToVersion(id, epicId, docId, num);
    if (!result) throw httpError("Version not found or revert failed.", 404, "not_found");
    res.json({ content: result.content, revertVersion: result.revertVersion });
  }));

  // ── Epic Versions ─────────────────────────────────────────────────

  // List versions for an epic
  app.get("/api/codascope/projects/:id/epics/:epicId/versions", wrap(async (req, res) => {
    const { versionSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const versions = await versionSvc.listVersions(id, epicId);
    res.json({ versions });
  }));

  // Create version snapshot
  app.post("/api/codascope/projects/:id/epics/:epicId/versions", wrap(async (req, res) => {
    const { versionSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { label, note, createdBy } = req.body as {
      label?: string;
      note?: string;
      createdBy?: string;
    };
    const version = await versionSvc.createVersion(id, epicId, { label, note, createdBy });
    res.status(201).json({ version });
  }));

  // Get version snapshot
  app.get("/api/codascope/projects/:id/epics/:epicId/versions/:v", wrap(async (req, res) => {
    const { versionSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const v = parseInt(param(req, "v"), 10);
    if (isNaN(v)) throw httpError("Invalid version number.", 400, "invalid_input");
    const snapshot = await versionSvc.getVersion(id, epicId, v);
    if (!snapshot) throw httpError("Version not found.", 404, "not_found");
    res.json(snapshot);
  }));

  // Diff two versions
  app.get("/api/codascope/projects/:id/epics/:epicId/versions/diff", wrap(async (req, res) => {
    const { versionSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const from = parseInt(String(req.query.from ?? ""), 10);
    const to = parseInt(String(req.query.to ?? ""), 10);
    if (isNaN(from) || isNaN(to)) {
      throw httpError("from and to query params are required and must be integers.", 400, "invalid_input");
    }
    const diff = await versionSvc.diffVersions(id, epicId, from, to);
    if (!diff) throw httpError("One or both versions not found.", 404, "not_found");
    res.json({ diff });
  }));

  // ── Rendering ─────────────────────────────────────────────────────

  // Render design doc as HTML
  app.post("/api/codascope/projects/:id/epics/:epicId/designs/:docId/render", wrap(async (req, res) => {
    const { renderSvc, designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const { html } = (req.body ?? {}) as { html?: string };

    // If HTML is provided (from agent), save it directly
    if (html && typeof html === "string") {
      await renderSvc.saveRenderedHtml(id, epicId, docId, html);
      res.json({ success: true });
      return;
    }

    // Otherwise, generate basic HTML from markdown
    const result = await designDocSvc.getDesignDoc(id, epicId, docId);
    if (!result) throw httpError("Design doc not found.", 404, "not_found");

    const basicHtml = renderSvc.generateBasicHtml(result.content, result.doc.title);
    await renderSvc.saveRenderedHtml(id, epicId, docId, basicHtml);
    res.json({ success: true });
  }));

  // Serve rendered HTML
  app.get("/api/codascope/projects/:id/epics/:epicId/designs/:docId/rendered", wrap(async (req, res) => {
    const { renderSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");

    const html = await renderSvc.getRenderedHtml(id, epicId, docId);
    if (!html) throw httpError("No rendered version available.", 404, "not_found");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  }));

  // ── Brief ─────────────────────────────────────────────────────────

  // Generate exportable brief
  app.get("/api/codascope/projects/:id/epics/:epicId/brief", wrap(async (req, res) => {
    const { epicSvc, annotationSvc, designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");

    const epic = await epicSvc.getEpic(id, epicId);
    if (!epic) throw httpError("Epic not found.", 404, "not_found");

    const health = epicSvc.computeHealth(epic);
    const scope = epic.scope;
    const scopeEntryCount = scope?.entries?.length ?? 0;
    const enrichedCount = scope?.entries?.filter((e) => e.enrichedAt)?.length ?? 0;
    const designDocNames = epic.designDocs.map((d) => d.title).join(", ") || "None";

    // Count open annotations across all documents
    let openAnnotationCount = 0;
    const docIds = ["definition", ...epic.designDocs.map((d) => d.id)];
    for (const docId of docIds) {
      const anns = await annotationSvc.listAnnotations(id, epicId, docId);
      openAnnotationCount += anns.filter((a) => a.status === "open").length;
    }

    const statusLabels: Record<string, string> = {
      defining: "Defining",
      curating: "Curating",
      designing: "Designing",
      "in-review": "In Review",
      approved: "Approved",
      archived: "Archived",
    };
    const healthIcons: Record<string, string> = {
      active: "🟢",
      hot: "⚡",
      stale: "🟡",
      blocked: "🔴",
    };

    const lastActivityAgo = (() => {
      const ms = Date.now() - new Date(health.lastActivityAt).getTime();
      const hours = Math.floor(ms / (1000 * 60 * 60));
      if (hours < 1) return "just now";
      if (hours < 24) return `${hours}h ago`;
      return `${Math.floor(hours / 24)}d ago`;
    })();

    const brief = [
      `## ${epic.title} — Design Brief`,
      `**Status**: ${statusLabels[epic.status] ?? epic.status} (v${epic.currentVersion})`,
      `**Health**: ${healthIcons[health.health] ?? ""} ${health.health.charAt(0).toUpperCase() + health.health.slice(1)} (${health.reason})`,
      `**Scope**: ${scopeEntryCount} topics (${enrichedCount} enriched)`,
      `**Design Docs**: ${designDocNames}`,
      `**Open Threads**: ${openAnnotationCount}`,
      `**Last Activity**: ${lastActivityAgo}`,
      `**Collaborators**: ${epic.collaborators.join(", ")}`,
    ].join("\n");

    res.json({ brief });
  }));

  // ── Epic Conversation ─────────────────────────────────────────────

  // Get or create epic conversation
  app.get("/api/codascope/projects/:id/epics/:epicId/conversation", wrap(async (req, res) => {
    const { chatSvc, epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");

    const epic = await epicSvc.getEpic(id, epicId);
    if (!epic) throw httpError("Epic not found.", 404, "not_found");

    const conversation = await chatSvc.getOrCreateEpicConversation(id, epicId, epic.title);

    // Update epic metadata with conversation ID if not set
    if (!epic.conversationId) {
      await epicSvc.updateEpic(id, epicId, {});
    }

    res.json({ conversation });
  }));

  // ── Lock Heartbeat ────────────────────────────────────────────────

  app.patch("/api/codascope/projects/:id/epics/:epicId/lock/heartbeat", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { documentId, lockedBy } = req.body as { documentId?: string; lockedBy?: string };

    if (!documentId || !lockedBy) {
      throw httpError("documentId and lockedBy are required.", 400, "invalid_input");
    }

    const lock = await epicSvc.heartbeatLock(id, epicId, documentId, lockedBy);
    if (!lock) throw httpError("Lock not found or expired.", 404, "not_found");
    res.json({ lock });
  }));
}
