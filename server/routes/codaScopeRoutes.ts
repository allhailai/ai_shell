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
import { CodaScopeEpicService } from "../services/codaScopeEpicService.js";
import { CodaScopeDesignDocService } from "../services/codaScopeDesignDocService.js";
import { CodaScopeVersionService } from "../services/codaScopeVersionService.js";
import { CodaScopeAnnotationService } from "../services/codaScopeAnnotationService.js";
import { buildBaseVars, loadCommandOrSkill } from "../services/codaScopeCommandLoader.js";
import type { TokenUsageRecord } from "../services/codaScopeBuildStateService.js";
import { buildManifestFromServices, buildAssistantPrompt, buildProjectManifest, formatConversationHistory, formatViewContext, streamAssistantResponse, type ViewContext } from "../services/codaScopeChatOrchestrator.js";
import { runAnalyzePipeline } from "../services/codaScopeBuildOrchestrator.js";
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
let epicService: CodaScopeEpicService | null = null;
let designDocService: CodaScopeDesignDocService | null = null;
let versionService: CodaScopeVersionService | null = null;
let annotationService: CodaScopeAnnotationService | null = null;

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
  epicSvc: CodaScopeEpicService;
  designDocSvc: CodaScopeDesignDocService;
  versionSvc: CodaScopeVersionService;
  annotationSvc: CodaScopeAnnotationService;
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

  if (!epicService) epicService = new CodaScopeEpicService(root);
  else epicService.setRoot(root);

  if (!designDocService) designDocService = new CodaScopeDesignDocService(root);
  else designDocService.setRoot(root);

  if (!versionService) versionService = new CodaScopeVersionService(root);
  else versionService.setRoot(root);

  if (!annotationService) annotationService = new CodaScopeAnnotationService(root);
  else annotationService.setRoot(root);

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
    epicSvc: epicService,
    designDocSvc: designDocService,
    versionSvc: versionService,
    annotationSvc: annotationService,
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

  // Delete a conversation
  app.delete("/api/codascope/projects/:id/conversations/:convId", wrap(async (req, res) => {
    const { chatSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const convId = param(req, "convId");
    const deleted = await chatSvc.deleteConversation(id, convId);
    if (!deleted) throw httpError("Conversation not found.", 404, "not_found");
    res.json({ ok: true });
  }));

  // Send message — creates conversation if needed, persists, streams agent SSE
  app.post("/api/codascope/projects/:id/conversations/:convId/messages", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const svcs = await ensureServices(secretService, httpError);
      const { agentSvc, chatSvc } = svcs;
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

      // ── Build manifest + system prompt ─────────────────────────────
      const manifest = await buildManifestFromServices(id, svcs);
      const manifestStr = buildProjectManifest(manifest);

      // Format conversation history (prior messages, not including current)
      const conversation = await chatSvc.readConversation(id, convId);
      const priorMessages = (conversation?.messages ?? [])
        .filter((m) => m.id !== userMsgId && m.id !== assistantMsgId)
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
        .map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt }));
      const historyStr = formatConversationHistory(priorMessages);

      // Format view context (enriched with topicTitle, filePath, recentViews, epicId)
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
          }
        : null;
      const viewStr = formatViewContext(viewCtx);

      // Build epic context if the user is viewing an epic
      let epicContextStr = "";
      if (viewCtx?.view === "epic" && viewCtx.epicId && epicSvc) {
        try {
          const epicDetail = await epicSvc.getEpic(id, viewCtx.epicId);
          if (epicDetail) {
            const { buildEpicContext } = await import("../services/codaScopeChatOrchestrator.js");
            epicContextStr = "\n\n## Epic Context\n\n" + buildEpicContext({
              epicId: epicDetail.id,
              title: epicDetail.title,
              status: epicDetail.status,
              definition: epicDetail.definition,
              scope: epicDetail.scope ? { entryCount: (epicDetail.scope.entries ?? []).length, lastScopedAt: epicDetail.scope.lastScopedAt } : null,
              designDocCount: (epicDetail.designDocs ?? []).length,
              conversationId: epicDetail.conversationId,
            });
          }
        } catch { /* epic context is best-effort */ }
      }

      // Build the full system prompt with all context injected
      const systemPrompt = buildAssistantPrompt(manifestStr, historyStr, viewStr + epicContextStr, message.trim());

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

      try {
        const { fullResponse, actions, agentResult } = await streamAssistantResponse({
          projectId: id,
          message: message.trim(),
          modelId,
          systemPrompt,
          agentSvc,
          onMessage: (msg) => {
            if (aborted) return;
            res.write(`data: ${JSON.stringify(msg)}\n\n`);
          },
        });

        // Update assistant message with final content + actions
        try {
          const conv = await chatSvc.readConversation(id, convId);
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
            await chatSvc.writeConversation(id, updated);
          }
        } catch {
          // Best effort persistence
        }
        if (!aborted) {
          res.write(`event: done\ndata: ${JSON.stringify({ ...agentResult as object, conversationId: convId, actions })}\n\n`);
          res.end();
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const partialResponse = (err as { fullResponse?: string }).fullResponse ?? "";
        // Mark assistant message as error
        try {
          const conv = await chatSvc.readConversation(id, convId);
          if (conv) {
            const updated = {
              ...conv,
              messages: conv.messages.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: partialResponse || `Error: ${errMsg}`, status: "error" as const, updatedAt: new Date().toISOString() }
                  : m,
              ),
            };
            await chatSvc.writeConversation(id, updated);
          }
        } catch {
          // Best effort
        }
        if (!aborted) {
          res.write(`event: error\ndata: ${JSON.stringify({ error: errMsg })}\n\n`);
          res.end();
        }
      }
    })().catch(next);
  });

  // ── Assistant (Right Panel) — SSE Streaming ─────────────────────
  // Backwards-compatible endpoint: auto-creates or reuses a conversation.

  app.post("/api/codascope/projects/:id/assistant", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const svcs = await ensureServices(secretService, httpError);
      const { agentSvc, chatSvc } = svcs;
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

      // ── Build manifest + system prompt ─────────────────────────────
      const manifest = await buildManifestFromServices(id, svcs);
      const manifestStr = buildProjectManifest(manifest);

      // Format conversation history
      const conversation = await chatSvc.readConversation(id, convId);
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
      req.on("close", () => {
        aborted = true;
      });

      try {
        const { fullResponse, actions, agentResult } = await streamAssistantResponse({
          projectId: id,
          message: message.trim(),
          modelId,
          systemPrompt,
          agentSvc,
          onMessage: (msg) => {
            if (aborted) return;
            res.write(`data: ${JSON.stringify(msg)}\n\n`);
          },
        });

        if (fullResponse) {
          await chatSvc.appendMessage(id, convId!, {
            role: "assistant",
            content: fullResponse,
            modelId,
            status: "complete",
            metadata: actions.length > 0 ? { actions } : undefined,
          }).catch(() => { /* best effort */ });
        }
        if (!aborted) {
          res.write(`event: done\ndata: ${JSON.stringify({ ...agentResult as object, conversationId: convId, actions })}\n\n`);
          res.end();
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const partialResponse = (err as { fullResponse?: string }).fullResponse ?? "";
        if (partialResponse) {
          await chatSvc.appendMessage(id, convId!, {
            role: "assistant",
            content: partialResponse,
            modelId,
            status: "error",
          }).catch(() => { /* best effort */ });
        }
        if (!aborted) {
          res.write(`event: error\ndata: ${JSON.stringify({ error: errMsg, conversationId: convId })}\n\n`);
          res.end();
        }
      }
    })().catch(next);
  });

  // ── Cancel Agent Chat ──────────────────────────────────────────────

  app.post("/api/codascope/projects/:id/assistant/cancel", wrap(async (req, res) => {
    const { agentSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const cancelled = agentSvc.cancelAgent(id);
    res.json({ cancelled });
  }));

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

  // ── Epics ──────────────────────────────────────────────────────────

  // List epics for a project
  app.get("/api/codascope/projects/:id/epics", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epics = await epicSvc.listEpics(id);
    res.json({ epics });
  }));

  // Create epic
  app.post("/api/codascope/projects/:id/epics", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
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
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const epic = await epicSvc.getEpic(id, epicId);
    if (!epic) throw httpError("Epic not found.", 404, "not_found");
    res.json({ epic });
  }));

  // Update epic metadata
  app.patch("/api/codascope/projects/:id/epics/:epicId", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
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
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const deleted = await epicSvc.deleteEpic(id, epicId);
    if (!deleted) throw httpError("Epic not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // Get definition markdown
  app.get("/api/codascope/projects/:id/epics/:epicId/definition", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const definition = await epicSvc.getDefinition(id, epicId);
    if (definition === null) throw httpError("Epic not found.", 404, "not_found");
    res.json({ definition });
  }));

  // Update definition markdown
  app.put("/api/codascope/projects/:id/epics/:epicId/definition", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { content } = req.body as { content?: string };
    if (content === undefined) throw httpError("content is required.", 400, "invalid_input");
    const updated = await epicSvc.updateDefinition(id, epicId, content);
    if (!updated) throw httpError("Epic not found.", 404, "not_found");
    res.json({ saved: true });
  }));

  // Acquire edit lock
  app.post("/api/codascope/projects/:id/epics/:epicId/lock", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
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
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const documentId = req.query.documentId as string ?? "definition";
    const released = await epicSvc.releaseLock(id, epicId, documentId);
    res.json({ released });
  }));

  // Check lock status
  app.get("/api/codascope/projects/:id/epics/:epicId/lock", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const locks = await epicSvc.getLockStatus(id, epicId);
    res.json({ locks });
  }));

  // Get computed health
  app.get("/api/codascope/projects/:id/epics/:epicId/health", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const health = await epicSvc.getHealth(id, epicId);
    if (!health) throw httpError("Epic not found.", 404, "not_found");
    res.json({ health });
  }));

  // Archive an epic (move to _archive/)
  app.post("/api/codascope/projects/:id/epics/:epicId/archive", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const archived = await epicSvc.archiveEpic(id, epicId);
    if (!archived) throw httpError("Epic not found.", 404, "not_found");
    res.json({ archived: true });
  }));

  // Restore an archived epic
  app.post("/api/codascope/projects/:id/epics/:epicId/restore", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const epic = await epicSvc.restoreEpic(id, epicId);
    if (!epic) throw httpError("Archived epic not found.", 404, "not_found");
    res.json({ epic });
  }));

  // List archived epics
  app.get("/api/codascope/projects/:id/epics-archived", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epics = await epicSvc.listArchivedEpics(id);
    res.json({ epics });
  }));

  // ── Epic Scope (P1) ────────────────────────────────────────────────

  // Get scope state
  app.get("/api/codascope/projects/:id/epics/:epicId/scope", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const scope = await epicSvc.getScope(id, epicId);
    res.json({ scope: scope ?? { entries: [], lastScopedAt: null, lastScopedBy: null } });
  }));

  // Update full scope (agent or user)
  app.put("/api/codascope/projects/:id/epics/:epicId/scope", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { scope } = req.body as { scope?: unknown };
    if (!scope) throw httpError("scope is required.", 400, "invalid_input");
    const saved = await epicSvc.setScope(id, epicId, scope as any);
    if (!saved) throw httpError("Epic not found.", 404, "not_found");
    res.json({ saved: true });
  }));

  // Toggle include/exclude for a single topic
  app.patch("/api/codascope/projects/:id/epics/:epicId/scope/:topicId", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
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
    const { epicSvc } = await ensureServices(secretService, httpError);
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
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const topicId = param(req, "topicId");
    const removed = await epicSvc.removeScopeEntry(id, epicId, topicId);
    if (!removed) throw httpError("Scope entry not found.", 404, "not_found");
    res.json({ removed: true });
  }));

  // Apply approved scope diff
  app.post("/api/codascope/projects/:id/epics/:epicId/scope/apply-diff", wrap(async (req, res) => {
    const { epicSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { accepted, fullDiff } = req.body as {
      accepted?: { addedTopicIds?: string[]; removedTopicIds?: string[]; changedTopicIds?: string[] };
      fullDiff?: unknown;
    };
    if (!accepted || !fullDiff) throw httpError("accepted and fullDiff are required.", 400, "invalid_input");
    const scope = await epicSvc.applyScopeDiff(id, epicId, {
      addedTopicIds: accepted.addedTopicIds ?? [],
      removedTopicIds: accepted.removedTopicIds ?? [],
      changedTopicIds: accepted.changedTopicIds ?? [],
    }, fullDiff as any);
    if (!scope) throw httpError("Epic not found.", 404, "not_found");
    res.json({ scope });
  }));

  // Start wiki enrichment pipeline for scoped topics
  app.post("/api/codascope/projects/:id/epics/:epicId/deepen", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const svcs = await ensureServices(secretService, httpError);
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

      // Register project dir and start build
      buildSvc.registerProjectDir(id, projectDir);
      const runId = buildSvc.startBuild(id, "epic-deepen", modelId);
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

      res.write(`event: run-started\ndata: ${JSON.stringify({ runId, epicId, entryCount: includedEntries.length })}\n\n`);

      let sseAborted = false;
      req.on("close", () => { sseAborted = true; });

      const isAborted = () => sseAborted || buildSvc.isCancelled(id);
      const sendEvent = (event: string, data: unknown) => {
        if (event === "pipeline-step") {
          buildSvc.addPipelineStep(id, runId, data as any);
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
        const { runEpicDeepenPipeline } = await import("../services/codaScopeBuildOrchestrator.js");
        await runEpicDeepenPipeline(
          { projectId: id, epicId, modelId, entries: includedEntries },
          { sendEvent, sendMessage, isAborted },
          svcs as any,
          runId,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        buildSvc.failBuild(id, runId, message);
        sendEvent("error", { error: message });
      }

      if (!isAborted()) res.end();
    })().catch(next);
  });

  // ── Design Documents (P2a) ────────────────────────────────────────

  // List design docs for an epic
  app.get("/api/codascope/projects/:id/epics/:epicId/designs", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docs = await designDocSvc.listDesignDocs(id, epicId);
    res.json({ docs });
  }));

  // List available templates
  app.get("/api/codascope/projects/:id/epics/:epicId/designs/templates", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices(secretService, httpError);
    const templates = designDocSvc.listTemplates();
    res.json({ templates });
  }));

  // Create design doc
  app.post("/api/codascope/projects/:id/epics/:epicId/designs", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const { title, template, content, createdBy } = req.body as {
      title?: string;
      template?: string;
      content?: string;
      createdBy?: string;
    };
    if (!title || typeof title !== "string" || !title.trim()) {
      throw httpError("title is required.", 400, "invalid_input");
    }
    const doc = await designDocSvc.createDesignDoc(id, epicId, {
      title: title.trim(),
      template,
      content,
      createdBy,
    });
    res.status(201).json({ doc });
  }));

  // Get design doc content
  app.get("/api/codascope/projects/:id/epics/:epicId/designs/:docId", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const result = await designDocSvc.getDesignDoc(id, epicId, docId);
    if (!result) throw httpError("Design doc not found.", 404, "not_found");
    res.json(result);
  }));

  // Update design doc content
  app.put("/api/codascope/projects/:id/epics/:epicId/designs/:docId", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const { content } = req.body as { content?: string };
    if (content === undefined || typeof content !== "string") {
      throw httpError("content is required.", 400, "invalid_input");
    }
    const doc = await designDocSvc.updateDesignDoc(id, epicId, docId, content);
    if (!doc) throw httpError("Design doc not found.", 404, "not_found");
    res.json({ doc });
  }));

  // Delete design doc
  app.delete("/api/codascope/projects/:id/epics/:epicId/designs/:docId", wrap(async (req, res) => {
    const { designDocSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const deleted = await designDocSvc.deleteDesignDoc(id, epicId, docId);
    if (!deleted) throw httpError("Design doc not found.", 404, "not_found");
    res.json({ success: true });
  }));

  // ── Versions (P2a) ────────────────────────────────────────────────

  // List versions for an epic
  app.get("/api/codascope/projects/:id/epics/:epicId/versions", wrap(async (req, res) => {
    const { versionSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const versions = await versionSvc.listVersions(id, epicId);
    res.json({ versions });
  }));

  // Create version snapshot
  app.post("/api/codascope/projects/:id/epics/:epicId/versions", wrap(async (req, res) => {
    const { versionSvc } = await ensureServices(secretService, httpError);
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
    const { versionSvc } = await ensureServices(secretService, httpError);
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
    const { versionSvc } = await ensureServices(secretService, httpError);
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

  // ── Unified Analyze ───────────────────────────────────────────────

  app.post("/api/codascope/projects/:id/analyze", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const svcs = await ensureServices(secretService, httpError);
      const { buildSvc, projectSvc } = svcs;
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
          { projectId: id, modelId, wiki: wiki ?? false, quality: quality ?? false, scope },
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

  // ── Annotations (P2b) ──────────────────────────────────────────────

  // List annotations for a document
  app.get("/api/codascope/projects/:id/epics/:epicId/docs/:docId/annotations", wrap(async (req, res) => {
    const { annotationSvc, epicSvc, designDocSvc } = await ensureServices(secretService, httpError);
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
    const { annotationSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const { anchor, author, body, parentId, documentVersion } = req.body as {
      anchor?: unknown;
      author?: string;
      body?: string;
      parentId?: string;
      documentVersion?: number;
    };
    if (!anchor || !body || typeof body !== "string") {
      throw httpError("anchor and body are required.", 400, "invalid_input");
    }
    const annotation = await annotationSvc.createAnnotation(id, epicId, docId, {
      anchor: anchor as any,
      author: author ?? "user",
      body,
      parentId,
      documentVersion,
    });
    res.status(201).json({ annotation });
  }));

  // Update annotation (resolve, edit)
  app.patch("/api/codascope/projects/:id/epics/:epicId/annotations/:annId", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices(secretService, httpError);
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
    const { annotationSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const annId = param(req, "annId");
    const deleted = await annotationSvc.deleteAnnotation(id, epicId, annId);
    if (!deleted) throw httpError("Annotation not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // ── Directives (P2b) ──────────────────────────────────────────────

  // List directives for a document
  app.get("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const directives = await annotationSvc.listDirectives(id, epicId, docId);
    res.json({ directives });
  }));

  // Create directive
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const { type, afterLine, startLine, endLine, blockId, anchorText, instruction, author } = req.body as {
      type?: string; afterLine?: number; startLine?: number; endLine?: number;
      blockId?: string; anchorText?: string; instruction?: string; author?: string;
    };
    if (!type || !instruction) {
      throw httpError("type and instruction are required.", 400, "invalid_input");
    }
    if (afterLine === undefined || typeof afterLine !== "number") {
      throw httpError("afterLine is required.", 400, "invalid_input");
    }
    const directive = await annotationSvc.createDirective(id, epicId, docId, {
      type: type as any,
      afterLine,
      startLine,
      endLine,
      blockId,
      anchorText,
      instruction,
      author: author ?? "user",
    });
    res.status(201).json({ directive });
  }));

  // Execute directive (agent generates content)
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/execute", wrap(async (req, res) => {
    const { annotationSvc, epicSvc, designDocSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const dirId = param(req, "dirId");
    const { generatedContent } = req.body as { generatedContent?: string };

    // For now, accept pre-generated content from the client
    // (In production, this would trigger the agent via do_insert_content.md)
    if (!generatedContent || typeof generatedContent !== "string") {
      throw httpError("generatedContent is required.", 400, "invalid_input");
    }

    const directive = await annotationSvc.updateDirective(id, epicId, dirId, docId, {
      status: "generating",
    });
    if (!directive) throw httpError("Directive not found.", 404, "not_found");

    // Store the generated content
    const updated = await annotationSvc.updateDirective(id, epicId, dirId, docId, {
      generatedContent,
      status: "pending", // back to pending — user must Apply
    });

    res.json({ directive: updated });
  }));

  // Apply directive to document
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/apply", wrap(async (req, res) => {
    const { annotationSvc, epicSvc, designDocSvc } = await ensureServices(secretService, httpError);
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

    const result = await annotationSvc.applyDirective(id, epicId, docId, dirId, getContent, setContent);
    if (!result) throw httpError("Directive not found or has no generated content.", 404, "not_found");
    res.json({ directive: result.directive, content: result.newContent });
  }));

  // Reject directive
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/reject", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const dirId = param(req, "dirId");
    const directive = await annotationSvc.rejectDirective(id, epicId, docId, dirId);
    if (!directive) throw httpError("Directive not found.", 404, "not_found");
    res.json({ directive });
  }));

  // Undo applied directive
  app.post("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/undo", wrap(async (req, res) => {
    const { annotationSvc, epicSvc, designDocSvc } = await ensureServices(secretService, httpError);
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

    const directive = await annotationSvc.undoDirective(id, epicId, docId, dirId, setContent);
    if (!directive) throw httpError("Directive not found or not applied.", 404, "not_found");
    res.json({ directive });
  }));

  // Delete directive
  app.delete("/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId", wrap(async (req, res) => {
    const { annotationSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const epicId = param(req, "epicId");
    const docId = param(req, "docId");
    const dirId = param(req, "dirId");
    const deleted = await annotationSvc.deleteDirective(id, epicId, dirId, docId);
    if (!deleted) throw httpError("Directive not found.", 404, "not_found");
    res.json({ deleted: true });
  }));

  // ── Block IDs (P2b) ───────────────────────────────────────────────

  // Get computed block IDs for a document
  app.get("/api/codascope/projects/:id/epics/:epicId/docs/:docId/blocks", wrap(async (req, res) => {
    const { annotationSvc, epicSvc, designDocSvc } = await ensureServices(secretService, httpError);
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
}

