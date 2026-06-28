/* ── CodaScope: Project Service ───────────────────────────────────────
   Manages CodaScope projects on the filesystem.
   Projects are stored as directories under the configured root path,
   each with a project.json metadata file.
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

interface RepoInfo {
  id: string;
  name: string;
  path: string;
  branch?: string;
}

interface ProjectData {
  id: string;
  name: string;
  description: string;
  repositories: RepoInfo[];
  createdAt: string;
  updatedAt: string;
}

export class CodaScopeProjectService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  async ensureRootExists(): Promise<void> {
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
    }
  }

  // ── List all projects ─────────────────────────────────────────────

  async listProjects(): Promise<ProjectData[]> {
    await this.ensureRootExists();
    const entries = readdirSync(this.root, { withFileTypes: true });
    const projects: ProjectData[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectPath = path.join(this.root, entry.name, "project.json");
      if (existsSync(projectPath)) {
        try {
          const raw = readFileSync(projectPath, "utf-8");
          const data = JSON.parse(raw) as ProjectData;
          // Count wiki pages
          const wikiDir = path.join(this.root, entry.name, "wiki");
          let wikiPageCount = 0;
          if (existsSync(wikiDir)) {
            wikiPageCount = readdirSync(wikiDir).filter((f) => f.endsWith(".md") && !f.startsWith("_")).length;
          }
          projects.push({ ...data, wikiPageCount } as ProjectData & { wikiPageCount: number });
        } catch {
          // Skip corrupted projects
        }
      }
    }

    return projects;
  }

  // ── Get single project ────────────────────────────────────────────

  async getProject(id: string): Promise<ProjectData | null> {
    const projectDir = this.findProjectDir(id);
    if (!projectDir) return null;

    const projectPath = path.join(projectDir, "project.json");
    if (!existsSync(projectPath)) return null;

    try {
      const raw = readFileSync(projectPath, "utf-8");
      return JSON.parse(raw) as ProjectData;
    } catch {
      return null;
    }
  }

  // ── Create project ────────────────────────────────────────────────

  async createProject(name: string, description: string): Promise<ProjectData> {
    await this.ensureRootExists();

    const id = crypto.randomUUID();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || id;
    const projectDir = path.join(this.root, slug);

    if (existsSync(projectDir)) {
      // Add numeric suffix if slug already exists
      let counter = 2;
      let uniqueDir = `${projectDir}-${counter}`;
      while (existsSync(uniqueDir)) {
        counter++;
        uniqueDir = `${projectDir}-${counter}`;
      }
      mkdirSync(uniqueDir, { recursive: true });
      return this.writeProject(uniqueDir, id, name, description);
    }

    mkdirSync(projectDir, { recursive: true });
    return this.writeProject(projectDir, id, name, description);
  }

  private writeProject(projectDir: string, id: string, name: string, description: string): ProjectData {
    // Create subdirectories
    mkdirSync(path.join(projectDir, "wiki"), { recursive: true });
    mkdirSync(path.join(projectDir, "quality"), { recursive: true });
    mkdirSync(path.join(projectDir, "skills"), { recursive: true });
    mkdirSync(path.join(projectDir, "versions"), { recursive: true });
    mkdirSync(path.join(projectDir, "chat"), { recursive: true });

    const now = new Date().toISOString();
    const project: ProjectData = {
      id,
      name,
      description,
      repositories: [],
      createdAt: now,
      updatedAt: now,
    };

    writeFileSync(path.join(projectDir, "project.json"), JSON.stringify(project, null, 2));
    return project;
  }

  // ── Update project ────────────────────────────────────────────────

  async updateProject(id: string, updates: { name?: string; description?: string }): Promise<ProjectData | null> {
    const projectDir = this.findProjectDir(id);
    if (!projectDir) return null;

    const projectPath = path.join(projectDir, "project.json");
    const raw = readFileSync(projectPath, "utf-8");
    const project = JSON.parse(raw) as ProjectData;

    if (updates.name !== undefined) project.name = updates.name;
    if (updates.description !== undefined) project.description = updates.description;
    project.updatedAt = new Date().toISOString();

    writeFileSync(projectPath, JSON.stringify(project, null, 2));
    return project;
  }

  // ── Delete project ────────────────────────────────────────────────

  async deleteProject(id: string): Promise<void> {
    const projectDir = this.findProjectDir(id);
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  }

  // ── Repository management ─────────────────────────────────────────

  async addRepository(projectId: string, repo: { name: string; path: string }): Promise<RepoInfo | null> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    const projectPath = path.join(projectDir, "project.json");
    const raw = readFileSync(projectPath, "utf-8");
    const project = JSON.parse(raw) as ProjectData;

    const newRepo: RepoInfo = {
      id: crypto.randomUUID(),
      name: repo.name,
      path: repo.path,
    };

    // Try to detect branch
    try {
      const headPath = path.join(repo.path, ".git", "HEAD");
      if (existsSync(headPath)) {
        const head = readFileSync(headPath, "utf-8").trim();
        if (head.startsWith("ref: refs/heads/")) {
          newRepo.branch = head.replace("ref: refs/heads/", "");
        }
      }
    } catch {
      // Not a git repo or can't read HEAD
    }

    project.repositories.push(newRepo);
    project.updatedAt = new Date().toISOString();
    writeFileSync(projectPath, JSON.stringify(project, null, 2));

    return newRepo;
  }

  async removeRepository(projectId: string, repoId: string): Promise<void> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return;

    const projectPath = path.join(projectDir, "project.json");
    const raw = readFileSync(projectPath, "utf-8");
    const project = JSON.parse(raw) as ProjectData;

    project.repositories = project.repositories.filter((r) => r.id !== repoId);
    project.updatedAt = new Date().toISOString();
    writeFileSync(projectPath, JSON.stringify(project, null, 2));
  }

  // ── Internal: find project directory by ID ────────────────────────

  private findProjectDir(id: string): string | null {
    if (!existsSync(this.root)) return null;

    const entries = readdirSync(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectPath = path.join(this.root, entry.name, "project.json");
      if (existsSync(projectPath)) {
        try {
          const raw = readFileSync(projectPath, "utf-8");
          const data = JSON.parse(raw);
          if (data.id === id) return path.join(this.root, entry.name);
        } catch {
          // Skip corrupted
        }
      }
    }
    return null;
  }

  // ── Get project directory (public) ────────────────────────────────

  getProjectDir(id: string): string | null {
    return this.findProjectDir(id);
  }
}
