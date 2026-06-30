/* ── CodaScope: Server Routes ─────────────────────────────────────────
   All CodaScope API routes under /api/codascope/.
   Handles config, projects, wiki, chat, agent runs, and skills.
   ──────────────────────────────────────────────────────────────────── */

import type { Express, Request, Response, NextFunction } from "express";
import type { SecretService } from "../services/secretService.js";
import { CodaScopeProjectService } from "../services/codaScopeProjectService.js";
import { CodaScopeWikiService } from "../services/codaScopeWikiService.js";
import { CodaScopeChatService } from "../services/codaScopeChatService.js";
import { CodaScopeSkillService } from "../services/codaScopeSkillService.js";
import { CodaScopeAgentService } from "../services/codaScopeAgentService.js";
import { CodaScopeBuildStateService } from "../services/codaScopeBuildStateService.js";
import { CodaScopeCodeMapService } from "../services/codaScopeCodeMapService.js";
import { CodaScopeConceptService } from "../services/codaScopeConceptService.js";
import { CodaScopeGoldenRuleService } from "../services/codaScopeGoldenRuleService.js";
import { CodaScopeQualityService } from "../services/codaScopeQualityService.js";
import { CodaScopeWikiStateService } from "../services/codaScopeWikiStateService.js";
import { buildBaseVars, loadCommandOrSkill } from "../services/codaScopeCommandLoader.js";
import type { TokenUsageRecord } from "../services/codaScopeBuildStateService.js";
import { existsSync, readFileSync, statSync } from "node:fs";

type HttpErrorFn = (message: string, status: number, code: string) => Error;

interface CodaScopeRoutesDeps {
  secretService: SecretService;
  authMiddleware: Record<string, unknown>;
  httpError: HttpErrorFn;
}

/** Safely extract a string route param. */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] ?? "" : val ?? "";
}

// Singleton service instances (created on first route registration)
let projectService: CodaScopeProjectService | null = null;
let wikiService: CodaScopeWikiService | null = null;
let chatService: CodaScopeChatService | null = null;
let skillService: CodaScopeSkillService | null = null;
let agentService: CodaScopeAgentService | null = null;
let buildStateService: CodaScopeBuildStateService | null = null;
let codeMapService: CodaScopeCodeMapService | null = null;
let conceptService: CodaScopeConceptService | null = null;
let goldenRuleService: CodaScopeGoldenRuleService | null = null;
let qualityService: CodaScopeQualityService | null = null;
let wikiStateService: CodaScopeWikiStateService | null = null;

const CONFIG_KEY = "codascope_projects_root";
const APP_ID = "codascope";

async function getProjectsRoot(secretService: SecretService): Promise<string | null> {
  return secretService.getAppSecret(APP_ID, CONFIG_KEY);
}

async function setProjectsRoot(secretService: SecretService, value: string): Promise<void> {
  return secretService.setAppSecret(APP_ID, CONFIG_KEY, value);
}

async function ensureServices(secretService: SecretService, httpError: HttpErrorFn): Promise<{
  projectSvc: CodaScopeProjectService;
  wikiSvc: CodaScopeWikiService;
  chatSvc: CodaScopeChatService;
  skillSvc: CodaScopeSkillService;
  agentSvc: CodaScopeAgentService;
  buildSvc: CodaScopeBuildStateService;
  codeMapSvc: CodaScopeCodeMapService;
  conceptSvc: CodaScopeConceptService;
  goldenRuleSvc: CodaScopeGoldenRuleService;
  qualitySvc: CodaScopeQualityService;
  wikiStateSvc: CodaScopeWikiStateService;
}> {
  const root = await getProjectsRoot(secretService);
  if (!root) throw httpError("CodaScope is not configured. Set the projects root first.", 400, "not_configured");

  if (!projectService) projectService = new CodaScopeProjectService(root);
  else projectService.setRoot(root);

  if (!wikiService) wikiService = new CodaScopeWikiService(root);
  else wikiService.setRoot(root);

  if (!chatService) chatService = new CodaScopeChatService(root);
  else chatService.setRoot(root);

  if (!skillService) skillService = new CodaScopeSkillService(root);
  else skillService.setRoot(root);

  if (!agentService) agentService = new CodaScopeAgentService(secretService, root);
  else agentService.setProjectsRoot(root);

  if (!buildStateService) buildStateService = new CodaScopeBuildStateService(root);
  else buildStateService.setRoot(root);

  if (!codeMapService) codeMapService = new CodaScopeCodeMapService(root);
  else codeMapService.setRoot(root);

  if (!conceptService) conceptService = new CodaScopeConceptService(root);
  else conceptService.setRoot(root);

  if (!goldenRuleService) goldenRuleService = new CodaScopeGoldenRuleService(root);
  else goldenRuleService.setRoot(root);

  if (!qualityService) qualityService = new CodaScopeQualityService(root);
  else qualityService.setRoot(root);

  if (!wikiStateService) wikiStateService = new CodaScopeWikiStateService(root);
  else wikiStateService.setRoot(root);

  return {
    projectSvc: projectService,
    wikiSvc: wikiService,
    chatSvc: chatService,
    skillSvc: skillService,
    agentSvc: agentService,
    buildSvc: buildStateService,
    codeMapSvc: codeMapService,
    conceptSvc: conceptService,
    goldenRuleSvc: goldenRuleService,
    qualitySvc: qualityService,
    wikiStateSvc: wikiStateService,
  };
}

export function registerCodaScopeRoutes(app: Express, deps: CodaScopeRoutesDeps): void {
  const { secretService, httpError } = deps;

  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => {
    return (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };
  };

  // ── Config ──────────────────────────────────────────────────────

  app.get("/api/codascope/config", wrap(async (_req, res) => {
    const root = await getProjectsRoot(secretService);
    res.json({ projectsRoot: root ?? null, configured: !!root });
  }));

  app.put("/api/codascope/config", wrap(async (req, res) => {
    const { projectsRoot: newRoot } = req.body as { projectsRoot?: string };
    if (!newRoot || typeof newRoot !== "string" || !newRoot.trim()) {
      throw httpError("projectsRoot is required.", 400, "invalid_input");
    }
    await setProjectsRoot(secretService, newRoot.trim());
    // Ensure the directory exists
    const svc = new CodaScopeProjectService(newRoot.trim());
    await svc.ensureRootExists();
    res.json({ projectsRoot: newRoot.trim(), configured: true });
  }));

  // ── Projects ────────────────────────────────────────────────────

  app.get("/api/codascope/projects", wrap(async (_req, res) => {
    const { projectSvc } = await ensureServices(secretService, httpError);
    const projects = await projectSvc.listProjects();
    res.json({ projects });
  }));

  app.post("/api/codascope/projects", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices(secretService, httpError);
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name || typeof name !== "string" || !name.trim()) {
      throw httpError("name is required.", 400, "invalid_input");
    }
    const project = await projectSvc.createProject(name.trim(), description?.trim() ?? "");
    res.status(201).json({ project });
  }));

  app.get("/api/codascope/projects/:id", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const project = await projectSvc.getProject(id);
    if (!project) throw httpError("Project not found.", 404, "not_found");
    res.json({ project });
  }));

  app.put("/api/codascope/projects/:id", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const { name, description } = req.body as { name?: string; description?: string };
    const project = await projectSvc.updateProject(id, { name, description });
    if (!project) throw httpError("Project not found.", 404, "not_found");
    res.json({ project });
  }));

  app.delete("/api/codascope/projects/:id", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    await projectSvc.deleteProject(id);
    res.json({ deleted: true });
  }));

  // ── Repositories ────────────────────────────────────────────────

  app.post("/api/codascope/projects/:id/repositories", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const { name, path: repoPath } = req.body as { name?: string; path?: string };
    if (!repoPath || typeof repoPath !== "string" || !repoPath.trim()) {
      throw httpError("path is required.", 400, "invalid_input");
    }
    const repository = await projectSvc.addRepository(id, {
      name: name?.trim() || repoPath.split("/").pop() || "repo",
      path: repoPath.trim(),
    });
    if (!repository) throw httpError("Project not found.", 404, "not_found");
    res.status(201).json({ repository });
  }));

  app.delete("/api/codascope/projects/:id/repositories/:repoId", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const repoId = param(req, "repoId");
    await projectSvc.removeRepository(id, repoId);
    res.json({ deleted: true });
  }));

  // ── Wiki ────────────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/wiki", wrap(async (req, res) => {
    const { wikiSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const topics = await wikiSvc.listTopics(id);
    res.json({ topics });
  }));

  app.get("/api/codascope/projects/:id/wiki/:topicId", wrap(async (req, res) => {
    const { wikiSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const topicId = param(req, "topicId");
    const content = await wikiSvc.getTopicContent(id, topicId);
    if (content === null) throw httpError("Topic not found.", 404, "not_found");
    res.json({ content });
  }));

  app.put("/api/codascope/projects/:id/wiki/:topicId", wrap(async (req, res) => {
    const { wikiSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const topicId = param(req, "topicId");
    const { content } = req.body as { content?: string };
    if (content === undefined) throw httpError("content is required.", 400, "invalid_input");
    await wikiSvc.updateTopicContent(id, topicId, content);
    res.json({ saved: true });
  }));

  app.get("/api/codascope/projects/:id/wiki-state", wrap(async (req, res) => {
    const { projectSvc, wikiStateSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const projectDir = projectSvc.getProjectDir(id);
    if (!projectDir) throw httpError("Project not found.", 404, "not_found");
    const state = wikiStateSvc.getWikiState(projectDir);
    if (!state) {
      res.json({ topics: {} });
      return;
    }
    res.json(state);
  }));

  // ── Chat ────────────────────────────────────────────────────────

  // Placeholder chat route removed — all chat goes through /chat/stream SSE

  // ── Skills ──────────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/skills", wrap(async (req, res) => {
    const { skillSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const skills = await skillSvc.listSkills(id);
    res.json({ skills });
  }));

  app.post("/api/codascope/projects/:id/skills", wrap(async (req, res) => {
    const { skillSvc } = await ensureServices(secretService, httpError);
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
      const { agentSvc, projectSvc, wikiSvc } = await ensureServices(secretService, httpError);
      const id = param(req, "id");
      const skillId = param(req, "skillId");
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
          "Write all output files to the project directory.",
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
      const { agentSvc, projectSvc, wikiSvc, buildSvc } = await ensureServices(secretService, httpError);
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
          "Follow the instructions precisely. Write all output files to the project's wiki/ directory. " +
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
          try {
            const topics = await wikiSvc.listTopics(id);
            pageCount = topics.length;
            if (!aborted) {
              res.write(`event: wiki-refresh\ndata: ${JSON.stringify({ topics })}\n\n`);
            }
          } catch { /* ignore refresh errors */ }

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
    const { buildSvc, projectSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const projectDir = projectSvc.getProjectDir(id);
    if (projectDir) buildSvc.registerProjectDir(id, projectDir);
    const state = buildSvc.getBuildState(id);
    res.json({ build: state });
  }));

  // ── Cancel Build ──────────────────────────────────────────────────

  app.post("/api/codascope/projects/:id/build/cancel", wrap(async (req, res) => {
    const { buildSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const state = buildSvc.getBuildState(id);
    if (!state || state.status !== "building") {
      res.json({ cancelled: false, reason: "No active build" });
      return;
    }
    buildSvc.cancelBuild(id);
    res.json({ cancelled: true, runId: state.runId });
  }));

  // ── Build Logs (History) ─────────────────────────────────────────

  app.get("/api/codascope/projects/:id/build-logs", wrap(async (req, res) => {
    const { buildSvc, projectSvc } = await ensureServices(secretService, httpError);
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
      const { buildSvc, projectSvc } = await ensureServices(secretService, httpError);
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

  // ── Models ──────────────────────────────────────────────────────

  app.get("/api/codascope/models", wrap(async (_req, res) => {
    const { agentSvc } = await ensureServices(secretService, httpError);
    try {
      const models = await agentSvc.listModels();
      res.json({ models });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list models";
      // If API key not set, return empty list rather than error
      if (message.includes("not configured")) {
        res.json({ models: [], error: message });
      } else {
        throw httpError(message, 500, "model_list_failed");
      }
    }
  }));

  // ── Validate API Key ───────────────────────────────────────────────

  app.post("/api/codascope/validate-api-key", wrap(async (req, res) => {
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      throw httpError("apiKey is required", 400, "missing_api_key");
    }

    // We need an agentService but don't need full project setup.
    // Create a temporary one if not initialized yet.
    let svc = agentService;
    if (!svc) {
      const root = await getProjectsRoot(secretService) ?? "/tmp/codascope-validate";
      svc = new CodaScopeAgentService(secretService, root);
      // Don't persist as the singleton — let ensureServices do that
    }

    const result = await svc.validateApiKey(apiKey.trim());
    res.json(result);
  }));

  // ── Conversations — CRUD ─────────────────────────────────────────

  // List conversations
  app.get("/api/codascope/projects/:id/conversations", wrap(async (req, res) => {
    const { chatSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const conversations = await chatSvc.listConversations(id);
    res.json({ conversations });
  }));

  // Create conversation
  app.post("/api/codascope/projects/:id/conversations", wrap(async (req, res) => {
    const { chatSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const { title, modelId } = req.body as { title?: string; modelId?: string };
    const conversation = await chatSvc.createConversation(id, { title, modelId });
    res.status(201).json({ conversation });
  }));

  // Read conversation
  app.get("/api/codascope/projects/:id/conversations/:convId", wrap(async (req, res) => {
    const { chatSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const convId = param(req, "convId");
    const conversation = await chatSvc.readConversation(id, convId);
    if (!conversation) throw httpError("Conversation not found.", 404, "not_found");
    res.json({ conversation });
  }));

  // Update conversation (title)
  app.patch("/api/codascope/projects/:id/conversations/:convId", wrap(async (req, res) => {
    const { chatSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const convId = param(req, "convId");
    const { title, summary } = req.body as { title?: string; summary?: string };
    const conversation = await chatSvc.updateConversation(id, convId, { title, summary });
    if (!conversation) throw httpError("Conversation not found.", 404, "not_found");
    res.json({ conversation });
  }));

  // Send message — creates conversation if needed, persists, streams agent SSE
  app.post("/api/codascope/projects/:id/conversations/:convId/messages", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const { agentSvc, chatSvc } = await ensureServices(secretService, httpError);
      const id = param(req, "id");
      const convId = param(req, "convId");
      const { message, modelId, context } = req.body as {
        message?: string;
        modelId?: string;
        context?: Record<string, unknown>;
      };

      if (!message || typeof message !== "string" || !message.trim()) {
        throw httpError("message is required.", 400, "invalid_input");
      }
      if (!modelId || typeof modelId !== "string") {
        throw httpError("modelId is required.", 400, "invalid_input");
      }

      // Persist user message
      const userMsgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      await chatSvc.appendMessage(id, convId, {
        id: userMsgId,
        role: "user",
        content: message.trim(),
        modelId: null,
        status: "complete",
        context: context ?? null,
      });

      // Create a placeholder for the assistant message
      const assistantMsgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      await chatSvc.appendMessage(id, convId, {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        modelId,
        status: "streaming",
      });

      // Set up SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let aborted = false;
      req.on("close", () => {
        aborted = true;
      });

      // Build context string for agent
      const contextStr = context
        ? `[Current View: ${(context as Record<string, string>).view ?? "unknown"}] The user is in project "${(context as Record<string, string>).projectName ?? ""}"${(context as Record<string, string>).topicId ? `, viewing wiki topic "${(context as Record<string, string>).topicId}"` : ""}.`
        : undefined;

      let fullResponse = "";

      await agentSvc.send({
        projectId: id,
        message: message.trim(),
        modelId,
        context: contextStr,
        purpose: "assistant",
        onMessage: (msg) => {
          if (aborted) return;
          // Accumulate text
          if (msg.type === "assistant" && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === "text") fullResponse += block.text;
            }
          }
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
        },
        onDone: async (result) => {
          // Update assistant message with final content
          try {
            const conversation = await chatSvc.readConversation(id, convId);
            if (conversation) {
              const updated = {
                ...conversation,
                messages: conversation.messages.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, content: fullResponse, status: "complete" as const, updatedAt: new Date().toISOString() }
                    : m,
                ),
              };
              await chatSvc.writeConversation(id, updated);
            }
          } catch {
            // Best effort persistence
          }
          if (!aborted) {
            res.write(`event: done\ndata: ${JSON.stringify({ ...result, conversationId: convId })}\n\n`);
            res.end();
          }
        },
        onError: async (err) => {
          // Mark assistant message as error
          try {
            const conversation = await chatSvc.readConversation(id, convId);
            if (conversation) {
              const updated = {
                ...conversation,
                messages: conversation.messages.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, content: fullResponse || `Error: ${err.message}`, status: "error" as const, updatedAt: new Date().toISOString() }
                    : m,
                ),
              };
              await chatSvc.writeConversation(id, updated);
            }
          } catch {
            // Best effort
          }
          if (!aborted) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
          }
        },
      });
    })().catch(next);
  });

  // ── Assistant (Right Panel) — SSE Streaming ─────────────────────
  // Backwards-compatible endpoint: auto-creates or reuses a conversation.

  app.post("/api/codascope/projects/:id/assistant", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const { agentSvc, chatSvc } = await ensureServices(secretService, httpError);
      const id = param(req, "id");
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
        const conv = await chatSvc.createConversation(id, { modelId });
        convId = conv.id;
      }

      // Persist user message
      await chatSvc.appendMessage(id, convId, {
        role: "user",
        content: message.trim(),
        status: "complete",
      });

      // Set up SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let aborted = false;
      req.on("close", () => {
        aborted = true;
      });

      let fullResponse = "";

      await agentSvc.send({
        projectId: id,
        message: message.trim(),
        modelId,
        context: context?.trim(),
        purpose: "assistant",
        onMessage: (msg) => {
          if (aborted) return;
          if (msg.type === "assistant" && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === "text") fullResponse += block.text;
            }
          }
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
        },
        onDone: async (result) => {
          // Persist assistant response
          if (fullResponse) {
            await chatSvc.appendMessage(id, convId!, {
              role: "assistant",
              content: fullResponse,
              modelId,
              status: "complete",
            }).catch(() => { /* best effort */ });
          }
          if (!aborted) {
            res.write(`event: done\ndata: ${JSON.stringify({ ...result, conversationId: convId })}\n\n`);
            res.end();
          }
        },
        onError: async (err) => {
          // Persist error
          if (fullResponse) {
            await chatSvc.appendMessage(id, convId!, {
              role: "assistant",
              content: fullResponse,
              modelId,
              status: "error",
            }).catch(() => { /* best effort */ });
          }
          if (!aborted) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: err.message, conversationId: convId })}\n\n`);
            res.end();
          }
        },
      });
    })().catch(next);
  });

  // ── Code Map ──────────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/code-map", wrap(async (req, res) => {
    const { codeMapSvc, projectSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const project = await projectSvc.getProject(id);
    if (!project) throw httpError("Project not found.", 404, "not_found");

    const statuses = codeMapSvc.getAllCodeMapStatuses(
      id,
      project.repositories ?? [],
    );
    res.json({ statuses });
  }));

  app.get("/api/codascope/projects/:id/code-map/:repoSlug", wrap(async (req, res) => {
    const { codeMapSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const repoSlug = param(req, "repoSlug");
    const content = codeMapSvc.readCodeMap(id, repoSlug);
    if (content === null) throw httpError("Code Map not found.", 404, "not_found");
    const meta = codeMapSvc.getCodeMapMeta(id, repoSlug);
    res.json({ content, meta });
  }));

  app.get("/api/codascope/projects/:id/code-map/inventory/:repoId", wrap(async (req, res) => {
    const { codeMapSvc, projectSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const repoId = param(req, "repoId");
    const project = await projectSvc.getProject(id);
    if (!project) throw httpError("Project not found.", 404, "not_found");

    const repo = (project.repositories ?? []).find(
      (r: { id: string }) => r.id === repoId,
    );
    if (!repo) throw httpError("Repository not found.", 404, "not_found");

    const inventory = codeMapSvc.generateFileInventory(repo.name, repo.path);
    const markdown = codeMapSvc.formatInventoryAsMarkdown(inventory);
    res.json({ inventory, markdown });
  }));

  // ── Concepts ──────────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/concepts", wrap(async (req, res) => {
    const { conceptSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const category = req.query.category as string | undefined;
    const concepts = conceptSvc.listConcepts(id, category);
    res.json({ concepts, count: concepts.length });
  }));

  app.post("/api/codascope/projects/:id/concepts", wrap(async (req, res) => {
    const { conceptSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const { name, description, category, relatedFiles } = req.body as {
      name?: string; description?: string; category?: string; relatedFiles?: string[];
    };
    if (!name || typeof name !== "string" || !name.trim()) {
      throw httpError("name is required.", 400, "invalid_input");
    }
    const concept = conceptSvc.createConcept(id, {
      name: name.trim(),
      description: description?.trim() ?? "",
      category: category ?? "other",
      relatedFiles: relatedFiles ?? [],
    });
    res.status(201).json({ concept });
  }));

  app.put("/api/codascope/projects/:id/concepts/:conceptId", wrap(async (req, res) => {
    const { conceptSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const conceptId = param(req, "conceptId");
    const { name, description, category, relatedConcepts, relatedFiles, wikiTopicId } = req.body;
    const concept = conceptSvc.updateConcept(id, conceptId, {
      name, description, category, relatedConcepts, relatedFiles, wikiTopicId,
    });
    if (!concept) throw httpError("Concept not found.", 404, "not_found");
    res.json({ concept });
  }));

  app.delete("/api/codascope/projects/:id/concepts/:conceptId", wrap(async (req, res) => {
    const { conceptSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const conceptId = param(req, "conceptId");
    const deleted = conceptSvc.deleteConcept(id, conceptId);
    if (!deleted) throw httpError("Concept not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // ── Golden Rules ──────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/golden-rules", wrap(async (req, res) => {
    const { goldenRuleSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const category = req.query.category as string | undefined;
    const severity = req.query.severity as string | undefined;
    const enabledStr = req.query.enabled as string | undefined;
    const enabled = enabledStr !== undefined ? enabledStr === "true" : undefined;
    const rules = goldenRuleSvc.listRules(id, { category, severity, enabled });
    const activeCount = goldenRuleSvc.getActiveRuleCount(id);
    res.json({ rules, activeCount, totalCount: rules.length });
  }));

  app.post("/api/codascope/projects/:id/golden-rules", wrap(async (req, res) => {
    const { goldenRuleSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const { name, description, category, severity, appliesTo, codePatterns } = req.body as {
      name?: string; description?: string; category?: string;
      severity?: string; appliesTo?: string[]; codePatterns?: string[];
    };
    if (!name || typeof name !== "string" || !name.trim()) {
      throw httpError("name is required.", 400, "invalid_input");
    }
    if (!category) throw httpError("category is required.", 400, "invalid_input");
    if (!severity) throw httpError("severity is required.", 400, "invalid_input");

    const rule = goldenRuleSvc.createRule(id, {
      name: name.trim(),
      description: description?.trim() ?? "",
      category: category as any,
      severity: severity as any,
      appliesTo: appliesTo as any,
      codePatterns: codePatterns ?? [],
    });
    res.status(201).json({ rule });
  }));

  app.put("/api/codascope/projects/:id/golden-rules/:ruleId", wrap(async (req, res) => {
    const { goldenRuleSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const ruleId = param(req, "ruleId");
    const { name, description, category, severity, appliesTo, codePatterns } = req.body;
    const rule = goldenRuleSvc.updateRule(id, ruleId, {
      name, description, category, severity, appliesTo, codePatterns,
    });
    if (!rule) throw httpError("Rule not found.", 404, "not_found");
    res.json({ rule });
  }));

  app.delete("/api/codascope/projects/:id/golden-rules/:ruleId", wrap(async (req, res) => {
    const { goldenRuleSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const ruleId = param(req, "ruleId");
    const deleted = goldenRuleSvc.deleteRule(id, ruleId);
    if (!deleted) throw httpError("Rule not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  app.patch("/api/codascope/projects/:id/golden-rules/:ruleId/toggle", wrap(async (req, res) => {
    const { goldenRuleSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const ruleId = param(req, "ruleId");
    const rule = goldenRuleSvc.toggleRule(id, ruleId);
    if (!rule) throw httpError("Rule not found.", 404, "not_found");
    res.json({ rule });
  }));

  // ── Quality ───────────────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/quality/latest", wrap(async (req, res) => {
    const { qualitySvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const summary = qualitySvc.getLatestSummary(id);
    res.json({ report: summary });
  }));

  app.get("/api/codascope/projects/:id/quality/scans", wrap(async (req, res) => {
    const { qualitySvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const limit = parseInt(String(req.query.limit ?? "20"), 10);
    const scans = qualitySvc.listScans(id, limit);
    res.json({ scans });
  }));

  app.get("/api/codascope/projects/:id/quality/scans/:scanId", wrap(async (req, res) => {
    const { qualitySvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const scanId = param(req, "scanId");
    const report = qualitySvc.getScanReport(id, scanId);
    if (!report) throw httpError("Scan not found.", 404, "not_found");
    res.json({ report });
  }));

  app.get("/api/codascope/projects/:id/quality/scans/:scanId/categories/:category", wrap(async (req, res) => {
    const { qualitySvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const scanId = param(req, "scanId");
    const category = param(req, "category");
    const categoryData = qualitySvc.getCategoryIssues(id, scanId, category);
    if (!categoryData) throw httpError("Category not found.", 404, "not_found");
    res.json({ category: categoryData });
  }));

  app.get("/api/codascope/projects/:id/quality/trends", wrap(async (req, res) => {
    const { qualitySvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const limit = parseInt(String(req.query.limit ?? "20"), 10);
    const trends = qualitySvc.getTrends(id, limit);
    res.json({ trends });
  }));

  // ── Unified Analyze ───────────────────────────────────────────────

  app.post("/api/codascope/projects/:id/analyze", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const { agentSvc, projectSvc, wikiSvc, buildSvc, codeMapSvc, wikiStateSvc } = await ensureServices(secretService, httpError);
      const id = param(req, "id");
      const { modelId, wiki, quality, scope } = req.body as {
        modelId?: string;
        wiki?: "auto" | "full" | false;
        quality?: boolean;
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

      res.write(`event: run-started\ndata: ${JSON.stringify({ runId, pipeline: { wiki, quality, scope } })}\n\n`);

      // Clear any previous cancellation for this project
      buildSvc.clearCancellation(id);

      let sseAborted = false;
      req.on("close", () => { sseAborted = true; });

      // Check both SSE disconnect and explicit cancel request
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
        // ── Build info tracker ───────────────────────────────────────
        let buildMode: "outline" | "delta" | "full" | undefined;
        let topicsRebuilt = 0;

        // ── Step 1: Code Map (always runs if stale) ──────────────────
        const repos = project.repositories ?? [];
        const isStale = codeMapSvc.isAnyCodeMapStale(id, repos);

        if (isStale) {
          sendEvent("pipeline-step", { step: "code-map", status: "running" });

          for (const repo of repos) {
            const slug = CodaScopeCodeMapService.repoSlug(repo.name || repo.path);
            const inventory = codeMapSvc.generateFileInventory(repo.name, repo.path);
            const inventoryMd = codeMapSvc.formatInventoryAsMarkdown(inventory);
            const existingDocs = codeMapSvc.readExistingDocs(repo.path, inventory.existingDocs);

            const vars = buildBaseVars({
              projectName: project.name,
              projectDir,
              repositories: repos,
            });
            vars.REPOSITORY_NAME = repo.name;
            vars.REPOSITORY_PATH = repo.path;
            vars.REPO_SLUG = slug;
            vars.FILE_INVENTORY = inventoryMd;
            vars.EXISTING_DOCS = existingDocs;

            const prompt = loadCommandOrSkill("do_build_code_map", projectDir, vars);
            if (!prompt) {
              sendEvent("pipeline-step", { step: "code-map", status: "error", error: "Code Map command not found." });
              continue;
            }

            sendEvent("pipeline-step", { step: "code-map", status: "building", repo: repo.name });

            await agentSvc.send({
              projectId: id,
              message: prompt,
              modelId,
              systemPrompt:
                "You are CodaScope, an AI agent for codebase analysis and documentation. " +
                "Follow the instructions precisely. Write all output files to the project directory. " +
                "Do NOT modify files in the source repositories.",
              purpose: "wiki-build",
              onMessage: sendMessage,
              onDone: async (result) => {
                // Save Code Map metadata
                const currentHead = codeMapSvc.getGitHead(repo.path);
                codeMapSvc.saveCodeMapMeta(id, slug, {
                  repoId: repo.id,
                  repoSlug: slug,
                  generatedAt: new Date().toISOString(),
                  gitHead: currentHead,
                  totalFiles: inventory.totalFiles,
                  languages: Object.keys(inventory.languages),
                });
                // Capture token usage
                const tokenUsage = result?.usage ? {
                  inputTokens: result.usage.inputTokens,
                  outputTokens: result.usage.outputTokens,
                  cacheReadTokens: result.usage.cacheReadTokens,
                  cacheWriteTokens: result.usage.cacheWriteTokens,
                  totalTokens: result.usage.totalTokens,
                  reasoningTokens: result.usage.reasoningTokens,
                } : undefined;
                sendEvent("pipeline-step", { step: "code-map", status: "complete", repo: repo.name, tokenUsage });
              },
              onError: (err) => {
                sendEvent("pipeline-step", { step: "code-map", status: "error", repo: repo.name, error: err.message });
              },
            });
          }
        } else {
          sendEvent("pipeline-step", { step: "code-map", status: "skipped", reason: "Code Map is fresh" });
        }

        // ── Step 2: Wiki (if toggled on) ──────────────────────────────
        if (wiki) {
          const wikiState = wikiStateSvc.getWikiState(projectDir);
          const isFullBuild = wiki === "full" || !wikiState || Object.keys(wikiState.topics).length === 0;
          buildMode = isFullBuild ? "outline" : "delta";

          if (isFullBuild) {
            // ── Outline Build: single LLM call, all topics at outline depth ──
            sendEvent("pipeline-step", { step: "wiki-outline", status: "running", mode: "outline" });

            const vars = buildBaseVars({
              projectName: project.name,
              projectDir,
              repositories: repos,
            });

            const prompt = loadCommandOrSkill("do_build_full_wiki", projectDir, vars);
            if (prompt) {
              await agentSvc.send({
                projectId: id,
                message: prompt,
                modelId,
                systemPrompt:
                  "You are CodaScope, an AI agent for codebase analysis and documentation. " +
                  "Follow the instructions precisely. Write all output files to the project's wiki/ directory. " +
                  "Do NOT modify files in the source repositories.",
                purpose: "wiki-build",
                onMessage: sendMessage,
                onDone: async (result) => {
                  const tokenUsage = result?.usage ? {
                    inputTokens: result.usage.inputTokens,
                    outputTokens: result.usage.outputTokens,
                    cacheReadTokens: result.usage.cacheReadTokens,
                    cacheWriteTokens: result.usage.cacheWriteTokens,
                    totalTokens: result.usage.totalTokens,
                    reasoningTokens: result.usage.reasoningTokens,
                  } : undefined;
                  sendEvent("pipeline-step", { step: "wiki-outline", status: "complete", tokenUsage });
                },
                onError: (err) => {
                  sendEvent("pipeline-step", { step: "wiki-outline", status: "error", error: err.message });
                },
              });
            }
          } else {
            // ── Delta Build: only rebuild topics affected by git changes ──
            const gitHeadDebug = Object.entries(wikiState.gitHeads).map(([k, v]) => `${k}:${String(v).slice(0,8)}`).join(", ");
            sendEvent("pipeline-step", { step: "wiki-delta", status: "running", mode: "delta", repoCount: repos.length, gitHeads: gitHeadDebug });

            // Collect all changed files across repos
            const allChangedFiles: string[] = [];
            for (const repo of repos) {
              const repoKey = repo.name || repo.path;
              const lastHead = wikiState.gitHeads[repoKey];
              const currentHead = codeMapSvc.getGitHead(repo.path);
              console.log(`[wiki-delta] repo=${repoKey} lastHead=${lastHead?.slice(0,8) ?? "null"} currentHead=${currentHead?.slice(0,8) ?? "null"} match=${lastHead === currentHead}`);
              if (lastHead && currentHead && lastHead !== currentHead) {
                const changed = codeMapSvc.getChangedFiles(repo.path, lastHead, currentHead);
                console.log(`[wiki-delta] ${changed.length} changed files for ${repoKey}`);
                allChangedFiles.push(...changed);
              } else if (!lastHead) {
                console.log(`[wiki-delta] no lastHead for ${repoKey} — gitHeads keys: ${Object.keys(wikiState.gitHeads).join(", ")}`);
              }
            }

            // Map changed files to affected topics
            const affectedTopics = wikiStateSvc.getAffectedTopics(wikiState, allChangedFiles);

            if (affectedTopics.length === 0) {
              const repoDebug = repos.map((r) => {
                const k = r.name || r.path;
                const last = wikiState.gitHeads[k];
                const cur = codeMapSvc.getGitHead(r.path);
                return `${k}[last=${last?.slice(0,8) ?? "none"} cur=${cur?.slice(0,8) ?? "none"} eq=${last === cur}]`;
              }).join("; ");
              sendEvent("pipeline-step", { step: "wiki-delta", status: "skipped", reason: `No wiki topics affected by ${allChangedFiles.length} changed file(s)`, debug: repoDebug });
            } else {
              sendEvent("pipeline-step", {
                step: "wiki-delta",
                status: "building",
                progress: `${affectedTopics.length} of ${Object.keys(wikiState.topics).length} topics affected`,
              });

              // Rebuild each affected topic
              for (const topicId of affectedTopics) {
                if (isAborted()) break;

                const existingContent = await wikiSvc.getTopicContent(id, topicId);
                const topicState = wikiState.topics[topicId];

                const vars = buildBaseVars({
                  projectName: project.name,
                  projectDir,
                  repositories: repos,
                });
                vars.TOPIC_NAME = topicId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                vars.TOPIC_SLUG = topicId;
                vars.WIKI_PAGE_CONTENT = existingContent ?? "(No existing content)";
                vars.CHANGED_FILES = allChangedFiles.join("\n");
                vars.CURRENT_DEPTH = topicState?.depth ?? "outline";

                const prompt = loadCommandOrSkill("do_build_wiki_delta", projectDir, vars);
                if (prompt) {
                  await agentSvc.send({
                    projectId: id,
                    message: prompt,
                    modelId,
                    systemPrompt:
                      "You are CodaScope, a technical documentation specialist. " +
                      "Update the wiki page to reflect recent code changes. Preserve the existing depth and quality. " +
                      "Do NOT modify files in the source repositories.",
                    purpose: "wiki-build",
                    onMessage: sendMessage,
                    onDone: async (result) => {
                      const tokenUsage = result?.usage ? {
                        inputTokens: result.usage.inputTokens,
                        outputTokens: result.usage.outputTokens,
                        cacheReadTokens: result.usage.cacheReadTokens,
                        cacheWriteTokens: result.usage.cacheWriteTokens,
                        totalTokens: result.usage.totalTokens,
                        reasoningTokens: result.usage.reasoningTokens,
                      } : undefined;
                      sendEvent("pipeline-step", {
                        step: "wiki-delta",
                        status: "enriched",
                        topic: topicId,
                        tokenUsage,
                      });
                      topicsRebuilt++;
                    },
                    onError: (err) => {
                      sendEvent("pipeline-step", {
                        step: "wiki-delta",
                        status: "error",
                        topic: topicId,
                        error: err.message,
                      });
                    },
                  });
                }
              }
              sendEvent("pipeline-step", { step: "wiki-delta", status: "complete" });
            }
          }

          // ── Post-wiki: update wiki-state.json ────────────────────────
          sendEvent("pipeline-step", { step: "wiki-state", status: "running" });
          try {
            const newState = wikiState ?? wikiStateSvc.createEmptyState();
            newState.lastBuildAt = new Date().toISOString();
            newState.lastBuildMode = isFullBuild ? "outline" : "delta";

            // Update git heads — only advance the HEAD when topics were
            // actually rebuilt (or on full/outline builds). Otherwise the
            // baseline stays at the pre-build HEAD so deltas can still be
            // detected on the next run.
            if (isFullBuild || topicsRebuilt > 0) {
              for (const repo of repos) {
                const repoKey = repo.name || repo.path;
                const currentHead = codeMapSvc.getGitHead(repo.path);
                if (currentHead) newState.gitHeads[repoKey] = currentHead;
              }
            }

            // Evaluate depth and extract deps for all topics
            const topics = await wikiSvc.listTopics(id);
            for (const topic of topics) {
              if (topic.id === "_index" || topic.id.startsWith("_")) continue;
              const content = await wikiSvc.getTopicContent(id, topic.id);
              if (!content) continue;

              const { depth, metrics } = wikiStateSvc.evaluateTopicDepth(content);
              const deps = wikiStateSvc.extractDepsFromContent(content);

              // Preserve existing state fields (lastDeepenedAt) if topic already tracked
              const existing = newState.topics[topic.id];
              newState.topics[topic.id] = {
                depth: existing?.depth === "deep" && depth !== "deep" ? existing.depth : depth, // never downgrade
                builtAt: new Date().toISOString(),
                lastDeepenedAt: existing?.lastDeepenedAt,
                deps,
                metrics,
              };
            }

            wikiStateSvc.saveWikiState(projectDir, newState);
            sendEvent("pipeline-step", { step: "wiki-state", status: "complete" });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendEvent("pipeline-step", { step: "wiki-state", status: "error", error: msg });
          }
        }

        // ── Step 3: Quality (if toggled on) ───────────────────────────
        if (quality) {
          sendEvent("pipeline-step", { step: "quality", status: "running" });

          const vars = buildBaseVars({
            projectName: project.name,
            projectDir,
            repositories: repos,
          });
          vars.MODEL_ID = modelId;

          // Apply scope
          if (scope && typeof scope === "string" && scope !== "full") {
            vars.SCAN_SCOPE = `Scoped scan: focus on ${scope} areas only.`;
          } else if (scope && typeof scope === "object" && scope.path) {
            vars.SCAN_SCOPE = `Scoped scan: analyze only files under ${scope.path}`;
          }

          const prompt = loadCommandOrSkill("do_quality_scan", projectDir, vars);
          if (prompt) {
            await agentSvc.send({
              projectId: id,
              message: prompt,
              modelId,
              systemPrompt:
                "You are CodaScope, a senior code reviewer conducting a quality audit. " +
                "Follow the instructions precisely. Write the quality report to the project's quality/ directory. " +
                "Do NOT modify files in the source repositories.",
              purpose: "wiki-build",
              onMessage: sendMessage,
              onDone: async (result) => {
                const tokenUsage = result?.usage ? {
                  inputTokens: result.usage.inputTokens,
                  outputTokens: result.usage.outputTokens,
                  cacheReadTokens: result.usage.cacheReadTokens,
                  cacheWriteTokens: result.usage.cacheWriteTokens,
                  totalTokens: result.usage.totalTokens,
                  reasoningTokens: result.usage.reasoningTokens,
                } : undefined;
                sendEvent("pipeline-step", { step: "quality", status: "complete", tokenUsage });
              },
              onError: (err) => {
                sendEvent("pipeline-step", { step: "quality", status: "error", error: err.message });
              },
            });
          }
        }

        // ── Done ──────────────────────────────────────────────────────
        let pageCount: number | undefined;
        try {
          const topics = await wikiSvc.listTopics(id);
          pageCount = topics.length;
          sendEvent("wiki-refresh", { topics });
        } catch { /* ignore */ }

        if (buildSvc.isCancelled(id)) {
          buildSvc.failBuild(id, runId, "Build cancelled by user");
          buildSvc.clearCancellation(id);
          sendEvent("cancelled", { runId });
          if (!sseAborted) res.end();
        } else {
          buildSvc.completeBuild(id, runId, pageCount, { buildMode, topicsRebuilt });
          sendEvent("done", { runId, buildSummary: buildSvc.getBuildState(id)?.summary });
          if (!isAborted()) res.end();
        }

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        buildSvc.failBuild(id, runId, message);
        buildSvc.clearCancellation(id);
        sendEvent("error", { error: message });
        if (!isAborted()) res.end();
      }
    })().catch(next);
  });
}

