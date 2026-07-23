/* ── CodaScope: Shared SSE Pipeline Helper ──────────────────────────
   Encapsulates the common SSE setup pattern used by research, curation,
   and deepen pipelines. Eliminates ~180 lines of duplicated boilerplate
   across 3 route files.

   Each SSE pipeline follows the same lifecycle:
     1. Pre-stream validation (before headers are sent)
     2. SSE header setup + abort tracking
     3. Build state registration (startBuild)
     4. Pipeline execution with sendEvent/sendMessage/isAborted
     5. Build state completion (completeBuild/failBuild)
     6. SSE stream teardown
   ──────────────────────────────────────────────────────────────────── */

import type { Request, Response } from "express";
import type { CodaScopeBuildStateService } from "../../services/codaScopeBuildStateService.js";

/* ── Types ────────────────────────────────────────────────────────── */

export interface SseCallbacks {
  sendEvent: (event: string, data: unknown) => void;
  sendMessage: (msg: unknown) => void;
  isAborted: () => boolean;
  isClientDisconnected: () => boolean;
  isCancelled: () => boolean;
  terminal: SseTerminalWriter;
}

export type StandardSseTerminalEvent = "done" | "error" | "cancelled";

export interface SseTerminalWriter {
  sendEvent: (event: string, data: unknown) => boolean;
  done: (data?: Record<string, unknown>) => boolean;
  error: (error: unknown) => boolean;
  cancelled: (data?: Record<string, unknown>) => boolean;
  terminalEvent: () => StandardSseTerminalEvent | null;
  isResponseEnding: () => boolean;
}

export interface SsePipelineConfig {
  /** Project ID for build state tracking. */
  projectId: string;
  /** Build scope key (e.g. "research::epicId", "curation::epicId"). */
  scope: string;
  /** Build type label for build state (e.g. "research", "curation", "epic-deepen"). */
  buildType: string;
  /** Model ID for build state tracking. */
  modelId: string;
  /** Build state service instance. */
  buildSvc: CodaScopeBuildStateService;
  /** Optional project directory to register before starting the build. */
  projectDir?: string;
}

export interface SsePipelineResult {
  runId: string;
  callbacks: SseCallbacks;
}

/** Exactly-once SSE writer shared by every route that owns a stream terminal. */
export function createSseTerminalWriter(
  res: Response,
  isClientDisconnected: () => boolean = () => false,
): SseTerminalWriter {
  let terminal: StandardSseTerminalEvent | null = null;
  let responseEnding = false;
  let terminalPublishing = false;

  const serializeFrame = (event: string, data: unknown): string => {
    const payload = JSON.stringify(data);
    if (typeof payload !== "string") {
      throw new TypeError(`SSE ${event} payload did not serialize to JSON.`);
    }
    return `event: ${event}\ndata: ${payload}\n\n`;
  };

  const write = (event: string, data: unknown): boolean => {
    if (terminal || terminalPublishing || isClientDisconnected() || res.writableEnded) return false;
    const frame = serializeFrame(event, data);
    res.write(frame);
    return true;
  };

  const writeTerminal = (event: StandardSseTerminalEvent, data: Record<string, unknown>): boolean => {
    if (terminal || terminalPublishing || isClientDisconnected() || res.writableEnded) return false;
    terminalPublishing = true;

    try {
      let publishedEvent = event;
      let frame: string;
      try {
        frame = serializeFrame(event, data);
      } catch {
        publishedEvent = "error";
        frame = serializeFrame("error", {
          error: `Server could not serialize ${event} terminal payload.`,
        });
      }

      // Serialization and validation are complete before terminal ownership.
      // res.write accepts the full frame synchronously, even when it reports
      // backpressure with a false return value.
      res.write(frame);
      terminal = publishedEvent;
      responseEnding = true;
      res.end();
      return true;
    } finally {
      terminalPublishing = false;
    }
  };

  return {
    sendEvent: (event, data) => {
      const objectData = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      if (event === "done") {
        return objectData
          ? writeTerminal("done", objectData)
          : writeTerminal("error", { error: "Server produced a malformed done terminal payload." });
      }
      if (event === "cancelled") {
        return objectData
          ? writeTerminal("cancelled", objectData)
          : writeTerminal("error", { error: "Server produced a malformed cancelled terminal payload." });
      }
      if (event === "error") {
        const message = objectData?.error;
        return writeTerminal("error", {
          ...(objectData ?? {}),
          error: typeof message === "string" && message.trim()
            ? message
            : "SSE pipeline failed without an error message.",
        });
      }
      return write(event, data);
    },
    done: (data = {}) => writeTerminal("done", data),
    error: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      return writeTerminal("error", {
        error: message.trim() ? message : "SSE pipeline failed without an error message.",
      });
    },
    cancelled: (data = {}) => writeTerminal("cancelled", data),
    terminalEvent: () => terminal,
    isResponseEnding: () => responseEnding,
  };
}

/* ── SSE Pipeline Handler ────────────────────────────────────────── */

/**
 * Sets up an SSE pipeline with build state tracking.
 *
 * Returns `null` if a build is already in progress for the given scope
 * (responds with 409 to the client).
 *
 * Otherwise, sets up SSE headers, abort tracking, and returns:
 * - `runId` — the build run ID
 * - `callbacks` — { sendEvent, sendMessage, isAborted }
 *
 * The caller is responsible for:
 * 1. Calling the pipeline orchestrator with the callbacks
 * 2. Calling `completeSsePipeline()` or letting errors propagate
 */
export function initSsePipeline(
  req: Request,
  res: Response,
  config: SsePipelineConfig,
): SsePipelineResult | null {
  const { projectId, scope, buildType, modelId, buildSvc, projectDir } = config;

  // Register project dir if available
  if (projectDir) {
    buildSvc.registerProjectDir(projectId, projectDir);
  }

  // Start a scoped build
  const runId = buildSvc.startBuild(projectId, buildType, modelId, scope);
  if (!runId) {
    res.status(409).json({
      error: `A ${buildType} pipeline is already running for this scope.`,
      code: "build_in_progress",
    });
    return null;
  }

  // Set up SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Keep transport disconnect separate from deliberate server cancellation.
  let clientDisconnected = false;
  const isClientDisconnected = () => clientDisconnected;
  const isCancelled = () => buildSvc.isCancelled(projectId, scope);
  const isAborted = () => isClientDisconnected() || isCancelled();
  const terminal = createSseTerminalWriter(res, isClientDisconnected);
  res.on("close", () => {
    if (!terminal.isResponseEnding()) clientDisconnected = true;
  });

  const sendEvent = (event: string, data: unknown) => {
    const standardTerminal = event === "done" || event === "error" || event === "cancelled";
    if (!standardTerminal && isAborted()) return;
    terminal.sendEvent(event, data);
  };

  const sendMessage = (msg: unknown) => {
    const msgJson = JSON.stringify(msg);
    buildSvc.appendOutput(projectId, runId, msgJson + "\n", scope);
    if (isAborted() || terminal.terminalEvent()) return;
    res.write(`event: message\ndata: ${msgJson}\n\n`);
  };

  return {
    runId,
    callbacks: {
      sendEvent,
      sendMessage,
      isAborted,
      isClientDisconnected,
      isCancelled,
      terminal,
    },
  };
}

/**
 * Complete an SSE pipeline: mark build as complete, send done event, end response.
 */
export function completeSsePipeline(
  res: Response,
  config: Pick<SsePipelineConfig, "projectId" | "scope" | "buildSvc">,
  runId: string,
  callbacks: Pick<SseCallbacks, "isAborted" | "isClientDisconnected" | "isCancelled" | "terminal">,
): void {
  const existingTerminal = callbacks.terminal.terminalEvent();
  if (existingTerminal) {
    if (existingTerminal === "cancelled" && callbacks.isCancelled()) {
      config.buildSvc.clearCancellation(config.projectId, config.scope);
    }
    return;
  }

  if (callbacks.isAborted()) {
    config.buildSvc.failBuild(config.projectId, runId, "Pipeline cancelled.", config.scope);
    if (callbacks.isCancelled()) config.buildSvc.clearCancellation(config.projectId, config.scope);
    callbacks.terminal.cancelled({ runId });
    return;
  }
  config.buildSvc.completeBuild(config.projectId, runId, undefined, undefined, config.scope);
  callbacks.terminal.done({});
}

/**
 * Fail an SSE pipeline: mark build as failed, send error event, end response.
 */
export function failSsePipeline(
  res: Response,
  config: Pick<SsePipelineConfig, "projectId" | "scope" | "buildSvc">,
  runId: string,
  error: unknown,
  callbacks: Pick<SseCallbacks, "isCancelled" | "terminal">,
): void {
  const message = error instanceof Error ? error.message : String(error);
  if (callbacks.terminal.terminalEvent()) return;
  config.buildSvc.failBuild(config.projectId, runId, message, config.scope);
  if (callbacks.isCancelled()) config.buildSvc.clearCancellation(config.projectId, config.scope);
  callbacks.terminal.error(message);
}

/**
 * Handle pre-stream errors (before SSE headers are sent).
 * Falls back to JSON error response if headers haven't been sent,
 * otherwise writes an SSE error event.
 */
export function handlePreStreamError(res: Response, error: unknown): void {
  if (!res.headersSent) {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as any)?.status ?? 500;
    res.status(status).json({ error: message });
  } else {
    createSseTerminalWriter(res).error(error);
  }
}
