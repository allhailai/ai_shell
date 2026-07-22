/* ── CodaScope: Project Service ───────────────────────────────────────
   Manages CodaScope projects on the filesystem.
   Projects are stored as directories under the configured root path,
   each with a project.json metadata file.
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import type { ProjectDirResolver } from "./codaScopeProjectDirResolver.js";

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
  archived?: boolean;
}

export interface RepositoryRecoveryChange {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
}

export interface GeneratedWikiRecoveryPreview {
  repository: { id: string; name: string };
  changes: RepositoryRecoveryChange[];
  fingerprint: string;
}

const GENERATED_WIKI_PATHSPECS = ["wiki", ":(glob)code_map_*.md"];
const GENERATED_WIKI_STASH_CONFIRMATION = "STASH GENERATED FILES";

function parsePorcelainChanges(porcelain: string): RepositoryRecoveryChange[] {
  const records = porcelain.split("\0");
  const changes: RepositoryRecoveryChange[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;

    const indexStatus = record[0] ?? " ";
    const worktreeStatus = record[1] ?? " ";
    const path = record.slice(3);
    const renamedOrCopied = indexStatus === "R" || indexStatus === "C";
    const originalPath = renamedOrCopied ? records[++index] || undefined : undefined;
    changes.push({ indexStatus, worktreeStatus, path, ...(originalPath ? { originalPath } : {}) });
  }

  return changes;
}

export class CodaScopeProjectService {
  private root: string;
  private dirResolver: ProjectDirResolver | null = null;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  getRoot(): string {
    return this.root;
  }

  /** Set an optional cached directory resolver. When set, getProjectDir delegates to it. */
  setDirResolver(resolver: ProjectDirResolver): void {
    this.dirResolver = resolver;
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
      const data = JSON.parse(raw) as ProjectData;
      // Count wiki pages (same as listProjects)
      const wikiDir = path.join(projectDir, "wiki");
      let wikiPageCount = 0;
      if (existsSync(wikiDir)) {
        wikiPageCount = readdirSync(wikiDir).filter((f) => f.endsWith(".md") && !f.startsWith("_")).length;
      }
      return { ...data, wikiPageCount } as ProjectData & { wikiPageCount: number };
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

  async updateProject(id: string, updates: { name?: string; description?: string; archived?: boolean }): Promise<ProjectData | null> {
    const projectDir = this.findProjectDir(id);
    if (!projectDir) return null;

    const projectPath = path.join(projectDir, "project.json");
    const raw = readFileSync(projectPath, "utf-8");
    const project = JSON.parse(raw) as ProjectData;

    if (updates.name !== undefined) project.name = updates.name;
    if (updates.description !== undefined) project.description = updates.description;
    if (updates.archived !== undefined) project.archived = updates.archived;
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

  // ── Validate repositories ─────────────────────────────────────────

  /**
   * Check whether each repository's local path is valid (exists and is a git repo).
   * Used after import to detect repos that need remapping on the target machine.
   */
  async validateRepositories(projectId: string): Promise<{
    valid: boolean;
    unmappedRepos: Array<{ id: string; name: string; path: string }>;
  }> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return { valid: true, unmappedRepos: [] };

    const projectPath = path.join(projectDir, "project.json");
    if (!existsSync(projectPath)) return { valid: true, unmappedRepos: [] };

    try {
      const raw = readFileSync(projectPath, "utf-8");
      const project = JSON.parse(raw) as ProjectData;
      const unmappedRepos: Array<{ id: string; name: string; path: string }> = [];

      for (const repo of project.repositories) {
        if (!existsSync(repo.path) || !existsSync(path.join(repo.path, ".git"))) {
          unmappedRepos.push({ id: repo.id, name: repo.name, path: repo.path });
        }
      }

      return { valid: unmappedRepos.length === 0, unmappedRepos };
    } catch {
      return { valid: true, unmappedRepos: [] };
    }
  }

  // ── Update a single repository's path ─────────────────────────────

  /**
   * Update the path for a specific repository in a project.
   * Used during repo remapping after import.
   */
  async updateRepositoryPath(projectId: string, repoId: string, newPath: string): Promise<boolean> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return false;

    const projectPath = path.join(projectDir, "project.json");
    const raw = readFileSync(projectPath, "utf-8");
    const project = JSON.parse(raw) as ProjectData;
    const repo = project.repositories.find((r) => r.id === repoId);
    if (!repo) return false;

    repo.path = newPath;

    // Try to detect branch from new path
    try {
      const headPath = path.join(newPath, ".git", "HEAD");
      if (existsSync(headPath)) {
        const head = readFileSync(headPath, "utf-8").trim();
        if (head.startsWith("ref: refs/heads/")) {
          repo.branch = head.replace("ref: refs/heads/", "");
        }
      }
    } catch { /* ignore */ }

    project.updatedAt = new Date().toISOString();
    writeFileSync(projectPath, JSON.stringify(project, null, 2));
    return true;
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
    // Use cached resolver when available
    if (this.dirResolver) {
      return this.dirResolver.resolve(id);
    }
    return this.findProjectDir(id);
  }

  // ── Generated wiki recovery ───────────────────────────────────────

  /**
   * Return only legacy CodaScope build artifacts that are dirty in a configured
   * repository. This intentionally excludes all ordinary repository changes.
   */
  async previewGeneratedWikiRecovery(
    projectId: string,
    repoId: string,
  ): Promise<GeneratedWikiRecoveryPreview | null> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    const projectPath = path.join(projectDir, "project.json");
    const project = JSON.parse(readFileSync(projectPath, "utf-8")) as ProjectData;
    const repo = project.repositories.find((candidate) => candidate.id === repoId);
    if (!repo || !existsSync(repo.path) || !existsSync(path.join(repo.path, ".git"))) return null;

    const porcelain = this.generatedWikiRecoveryPorcelain(repo.path);
    return {
      repository: { id: repo.id, name: repo.name },
      changes: parsePorcelainChanges(porcelain),
      fingerprint: crypto.createHash("sha256").update(porcelain).digest("hex"),
    };
  }

  /**
   * Stash only the files the old wiki-build behavior could have created.
   * The caller must confirm the exact preview, so newly changed files are
   * never silently included in a recovery stash.
   */
  async stashGeneratedWikiArtifacts(
    projectId: string,
    repoId: string,
    input: { confirmation: unknown; fingerprint: unknown },
  ): Promise<{ stashRef: string; changes: RepositoryRecoveryChange[] }> {
    if (input.confirmation !== GENERATED_WIKI_STASH_CONFIRMATION) {
      throw Object.assign(new Error(`Type ${GENERATED_WIKI_STASH_CONFIRMATION} to stash the generated files.`), {
        status: 400,
        code: "generated_wiki_stash_confirmation_required",
      });
    }

    if (typeof input.fingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(input.fingerprint)) {
      throw Object.assign(new Error("A valid recovery preview is required before stashing files."), {
        status: 400,
        code: "generated_wiki_stash_preview_required",
      });
    }

    const preview = await this.previewGeneratedWikiRecovery(projectId, repoId);
    if (!preview) {
      throw Object.assign(new Error("Project or repository not found."), { status: 404, code: "not_found" });
    }
    if (preview.fingerprint !== input.fingerprint) {
      throw Object.assign(new Error("Repository changes have changed. Review the generated files again before stashing."), {
        status: 409,
        code: "generated_wiki_stash_preview_stale",
      });
    }
    if (preview.changes.length === 0) {
      throw Object.assign(new Error("No generated wiki files are currently dirty in this repository."), {
        status: 409,
        code: "generated_wiki_stash_empty",
      });
    }

    const projectDir = this.findProjectDir(projectId)!;
    const project = JSON.parse(readFileSync(path.join(projectDir, "project.json"), "utf-8")) as ProjectData;
    const repo = project.repositories.find((candidate) => candidate.id === repoId)!;
    const stamp = new Date().toISOString();

    execFileSync(
      "git",
      [
        "stash",
        "push",
        "--include-untracked",
        "--message",
        `CodaScope recovery: generated wiki files ${stamp}`,
        "--",
        ...GENERATED_WIKI_PATHSPECS,
      ],
      { cwd: repo.path, encoding: "utf-8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] },
    );

    const stashRef = execFileSync(
      "git",
      ["stash", "list", "-1", "--format=%gd"],
      { cwd: repo.path, encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (!stashRef) {
      throw Object.assign(new Error("Git did not create a recovery stash."), {
        status: 500,
        code: "generated_wiki_stash_missing",
      });
    }

    return { stashRef, changes: preview.changes };
  }

  private generatedWikiRecoveryPorcelain(repoPath: string): string {
    return execFileSync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...GENERATED_WIKI_PATHSPECS],
      { cwd: repoPath, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] },
    );
  }

  // ── Git status check ──────────────────────────────────────────────

  /**
   * Check if a repository is behind its remote tracking branch.
   * Runs `git fetch` then compares local vs upstream.
   */
  async checkRepoStatus(
    projectId: string,
    repoId: string
  ): Promise<{
    status: "current" | "behind" | "ahead" | "diverged" | "unknown";
    behind: number;
    ahead: number;
    branch: string | null;
    error?: string;
  }> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return { status: "unknown", behind: 0, ahead: 0, branch: null, error: "Project not found." };

    const projectPath = path.join(projectDir, "project.json");
    const raw = readFileSync(projectPath, "utf-8");
    const project = JSON.parse(raw) as ProjectData;
    const repo = project.repositories.find((r) => r.id === repoId);
    if (!repo) return { status: "unknown", behind: 0, ahead: 0, branch: null, error: "Repository not found." };

    if (!existsSync(repo.path) || !existsSync(path.join(repo.path, ".git"))) {
      return { status: "unknown", behind: 0, ahead: 0, branch: repo.branch ?? null, error: "Not a git repository." };
    }

    // Detect the current branch
    let branch = repo.branch ?? null;
    try {
      const headContent = readFileSync(path.join(repo.path, ".git", "HEAD"), "utf-8").trim();
      if (headContent.startsWith("ref: refs/heads/")) {
        branch = headContent.replace("ref: refs/heads/", "");
      }
    } catch { /* ignore */ }

    // Fetch latest from remote (silent, with timeout)
    try {
      execSync("git fetch", {
        cwd: repo.path,
        encoding: "utf-8",
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Fetch failed (no network, no remote, etc.) — return unknown
      return { status: "unknown", behind: 0, ahead: 0, branch, error: "Could not fetch from remote." };
    }

    // Compare local HEAD vs upstream tracking branch
    try {
      const behindStr = execSync("git rev-list --count HEAD..@{u}", {
        cwd: repo.path,
        encoding: "utf-8",
        timeout: 5_000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      const aheadStr = execSync("git rev-list --count @{u}..HEAD", {
        cwd: repo.path,
        encoding: "utf-8",
        timeout: 5_000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      const behind = parseInt(behindStr, 10) || 0;
      const ahead = parseInt(aheadStr, 10) || 0;

      let status: "current" | "behind" | "ahead" | "diverged" = "current";
      if (behind > 0 && ahead > 0) status = "diverged";
      else if (behind > 0) status = "behind";
      else if (ahead > 0) status = "ahead";

      return { status, behind, ahead, branch };
    } catch {
      // No tracking branch set
      return { status: "unknown", behind: 0, ahead: 0, branch, error: "No upstream tracking branch." };
    }
  }

  // ── Git pull ──────────────────────────────────────────────────────

  async gitPullRepository(
    projectId: string,
    repoId: string
  ): Promise<{ success: boolean; output: string; branch?: string; error?: string }> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return { success: false, output: "", error: "Project not found." };

    const projectPath = path.join(projectDir, "project.json");
    const raw = readFileSync(projectPath, "utf-8");
    const project = JSON.parse(raw) as ProjectData;
    const repo = project.repositories.find((r) => r.id === repoId);
    if (!repo) return { success: false, output: "", error: "Repository not found." };

    if (!existsSync(repo.path)) {
      return { success: false, output: "", error: `Repository path does not exist: ${repo.path}` };
    }
    if (!existsSync(path.join(repo.path, ".git"))) {
      return { success: false, output: "", error: "Not a git repository." };
    }

    try {
      const output = execSync("git pull", {
        cwd: repo.path,
        encoding: "utf-8",
        timeout: 60_000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Update the stored branch in case it changed
      try {
        const headPath = path.join(repo.path, ".git", "HEAD");
        const head = readFileSync(headPath, "utf-8").trim();
        if (head.startsWith("ref: refs/heads/")) {
          repo.branch = head.replace("ref: refs/heads/", "");
        }
      } catch {
        // ignore
      }

      project.updatedAt = new Date().toISOString();
      writeFileSync(projectPath, JSON.stringify(project, null, 2));

      return { success: true, output: output.trim(), branch: repo.branch };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "git pull failed";
      // Extract stderr from exec error
      const stderr = (err as { stderr?: string })?.stderr?.toString().trim();
      return { success: false, output: stderr || message, error: stderr || message };
    }
  }
}
