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

const CONFIG_KEY = "codascope_projects_root";
const APP_ID = "codascope";

async function getProjectsRoot(secretService: SecretService): Promise<string | null> {
  return secretService.getAppSecret(APP_ID, CONFIG_KEY);
}

async function setProjectsRoot(secretService: SecretService, value: string): Promise<void> {
  return secretService.setAppSecret(APP_ID, CONFIG_KEY, value);
}

async function ensureServices(secretService: SecretService, httpError: HttpErrorFn): Promise<{ projectSvc: CodaScopeProjectService; wikiSvc: CodaScopeWikiService; chatSvc: CodaScopeChatService; skillSvc: CodaScopeSkillService; agentSvc: CodaScopeAgentService }> {
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

  return { projectSvc: projectService, wikiSvc: wikiService, chatSvc: chatService, skillSvc: skillService, agentSvc: agentService };
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

  // ── Chat ────────────────────────────────────────────────────────

  app.post("/api/codascope/projects/:id/chat", wrap(async (req, res) => {
    const { chatSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const { message, model } = req.body as { message?: string; model?: string };
    if (!message || typeof message !== "string" || !message.trim()) {
      throw httpError("message is required.", 400, "invalid_input");
    }
    const response = await chatSvc.chat(id, message.trim(), model);
    res.json(response);
  }));

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

  app.post("/api/codascope/projects/:id/skills/:skillId/run", wrap(async (req, res) => {
    const { skillSvc } = await ensureServices(secretService, httpError);
    const id = param(req, "id");
    const skillId = param(req, "skillId");
    const { model } = req.body as { model?: string };
    const result = await skillSvc.runSkill(id, skillId, model);
    res.json(result);
  }));

  // ── Agent Runs (placeholder — Phase 1 scaffolding) ──────────────

  app.post("/api/codascope/projects/:id/runs", wrap(async (req, res) => {
    const id = param(req, "id");
    const { command, model } = req.body as { command?: string; model?: string };
    if (!command) throw httpError("command is required.", 400, "invalid_input");
    // TODO: Integrate with CodaScopeAgentService + Cursor SDK in next step
    console.log(`[codascope] Agent run requested: ${command} with model ${model ?? "default"} for project ${id}`);
    res.json({ message: `Agent run "${command}" started. (Integration pending)`, runId: `run-${Date.now()}` });
  }));

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

  // ── Assistant (Right Panel) — SSE Streaming ─────────────────────

  app.post("/api/codascope/projects/:id/assistant", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const { agentSvc } = await ensureServices(secretService, httpError);
      const id = param(req, "id");
      const { message, modelId, context } = req.body as {
        message?: string;
        modelId?: string;
        context?: string;
      };

      if (!message || typeof message !== "string" || !message.trim()) {
        throw httpError("message is required.", 400, "invalid_input");
      }
      if (!modelId || typeof modelId !== "string") {
        throw httpError("modelId is required.", 400, "invalid_input");
      }

      // Set up SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // Handle client disconnect
      let aborted = false;
      req.on("close", () => {
        aborted = true;
      });

      await agentSvc.send({
        projectId: id,
        message: message.trim(),
        modelId,
        context: context?.trim(),
        purpose: "assistant",
        onMessage: (msg) => {
          if (aborted) return;
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
        },
        onDone: (result) => {
          if (aborted) return;
          res.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
          res.end();
        },
        onError: (err) => {
          if (aborted) return;
          res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
          res.end();
        },
      });
    })().catch(next);
  });

  // ── Chat — SSE Streaming ────────────────────────────────────────

  app.post("/api/codascope/projects/:id/chat/stream", (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const { agentSvc, chatSvc } = await ensureServices(secretService, httpError);
      const id = param(req, "id");
      const { message, modelId } = req.body as {
        message?: string;
        modelId?: string;
      };

      if (!message || typeof message !== "string" || !message.trim()) {
        throw httpError("message is required.", 400, "invalid_input");
      }
      if (!modelId || typeof modelId !== "string") {
        throw httpError("modelId is required.", 400, "invalid_input");
      }

      // Save user message to chat history
      await chatSvc.saveMessage(id, "user", message.trim());

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
        systemPrompt:
          "You are CodaScope, an AI assistant that helps users understand and explore codebases. " +
          "You have access to tools to browse wiki documentation and repository information. " +
          "Use these tools to find relevant information before answering questions.",
        purpose: "chat",
        onMessage: (msg) => {
          if (aborted) return;
          // Accumulate text for history
          if (msg.type === "assistant" && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === "text") fullResponse += block.text;
            }
          }
          res.write(`data: ${JSON.stringify(msg)}\n\n`);
        },
        onDone: async (result) => {
          if (!aborted) {
            // Save assistant response to chat history
            if (fullResponse) {
              await chatSvc.saveMessage(id, "agent", fullResponse);
            }
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
}
