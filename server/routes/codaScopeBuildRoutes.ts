/* ── CodaScope: Build Routes ──────────────────────────────────────────
   Skills, agent runs, build status/cancel/logs, build log stream,
   and the analyze pipeline endpoint.
   ──────────────────────────────────────────────────────────────────── */

import type { Request, Response, NextFunction } from "express";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import { ensureReposMapped } from "./codaScopeCoreRoutes.js";
import type { TokenUsageRecord } from "../services/codaScopeBuildStateService.js";
import { buildBaseVars, loadCommandOrSkill } from "../services/codaScopeCommandLoader.js";
import { runAnalyzePipeline } from "../services/codaScopeBuildOrchestrator.js";
import { runDeepRunPipeline } from "../services/codaScopeDeepRunOrchestrator.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createSseTerminalWriter } from "./utils/ssePipelineHelper.js";

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
      res.on("close", () => { aborted = true; });
      const terminal = createSseTerminalWriter(res, () => aborted);

      try {
        await agentSvc.send({
        scope: { kind: "project", projectId: id },
        message: "Execute the following skill:\n\n" + prompt,
        modelId,
        systemPrompt:
          "You are CodaScope, an AI agent for codebase analysis and documentation. " +
          "Follow the instructions in the skill prompt precisely. " +
          "Use CodaScope tools for all source reads and project writes; never use native filesystem write tools.",
        purpose: "wiki-build",
        onMessage: (msg) => {
          if (aborted || terminal.terminalEvent()) return;
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
        },
        onDone: async (result) => {
          if (!aborted && !terminal.terminalEvent()) {
            // Refresh wiki topics in case the skill created/modified wiki pages
            try {
              const topics = await wikiSvc.listTopics(id);
              terminal.sendEvent("wiki-refresh", { topics });
            } catch { /* ignore refresh errors */ }
            terminal.done(result && typeof result === "object"
              ? result as unknown as Record<string, unknown>
              : {});
          }
        },
        onError: (err) => {
          terminal.error(err);
        },
        });
      } catch (err) {
        terminal.error(err);
      }
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
      const runId = buildSvc.startBuild(id, command, modelId, undefined, undefined, true);
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
      res.on("close", () => { aborted = true; });
      const terminal = createSseTerminalWriter(res, () => aborted);

      try {
        await agentSvc.send({
        scope: { kind: "project", projectId: id },
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

          if (aborted || terminal.terminalEvent()) return;
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
            if (!aborted && !terminal.terminalEvent()) {
              terminal.sendEvent("wiki-refresh", { topics });
            }
          } catch { /* ignore refresh errors */ }

          if (WIKI_BUILD_COMMANDS.has(command) && !substantivePageCount) {
            const error = substantivePageCount === undefined
              ? "Could not verify registered wiki output in the CodaScope project."
              : "Wiki build finished without creating any registered topic pages in the CodaScope project.";
            buildSvc.failBuild(id, runId, error);
            terminal.error(error);
            return;
          }

          buildSvc.completeBuild(id, runId, pageCount);

          if (!aborted && !terminal.terminalEvent()) {
            const buildState = buildSvc.getBuildState(id);
            terminal.done({ ...result as object, buildSummary: buildState?.summary });
          }
        },
        onError: (err) => {
          buildSvc.failBuild(id, runId, err.message);

          terminal.error(err);
        },
        });
      } catch (err) {
        buildSvc.failBuild(id, runId, err instanceof Error ? err.message : String(err));
        terminal.error(err);
      }
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
      res.on("close", () => { aborted = true; });
      const terminal = createSseTerminalWriter(res, () => aborted);
      try {
        const buildState = buildSvc.getBuildStateByRunId(id, runId);
        if (!buildState) {
          terminal.error("Build run not found.");
          return;
        }

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
      if (buildState.pipelineSteps.length > 0) {
        for (const step of buildState.pipelineSteps) {
          if (aborted) break;
          terminal.sendEvent("pipeline-step", { step: step.id, status: step.status, detail: step.detail });
        }
      }

      // 2. Check if build is still running
      if (buildState.status !== "building") {
        // Build is done — send final status and close
        if (buildState.status === "complete") {
          terminal.done({ buildSummary: buildState.summary });
        } else if (buildState.status === "error") {
          terminal.error(buildState.error ?? "Build failed.");
        } else {
          terminal.error("Build run has no valid terminal state.");
        }
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

        try {
          const currentState = buildSvc.getBuildStateByRunId(id, runId);

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
              terminal.sendEvent("pipeline-step", { step: steps[i].id, status: steps[i].status, detail: steps[i].detail });
            }
            lastStepCount = steps.length;
          } else {
            // Check if existing steps have been updated (status changed)
            for (const step of steps) {
              terminal.sendEvent("pipeline-step", { step: step.id, status: step.status, detail: step.detail });
            }
          }
        }

        // Check if build finished
        if (!currentState || currentState.status !== "building") {
          clearInterval(pollInterval);
          if (!currentState) {
            terminal.error("Build run disappeared while reconnecting.");
          } else if (currentState.status === "complete") {
            terminal.done({ buildSummary: currentState.summary });
          } else if (currentState.status === "error") {
            terminal.error(currentState.error ?? "Build failed.");
          } else {
            terminal.error("Build run has no valid terminal state.");
          }
        }
        } catch (err) {
          clearInterval(pollInterval);
          terminal.error(err);
        }
      }, 500); // Poll every 500ms

      // Clean up on disconnect
        res.on("close", () => {
          clearInterval(pollInterval);
        });
      } catch (err) {
        terminal.error(err);
      }
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
      const runId = buildSvc.startBuild(id, "analyze", modelId, undefined, "analyze");
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
      res.on("close", () => { sseAborted = true; });

      const isAborted = () => sseAborted || buildSvc.isCancelled(id);
      const terminal = createSseTerminalWriter(res, () => sseAborted);

      const sendEvent = (event: string, data: unknown) => {
        if (event === "pipeline-step") {
          buildSvc.addPipelineStep(id, runId, data as { step: string; status: string; repo?: string; topic?: string; progress?: string; reason?: string; error?: string; mode?: string; tokenUsage?: TokenUsageRecord });
        }
        const standardTerminal = event === "done" || event === "error" || event === "cancelled";
        if (!standardTerminal && isAborted()) return;
        terminal.sendEvent(event, data);
      };

      const sendMessage = (msg: unknown) => {
        const msgJson = JSON.stringify(msg);
        buildSvc.appendOutput(id, runId, msgJson + "\n");
        if (isAborted() || terminal.terminalEvent()) return;
        res.write(`data: ${msgJson}\n\n`);
      };

      try {
        await runAnalyzePipeline(
          { projectId: id, modelId, wiki: wiki ?? false, scope },
          { sendEvent, sendMessage, isAborted },
          svcs,
          runId,
        );
        if (!terminal.terminalEvent()) {
          if (isAborted()) {
            buildSvc.failBuild(id, runId, "Analysis cancelled.");
            terminal.cancelled({ runId });
          } else {
            const error = "Analysis pipeline ended without a terminal result.";
            buildSvc.failBuild(id, runId, error);
            terminal.error(error);
          }
        }
      } catch (err) {
        if (terminal.terminalEvent() === "done") return;
        const message = err instanceof Error ? err.message : String(err);
        buildSvc.failBuild(id, runId, message);
        buildSvc.clearCancellation(id);
        terminal.error(message);
      }
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
      const runId = buildSvc.startBuild(id, "deep-run", modelId, undefined, "deep-run");
      if (!runId) {
        res.status(409).json({ error: "A build is already running for this project.", code: "build_in_progress" });
        return;
      }

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
      res.on("close", () => { sseAborted = true; });

      const isAborted = () => sseAborted || buildSvc.isCancelled(id);
      const terminal = createSseTerminalWriter(res, () => sseAborted);

      const sendEvent = (event: string, data: unknown) => {
        if (event === "pipeline-step") {
          buildSvc.addPipelineStep(id, runId, data as { step: string; status: string; repo?: string; topic?: string; progress?: string; reason?: string; error?: string; mode?: string; tokenUsage?: TokenUsageRecord });
        }
        const standardTerminal = event === "done" || event === "error" || event === "cancelled";
        if (!standardTerminal && isAborted()) return;
        terminal.sendEvent(event, data);
      };

      const sendMessage = (msg: unknown) => {
        const msgJson = JSON.stringify(msg);
        buildSvc.appendOutput(id, runId, msgJson + "\n");
        if (isAborted() || terminal.terminalEvent()) return;
        res.write(`data: ${msgJson}\n\n`);
      };

      try {
        await runDeepRunPipeline(
          { projectId: id, modelId },
          { sendEvent, sendMessage, isAborted },
          svcs,
          runId,
        );
        if (!terminal.terminalEvent()) {
          if (isAborted()) {
            buildSvc.failBuild(id, runId, "Deep Run cancelled.");
            terminal.cancelled({ runId });
          } else {
            const error = "Deep Run pipeline ended without a terminal result.";
            buildSvc.failBuild(id, runId, error);
            terminal.error(error);
          }
        }
      } catch (err) {
        if (terminal.terminalEvent() === "done") return;
        const message = err instanceof Error ? err.message : String(err);
        buildSvc.failBuild(id, runId, message);
        buildSvc.clearCancellation(id);
        terminal.error(message);
      }
    })().catch(next);
  });
}
