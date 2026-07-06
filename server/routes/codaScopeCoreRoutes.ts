/* ── CodaScope: Core Routes ───────────────────────────────────────────
   Config, projects, repositories, models, API key validation,
   and project export/import.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import { getProjectsRoot, setProjectsRoot, getAgentServiceSingleton } from "./codaScopeServiceContext.js";
import { CodaScopeProjectService } from "../services/codaScopeProjectService.js";
import { CodaScopeAgentService } from "../services/codaScopeAgentService.js";
// archiver v8 exports class constructors, not a factory function.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { ZipArchive } = require("archiver") as {
  ZipArchive: new (options?: Record<string, unknown>) => import("stream").Transform & {
    append: (source: import("stream").Readable | Buffer | string, data?: { name: string }) => unknown;
    directory: (dirpath: string, destpath: false | string) => unknown;
    finalize: () => Promise<void>;
    on: (event: string, listener: (...args: unknown[]) => void) => unknown;
    pipe: (dest: import("stream").Writable) => import("stream").Writable;
  };
};
import * as unzipper from "unzipper";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rename, rm, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

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
  const { app, secretService, httpError, ensureServices, wrap, param, upload } = ctx;

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
    const { projectSvc } = await ensureServices();
    const id = param(req, "id");
    const projectDir = projectSvc.getProjectDir(id);
    if (!projectDir) throw httpError("Project not found.", 404, "not_found");

    // Read project.json for metadata
    const projectJsonPath = path.join(projectDir, "project.json");
    if (!existsSync(projectJsonPath)) throw httpError("Project data is corrupted.", 500, "corrupted");
    const projectData = JSON.parse(readFileSync(projectJsonPath, "utf-8"));

    // Derive a safe filename from the project slug (directory name)
    const slug = path.basename(projectDir);
    const safeName = slug.replace(/[^a-z0-9_-]/gi, "_");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="codascope_${safeName}.zip"`);

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on("error", (err: Error) => {
      console.error("[CodaScope] Export archive error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to create archive." });
      }
    });

    archive.pipe(res);

    // Add _export_meta.json at the root
    const exportMeta = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      originalProjectId: projectData.id,
      originalSlug: slug,
    };
    archive.append(JSON.stringify(exportMeta, null, 2), { name: "_export_meta.json" });

    // Add the entire project directory
    archive.directory(projectDir, false);

    await archive.finalize();
  }));

  // ── Import project ─────────────────────────────────────────────

  app.post("/api/codascope/projects/import", upload.single("file"), wrap(async (req, res) => {
    const { projectSvc } = await ensureServices();
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) throw httpError("No file uploaded.", 400, "missing_file");

    // Extract to a temp directory
    const tmpDir = path.join(os.tmpdir(), `codascope-import-${crypto.randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      // Write the uploaded buffer to a temp file and extract
      const tmpZipPath = path.join(tmpDir, "upload.zip");
      writeFileSync(tmpZipPath, file.buffer);

      const extractedDir = path.join(tmpDir, "extracted");
      mkdirSync(extractedDir, { recursive: true });
      const zipDir = await unzipper.Open.file(tmpZipPath);
      await zipDir.extract({ path: extractedDir });

      // Validate: project.json must exist
      if (!existsSync(path.join(extractedDir, "project.json"))) {
        throw httpError("Invalid archive: project.json not found.", 400, "invalid_archive");
      }

      // Read the original project data
      const rawProject = readFileSync(path.join(extractedDir, "project.json"), "utf-8");
      const originalProject = JSON.parse(rawProject);

      // Generate fresh UUID and slug
      const newId = crypto.randomUUID();
      const baseName = originalProject.name || "Imported Project";
      const baseSlug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || newId;
      const projectsRoot = projectSvc.getRoot();

      // Find a unique directory name
      let targetSlug = baseSlug;
      let targetDir = path.join(projectsRoot, targetSlug);
      let counter = 2;
      let collision = false;
      while (existsSync(targetDir)) {
        collision = true;
        targetSlug = `${baseSlug}-${counter}`;
        targetDir = path.join(projectsRoot, targetSlug);
        counter++;
      }

      // Move extracted content to the target directory
      await rename(extractedDir, targetDir);

      // Rewrite project.json with new UUID, keeping everything else
      const now = new Date().toISOString();
      const newProjectData = {
        ...originalProject,
        id: newId,
        name: collision ? `${baseName} (imported)` : baseName,
        updatedAt: now,
      };
      writeFileSync(path.join(targetDir, "project.json"), JSON.stringify(newProjectData, null, 2));

      // Remove export meta file if present
      const metaPath = path.join(targetDir, "_export_meta.json");
      if (existsSync(metaPath)) {
        await rm(metaPath);
      }

      // Check repo validity
      const repoStatus = await projectSvc.validateRepositories(newId);

      res.status(201).json({
        project: newProjectData,
        needsRepoMapping: !repoStatus.valid,
        unmappedRepos: repoStatus.unmappedRepos,
      });
    } finally {
      // Clean up temp directory
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch { /* ignore cleanup errors */ }
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
    if (!svc) {
      const root = await getProjectsRoot(secretService) ?? "/tmp/codascope-validate";
      svc = new CodaScopeAgentService(secretService, root);
      // Don't persist as the singleton — let ensureServices do that
    }

    const result = await svc.validateApiKey(apiKey.trim());
    res.json(result);
  }));
}

