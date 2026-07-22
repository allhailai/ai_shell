/* ── CodaScope: Build Routes ──────────────────────────────────────────
   Skills, agent runs, build status/cancel/logs, build log stream,
   and the analyze pipeline endpoint.
   ──────────────────────────────────────────────────────────────────── */

import type { Request, Response, NextFunction } from "express";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import { ensureReposMapped } from "./codaScopeCoreRoutes.js";
import type { TokenUsageRecord } from "../services/codaScopeBuildStateService.js";
import { buildBaseVars, loadCommandOrSkill } from "../services/codaScopeCommandLoader.js";
import { runAnalyzePipeline, runDeepRunPipeline } from "../services/codaScopeBuildOrchestrator.js";
import { existsSync, readFileSync, statSync } from "node:fs";

const WIKI_BUILD_COMMANDS = new Set([
  "do_explore",
  "do_build_full_wiki",
  "do_build_wiki_page",
  "do_build_wiki_delta",
  "do_deep_wiki_page",
  "do_wiki_cross_reference",
]);

export function registerBuildRoutes(ctx: CodaScopeRouteContext): void {
  const { app, httpError, ensureServices, wrap, param } = ctx;

  // ── Skills ──────────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/skills", wrap(async (req, res) => {
    const { skillSvc } = await ensureServices();
    const id = param(req, "id");
    const skills = await skillSvc.listSkills(id);
    res.json({ skills });
  }));

  app.post("/api/codascope/projects/:id/skills", wrap(async (req, res) => {
    const { skillSvc } = await ensureServices();
    const id = param(req, "id");
    const { name, description, category } = req.body as { name?: string; description?: string; category?: string };
    if (!name || typeof name !== "string" || !name.trim()) {
      throw httpError("name is required.", 400, "invalid_input");
    }
    const skill = await skillSvc.createSkill(id, {
      name: name.trim(),
      description: description?.trim() ?? "",
      category: category ?? "custom",
    });
    res.status(201).json({ skill });
  }));

  app.post("/api/codascope/projects/:id/skills/:skillId/run", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const { agentSvc, projectSvc, wikiSvc } = await ensureServices();
      const id = param(req, "id");
      const skillId = param(req, "skillId");
      await ensureReposMapped(projectSvc, id, httpError);
      const { modelId } = req.body as { modelId?: string };

      if (!modelId || typeof modelId !== "string") {
        throw httpError("modelId is required.", 400, "invalid_input");
      }

      const project = await projectSvc.getProject(id);
      if (!project) throw httpError("Project not found.", 404, "not_found");

      const projectDir = projectSvc.getProjectDir(id);
      if (!projectDir) throw httpError("Project directory not found.", 404, "not_found");

      // Build template variables
      const vars = buildBaseVars({
        projectName: project.name,
        projectDir,
        repositories: project.repositories,
      });

      // Load prompt — try project skill first, then framework command
      const prompt = loadCommandOrSkill(skillId, projectDir, vars);
      if (!prompt) {
        throw httpError(`Skill or command "${skillId}" not found.`, 404, "not_found");
      }

      // SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let aborted = false;
      req.on("close", () => { aborted = true; });

      await agentSvc.send({
        projectId: id,
        message: "Execute the following skill:\n\n" + prompt,
        modelId,
        systemPrompt:
          "You are CodaScope, an AI agent for codebase analysis and documentation. " +
          "Follow the instructions in the skill prompt precisely. " +
          "Use CodaScope tools for all source reads and project writes; never use native filesystem write tools.",
        purpose: "wiki-build",
        onMessage: (msg) => {
          if (aborted) return;
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
        },
        onDone: async (result) => {
          if (!aborted) {
            // Refresh wiki topics in case the skill created/modified wiki pages
            try {
              const topics = await wikiSvc.listTopics(id);
              res.write(`event: wiki-refresh\ndata: ${JSON.stringify({ topics })}\n\n`);
            } catch { /* ignore refresh errors */ }
            res.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
            res.end();
          }
        },
        onError: (err) => {
          if (aborted) return;
          res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
          res.end();
        },
      });
    })().catch(next);
  });

  // ── Agent Runs — SSE Streaming (with build state tracking) ──────

  app.post("/api/codascope/projects/:id/runs", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const { agentSvc, projectSvc, wikiSvc, buildSvc } = await ensureServices();
      const id = param(req, "id");
      const { command, modelId, topicName } = req.body as {
        command?: string;
        modelId?: string;
        topicName?: string;
      };

      if (!command) throw httpError("command is required.", 400, "invalid_input");
      if (!modelId || typeof modelId !== "string") {
        throw httpError("modelId is required.", 400, "invalid_input");
      }

      // Register the actual project directory so build-logs go to the right place
      const projectDir = projectSvc.getProjectDir(id);
      if (projectDir) buildSvc.registerProjectDir(id, projectDir);

      // Reject duplicate builds
      const runId = buildSvc.startBuild(id, command, modelId);
      if (!runId) {
        res.status(409).json({ error: "A build is already running for this project.", code: "build_in_progress" });
        return;
      }

      const project = await projectSvc.getProject(id);
      if (!project) {
        buildSvc.failBuild(id, runId, "Project not found.");
        throw httpError("Project not found.", 404, "not_found");
      }

      if (!projectDir) {
        buildSvc.failBuild(id, runId, "Project directory not found.");
        throw httpError("Project directory not found.", 404, "not_found");
      }

      // Build template variables
      const vars = buildBaseVars({
        projectName: project.name,
        projectDir,
        repositories: project.repositories,
      });

      // Add optional per-run variables
      if (topicName) {
        vars.TOPIC_NAME = topicName;
        vars.TOPIC_SLUG = topicName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      }

      // Load command prompt
      const prompt = loadCommandOrSkill(command, projectDir, vars);
      if (!prompt) {
        buildSvc.failBuild(id, runId, `Command "${command}" not found.`);
        throw httpError(`Command "${command}" not found.`, 404, "not_found");
      }

      // SSE headers — include runId so client can reconnect
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // Send runId as first event so client knows which run to reconnect to
      res.write(`event: run-started\ndata: ${JSON.stringify({ runId })}\n\n`);

      let aborted = false;
      req.on("close", () => { aborted = true; });

      await agentSvc.send({
        projectId: id,
        message: prompt,
        modelId,
        systemPrompt:
          "You are CodaScope, an AI agent for codebase analysis and documentation. " +
          "Follow the instructions precisely. Use CodaScope tools for all source reads and project writes; never use native filesystem write tools. " +
          "Do NOT modify files in the source repositories.",
        purpose: "wiki-build",
        onMessage: (msg) => {
          // Persist output to disk (survives page refresh)
          const msgJson = JSON.stringify(msg);
          buildSvc.appendOutput(id, runId, msgJson + "\n");

          if (aborted) return;
          res.write(`data: ${msgJson}\n\n`);
        },
        onDone: async (result) => {
          // Count wiki pages and complete the build
          let pageCount: number | undefined;
          let substantivePageCount: number | undefined;
          try {
            const topics = await wikiSvc.listTopics(id);
            pageCount = topics.length;
            substantivePageCount = topics.filter((topic) => topic.id !== "index" && !topic.id.startsWith("_")).length;
            if (!aborted) {
              res.write(`event: wiki-refresh\ndata: ${JSON.stringify({ topics })}\n\n`);
            }
          } catch { /* ignore refresh errors */ }

          if (WIKI_BUILD_COMMANDS.has(command) && !substantivePageCount) {
            const error = substantivePageCount === undefined
              ? "Could not verify registered wiki output in the CodaScope project."
              : "Wiki build finished without creating any registered topic pages in the CodaScope project.";
            buildSvc.failBuild(id, runId, error);
            if (!aborted) {
              res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);
              res.end();
            }
            return;
          }

          buildSvc.completeBuild(id, runId, pageCount);

          if (!aborted) {
            const buildState = buildSvc.getBuildState(id);
            res.write(`event: done\ndata: ${JSON.stringify({ ...result, buildSummary: buildState?.summary })}\n\n`);
            res.end();
          }
        },
        onError: (err) => {
          buildSvc.failBuild(id, runId, err.message);

          if (aborted) return;
          res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
          res.end();
        },
      });
    })().catch(next);
  });

  // ── Build Status ─────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/build-status", wrap(async (req, res) => {
    const { buildSvc, projectSvc } = await ensureServices();
    const id = param(req, "id");
    const scope = req.query.scope as string | undefined;
    const projectDir = projectSvc.getProjectDir(id);
    if (projectDir) buildSvc.registerProjectDir(id, projectDir);
    const state = buildSvc.getBuildState(id, scope || undefined);
    res.json({ build: state });
  }));

  // ── Cancel Build ──────────────────────────────────────────────────

  app.post("/api/codascope/projects/:id/build/cancel", wrap(async (req, res) => {
    const { buildSvc } = await ensureServices();
    const id = param(req, "id");
    const { scope } = req.body as { scope?: string };
    const state = buildSvc.getBuildState(id, scope);
    if (!state || state.status !== "building") {
      res.json({ cancelled: false, reason: "No active build" });
      return;
    }
    buildSvc.cancelBuild(id, scope);
    res.json({ cancelled: true, runId: state.runId });
  }));

  // ── Build Logs (History) ─────────────────────────────────────────

  app.get("/api/codascope/projects/:id/build-logs", wrap(async (req, res) => {
    const { buildSvc, projectSvc } = await ensureServices();
    const id = param(req, "id");
    const projectDir = projectSvc.getProjectDir(id);
    if (projectDir) buildSvc.registerProjectDir(id, projectDir);
    const limit = parseInt(String(req.query.limit ?? "20"), 10);
    const logs = buildSvc.listBuildLogs(id, limit);
    res.json({ logs });
  }));

  // ── Build Log Stream (Reconnectable SSE) ─────────────────────────
  // Replays stored output from the log file, then tails live output
  // if the build is still running.

  app.get("/api/codascope/projects/:id/build-log/:runId/stream", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const { buildSvc, projectSvc } = await ensureServices();
      const id = param(req, "id");
      const runId = param(req, "runId");
      const projectDir = projectSvc.getProjectDir(id);
      if (projectDir) buildSvc.registerProjectDir(id, projectDir);

      // SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let aborted = false;
      req.on("close", () => { aborted = true; });

      // 1. Replay stored output
      const logPath = buildSvc.getBuildOutputPath(id, runId);
      if (existsSync(logPath)) {
        const storedOutput = readFileSync(logPath, "utf-8");
        const lines = storedOutput.split("\n").filter(Boolean);
        for (const line of lines) {
          if (aborted) break;
          res.write(`data: ${line}\n\n`);
        }
      }

      // 1b. Replay persisted pipeline steps
      const buildState = buildSvc.getBuildState(id);
      if (buildState && buildState.runId === runId && buildState.pipelineSteps.length > 0) {
        for (const step of buildState.pipelineSteps) {
          if (aborted) break;
          res.write(`event: pipeline-step\ndata: ${JSON.stringify({ step: step.id, status: step.status, detail: step.detail })}\n\n`);
        }
      }

      // 2. Check if build is still running
      const state = buildSvc.getBuildState(id);
      if (!state || state.runId !== runId || state.status !== "building") {
        // Build is done — send final status and close
        if (state && state.runId === runId) {
          if (state.status === "complete") {
            res.write(`event: done\ndata: ${JSON.stringify({ buildSummary: state.summary })}\n\n`);
          } else if (state.status === "error") {
            res.write(`event: error\ndata: ${JSON.stringify({ error: state.error })}\n\n`);
          }
        }
        res.end();
        return;
      }

      // 3. Tail live output — poll the file for new content
      let lastSize = existsSync(logPath) ? statSync(logPath).size : 0;
      let lastStepCount = buildState?.pipelineSteps.length ?? 0;
      const pollInterval = setInterval(() => {
        if (aborted) {
          clearInterval(pollInterval);
          return;
        }

        const currentState = buildSvc.getBuildState(id);

        // Check for new output
        if (existsSync(logPath)) {
          const currentSize = statSync(logPath).size;
          if (currentSize > lastSize) {
            const fd = require("node:fs").openSync(logPath, "r");
            const buf = Buffer.alloc(currentSize - lastSize);
            require("node:fs").readSync(fd, buf, 0, buf.length, lastSize);
            require("node:fs").closeSync(fd);
            const newContent = buf.toString("utf-8");
            const lines = newContent.split("\n").filter(Boolean);
            for (const line of lines) {
              res.write(`data: ${line}\n\n`);
            }
            lastSize = currentSize;
          }
        }

        // Forward new pipeline step updates
        if (currentState && currentState.runId === runId) {
          const steps = currentState.pipelineSteps;
          if (steps.length > lastStepCount) {
            // Send newly added steps
            for (let i = lastStepCount; i < steps.length; i++) {
              res.write(`event: pipeline-step\ndata: ${JSON.stringify({ step: steps[i].id, status: steps[i].status, detail: steps[i].detail })}\n\n`);
            }
            lastStepCount = steps.length;
          } else {
            // Check if existing steps have been updated (status changed)
            for (const step of steps) {
              res.write(`event: pipeline-step\ndata: ${JSON.stringify({ step: step.id, status: step.status, detail: step.detail })}\n\n`);
            }
          }
        }

        // Check if build finished
        if (!currentState || currentState.runId !== runId || currentState.status !== "building") {
          clearInterval(pollInterval);
          if (currentState && currentState.runId === runId) {
            if (currentState.status === "complete") {
              res.write(`event: done\ndata: ${JSON.stringify({ buildSummary: currentState.summary })}\n\n`);
            } else if (currentState.status === "error") {
              res.write(`event: error\ndata: ${JSON.stringify({ error: currentState.error })}\n\n`);
            }
          }
          res.end();
        }
      }, 500); // Poll every 500ms

      // Clean up on disconnect
      req.on("close", () => {
        clearInterval(pollInterval);
      });
    })().catch(next);
  });

  // ── Analyze Pipeline ─────────────────────────────────────────────

  app.post("/api/codascope/projects/:id/analyze", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const svcs = await ensureServices();
      const { buildSvc, projectSvc } = svcs;
      const id = param(req, "id");
      await ensureReposMapped(projectSvc, id, httpError);
      const { modelId, wiki, scope } = req.body as {
        modelId?: string;
        wiki?: "auto" | "full" | false;
        scope?: string | { path: string };
      };

      if (!modelId || typeof modelId !== "string") {
        throw httpError("modelId is required.", 400, "invalid_input");
      }

      const project = await projectSvc.getProject(id);
      if (!project) throw httpError("Project not found.", 404, "not_found");

      const projectDir = projectSvc.getProjectDir(id);
      if (!projectDir) throw httpError("Project directory not found.", 404, "not_found");

      // Register project dir for build-logs co-location
      buildSvc.registerProjectDir(id, projectDir);

      // Reject duplicate builds
      const runId = buildSvc.startBuild(id, "analyze", modelId);
      if (!runId) {
        res.status(409).json({ error: "An analysis is already running for this project.", code: "build_in_progress" });
        return;
      }

      // SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      res.write(`event: run-started\ndata: ${JSON.stringify({ runId, pipeline: { wiki, scope } })}\n\n`);

      // Clear any previous cancellation for this project
      buildSvc.clearCancellation(id);

      let sseAborted = false;
      req.on("close", () => { sseAborted = true; });

      const isAborted = () => sseAborted || buildSvc.isCancelled(id);

      const sendEvent = (event: string, data: unknown) => {
        if (event === "pipeline-step") {
          buildSvc.addPipelineStep(id, runId, data as { step: string; status: string; repo?: string; topic?: string; progress?: string; reason?: string; error?: string; mode?: string; tokenUsage?: TokenUsageRecord });
        }
        if (isAborted()) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const sendMessage = (msg: unknown) => {
        const msgJson = JSON.stringify(msg);
        buildSvc.appendOutput(id, runId, msgJson + "\n");
        if (isAborted()) return;
        res.write(`data: ${msgJson}\n\n`);
      };

      try {
        await runAnalyzePipeline(
          { projectId: id, modelId, wiki: wiki ?? false, scope },
          { sendEvent, sendMessage, isAborted },
          svcs,
          runId,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        buildSvc.failBuild(id, runId, message);
        buildSvc.clearCancellation(id);
        sendEvent("error", { error: message });
      }

      if (!isAborted()) res.end();
    })().catch(next);
  });

  // ── Deep Run Pipeline ───────────────────────────────────────────
  // Full code-to-wiki sync: force-refresh code maps → outline if needed →
  // deep-enrich each topic → cross-reference pass → regenerate index →
  // update wiki-state.json with sync point.

  app.post("/api/codascope/projects/:id/deep-run", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const svcs = await ensureServices();
      const { buildSvc, projectSvc } = svcs;
      const id = param(req, "id");
      await ensureReposMapped(projectSvc, id, httpError);
      const { modelId } = req.body as { modelId?: string };

      if (!modelId || typeof modelId !== "string") {
        throw httpError("modelId is required.", 400, "invalid_input");
      }

      const project = await projectSvc.getProject(id);
      if (!project) throw httpError("Project not found.", 404, "not_found");

      const projectDir = projectSvc.getProjectDir(id);
      if (!projectDir) throw httpError("Project directory not found.", 404, "not_found");

      // Register project dir for build-logs co-location
      buildSvc.registerProjectDir(id, projectDir);

      // Reject duplicate builds (deep-run uses the main project scope)
      const runId = buildSvc.startBuild(id, "deep-run", modelId);
      if (!runId) {
        res.status(409).json({ error: "A build is already running for this project.", code: "build_in_progress" });
        return;
      }

      // Mark the build as a deep-run
      const buildState = buildSvc.getBuildState(id);
      if (buildState) buildState.buildType = "deep-run";

      // SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      res.write(`event: run-started\ndata: ${JSON.stringify({ runId, buildType: "deep-run" })}\n\n`);

      // Clear any previous cancellation for this project
      buildSvc.clearCancellation(id);

      let sseAborted = false;
      req.on("close", () => { sseAborted = true; });

      const isAborted = () => sseAborted || buildSvc.isCancelled(id);

      const sendEvent = (event: string, data: unknown) => {
        if (event === "pipeline-step") {
          buildSvc.addPipelineStep(id, runId, data as { step: string; status: string; repo?: string; topic?: string; progress?: string; reason?: string; error?: string; mode?: string; tokenUsage?: TokenUsageRecord });
        }
        if (isAborted()) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const sendMessage = (msg: unknown) => {
        const msgJson = JSON.stringify(msg);
        buildSvc.appendOutput(id, runId, msgJson + "\n");
        if (isAborted()) return;
        res.write(`data: ${msgJson}\n\n`);
      };

      try {
        await runDeepRunPipeline(
          { projectId: id, modelId },
          { sendEvent, sendMessage, isAborted },
          svcs,
          runId,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        buildSvc.failBuild(id, runId, message);
        buildSvc.clearCancellation(id);
        sendEvent("error", { error: message });
      }

      if (!isAborted()) res.end();
    })().catch(next);
  });
}
