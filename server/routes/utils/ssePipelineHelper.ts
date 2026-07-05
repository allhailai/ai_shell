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

  // Abort tracking
  let aborted = false;
  req.on("close", () => { aborted = true; });

  const isAborted = () => aborted || buildSvc.isCancelled(projectId, scope);

  const sendEvent = (event: string, data: unknown) => {
    if (isAborted()) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const sendMessage = (msg: unknown) => {
    const msgJson = JSON.stringify(msg);
    buildSvc.appendOutput(projectId, runId, msgJson + "\n", scope);
    if (isAborted()) return;
    res.write(`event: message\ndata: ${msgJson}\n\n`);
  };

  return { runId, callbacks: { sendEvent, sendMessage, isAborted } };
}

/**
 * Complete an SSE pipeline: mark build as complete, send done event, end response.
 */
export function completeSsePipeline(
  res: Response,
  config: Pick<SsePipelineConfig, "projectId" | "scope" | "buildSvc">,
  runId: string,
  isAborted: () => boolean,
): void {
  config.buildSvc.completeBuild(config.projectId, runId, undefined, undefined, config.scope);
  if (!isAborted()) {
    res.write(`event: done\ndata: ${JSON.stringify({})}\n\n`);
    res.end();
  }
}

/**
 * Fail an SSE pipeline: mark build as failed, send error event, end response.
 */
export function failSsePipeline(
  res: Response,
  config: Pick<SsePipelineConfig, "projectId" | "scope" | "buildSvc">,
  runId: string,
  error: unknown,
  isAborted: () => boolean,
): void {
  const message = error instanceof Error ? error.message : String(error);
  config.buildSvc.failBuild(config.projectId, runId, message, config.scope);
  if (!isAborted()) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
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
    res.write(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n\n`);
    res.end();
  }
}
