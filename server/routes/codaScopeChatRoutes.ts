/* ── CodaScope: Chat Routes ──────────────────────────────────────────
   Conversations, messages (SSE streaming), assistant, and images.
   ──────────────────────────────────────────────────────────────────── */

import type { Request, Response, NextFunction } from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import {
  buildManifestFromServices,
  buildAssistantPrompt,
  buildProjectManifest,
  formatConversationHistory,
  formatViewContext,
  formatReferences,
  formatSelectionContext,
  streamAssistantResponse,
  type ViewContext,
  type ReferenceItem,
  type SelectionContext,
} from "../services/codaScopeChatOrchestrator.js";
import type { MessageContext } from "../services/codaScopeChatService.js";
import { createSseTerminalWriter } from "./utils/ssePipelineHelper.js";

function parseMessageContext(value: Record<string, unknown> | undefined): MessageContext | null {
  if (!value || typeof value.view !== "string" || !value.view.trim()) return null;
  return {
    view: value.view,
    ...(typeof value.topicId === "string" || value.topicId === null ? { topicId: value.topicId } : {}),
    ...(typeof value.projectName === "string" ? { projectName: value.projectName } : {}),
    ...(typeof value.projectId === "string" ? { projectId: value.projectId } : {}),
    ...(typeof value.noteScope === "string" || value.noteScope === null ? { noteScope: value.noteScope } : {}),
    ...(typeof value.noteVisibility === "string" || value.noteVisibility === null ? { noteVisibility: value.noteVisibility } : {}),
    ...(typeof value.notePath === "string" || value.notePath === null ? { notePath: value.notePath } : {}),
  };
}

export function registerChatRoutes(ctx: CodaScopeRouteContext): void {
  const { app, authService, httpError, ensureServices, wrap, param, principal, upload } = ctx;

  // ── Conversations — CRUD ─────────────────────────────────────────

  // List conversations
  app.get("/api/codascope/projects/:id/conversations", wrap(async (req, res) => {
    const { chatSvc } = await ensureServices();
    const id = param(req, "id");
    const conversations = await chatSvc.listConversations(id, principal(req).username);
    res.json({ conversations });
  }));

  // Ownerless records predate per-user custody. They are visible only to an
  // administrator performing a deliberate assignment; normal users cannot
  // list, read, or self-claim them.
  app.get("/api/codascope/projects/:id/conversations/legacy", wrap(async (req, res) => {
    const actor = principal(req);
    if (!actor.isAdmin) throw httpError("Administrator access is required.", 403, "forbidden");
    const { chatSvc } = await ensureServices();
    const conversations = await chatSvc.listLegacyConversations(param(req, "id"));
    res.json({ conversations });
  }));

  app.patch("/api/codascope/projects/:id/conversations/:convId/owner", wrap(async (req, res) => {
    const actor = principal(req);
    if (!actor.isAdmin) throw httpError("Administrator access is required.", 403, "forbidden");

    const targetUsername = typeof req.body?.targetUsername === "string" ? req.body.targetUsername.trim() : "";
    if (!targetUsername) throw httpError("targetUsername is required.", 400, "invalid_input");
    try {
      await authService.getUser(targetUsername);
    } catch {
      throw httpError("Target user not found.", 400, "invalid_input");
    }

    const { chatSvc } = await ensureServices();
    const conversation = await chatSvc.assignLegacyConversationOwner(
      param(req, "id"),
      param(req, "convId"),
      targetUsername,
    );
    if (!conversation) throw httpError("Legacy conversation not found.", 404, "not_found");
    res.json({ conversation });
  }));

  // Create conversation
  app.post("/api/codascope/projects/:id/conversations", wrap(async (req, res) => {
    const { chatSvc } = await ensureServices();
    const id = param(req, "id");
    const { title, modelId } = req.body as { title?: string; modelId?: string };
    const conversation = await chatSvc.createConversation(id, principal(req).username, { title, modelId });
    res.status(201).json({ conversation });
  }));

  // Read conversation
  app.get("/api/codascope/projects/:id/conversations/:convId", wrap(async (req, res) => {
    const { chatSvc } = await ensureServices();
    const id = param(req, "id");
    const convId = param(req, "convId");
    const conversation = await chatSvc.readConversation(id, convId, principal(req).username);
    if (!conversation) throw httpError("Conversation not found.", 404, "not_found");
    res.json({ conversation });
  }));

  // Update conversation (title)
  app.patch("/api/codascope/projects/:id/conversations/:convId", wrap(async (req, res) => {
    const { chatSvc } = await ensureServices();
    const id = param(req, "id");
    const convId = param(req, "convId");
    const { title, summary } = req.body as { title?: string; summary?: string };
    const conversation = await chatSvc.updateConversation(id, convId, principal(req).username, { title, summary });
    if (!conversation) throw httpError("Conversation not found.", 404, "not_found");
    res.json({ conversation });
  }));

  // Delete a conversation
  app.delete("/api/codascope/projects/:id/conversations/:convId", wrap(async (req, res) => {
    const { chatSvc, imageSvc } = await ensureServices();
    const id = param(req, "id");
    const convId = param(req, "convId");
    const actorId = principal(req).username;
    // Authorize image cleanup before deleting the conversation record. The
    // image service repeats this check so direct callers cannot bypass it.
    const conversation = await chatSvc.readConversation(id, convId, actorId);
    if (!conversation) throw httpError("Conversation not found.", 404, "not_found");
    await imageSvc.pruneConversationImages(id, convId, actorId);
    const deleted = await chatSvc.deleteConversation(id, convId, actorId);
    if (!deleted) throw httpError("Conversation not found.", 404, "not_found");
    res.json({ ok: true });
  }));

  // ── Send Message — SSE Streaming ─────────────────────────────────

  app.post("/api/codascope/projects/:id/conversations/:convId/messages", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const svcs = await ensureServices();
      const { agentSvc, chatSvc, epicSvc, imageSvc } = svcs;
      const id = param(req, "id");
      const actorId = principal(req).username;
      const convId = param(req, "convId");
      const { message, modelId, context, attachments, references, selectionContext } = req.body as {
        message?: string;
        modelId?: string;
        context?: Record<string, unknown>;
        attachments?: Array<{ type: string; path: string }>;
        references?: Array<{ category: string; id: string; label?: string }>;
        selectionContext?: { blockId: string; text: string; startLine: number; endLine: number; docId: string; epicId?: string };
      };

      if (!message || typeof message !== "string" || !message.trim()) {
        throw httpError("message is required.", 400, "invalid_input");
      }
      if (!modelId || typeof modelId !== "string") {
        throw httpError("modelId is required.", 400, "invalid_input");
      }
      if (attachments !== undefined && !Array.isArray(attachments)) {
        throw httpError("attachments must be an array.", 400, "invalid_input");
      }
      const persistedContext = parseMessageContext(context);
      if (context !== undefined && !persistedContext) {
        throw httpError("context.view must be a non-empty string.", 400, "invalid_input");
      }

      // Verify ownership before reading attachments, persisting messages, or
      // assembling history for an agent run. An unauthorized ID deliberately
      // looks identical to an unknown conversation.
      const ownedConversation = await chatSvc.readConversation(id, convId, actorId);
      if (!ownedConversation) throw httpError("Conversation not found.", 404, "not_found");

      // Resolve image attachments: read from disk and base64-encode for the SDK
      const imageAttachmentPaths: Array<{ path: string; filename: string }> = [];
      const sdkImages: Array<{ data: string; mimeType: string }> = [];
      if (attachments && Array.isArray(attachments)) {
        for (const att of attachments) {
          if (att.type !== "image" || !att.path) continue;
          // att.path is relative like "conversations/<convId>/images/<filename>"
          const filename = path.basename(att.path);
          const absPath = await imageSvc.getImagePath(id, convId, filename, actorId);
          if (absPath && existsSync(absPath)) {
            const buffer = readFileSync(absPath);
            const ext = path.extname(filename).toLowerCase();
            const mimeMap: Record<string, string> = {
              ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
              ".gif": "image/gif", ".webp": "image/webp",
            };
            sdkImages.push({
              data: buffer.toString("base64"),
              mimeType: mimeMap[ext] ?? "image/png",
            });
            imageAttachmentPaths.push({ path: att.path, filename });
          }
        }
      }

      // Persist user message (with image metadata if present)
      const userMsgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const afterUserMessage = await chatSvc.appendMessage(id, convId, actorId, {
        id: userMsgId,
        role: "user",
        content: message.trim(),
        modelId: null,
        status: "complete",
        context: persistedContext,
        ...(imageAttachmentPaths.length > 0 ? { metadata: { images: imageAttachmentPaths } } : {}),
      });
      if (!afterUserMessage) throw httpError("Conversation not found.", 404, "not_found");

      // Create a placeholder for the assistant message
      const assistantMsgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const afterPlaceholder = await chatSvc.appendMessage(id, convId, actorId, {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        modelId,
        status: "streaming",
      });
      if (!afterPlaceholder) throw httpError("Conversation not found.", 404, "not_found");

      // ── Build manifest + system prompt ─────────────────────────────
      const manifest = await buildManifestFromServices(id, svcs);
      const manifestStr = buildProjectManifest(manifest);

      // Format conversation history (prior messages, not including current)
      const conversation = await chatSvc.readConversation(id, convId, actorId);
      const priorMessages = (conversation?.messages ?? [])
        .filter((m) => m.id !== userMsgId && m.id !== assistantMsgId)
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
        .map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt }));
      const historyStr = formatConversationHistory(priorMessages);

      // Format view context (enriched with topicTitle, filePath, recentViews, epicId, epicTab)
      const ctxRecord = context as Record<string, unknown> | undefined;
      const viewCtx: ViewContext | null = ctxRecord
        ? {
            view: (ctxRecord.view as string) ?? "unknown",
            topicId: (ctxRecord.topicId as string) ?? null,
            topicTitle: (ctxRecord.topicTitle as string) ?? null,
            filePath: (ctxRecord.filePath as string) ?? null,
            recentViews: Array.isArray(ctxRecord.recentViews)
              ? (ctxRecord.recentViews as Array<{ view: string; label: string }>)
              : undefined,
            projectName: (ctxRecord.projectName as string) ?? "",
            projectId: id,
            epicId: (ctxRecord.epicId as string) ?? null,
            epicTitle: (ctxRecord.epicTitle as string) ?? null,
            epicTab: (ctxRecord.epicTab as string) ?? null,
            noteScope: (ctxRecord.noteScope as string) ?? null,
            noteVisibility: (ctxRecord.noteVisibility as string) ?? null,
            notePath: (ctxRecord.notePath as string) ?? null,
          }
        : null;
      const viewStr = formatViewContext(viewCtx);

      // Build epic context if the user is viewing an epic
      let epicContextStr = "";
      if (viewCtx?.view === "epic" && viewCtx.epicId && epicSvc) {
        try {
          const epicDetail = await epicSvc.getEpic(id, viewCtx.epicId);
          if (epicDetail) {
            // Fetch knowledge + curation data in parallel (best-effort)
            let epicWikiPages: Array<{ id: string; title: string }> = [];
            let researchSourceSummary: { total: number; ready: number; pending: number; error: number } | undefined;
            let curationSummary: { pendingReasonCount: number; lastCuratedAt: string | null; lastCurationStatus: string | null } | undefined;

            try {
              const { epicKnowledgeSvc, curationSvc } = await ensureServices();
              const [wikiPages, sources, reasons, latestLog] = await Promise.all([
                epicKnowledgeSvc.listEpicWikiPages(id, viewCtx.epicId),
                epicKnowledgeSvc.listSources(id, viewCtx.epicId),
                curationSvc.getReasons(id, viewCtx.epicId),
                curationSvc.getLatestLog(id, viewCtx.epicId),
              ]);
              epicWikiPages = (wikiPages ?? []).map((p: { id: string; title: string }) => ({ id: p.id, title: p.title }));
              const srcList = sources ?? [];
              researchSourceSummary = {
                total: srcList.length,
                ready: srcList.filter((s: { status: string }) => s.status === "ready").length,
                pending: srcList.filter((s: { status: string }) => s.status === "pending" || s.status === "processing").length,
                error: srcList.filter((s: { status: string }) => s.status === "error").length,
              };
              curationSummary = {
                pendingReasonCount: (reasons ?? []).length,
                lastCuratedAt: latestLog?.completedAt ?? null,
                lastCurationStatus: latestLog?.status ?? null,
              };
            } catch { /* knowledge/curation data is best-effort */ }

            const { buildEpicContext } = await import("../services/codaScopeChatOrchestrator.js");
            epicContextStr = "\n\n## Epic Context\n\n" + buildEpicContext({
              epicId: epicDetail.id,
              title: epicDetail.title,
              status: epicDetail.status,
              definition: epicDetail.definition,
              scope: epicDetail.scope ? { entryCount: (epicDetail.scope.entries ?? []).length, lastScopedAt: epicDetail.scope.lastScopedAt } : null,
              designDocCount: (epicDetail.designDocs ?? []).length,
              conversationId: convId,
              epicWikiPageCount: epicWikiPages.length,
              epicWikiPageTitles: epicWikiPages,
              researchSources: researchSourceSummary,
              curation: curationSummary,
            });
          }
        } catch { /* epic context is best-effort */ }
      }

      // Format @-mention references into prompt context
      const referencesStr = references && references.length > 0
        ? "\n\n" + formatReferences(references as ReferenceItem[])
        : "";

      // Format selection context into prompt context (Phase 3)
      const selectionStr = selectionContext && selectionContext.text
        ? "\n\n" + formatSelectionContext(selectionContext as SelectionContext)
        : "";

      // Build the full system prompt with all context injected
      const systemPrompt = buildAssistantPrompt(manifestStr, historyStr, viewStr + epicContextStr + referencesStr + selectionStr, message.trim());

      // Set up SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let aborted = false;
      res.on("close", () => {
        aborted = true;
      });
      const terminal = createSseTerminalWriter(res, () => aborted);

      try {
        const { fullResponse, actions, agentResult } = await streamAssistantResponse({
          projectId: id,
          actorId,
          message: message.trim(),
          modelId,
          systemPrompt,
          agentSvc,
          ...(sdkImages.length > 0 ? { images: sdkImages } : {}),
          onMessage: (msg) => {
            if (aborted || terminal.terminalEvent()) return;
            res.write(`data: ${JSON.stringify(msg)}\n\n`);
          },
        });

        // Update assistant message with final content + actions
        try {
          const conv = await chatSvc.readConversation(id, convId, actorId);
          if (conv) {
            const updated = {
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: fullResponse,
                      status: "complete" as const,
                      updatedAt: new Date().toISOString(),
                      metadata: {
                        ...(m.metadata ?? {}),
                        ...(actions.length > 0 ? { actions } : {}),
                      },
                    }
                  : m,
              ),
            };
            await chatSvc.writeConversation(id, actorId, updated);
          }
        } catch {
          // Best effort persistence
        }
        terminal.done({ ...agentResult as object, conversationId: convId, actions });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const partialResponse = (err as { fullResponse?: string }).fullResponse ?? "";
        // Mark assistant message as error
        try {
          const conv = await chatSvc.readConversation(id, convId, actorId);
          if (conv) {
            const updated = {
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: partialResponse || `Error: ${errMsg}`, status: "error" as const, updatedAt: new Date().toISOString() }
                  : m,
              ),
            };
            await chatSvc.writeConversation(id, actorId, updated);
          }
        } catch {
          // Best effort
        }
        terminal.error(errMsg);
      }
    })().catch(next);
  });

  // ── Assistant (Right Panel) — SSE Streaming ─────────────────────
  // Backwards-compatible endpoint: auto-creates or reuses a conversation.

  app.post("/api/codascope/projects/:id/assistant", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const svcs = await ensureServices();
      const { agentSvc, chatSvc } = svcs;
      const id = param(req, "id");
      const actorId = principal(req).username;
      const { message, modelId, context, conversationId } = req.body as {
        message?: string;
        modelId?: string;
        context?: string;
        conversationId?: string;
      };

      if (!message || typeof message !== "string" || !message.trim()) {
        throw httpError("message is required.", 400, "invalid_input");
      }
      if (!modelId || typeof modelId !== "string") {
        throw httpError("modelId is required.", 400, "invalid_input");
      }

      // Resolve or create conversation
      let convId = conversationId;
      if (!convId) {
        const conv = await chatSvc.createConversation(id, actorId, { modelId });
        convId = conv.id;
      } else {
        const conversation = await chatSvc.readConversation(id, convId, actorId);
        if (!conversation) throw httpError("Conversation not found.", 404, "not_found");
      }

      // Persist user message
      const afterUserMessage = await chatSvc.appendMessage(id, convId, actorId, {
        role: "user",
        content: message.trim(),
        status: "complete",
      });
      if (!afterUserMessage) throw httpError("Conversation not found.", 404, "not_found");

      // ── Build manifest + system prompt ─────────────────────────────
      const manifest = await buildManifestFromServices(id, svcs);
      const manifestStr = buildProjectManifest(manifest);

      // Format conversation history
      const conversation = await chatSvc.readConversation(id, convId, actorId);
      const priorMessages = (conversation?.messages ?? [])
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
        .slice(0, -1) // exclude the just-appended user message (it's the current one)
        .map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt }));
      const historyStr = formatConversationHistory(priorMessages);

      // Parse view context from the string (backwards-compat format)
      const viewStr = context?.trim() ?? "The user's current view is unknown.";

      // Build system prompt
      const systemPrompt = buildAssistantPrompt(manifestStr, historyStr, viewStr, message.trim());

      // Set up SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let aborted = false;
      res.on("close", () => {
        aborted = true;
      });
      const terminal = createSseTerminalWriter(res, () => aborted);

      try {
        const { fullResponse, actions, agentResult } = await streamAssistantResponse({
          projectId: id,
          actorId,
          message: message.trim(),
          modelId,
          systemPrompt,
          agentSvc,
          onMessage: (msg) => {
            if (aborted || terminal.terminalEvent()) return;
            res.write(`data: ${JSON.stringify(msg)}\n\n`);
          },
        });

        if (fullResponse) {
          await chatSvc.appendMessage(id, convId!, actorId, {
            role: "assistant",
            content: fullResponse,
            modelId,
            status: "complete",
            metadata: actions.length > 0 ? { actions } : undefined,
          }).catch(() => { /* best effort */ });
        }
        terminal.done({ ...agentResult as object, conversationId: convId, actions });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const partialResponse = (err as { fullResponse?: string }).fullResponse ?? "";
        if (partialResponse) {
          await chatSvc.appendMessage(id, convId!, actorId, {
            role: "assistant",
            content: partialResponse,
            modelId,
            status: "error",
          }).catch(() => { /* best effort */ });
        }
        terminal.sendEvent("error", { error: errMsg, conversationId: convId });
      }
    })().catch(next);
  });

  // ── Cancel Agent Chat ──────────────────────────────────────────────

  app.post("/api/codascope/projects/:id/assistant/cancel", wrap(async (req, res) => {
    const { agentSvc } = await ensureServices();
    const id = param(req, "id");
    const cancelled = agentSvc.cancelAgent(id, principal(req).username);
    res.json({ cancelled });
  }));

  // ── Images ─────────────────────────────────────────────────────────

  // Upload image for a conversation
  app.post("/api/codascope/projects/:id/conversations/:convId/images", upload.single("image"), wrap(async (req, res) => {
    const { chatSvc, imageSvc } = await ensureServices();
    const id = param(req, "id");
    const convId = param(req, "convId");
    const actorId = principal(req).username;
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) throw httpError("No image file provided.", 400, "invalid_input");
    if (!await chatSvc.readConversation(id, convId, actorId)) {
      throw httpError("Conversation not found.", 404, "not_found");
    }
    const result = await imageSvc.uploadImage(id, convId, actorId, file.buffer, file.mimetype, file.originalname);
    res.status(201).json(result);
  }));

  // Serve a conversation image
  app.get("/api/codascope/projects/:id/conversations/:convId/images/:filename", wrap(async (req, res) => {
    const { imageSvc } = await ensureServices();
    const id = param(req, "id");
    const convId = param(req, "convId");
    const filename = param(req, "filename");
    const filePath = await imageSvc.getImagePath(id, convId, filename, principal(req).username);
    if (!filePath) throw httpError("Image not found.", 404, "not_found");

    // Determine content type from extension
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    res.setHeader("Content-Type", mimeTypes[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(filePath);
  }));
}
