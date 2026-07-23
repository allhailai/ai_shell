/* ── CodaScope: Annotation Routes ────────────────────────────────────
   Annotations, directives (create, execute, apply, reject, undo, delete),
   block IDs, and batch directive execution.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import { createHash } from "node:crypto";
import type { BlockAnchor } from "../../src/apps/codascope/codaScopeTypes.js";
import { isAnnotationServiceError } from "../services/codaScopeAnnotationService.js";

export function registerAnnotationRoutes(ctx: CodaScopeRouteContext): void {
  const { app, httpError, ensureServices, wrap, param, principal } = ctx;

  const annotationFailure = (error: unknown): never => {
    if (isAnnotationServiceError(error)) throw httpError(error.message, error.status, error.code);
    throw error;
  };

  const loadDocument = async (projectId: string, epicId: string, documentId: string) => {
    const { epicSvc, designDocSvc } = await ensureServices();
    if (documentId === "definition") {
      const content = await epicSvc.getDefinition(projectId, epicId);
      if (content === null) return null;
      return { content, contentHash: contentHash(content) };
    }
    const result = await designDocSvc.getDesignDoc(projectId, epicId, documentId);
    return result ? { content: result.content, contentHash: result.contentHash } : null;
  };

  // ── Annotations ───────────────────────────────────────────────────

  // List annotations for a document
  app.get("/api/codascope/projects/:id/epics/:epicId/docs/:docId/annotations", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");

    const document = await loadDocument(id, epicId, docId);
    if (!document) throw httpError("Document not found.", 404, "not_found");
    const annotations = await annotationSvc.listAnnotations(id, epicId, docId, document.content);
    res.json({ annotations });
  }));

  // Create annotation
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/annotations", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    assertOnlyFields(req.body, ["anchor", "body", "parentId", "documentVersion"], httpError);
    const { anchor, body, parentId, documentVersion } = req.body as {
      anchor?: unknown;
      body?: unknown;
      parentId?: unknown;
      documentVersion?: unknown;
    };
    if (typeof body !== "string" || !body.trim()) {
      throw httpError("body must be a non-empty string.", 400, "invalid_input");
    }
    if (parentId !== undefined && (typeof parentId !== "string" || !parentId)) {
      throw httpError("parentId must be a non-empty string.", 400, "invalid_input");
    }
    if (documentVersion !== undefined
      && (!Number.isSafeInteger(documentVersion) || (documentVersion as number) < 0)) {
      throw httpError("documentVersion must be a non-negative integer.", 400, "invalid_input");
    }
    if (parentId && anchor !== undefined) {
      throw httpError("Replies inherit their root thread anchor.", 400, "invalid_input");
    }
    let trustedAnchor: BlockAnchor | undefined;
    if (!parentId) {
      if (!isBlockAnchor(anchor)) throw httpError("A valid block anchor is required.", 400, "invalid_input");
      const document = await loadDocument(id, epicId, docId);
      if (!document) throw httpError("Document not found.", 404, "not_found");
      const target = annotationSvc.computeBlockIds(document.content).find((block) => block.blockId === anchor.blockId);
      if (!target) throw httpError("The selected annotation block no longer exists.", 400, "invalid_input");
      trustedAnchor = {
        blockId: target.blockId,
        sectionSlug: target.sectionSlug,
        anchorText: target.content,
        lineNumber: target.lineStart,
      };
    }
    try {
      const annotation = await annotationSvc.createAnnotation(
        id,
        epicId,
        docId,
        { username: principal(req).username, origin: "user" },
        {
          anchor: trustedAnchor,
          body,
          parentId: parentId as string | undefined,
          documentVersion: documentVersion as number | undefined,
        },
      );
      res.status(201).json({ annotation });
    } catch (error) {
      annotationFailure(error);
    }
  }));

  // Update annotation (resolve, edit)
  app.patch("/api/codascope/projects/:id/epics/:epicId/annotations/:annId", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const annId = param(req, "annId");
    assertOnlyFields(req.body, ["status", "body"], httpError);
    const { status, body } = req.body as { status?: unknown; body?: unknown };
    if (status === undefined && body === undefined) {
      throw httpError("Provide a body or status update.", 400, "invalid_input");
    }
    if (status !== undefined && typeof status !== "string") {
      throw httpError("status must be a string.", 400, "invalid_input");
    }
    if (body !== undefined && (typeof body !== "string" || !body.trim())) {
      throw httpError("body must be a non-empty string.", 400, "invalid_input");
    }
    try {
      const annotation = await annotationSvc.updateAnnotation(
        id,
        epicId,
        annId,
        { username: principal(req).username, origin: "user" },
        { status: status as any, body: body as string | undefined },
      );
      if (!annotation) throw httpError("Annotation not found.", 404, "not_found");
      res.json({ annotation });
    } catch (error) {
      annotationFailure(error);
    }
  }));

  // Add one actor-bound reaction. The request never carries a username.
  app.post("/api/codascope/projects/:id/epics/:epicId/annotations/:annId/reactions", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices();
    assertOnlyFields(req.body, ["emoji"], httpError);
    const emoji = (req.body as { emoji?: unknown }).emoji;
    if (typeof emoji !== "string" || !emoji.trim() || Array.from(emoji.trim()).length > 32) {
      throw httpError("emoji must be between 1 and 32 characters.", 400, "invalid_input");
    }
    try {
      const annotation = await annotationSvc.addReaction(
        param(req, "id"),
        param(req, "epicId"),
        param(req, "annId"),
        { username: principal(req).username, origin: "user" },
        emoji,
      );
      if (!annotation) throw httpError("Annotation not found.", 404, "not_found");
      res.json({ annotation });
    } catch (error) {
      annotationFailure(error);
    }
  }));

  // Remove one actor-bound reaction. Missing reactions are idempotent.
  app.delete("/api/codascope/projects/:id/epics/:epicId/annotations/:annId/reactions", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices();
    assertOnlyFields(req.body, ["emoji"], httpError);
    const emoji = (req.body as { emoji?: unknown }).emoji;
    if (typeof emoji !== "string" || !emoji.trim() || Array.from(emoji.trim()).length > 32) {
      throw httpError("emoji must be between 1 and 32 characters.", 400, "invalid_input");
    }
    try {
      const annotation = await annotationSvc.removeReaction(
        param(req, "id"),
        param(req, "epicId"),
        param(req, "annId"),
        { username: principal(req).username, origin: "user" },
        emoji,
      );
      if (!annotation) throw httpError("Annotation not found.", 404, "not_found");
      res.json({ annotation });
    } catch (error) {
      annotationFailure(error);
    }
  }));

  // Explicitly move a root thread to an exact block in the current document.
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/annotations/:annId/reattach", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices();
    assertOnlyFields(req.body, ["targetBlockId", "contentHash"], httpError);
    const { targetBlockId, contentHash: expectedHash } = req.body as {
      targetBlockId?: unknown;
      contentHash?: unknown;
    };
    if (typeof targetBlockId !== "string" || !targetBlockId
      || typeof expectedHash !== "string" || !expectedHash) {
      throw httpError("targetBlockId and contentHash are required.", 400, "invalid_input");
    }
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const document = await loadDocument(id, epicId, docId);
    if (!document) throw httpError("Document not found.", 404, "not_found");
    if (document.contentHash !== expectedHash) {
      throw httpError("Document content changed. Reload before reattaching the annotation.", 409, "conflict");
    }
    const target = annotationSvc.computeBlockIds(document.content).find((block) => block.blockId === targetBlockId);
    if (!target) throw httpError("The selected annotation block no longer exists.", 400, "invalid_input");
    try {
      const annotation = await annotationSvc.reattachAnnotation(
        id,
        epicId,
        docId,
        param(req, "annId"),
        expectedHash,
        target.blockId,
      );
      if (!annotation) throw httpError("Annotation not found.", 404, "not_found");
      res.json({ annotation });
    } catch (error) {
      annotationFailure(error);
    }
  }));

  // Delete annotation
  app.delete("/api/codascope/projects/:id/epics/:epicId/annotations/:annId", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices();
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const annId = param(req, "annId");
    const deleted = await annotationSvc.deleteAnnotation(
      id,
      epicId,
      annId,
      { username: principal(req).username, origin: "user" },
    );
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
    res.json({ blocks, contentHash: contentHash(content) });
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

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function assertOnlyFields(
  value: unknown,
  allowed: string[],
  httpError: CodaScopeRouteContext["httpError"],
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError("A JSON object body is required.", 400, "invalid_input");
  }
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw httpError("The request contains unsupported annotation fields.", 400, "invalid_input");
  }
}

function isBlockAnchor(value: unknown): value is BlockAnchor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const anchor = value as Record<string, unknown>;
  if (Object.keys(anchor).some((key) => !new Set(["blockId", "sectionSlug", "anchorText", "lineNumber"]).has(key))) return false;
  return typeof anchor.blockId === "string" && Boolean(anchor.blockId)
    && typeof anchor.sectionSlug === "string"
    && typeof anchor.anchorText === "string"
    && typeof anchor.lineNumber === "number"
    && Number.isFinite(anchor.lineNumber);
}
