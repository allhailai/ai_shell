/* ── CodaScope: Annotation Routes ────────────────────────────────────
   Annotations, directives (create, execute, apply, reject, undo, delete),
   block IDs, and batch directive execution.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";

export function registerAnnotationRoutes(ctx: CodaScopeRouteContext): void {
  const { app, httpError, ensureServices, wrap, param, principal } = ctx;

  // ── Annotations ───────────────────────────────────────────────────

  // List annotations for a document
  app.get("/api/codascope/projects/:id/epics/:epicId/docs/:docId/annotations", wrap(async (req, res) => {
    const { annotationSvc, epicSvc, designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");

    // Get current document content for re-anchoring
    let content: string | undefined;
    if (docId === "definition") {
      content = (await epicSvc.getDefinition(id, epicId)) ?? undefined;
    } else {
      const result = await designDocSvc.getDesignDoc(id, epicId, docId);
      content = result?.content;
    }

    const annotations = await annotationSvc.listAnnotations(id, epicId, docId, content);
    res.json({ annotations });
  }));

  // Create annotation
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/annotations", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const { anchor, body, parentId, documentVersion } = req.body as {
      anchor?: unknown;
      body?: string;
      parentId?: string;
      documentVersion?: number;
    };
    if (!anchor || !body || typeof body !== "string") {
      throw httpError("anchor and body are required.", 400, "invalid_input");
    }
    const annotation = await annotationSvc.createAnnotation(id, epicId, docId, {
      anchor: anchor as any,
      author: principal(req).username,
      body,
      parentId,
      documentVersion,
    });
    res.status(201).json({ annotation });
  }));

  // Update annotation (resolve, edit)
  app.patch("/api/codascope/projects/:id/epics/:epicId/annotations/:annId", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const annId = param(req, "annId");
    const { status, body, reactions } = req.body as {
      status?: string;
      body?: string;
      reactions?: Array<{ emoji: string; user: string }>;
    };
    const changes: Record<string, unknown> = {};
    if (status !== undefined) changes.status = status;
    if (body !== undefined) changes.body = body;
    if (reactions !== undefined) changes.reactions = reactions;
    const annotation = await annotationSvc.updateAnnotation(id, epicId, annId, changes as any);
    if (!annotation) throw httpError("Annotation not found.", 404, "not_found");
    res.json({ annotation });
  }));

  // Delete annotation
  app.delete("/api/codascope/projects/:id/epics/:epicId/annotations/:annId", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const annId = param(req, "annId");
    const deleted = await annotationSvc.deleteAnnotation(id, epicId, annId);
    if (!deleted) throw httpError("Annotation not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // ── Directives ────────────────────────────────────────────────────

  // List directives for a document
  app.get("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives", wrap(async (req, res) => {
    const { directiveSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const directives = await directiveSvc.listDirectives(id, epicId, docId);
    res.json({ directives });
  }));

  // Create directive
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives", wrap(async (req, res) => {
    const { directiveSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const { type, afterLine, startLine, endLine, blockId, anchorText, instruction } = req.body as {
      type?: string; afterLine?: number; startLine?: number; endLine?: number;
      blockId?: string; anchorText?: string; instruction?: string;
    };
    if (!type || !instruction) {
      throw httpError("type and instruction are required.", 400, "invalid_input");
    }
    if (afterLine === undefined || typeof afterLine !== "number") {
      throw httpError("afterLine is required.", 400, "invalid_input");
    }
    const directive = await directiveSvc.createDirective(id, epicId, docId, {
      type: type as any,
      afterLine,
      startLine,
      endLine,
      blockId,
      anchorText,
      instruction,
      author: principal(req).username,
    });
    res.status(201).json({ directive });
  }));

  // Execute directive (agent generates content)
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/execute", wrap(async (req, res) => {
    const { directiveSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const dirId = param(req, "dirId");
    const { generatedContent } = req.body as { generatedContent?: string };

    // For now, accept pre-generated content from the client
    // (In production, this would trigger the agent for content generation)
    if (!generatedContent || typeof generatedContent !== "string") {
      throw httpError("generatedContent is required.", 400, "invalid_input");
    }

    const directive = await directiveSvc.updateDirective(id, epicId, dirId, docId, {
      status: "generating",
    });
    if (!directive) throw httpError("Directive not found.", 404, "not_found");

    // Store the generated content
    const updated = await directiveSvc.updateDirective(id, epicId, dirId, docId, {
      generatedContent,
      status: "pending", // back to pending — user must Apply
    });

    res.json({ directive: updated });
  }));

  // Apply directive to document
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/apply", wrap(async (req, res) => {
    const { directiveSvc, epicSvc, designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const dirId = param(req, "dirId");

    const getContent = async (): Promise<string> => {
      if (docId === "definition") {
        return (await epicSvc.getDefinition(id, epicId)) ?? "";
      }
      const result = await designDocSvc.getDesignDoc(id, epicId, docId);
      return result?.content ?? "";
    };

    const setContent = async (content: string): Promise<void> => {
      if (docId === "definition") {
        await epicSvc.updateDefinition(id, epicId, content);
      } else {
        await designDocSvc.updateDesignDoc(id, epicId, docId, content);
      }
    };

    const result = await directiveSvc.applyDirective(id, epicId, docId, dirId, getContent, setContent);
    if (!result) throw httpError("Directive not found or has no generated content.", 404, "not_found");
    res.json({ directive: result.directive, content: result.newContent });
  }));

  // Reject directive
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/reject", wrap(async (req, res) => {
    const { directiveSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const dirId = param(req, "dirId");
    const directive = await directiveSvc.rejectDirective(id, epicId, docId, dirId);
    if (!directive) throw httpError("Directive not found.", 404, "not_found");
    res.json({ directive });
  }));

  // Undo applied directive
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/undo", wrap(async (req, res) => {
    const { directiveSvc, epicSvc, designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const dirId = param(req, "dirId");

    const setContent = async (content: string): Promise<void> => {
      if (docId === "definition") {
        await epicSvc.updateDefinition(id, epicId, content);
      } else {
        await designDocSvc.updateDesignDoc(id, epicId, docId, content);
      }
    };

    const directive = await directiveSvc.undoDirective(id, epicId, docId, dirId, setContent);
    if (!directive) throw httpError("Directive not found or not applied.", 404, "not_found");
    res.json({ directive });
  }));

  // Delete directive
  app.delete("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId", wrap(async (req, res) => {
    const { directiveSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const dirId = param(req, "dirId");
    const deleted = await directiveSvc.deleteDirective(id, epicId, dirId, docId);
    if (!deleted) throw httpError("Directive not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // ── Block IDs ─────────────────────────────────────────────────────

  // Get computed block IDs for a document
  app.get("/api/codascope/projects/:id/epics/:epicId/docs/:docId/blocks", wrap(async (req, res) => {
    const { annotationSvc, epicSvc, designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");

    let content: string;
    if (docId === "definition") {
      content = (await epicSvc.getDefinition(id, epicId)) ?? "";
    } else {
      const result = await designDocSvc.getDesignDoc(id, epicId, docId);
      content = result?.content ?? "";
    }

    const blocks = annotationSvc.computeBlockIds(content);
    res.json({ blocks });
  }));

  // ── Batch Directives ──────────────────────────────────────────────

  // Batch execute all pending directives
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/batch", wrap(async (req, res) => {
    const { directiveSvc, epicSvc, designDocSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");

    const getContent = async (): Promise<string> => {
      if (docId === "definition") {
        return (await epicSvc.getDefinition(id, epicId)) ?? "";
      }
      const result = await designDocSvc.getDesignDoc(id, epicId, docId);
      return result?.content ?? "";
    };

    const setContent = async (content: string): Promise<void> => {
      if (docId === "definition") {
        await epicSvc.updateDefinition(id, epicId, content);
      } else {
        await designDocSvc.updateDesignDoc(id, epicId, docId, content);
      }
    };

    const result = await directiveSvc.executeBatchDirectives(id, epicId, docId, getContent, setContent);
    if (!result) throw httpError("Document not found.", 404, "not_found");
    res.json({ applied: result.applied, content: result.newContent });
  }));
}
