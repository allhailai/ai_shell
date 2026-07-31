/* ── CodaScope: Workspace Conversation Routes ───────────────────────
   Authenticated actor-owned CRUD, stable-message SSE, images, and isolated
   workspace cancellation.
   ──────────────────────────────────────────────────────────────────── */

import type { NextFunction, Request, Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import {
  createWorkspaceMessageContext,
} from "../services/codaScopeWorkspaceConversationService.js";
import {
  streamWorkspaceAssistantResponse,
  WorkspaceAssistantCancelledError,
} from "../services/codaScopeWorkspaceChatOrchestrator.js";
import {
  createSseTerminalWriter,
} from "./utils/ssePipelineHelper.js";
import { assertSafePathSegment } from "../services/codaScopePathSafety.js";
import type { CodaScopeAction } from "../../src/apps/codascope/codaScopeTypes.js";
import {
  canonicalizeWorkspaceNoteRangeTarget,
  WorkspaceNoteRangeTargetInvalidError,
} from "../services/codaScopeWorkspaceNoteRangeTarget.js";
import {
  contextualizeWorkspaceAssistantFailure,
  reportWorkspaceAssistantFailure,
  workspaceAssistantFailureMetadata,
  WorkspaceAssistantDiagnosticError,
} from "../services/codaScopeWorkspaceAssistantDiagnostics.js";

const MAX_ATTACHMENTS = 10;
const MODEL_ID_MAX = 255;
const MESSAGE_MAX = 200_000;

export function registerWorkspaceChatRoutes(ctx: CodaScopeRouteContext): void {
  const { app, ensureServices, httpError, param, principal, upload, wrap } = ctx;

  app.get("/api/codascope/workspace/projects", wrap(async (req, res) => {
    // The catalog is workspace-global but remains authenticated.
    principal(req);
    const { workspaceCatalogSvc } = await ensureServices();
    const catalog = await workspaceCatalogSvc.listActiveProjectReferences();
    res.json({
      scope: { kind: "workspace" },
      ...catalog,
    });
  }));

  app.get("/api/codascope/workspace/conversations", wrap(async (req, res) => {
    const { workspaceConversationSvc } = await ensureServices();
    const conversations = await workspaceConversationSvc.listConversations(
      principal(req).username,
    );
    res.json({ scope: { kind: "workspace" }, conversations });
  }));

  app.post("/api/codascope/workspace/conversations", wrap(async (req, res) => {
    const { workspaceConversationSvc } = await ensureServices();
    const body = requestBody(req);
    rejectClientAuthorizationInputs(body, httpError);
    const title = optionalBoundedString(body.title, 72, "title", httpError);
    const modelId = optionalBoundedString(
      body.modelId,
      MODEL_ID_MAX,
      "modelId",
      httpError,
    );
    const conversation = await workspaceConversationSvc.createConversation(
      principal(req).username,
      { title, modelId },
    );
    res.status(201).json({ conversation });
  }));

  app.get(
    "/api/codascope/workspace/conversations/:convId",
    wrap(async (req, res) => {
      const { workspaceConversationSvc } = await ensureServices();
      const conversation = await workspaceConversationSvc.readConversation(
        principal(req).username,
        param(req, "convId"),
      );
      if (!conversation) {
        throw httpError("Conversation not found.", 404, "not_found");
      }
      res.json({ conversation });
    }),
  );

  app.patch(
    "/api/codascope/workspace/conversations/:convId",
    wrap(async (req, res) => {
      const { workspaceConversationSvc } = await ensureServices();
      const body = requestBody(req);
      rejectClientAuthorizationInputs(body, httpError);
      const conversation = await workspaceConversationSvc.updateConversation(
        principal(req).username,
        param(req, "convId"),
        {
          title: optionalBoundedString(body.title, 72, "title", httpError),
          summary: optionalBoundedString(body.summary, 240, "summary", httpError),
        },
      );
      if (!conversation) {
        throw httpError("Conversation not found.", 404, "not_found");
      }
      res.json({ conversation });
    }),
  );

  app.delete(
    "/api/codascope/workspace/conversations/:convId",
    wrap(async (req, res) => {
      const { workspaceConversationSvc } = await ensureServices();
      const deleted = await workspaceConversationSvc.deleteConversation(
        principal(req).username,
        param(req, "convId"),
      );
      if (!deleted) {
        throw httpError("Conversation not found.", 404, "not_found");
      }
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/codascope/workspace/conversations/:convId/messages",
    (req: Request, res: Response, next: NextFunction) => {
      void handleWorkspaceMessage(ctx, req, res).catch(next);
    },
  );

  app.post(
    "/api/codascope/workspace/conversations/:convId/images",
    upload.single("image"),
    wrap(async (req, res) => {
      const { workspaceConversationSvc, workspaceImageSvc } =
        await ensureServices();
      const actorId = principal(req).username;
      const conversationId = param(req, "convId");
      if (!await workspaceConversationSvc.readConversation(actorId, conversationId)) {
        throw httpError("Conversation not found.", 404, "not_found");
      }
      const file = (req as unknown as { file?: Express.Multer.File }).file;
      if (!file) {
        throw httpError("No image file provided.", 400, "invalid_input");
      }
      try {
        const result = await workspaceImageSvc.uploadImage(
          actorId,
          conversationId,
          file.buffer,
          file.mimetype,
        );
        res.status(201).json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message === "Conversation not found") {
          throw httpError("Conversation not found.", 404, "not_found");
        }
        if (message.startsWith("Unsupported image type")
          || message.startsWith("Image too large")) {
          throw httpError(message, 400, "invalid_input");
        }
        throw error;
      }
    }),
  );

  app.get(
    "/api/codascope/workspace/conversations/:convId/images/:filename",
    wrap(async (req, res) => {
      const { workspaceImageSvc } = await ensureServices();
      const filename = param(req, "filename");
      const filePath = await workspaceImageSvc.getImagePath(
        principal(req).username,
        param(req, "convId"),
        filename,
      );
      if (!filePath) throw httpError("Image not found.", 404, "not_found");
      res.setHeader("Content-Type", imageMimeType(filename));
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.sendFile(filePath);
    }),
  );

  app.post(
    "/api/codascope/workspace/assistant/cancel",
    wrap(async (req, res) => {
      const { agentSvc } = await ensureServices();
      const cancelled = agentSvc.cancelAgent({
        scope: { kind: "workspace" },
        actorId: principal(req).username,
      });
      res.json({ cancelled });
    }),
  );
}

async function handleWorkspaceMessage(
  ctx: CodaScopeRouteContext,
  req: Request,
  res: Response,
): Promise<void> {
  const { ensureServices, httpError, param, principal } = ctx;
  const services = await ensureServices();
  const {
    activeEntityResolver,
    agentSvc,
    workspaceCatalogSvc,
    workspaceConversationSvc,
    workspaceImageSvc,
    workspaceIntentSvc,
    workspaceNoteSvc,
  } = services;
  const actorId = principal(req).username;
  const conversationId = param(req, "convId");
  const body = requestBody(req);
  rejectClientAuthorizationInputs(body, httpError);
  rejectUnknownRequestFields(
    body,
    ["message", "modelId", "context", "attachments", "noteRangeTarget"],
    httpError,
  );

  const message = requiredBoundedString(
    body.message,
    MESSAGE_MAX,
    "message",
    httpError,
  );
  const modelId = requiredBoundedString(
    body.modelId,
    MODEL_ID_MAX,
    "modelId",
    httpError,
  );
  let context;
  try {
    context = createWorkspaceMessageContext(body.context);
  } catch {
    throw httpError("Invalid workspace message context.", 400, "invalid_input");
  }

  const owned = await workspaceConversationSvc.readConversation(
    actorId,
    conversationId,
  );
  if (!owned) throw httpError("Conversation not found.", 404, "not_found");

  let noteRangeTarget;
  if (body.noteRangeTarget !== undefined) {
    try {
      noteRangeTarget = await canonicalizeWorkspaceNoteRangeTarget({
        actorId,
        currentNote: context.currentNote,
        target: body.noteRangeTarget,
        noteService: workspaceNoteSvc,
      });
    } catch (error) {
      if (error instanceof WorkspaceNoteRangeTargetInvalidError) {
        throw httpError(
          "The selected CodaScope note range is invalid or stale.",
          400,
          "invalid_input",
        );
      }
      throw error;
    }
  }

  for (const projectId of context.explicitlyReferencedProjectIds) {
    if (!await activeEntityResolver.resolveActiveProject(projectId)) {
      throw httpError(
        "Explicit project references must identify active projects.",
        400,
        "invalid_input",
      );
    }
  }
  // Fail closed before the first durable message. The orchestrator derives
  // again immediately before agent execution to close archive races.
  await workspaceIntentSvc.resolveTurn(
    message,
    context.explicitlyReferencedProjectIds,
    {
      actorId,
      currentNote: context.currentNote,
      noteRangeTarget,
    },
  );

  const attachments = validateAttachments(
    body.attachments,
    conversationId,
    httpError,
  );
  const sdkImages = [];
  const persistedImages = [];
  for (const attachment of attachments) {
    const imagePath = await workspaceImageSvc.getImagePath(
      actorId,
      conversationId,
      attachment.filename,
    );
    if (!imagePath || !existsSync(imagePath)) {
      throw httpError("Image not found.", 404, "not_found");
    }
    const extension = path.extname(attachment.filename).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension)) {
      throw httpError("Unsupported image type.", 400, "invalid_input");
    }
    sdkImages.push({
      data: readFileSync(imagePath).toString("base64"),
      mimeType: imageMimeType(attachment.filename),
    });
    persistedImages.push({
      path: `${conversationId}/images/${attachment.filename}`,
      filename: attachment.filename,
    });
  }

  if (!workspaceConversationSvc.tryBeginConversationRun(actorId, conversationId)) {
    throw httpError(
      "A workspace assistant response is already in progress for this conversation.",
      409,
      "conversation_busy",
    );
  }

  let assistantMessageId = "";
  try {
    const userMessageId = createMessageId();
    const afterUser = await workspaceConversationSvc.appendMessage(
      actorId,
      conversationId,
      {
        id: userMessageId,
        role: "user",
        content: message,
        modelId: null,
        status: "complete",
        context,
        metadata: {
          ...(persistedImages.length > 0 ? { images: persistedImages } : {}),
          ...(noteRangeTarget ? { noteRangeTarget } : {}),
        },
      },
    );
    if (!afterUser) throw httpError("Conversation not found.", 404, "not_found");

    assistantMessageId = createMessageId();
    const afterPlaceholder = await workspaceConversationSvc.appendMessage(
      actorId,
      conversationId,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        modelId,
        status: "streaming",
        context,
      },
    );
    if (!afterPlaceholder) {
      throw httpError("Conversation not found.", 404, "not_found");
    }

    const history = afterPlaceholder.messages.filter(
      (candidate) =>
        candidate.id !== userMessageId
        && candidate.id !== assistantMessageId,
    );

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    let clientDisconnected = false;
    const terminal = createSseTerminalWriter(res, () => clientDisconnected);
    res.on("close", () => {
      if (!terminal.isResponseEnding()) clientDisconnected = true;
    });

    let generatedResponse = "";
    try {
      const result = await streamWorkspaceAssistantResponse({
        actorId,
        message,
        modelId,
        context,
        noteRangeTarget,
        history,
        catalog: workspaceCatalogSvc,
        intentService: workspaceIntentSvc,
        agentService: agentSvc,
        ...(sdkImages.length > 0 ? { images: sdkImages } : {}),
        onMessage: (delta) => {
          if (clientDisconnected || terminal.terminalEvent()) return;
          res.write(`data: ${JSON.stringify(delta)}\n\n`);
        },
      });
      generatedResponse = result.fullResponse;
      const donePayload = preflightDonePayload({
        ...(isRecord(result.agentResult) ? result.agentResult : {}),
        conversationId,
        assistantMessageId,
        retrievedSources: result.retrievedSources,
        actions: result.actions,
      });
      const persisted = await workspaceConversationSvc.completeAssistantMessage(
        actorId,
        conversationId,
        assistantMessageId,
        {
          content: result.fullResponse,
          retrievedSources: result.retrievedSources,
          actions: result.actions,
        },
      );
      if (!persisted) {
        throw new Error("Workspace assistant placeholder was unavailable.");
      }
      terminal.done(donePayload);
    } catch (error) {
      const partial = partialResponse(error) || generatedResponse;
      const actions = mutationActions(error);
      const cancelled = error instanceof WorkspaceAssistantCancelledError;
      const diagnostic = cancelled
        ? null
        : error instanceof WorkspaceAssistantDiagnosticError
          ? contextualizeWorkspaceAssistantFailure(error, {
              fullResponse: partial,
              actions,
            })
          : reportWorkspaceAssistantFailure("response_finalization", error, {
              fullResponse: partial,
              actions,
            });
      const failureContent = cancelled
        ? partial || "[Workspace assistant response cancelled.]"
        : partial
          ? `${partial}\n\n${diagnostic!.message}`
          : diagnostic!.message;
      const persistenceFailure = await persistWorkspaceFailure(
        workspaceConversationSvc,
        actorId,
        conversationId,
        assistantMessageId,
        failureContent,
        actions,
      );
      if (persistenceFailure) {
        terminal.sendEvent("error", {
          error: persistenceFailure.message,
          ...workspaceAssistantFailureMetadata(persistenceFailure),
        });
        return;
      }
      if (cancelled) {
        terminal.cancelled({
          conversationId,
          assistantMessageId,
          ...(actions.length > 0 ? { actions } : {}),
        });
      } else {
        terminal.sendEvent("error", {
          error: diagnostic!.message,
          ...workspaceAssistantFailureMetadata(diagnostic!),
          conversationId,
          assistantMessageId,
          ...(actions.length > 0 ? { actions } : {}),
        });
      }
    }
  } finally {
    workspaceConversationSvc.endConversationRun(actorId, conversationId);
  }
}

async function persistWorkspaceFailure(
  service: {
    recordAssistantMessageError: (
      actorId: string,
      conversationId: string,
      messageId: string,
      content: string,
      actions: readonly CodaScopeAction[],
    ) => Promise<unknown>;
  },
  actorId: string,
  conversationId: string,
  messageId: string,
  content: string,
  actions: readonly CodaScopeAction[],
): Promise<WorkspaceAssistantDiagnosticError | null> {
  if (!messageId) {
    return reportWorkspaceAssistantFailure(
      "failure_persistence",
      new Error("Workspace assistant message identity was unavailable."),
    );
  }
  try {
    const persisted = await service.recordAssistantMessageError(
      actorId,
      conversationId,
      messageId,
      content,
      actions,
    );
    if (persisted) return null;
    return reportWorkspaceAssistantFailure(
      "failure_persistence",
      new Error("Workspace assistant failure transition returned no record."),
    );
  } catch (error) {
    return reportWorkspaceAssistantFailure("failure_persistence", error);
  }
}

function validateAttachments(
  value: unknown,
  conversationId: string,
  httpError: CodaScopeRouteContext["httpError"],
): Array<{ filename: string }> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    throw httpError("attachments must be a bounded array.", 400, "invalid_input");
  }
  return value.map((candidate) => {
    if (!isRecord(candidate)
      || Object.keys(candidate).some((key) => key !== "type" && key !== "path")
      || candidate.type !== "image"
      || typeof candidate.path !== "string") {
      throw httpError("Invalid image attachment.", 400, "invalid_input");
    }
    const parts = candidate.path.split("/");
    if (parts.length !== 3
      || parts[0] !== conversationId
      || parts[1] !== "images"
      || !parts[2]) {
      throw httpError("Invalid image attachment path.", 400, "invalid_input");
    }
    try {
      assertSafePathSegment(parts[2], "image filename");
    } catch {
      throw httpError("Invalid image attachment path.", 400, "invalid_input");
    }
    return { filename: parts[2] };
  });
}

function rejectClientAuthorizationInputs(
  body: Record<string, unknown>,
  httpError: CodaScopeRouteContext["httpError"],
): void {
  for (const field of [
    "workspaceReadGrant",
    "workspaceNoteGrant",
    "noteGrant",
    "readGrant",
    "grant",
    "projectId",
    "scope",
    "ownerId",
    "actorId",
  ]) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      throw httpError(
        "Workspace authorization inputs are server-owned.",
        400,
        "invalid_input",
      );
    }
  }
}

function rejectUnknownRequestFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
  httpError: CodaScopeRouteContext["httpError"],
): void {
  const fields = new Set(allowed);
  if (Object.keys(body).some((field) => !fields.has(field))) {
    throw httpError(
      "Workspace message request contains unsupported fields.",
      400,
      "invalid_input",
    );
  }
}

function requestBody(req: Request): Record<string, unknown> {
  return isRecord(req.body) ? req.body : {};
}

function requiredBoundedString(
  value: unknown,
  maximum: number,
  field: string,
  httpError: CodaScopeRouteContext["httpError"],
): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw httpError(`${field} is required.`, 400, "invalid_input");
  }
  return value.trim();
}

function optionalBoundedString(
  value: unknown,
  maximum: number,
  field: string,
  httpError: CodaScopeRouteContext["httpError"],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maximum) {
    throw httpError(`${field} is invalid.`, 400, "invalid_input");
  }
  return value.trim();
}

function imageMimeType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return types[extension] ?? "application/octet-stream";
}

function preflightDonePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const serialized = JSON.stringify(payload);
    if (typeof serialized !== "string") throw new Error("not serializable");
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    throw new Error("Workspace assistant completion could not be serialized.");
  }
}

function partialResponse(error: unknown): string {
  return isRecord(error) && typeof error.fullResponse === "string"
    ? error.fullResponse
    : "";
}

function mutationActions(error: unknown): CodaScopeAction[] {
  if (!isRecord(error) || !Array.isArray(error.actions)) return [];
  return error.actions.filter((action): action is CodaScopeAction => (
    isRecord(action)
    && typeof action.type === "string"
    && isRecord(action.attributes)
    && typeof action.description === "string"
  ));
}

function createMessageId(): string {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
