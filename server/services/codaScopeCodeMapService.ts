/* ── CodaScope: Code Map Service ──────────────────────────────────────
   Progressive discovery layer for codebase analysis. Builds and manages
   Code Map files — structured, progressive-disclosure documents about
   each repository.

   Key features:
   - Deterministic file inventory (no AI): file tree, language detection, sizes
   - Git HEAD detection for staleness checking
   - Read/write code_map_<repo-slug>.md files
   - Provide concatenated Code Map text for agent context injection
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { assertSafePathSegment, isSafePathSegment } from "./codaScopePathSafety.js";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface FileInventoryEntry {
  path: string;
  type: "file" | "directory";
  language: string | null;
  size: number;
  children?: number;
}

export interface FileInventory {
  repoName: string;
  repoPath: string;
  generatedAt: string;
  totalFiles: number;
  totalDirs: number;
  totalSize: number;
  languages: Record<string, number>; // language → file count
  tree: FileInventoryEntry[];
  existingDocs: string[];            // paths to README.md, ARCHITECTURE.md, etc.
}

export interface CodeMapStatus {
  repoId: string;
  repoName: string;
  repoPath: string;
  exists: boolean;
  generatedAt: string | null;
  isStale: boolean;
  staleReason: string | null;
  currentGitHead: string | null;
  mapGitHead: string | null;
  commitsBehind: number;
}

export interface CodeMapMeta {
  repoId: string;
  repoSlug: string;
  generatedAt: string;
  gitHead: string | null;
  totalFiles: number;
  languages: string[];
}

/* ── Language Detection ─────────────────────────────────────────────── */

const LANG_MAP: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript",
  ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".rb": "Ruby", ".rs": "Rust", ".go": "Go",
  ".java": "Java", ".kt": "Kotlin", ".swift": "Swift",
  ".ex": "Elixir", ".exs": "Elixir", ".erl": "Erlang",
  ".cs": "C#", ".cpp": "C++", ".c": "C", ".h": "C/C++ Header",
  ".php": "PHP", ".scala": "Scala", ".clj": "Clojure",
  ".lua": "Lua", ".r": "R", ".R": "R",
  ".sql": "SQL", ".graphql": "GraphQL", ".gql": "GraphQL",
  ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".less": "Less",
  ".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML",
  ".xml": "XML", ".md": "Markdown", ".mdx": "MDX",
  ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell",
  ".dockerfile": "Dockerfile", ".tf": "Terraform", ".hcl": "HCL",
  ".proto": "Protobuf", ".vue": "Vue", ".svelte": "Svelte",
};

/** Directories to always skip during inventory */
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "dist", "build", "_build",
  "deps", "vendor", ".elixir_ls", "__pycache__", ".next", ".nuxt",
  ".turbo", "target", "coverage", ".cache", ".parcel-cache",
  "tmp", ".tmp", "bower_components",
]);

/** Doc files that indicate existing documentation */
const DOC_FILES = new Set([
  "README.md", "readme.md", "ARCHITECTURE.md", "architecture.md",
  "CONTRIBUTING.md", "CHANGELOG.md", "API.md", "DESIGN.md",
  "docs", "doc", ".github",
]);

function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (LANG_MAP[ext]) return LANG_MAP[ext];

  const basename = path.basename(filePath).toLowerCase();
  if (basename === "dockerfile") return "Dockerfile";
  if (basename === "makefile") return "Makefile";
  if (basename === "rakefile") return "Ruby";
  if (basename === "gemfile") return "Ruby";
  if (basename === "cmakelists.txt") return "CMake";

  return null;
}

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeCodeMapService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Directory Helpers ────────────────────────────────────────────── */

  private projectDir(projectId: string): string {
    // Projects are stored by their human-friendly directory slug, while
    // callers identify them by the stable ID in project.json. Older projects
    // can happen to use the same value for both, so preserve that fast path.
    if (isSafePathSegment(projectId)) {
      const direct = path.join(this.root, projectId);
      const directProjectPath = path.join(direct, "project.json");
      if (existsSync(directProjectPath)) {
        try {
          if (JSON.parse(readFileSync(directProjectPath, "utf-8")).id === projectId) return direct;
        } catch { /* fall through to a directory scan */ }
      }
    }

    try {
      for (const entry of readdirSync(this.root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const candidate = path.join(this.root, entry.name);
        const projectPath = path.join(candidate, "project.json");
        if (!existsSync(projectPath)) continue;
        try {
          if (JSON.parse(readFileSync(projectPath, "utf-8")).id === projectId) return candidate;
        } catch { /* skip malformed project metadata */ }
      }
    } catch { /* root may not exist yet */ }

    // Preserve the legacy behavior for callers that create a project data
    // directory before its project.json metadata has been written.
    return path.join(this.root, assertSafePathSegment(projectId, "project ID"));
  }

  private codeMapPath(projectId: string, repoSlug: string): string {
    return path.join(
      this.projectDir(projectId),
      `code_map_${assertSafePathSegment(repoSlug, "repository slug")}.md`,
    );
  }

  private codeMapMetaPath(projectId: string, repoSlug: string): string {
    return path.join(
      this.projectDir(projectId),
      `code_map_${assertSafePathSegment(repoSlug, "repository slug")}.meta.json`,
    );
  }

  /** Convert a repo name/path to a filesystem-safe slug */
  static repoSlug(nameOrPath: string): string {
    const name = path.basename(nameOrPath);
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  /* ── Deterministic File Inventory ─────────────────────────────────── */

  /**
   * Generate a file inventory for a repository directory.
   * This is purely deterministic — no AI, runs instantly.
   */
  generateFileInventory(repoName: string, repoPath: string): FileInventory {
    const languages: Record<string, number> = {};
    const tree: FileInventoryEntry[] = [];
    const existingDocs: string[] = [];
    let totalFiles = 0;
    let totalDirs = 0;
    let totalSize = 0;

    const walk = (dir: string, relPrefix: string, depth: number) => {
      if (depth > 8) return; // Limit depth

      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }

      for (const name of entries) {
        if (name.startsWith(".") && name !== ".github") continue;
        if (SKIP_DIRS.has(name)) continue;

        const fullPath = path.join(dir, name);
        const relPath = relPrefix ? `${relPrefix}/${name}` : name;

        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          totalDirs++;

          // Check for doc directories
          if (DOC_FILES.has(name.toLowerCase()) || DOC_FILES.has(name)) {
            existingDocs.push(relPath);
          }

          // Count children for the tree entry
          let childCount = 0;
          try {
            childCount = readdirSync(fullPath).filter(
              (f) => !f.startsWith(".") && !SKIP_DIRS.has(f),
            ).length;
          } catch { /* ignore */ }

          tree.push({
            path: relPath,
            type: "directory",
            language: null,
            size: 0,
            children: childCount,
          });

          walk(fullPath, relPath, depth + 1);
        } else if (stat.isFile()) {
          totalFiles++;
          totalSize += stat.size;

          const lang = detectLanguage(name);
          if (lang) {
            languages[lang] = (languages[lang] ?? 0) + 1;
          }

          // Check for doc files
          if (DOC_FILES.has(name) || DOC_FILES.has(name.toLowerCase())) {
            existingDocs.push(relPath);
          }

          // Only include files in tree up to a reasonable depth
          if (depth <= 4) {
            tree.push({
              path: relPath,
              type: "file",
              language: lang,
              size: stat.size,
            });
          }
        }
      }
    };

    if (existsSync(repoPath)) {
      walk(repoPath, "", 0);
    }

    return {
      repoName,
      repoPath,
      generatedAt: new Date().toISOString(),
      totalFiles,
      totalDirs,
      totalSize,
      languages,
      tree,
      existingDocs,
    };
  }

  /**
   * Format a file inventory as a markdown section suitable for agent context.
   */
  formatInventoryAsMarkdown(inv: FileInventory): string {
    const langSummary = Object.entries(inv.languages)
      .sort((a, b) => b[1] - a[1])
      .map(([lang, count]) => `${lang} (${count})`)
      .join(", ");

    const lines: string[] = [
      `## File Inventory: ${inv.repoName}`,
      "",
      `> ${inv.totalFiles} files, ${inv.totalDirs} directories | Languages: ${langSummary || "none detected"}`,
      "",
    ];

    // Group files by top-level directory
    const topDirs = new Map<string, { files: number; subdirs: number; langs: Set<string> }>();
    for (const entry of inv.tree) {
      const topDir = entry.path.split("/")[0];
      if (!topDirs.has(topDir)) {
        topDirs.set(topDir, { files: 0, subdirs: 0, langs: new Set() });
      }
      const info = topDirs.get(topDir)!;
      if (entry.type === "file") {
        info.files++;
        if (entry.language) info.langs.add(entry.language);
      } else {
        info.subdirs++;
      }
    }

    lines.push("### Directory Structure");
    lines.push("```");
    for (const [dir, info] of topDirs) {
      const langStr = info.langs.size > 0 ? ` — ${[...info.langs].join(", ")}` : "";
      lines.push(`${dir}/ (${info.files} files, ${info.subdirs} subdirs)${langStr}`);
    }
    lines.push("```");
    lines.push("");

    // List existing documentation
    if (inv.existingDocs.length > 0) {
      lines.push("### Existing Documentation");
      for (const doc of inv.existingDocs) {
        lines.push(`- \`${doc}\``);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Read content of existing documentation files for agent context.
   */
  readExistingDocs(repoPath: string, docPaths: string[]): string {
    const sections: string[] = [];

    for (const docPath of docPaths) {
      const fullPath = path.join(repoPath, docPath);
      if (!existsSync(fullPath)) continue;

      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && stat.size < 50_000) { // Skip very large files
          const content = readFileSync(fullPath, "utf-8");
          sections.push(`### ${docPath}\n\n${content}`);
        }
      } catch { /* skip unreadable files */ }
    }

    return sections.length > 0
      ? "## Existing Documentation Content\n\n" + sections.join("\n\n---\n\n")
      : "(No existing documentation files found)";
  }

  /* ── Git Utilities ────────────────────────────────────────────────── */

  /**
   * Get the current git HEAD commit hash for a repository.
   * Returns null if not a git repo or git is unavailable.
   */
  getGitHead(repoPath: string): string | null {
    try {
      const result = execSync("git rev-parse HEAD", {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return result.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Get the number of commits between two git refs.
   */
  getCommitCount(repoPath: string, fromRef: string, toRef: string): number {
    try {
      const result = execSync(`git rev-list --count ${fromRef}..${toRef}`, {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return parseInt(result.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get recent git log (last N commits) as context.
   */
  getRecentCommits(repoPath: string, count = 10): string {
    try {
      const result = execSync(
        `git log --oneline -${count} --no-decorate`,
        {
          cwd: repoPath,
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return result.trim() || "(no git history)";
    } catch {
      return "(git log unavailable)";
    }
  }

  /**
   * Get the list of files changed between two git refs.
   * Returns relative file paths from the repo root.
   */
  getChangedFiles(repoPath: string, fromRef: string, toRef: string): string[] {
    try {
      const result = execSync(`git diff --name-only ${fromRef}..${toRef}`, {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return result
        .trim()
        .split("\n")
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /* ── Code Map Read/Write ──────────────────────────────────────────── */

  /**
   * Save a Code Map metadata file alongside the Code Map markdown.
   */
  saveCodeMapMeta(projectId: string, repoSlug: string, meta: CodeMapMeta): void {
    const metaPath = this.codeMapMetaPath(projectId, repoSlug);
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  }

  /**
   * Read Code Map metadata.
   */
  getCodeMapMeta(projectId: string, repoSlug: string): CodeMapMeta | null {
    const metaPath = this.codeMapMetaPath(projectId, repoSlug);
    if (!existsSync(metaPath)) return null;
    try {
      return JSON.parse(readFileSync(metaPath, "utf-8"));
    } catch {
      return null;
    }
  }

  /**
   * Read a Code Map markdown file for a specific repository.
   */
  readCodeMap(projectId: string, repoSlug: string): string | null {
    const mapPath = this.codeMapPath(projectId, repoSlug);
    if (!existsSync(mapPath)) return null;
    try {
      return readFileSync(mapPath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Write a Code Map markdown file.
   */
  writeCodeMap(projectId: string, repoSlug: string, content: string): void {
    const dir = this.projectDir(projectId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.codeMapPath(projectId, repoSlug), content, "utf-8");
  }

  /**
   * Update a specific section of the Code Map by heading.
   * Preserves all other sections. Used by the assistant's update_code_map_section tool.
   */
  updateCodeMapSection(
    projectId: string,
    repoSlug: string,
    sectionHeading: string,
    newContent: string,
  ): boolean {
    const existing = this.readCodeMap(projectId, repoSlug);
    if (!existing) return false;

    // Find the section by heading (## Level N — Title)
    const headingPattern = new RegExp(
      `(^## .*${sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$)`,
      "mi",
    );
    const match = existing.match(headingPattern);
    if (!match || match.index === undefined) return false;

    // Find the start of this section and the next section
    const sectionStart = match.index;
    const afterHeading = sectionStart + match[0].length;
    const nextSectionMatch = existing.slice(afterHeading).match(/^## /m);
    const sectionEnd = nextSectionMatch && nextSectionMatch.index !== undefined
      ? afterHeading + nextSectionMatch.index
      : existing.length;

    // Replace the section content (keep the heading)
    const updated =
      existing.slice(0, afterHeading) +
      "\n" + newContent.trim() + "\n\n" +
      existing.slice(sectionEnd);

    this.writeCodeMap(projectId, repoSlug, updated);
    return true;
  }

  /**
   * Get concatenated Code Maps for all repos in a project.
   * Used for injecting as {{CODE_MAP}} context into agent prompts.
   */
  getConcatenatedCodeMaps(
    projectId: string,
    repos: Array<{ id: string; name: string; path: string }>,
  ): string {
    const sections: string[] = [];

    for (const repo of repos) {
      const slug = CodaScopeCodeMapService.repoSlug(repo.name || repo.path);
      const content = this.readCodeMap(projectId, slug);
      if (content) {
        sections.push(content);
      }
    }

    if (sections.length === 0) {
      return "(No Code Map exists yet. Build one by running Analyze.)";
    }

    return sections.join("\n\n---\n\n");
  }

  /* ── Staleness Detection ──────────────────────────────────────────── */

  /**
   * Check the staleness status of a Code Map for a specific repository.
   */
  getCodeMapStatus(
    projectId: string,
    repo: { id: string; name: string; path: string },
  ): CodeMapStatus {
    const slug = CodaScopeCodeMapService.repoSlug(repo.name || repo.path);
    const meta = this.getCodeMapMeta(projectId, slug);
    const mapExists = this.readCodeMap(projectId, slug) !== null;

    const currentHead = existsSync(repo.path) ? this.getGitHead(repo.path) : null;

    let isStale = false;
    let staleReason: string | null = null;
    let commitsBehind = 0;

    if (!mapExists) {
      isStale = true;
      staleReason = "Code Map has not been built yet.";
    } else if (meta) {
      if (currentHead && meta.gitHead && currentHead !== meta.gitHead) {
        commitsBehind = this.getCommitCount(repo.path, meta.gitHead, currentHead);
        isStale = true;
        staleReason = commitsBehind > 0
          ? `Repository has ${commitsBehind} new commit${commitsBehind !== 1 ? "s" : ""} since last Code Map build.`
          : "Repository HEAD has changed since last Code Map build.";
      }
    } else {
      // Map file exists but no meta — treat as potentially stale
      isStale = true;
      staleReason = "Code Map metadata is missing. Consider rebuilding.";
    }

    return {
      repoId: repo.id,
      repoName: repo.name,
      repoPath: repo.path,
      exists: mapExists,
      generatedAt: meta?.generatedAt ?? null,
      isStale,
      staleReason,
      currentGitHead: currentHead,
      mapGitHead: meta?.gitHead ?? null,
      commitsBehind,
    };
  }

  /**
   * Check staleness for all repos in a project.
   */
  getAllCodeMapStatuses(
    projectId: string,
    repos: Array<{ id: string; name: string; path: string }>,
  ): CodeMapStatus[] {
    return repos.map((repo) => this.getCodeMapStatus(projectId, repo));
  }

  /**
   * Check if ANY Code Map is stale for a project.
   */
  isAnyCodeMapStale(
    projectId: string,
    repos: Array<{ id: string; name: string; path: string }>,
  ): boolean {
    return repos.some((repo) => this.getCodeMapStatus(projectId, repo).isStale);
  }

  /* ── Code Map File Listing ────────────────────────────────────────── */

  /**
   * List all Code Map files for a project.
   */
  listCodeMaps(projectId: string): Array<{ repoSlug: string; meta: CodeMapMeta | null }> {
    const dir = this.projectDir(projectId);
    if (!existsSync(dir)) return [];

    const files = readdirSync(dir)
      .filter((f) => f.startsWith("code_map_") && f.endsWith(".md"));

    return files.map((f) => {
      const slug = f.replace("code_map_", "").replace(".md", "");
      return {
        repoSlug: slug,
        meta: this.getCodeMapMeta(projectId, slug),
      };
    });
  }
}
