/* ── CodaScope: Core Routes ───────────────────────────────────────────
   Config, projects, repositories, models, API key validation,
   and project export/import.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import { changeProjectsRoot, getProjectsRoot, getAgentServiceSingleton } from "./codaScopeServiceContext.js";
import { CodaScopeProjectService } from "../services/codaScopeProjectService.js";
import { CodaScopeAgentService } from "../services/codaScopeAgentService.js";
import path from "node:path";
import { archiveUpload, removeUploadedArchive } from "./codaScopeArchiveUpload.js";

// ── Write-blocking guard ──────────────────────────────────────────

/**
 * Reusable guard: rejects requests when a project has unmapped repositories.
 * Import into other route files and call before write operations.
 */
export async function ensureReposMapped(
  projectSvc: CodaScopeProjectService,
  projectId: string,
  httpError: (msg: string, status: number, code: string) => Error,
): Promise<void> {
  const { valid } = await projectSvc.validateRepositories(projectId);
  if (!valid) {
    throw httpError(
      "Project has unmapped repositories. Fix in Settings → Repositories.",
      400,
      "repos_unmapped",
    );
  }
}

export function registerCoreRoutes(ctx: CodaScopeRouteContext): void {
  const { app, secretService, httpError, repoRoot, ensureServices, wrap, param, principal } = ctx;

  // ── Config ──────────────────────────────────────────────────────

  app.get("/api/codascope/config", wrap(async (req, res) => {
    const root = await getProjectsRoot(secretService);
    const actor = principal(req);
    res.json(actor.isAdmin
      ? { projectsRoot: root ?? null, configured: Boolean(root) }
      : { configured: Boolean(root) });
  }));

  app.put("/api/codascope/config", wrap(async (req, res) => {
    if (!principal(req).isAdmin) {
      throw httpError("Administrator access is required.", 403, "forbidden");
    }
    const { projectsRoot: newRoot } = req.body as { projectsRoot?: string };
    if (!newRoot || typeof newRoot !== "string" || !newRoot.trim()) {
      throw httpError("projectsRoot is required.", 400, "invalid_input");
    }
    const resolvedRoot = path.resolve(newRoot.trim());
    await changeProjectsRoot(secretService, resolvedRoot, httpError, repoRoot);
    res.json({ projectsRoot: resolvedRoot, configured: true });
  }));

  // ── Projects ────────────────────────────────────────────────────

  app.get("/api/codascope/projects", wrap(async (_req, res) => {
    const { projectSvc } = await ensureServices();
    const projects = await projectSvc.listProjects();
    res.json({ projects });
  }));

  app.post("/api/codascope/projects", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name || typeof name !== "string" || !name.trim()) {
      throw httpError("name is required.", 400, "invalid_input");
    }
    const project = await projectSvc.createProject(name.trim(), description?.trim() ?? "");
    res.status(201).json({ project });
  }));

  app.get("/api/codascope/projects/:id", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
    const id = param(req, "id");
    const project = await projectSvc.getProject(id);
    if (!project) throw httpError("Project not found.", 404, "not_found");
    res.json({ project });
  }));

  app.put("/api/codascope/projects/:id", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
    const id = param(req, "id");
    const { name, description } = req.body as { name?: string; description?: string };
    const project = await projectSvc.updateProject(id, { name, description });
    if (!project) throw httpError("Project not found.", 404, "not_found");
    res.json({ project });
  }));

  app.delete("/api/codascope/projects/:id", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
    const id = param(req, "id");
    await projectSvc.deleteProject(id);
    res.json({ deleted: true });
  }));

  app.patch("/api/codascope/projects/:id/archive", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
    const id = param(req, "id");
    const { archived } = req.body as { archived?: boolean };
    const project = await projectSvc.updateProject(id, { archived: archived ?? true });
    if (!project) throw httpError("Project not found.", 404, "not_found");
    res.json({ project });
  }));

  // ── Repositories ────────────────────────────────────────────────

  app.post("/api/codascope/projects/:id/repositories", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
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
    const { projectSvc } = await ensureServices();
    const id = param(req, "id");
    const repoId = param(req, "repoId");
    await projectSvc.removeRepository(id, repoId);
    res.json({ deleted: true });
  }));

  app.post("/api/codascope/projects/:id/repositories/:repoId/pull", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
    const id = param(req, "id");
    const repoId = param(req, "repoId");
    const result = await projectSvc.gitPullRepository(id, repoId);
    if (!result.success) {
      res.status(result.error === "Project not found." || result.error === "Repository not found." ? 404 : 500)
        .json(result);
      return;
    }
    res.json(result);
  }));

  app.get("/api/codascope/projects/:id/repositories/:repoId/status", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
    const id = param(req, "id");
    const repoId = param(req, "repoId");
    const result = await projectSvc.checkRepoStatus(id, repoId);
    res.json(result);
  }));

  // ── Legacy generated-wiki recovery ─────────────────────────────

  app.get("/api/codascope/projects/:id/repositories/:repoId/recovery/generated-wiki", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
    const id = param(req, "id");
    const repoId = param(req, "repoId");
    const preview = await projectSvc.previewGeneratedWikiRecovery(id, repoId);
    if (!preview) throw httpError("Project or repository not found.", 404, "not_found");
    res.json(preview);
  }));

  app.post("/api/codascope/projects/:id/repositories/:repoId/recovery/generated-wiki/stash", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
    const id = param(req, "id");
    const repoId = param(req, "repoId");
    const { confirmation, fingerprint } = req.body as { confirmation?: unknown; fingerprint?: unknown };
    const result = await projectSvc.stashGeneratedWikiArtifacts(id, repoId, { confirmation, fingerprint });
    res.json({ success: true, ...result });
  }));

  // ── Remap repository path (PATCH) ──────────────────────────────

  app.patch("/api/codascope/projects/:id/repositories/:repoId", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
    const id = param(req, "id");
    const repoId = param(req, "repoId");
    const { path: newPath } = req.body as { path?: string };
    if (!newPath || typeof newPath !== "string" || !newPath.trim()) {
      throw httpError("path is required.", 400, "invalid_input");
    }
    const ok = await projectSvc.updateRepositoryPath(id, repoId, newPath.trim());
    if (!ok) throw httpError("Project or repository not found.", 404, "not_found");
    res.json({ updated: true });
  }));

  // ── Validate repositories ──────────────────────────────────────

  app.get("/api/codascope/projects/:id/validate-repos", wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
    const id = param(req, "id");
    const result = await projectSvc.validateRepositories(id);
    res.json(result);
  }));

  // ── Export project ─────────────────────────────────────────────

  app.get("/api/codascope/projects/:id/export", wrap(async (req, res) => {
    const { projectBundleSvc } = await ensureServices();
    const id = param(req, "id");
    const bundle = await projectBundleSvc.createExport(id);
    if (!bundle) throw httpError("Project not found.", 404, "not_found");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${bundle.filename}"`);
    bundle.archive.on("error", (err: Error) => {
      console.error("[CodaScope] Export archive error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to create archive." });
      } else {
        res.destroy(err);
      }
    });
    bundle.archive.pipe(res);
    await bundle.archive.finalize();
  }));

  // ── Import project ─────────────────────────────────────────────

  app.post("/api/codascope/projects/import", archiveUpload.single("file"), wrap(async (req, res) => {
    const { projectBundleSvc } = await ensureServices();
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) throw httpError("No file uploaded.", 400, "missing_file");

    try {
      const result = await projectBundleSvc.importProject(file.path);
      res.status(201).json(result);
    } finally {
      await removeUploadedArchive(file);
    }
  }));

  // ── Models ──────────────────────────────────────────────────────

  app.get("/api/codascope/models", wrap(async (_req, res) => {
    const { agentSvc } = await ensureServices();
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
    let svc = getAgentServiceSingleton();
    let temporaryService = false;
    if (!svc) {
      const root = await getProjectsRoot(secretService) ?? "/tmp/codascope-validate";
      svc = new CodaScopeAgentService(secretService, root);
      temporaryService = true;
    }

    try {
      const result = await svc.validateApiKey(apiKey.trim());
      res.json(result);
    } finally {
      if (temporaryService) await svc.shutdown();
    }
  }));
}
