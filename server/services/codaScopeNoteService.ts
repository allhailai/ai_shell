/* ── CodaScope: Note Service ──────────────────────────────────────────
   Filesystem-based CRUD for notes at 4 levels: personal, public, project, epic.
   Follows existing service patterns (module singleton, atomic writes,
   content hashing).

   Responsibilities:
   - Path resolution for each level (personal, public, project, epic)
   - Frontmatter parsing (regex-based, no npm deps)
   - Note CRUD (create, read, update, delete, list)
   - Folder management (list, create)
   - Image upload to co-located .assets/ directories
   - Content hashing for optimistic concurrency control
   - Index generation (_notes-index.json)
   - Full-text search (grep-based)
   - Atomic move of notes + assets

   Storage layout:
   <root>/_notes/<username>/              (personal notes)
   <root>/_notes/_public_notes/           (public notes)
   <project-dir>/_notes/                  (project notes)
   <project-dir>/epics/<epicId>/_notes/   (epic notes)
   ──────────────────────────────────────────────────────────────────── */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
  statSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  NoteLevel,
  NoteFrontmatter,
  NoteEntry,
  NoteFolderEntry,
} from "../../src/apps/codascope/codaScopeTypes.js";
import { ProjectDirResolver } from "./codaScopeProjectDirResolver.js";

/* ── Types ────────────────────────────────────────────────────────── */

export interface NoteResolveOpts {
  /** Username (required for personal level) */
  username?: string;
  /** Project ID (required for project/epic levels) */
  projectId?: string;
  /** Epic ID (required for epic level) */
  epicId?: string;
}

export interface NoteReadResult {
  content: string;
  contentHash: string;
  frontmatter: NoteFrontmatter;
}

export interface NoteCreateResult {
  path: string;
  contentHash: string;
}

export interface NoteUpdateResult {
  contentHash: string;
}

export interface NoteConflictResult {
  conflict: true;
  currentHash: string;
  currentContent: string;
}

export interface NoteImageResult {
  relativePath: string;
  filename: string;
}

export interface NoteSearchResult {
  level: NoteLevel;
  path: string;
  title: string;
  matchLine: string;
  lineNumber: number;
}

export interface NoteMoveOpts {
  fromLevel: NoteLevel;
  fromOpts: NoteResolveOpts;
  fromPath: string;
  toLevel: NoteLevel;
  toOpts: NoteResolveOpts;
  toPath: string;
}

/* ── Index schema ─────────────────────────────────────────────────── */

interface NotesIndex {
  generatedAt: string;
  notes: NoteEntry[];
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeNoteService {
  private root: string;
  private dirResolver: ProjectDirResolver;

  constructor(root: string, dirResolver?: ProjectDirResolver) {
    this.root = root;
    this.dirResolver = dirResolver ?? new ProjectDirResolver(root);
  }

  setRoot(root: string): void {
    this.root = root;
    this.dirResolver.setRoot(root);
  }

  setDirResolver(resolver: ProjectDirResolver): void {
    this.dirResolver = resolver;
  }

  /* ── Path Resolution ─────────────────────────────────────────────── */

  /**
   * Resolve the notes directory for a given level and options.
   * Returns null if the required context (project, epic) cannot be resolved.
   */
  resolveNotesDir(level: NoteLevel, opts: NoteResolveOpts): string | null {
    switch (level) {
      case "personal": {
        const username = opts.username ?? "default";
        return path.join(this.root, "_notes", username);
      }
      case "public":
        return path.join(this.root, "_notes", "_public_notes");

      case "project": {
        if (!opts.projectId) return null;
        const projectDir = this.dirResolver.resolve(opts.projectId);
        if (!projectDir) return null;
        return path.join(projectDir, "_notes");
      }
      case "epic": {
        if (!opts.projectId || !opts.epicId) return null;
        const projectDir = this.dirResolver.resolve(opts.projectId);
        if (!projectDir) return null;
        return path.join(projectDir, "epics", opts.epicId, "_notes");
      }
      default:
        return null;
    }
  }

  /* ── Frontmatter ─────────────────────────────────────────────────── */

  /**
   * Parse YAML frontmatter from markdown content using simple regex.
   * No npm dependencies — handles the subset of YAML we need.
   */
  parseFrontmatter(content: string): { frontmatter: NoteFrontmatter; body: string } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
      return {
        frontmatter: {
          title: "Untitled",
          tags: [],
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        },
        body: content,
      };
    }

    const yamlBlock = match[1];
    const body = match[2];

    // Parse individual YAML fields
    const titleMatch = yamlBlock.match(/^title:\s*(.+)$/m);
    const createdMatch = yamlBlock.match(/^created:\s*(.+)$/m);
    const updatedMatch = yamlBlock.match(/^updated:\s*(.+)$/m);
    const tagsMatch = yamlBlock.match(/^tags:\s*\[([^\]]*)\]$/m);

    const title = titleMatch ? titleMatch[1].trim().replace(/^["']|["']$/g, "") : "Untitled";
    const created = createdMatch ? createdMatch[1].trim() : new Date().toISOString();
    const updated = updatedMatch ? updatedMatch[1].trim() : new Date().toISOString();
    const tags = tagsMatch
      ? tagsMatch[1]
          .split(",")
          .map((t) => t.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean)
      : [];

    return {
      frontmatter: { title, tags, created, updated },
      body,
    };
  }

  /**
   * Generate frontmatter block from a NoteFrontmatter object.
   */
  serializeFrontmatter(fm: NoteFrontmatter): string {
    const tagStr = fm.tags.length > 0
      ? `[${fm.tags.map((t) => JSON.stringify(t)).join(", ")}]`
      : "[]";
    return [
      "---",
      `title: ${fm.title}`,
      `tags: ${tagStr}`,
      `created: ${fm.created}`,
      `updated: ${fm.updated}`,
      "---",
      "",
    ].join("\n");
  }

  /**
   * Generate default frontmatter for a new note.
   */
  private defaultFrontmatter(title?: string): NoteFrontmatter {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    return {
      title: title ?? `Untitled ${dateStr}`,
      tags: [],
      created: now.toISOString(),
      updated: now.toISOString(),
    };
  }

  /* ── Content Helpers ─────────────────────────────────────────────── */

  /** Compute MD5 hash of content for optimistic concurrency. */
  private computeHash(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex");
  }

  /** Count words in text. */
  private countWords(text: string): number {
    const stripped = text.trim();
    if (!stripped) return 0;
    return stripped.split(/\s+/).length;
  }

  /* ── CRUD ─────────────────────────────────────────────────────────── */

  /**
   * List notes in a directory (optionally filtered to a subfolder).
   * Returns entries from the index if available, or by scanning the directory.
   */
  async listNotes(level: NoteLevel, opts: NoteResolveOpts, folder?: string): Promise<NoteEntry[]> {
    const notesDir = this.resolveNotesDir(level, opts);
    if (!notesDir) return [];

    const targetDir = folder ? path.join(notesDir, folder) : notesDir;
    if (!existsSync(targetDir)) return [];

    // Try reading from index first
    const indexEntries = this.readIndex(targetDir);
    if (indexEntries) return indexEntries;

    // Fall back to scanning + generating index
    return this.scanAndIndex(targetDir);
  }

  /**
   * Read a note's content, hash, and parsed frontmatter.
   */
  async readNote(level: NoteLevel, opts: NoteResolveOpts, notePath: string): Promise<NoteReadResult | null> {
    const notesDir = this.resolveNotesDir(level, opts);
    if (!notesDir) return null;

    const filePath = this.resolveNotePath(notesDir, notePath);
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, "utf-8");
    const { frontmatter } = this.parseFrontmatter(content);
    const contentHash = this.computeHash(content);

    return { content, contentHash, frontmatter };
  }

  /**
   * Create a new note with optional initial content.
   * Auto-generates frontmatter if content doesn't include it.
   */
  async createNote(
    level: NoteLevel,
    opts: NoteResolveOpts,
    notePath: string,
    content?: string,
  ): Promise<NoteCreateResult> {
    const notesDir = this.resolveNotesDir(level, opts);
    if (!notesDir) throw new Error("Cannot resolve notes directory for the given level.");

    const filePath = this.resolveNotePath(notesDir, notePath);

    // Don't overwrite existing notes
    if (existsSync(filePath)) {
      throw new Error(`Note already exists: ${notePath}`);
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(filePath);
    if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });

    // Build content with frontmatter
    let finalContent: string;
    if (content && content.startsWith("---\n")) {
      // Content already has frontmatter
      finalContent = content;
    } else {
      // Extract title from path or content
      const basename = path.basename(notePath, ".md");
      const title = basename.replace(/[-_]/g, " ");
      const fm = this.defaultFrontmatter(title);
      finalContent = this.serializeFrontmatter(fm) + (content ?? "");
    }

    writeFileSync(filePath, finalContent, "utf-8");

    // Refresh the index for the parent directory
    await this.refreshIndex(parentDir);

    return {
      path: notePath,
      contentHash: this.computeHash(finalContent),
    };
  }

  /**
   * Update a note's content. Supports optimistic concurrency via expectedHash.
   * Returns 409-style conflict if hash mismatch.
   */
  async updateNote(
    level: NoteLevel,
    opts: NoteResolveOpts,
    notePath: string,
    content: string,
    expectedHash?: string,
  ): Promise<NoteUpdateResult | NoteConflictResult | null> {
    const notesDir = this.resolveNotesDir(level, opts);
    if (!notesDir) return null;

    const filePath = this.resolveNotePath(notesDir, notePath);
    if (!existsSync(filePath)) return null;

    // Optimistic concurrency check
    if (expectedHash) {
      const currentContent = readFileSync(filePath, "utf-8");
      const currentHash = this.computeHash(currentContent);
      if (currentHash !== expectedHash) {
        return { conflict: true, currentHash, currentContent };
      }
    }

    // Update the frontmatter `updated` timestamp
    const { frontmatter } = this.parseFrontmatter(content);
    frontmatter.updated = new Date().toISOString();

    // Reconstruct content with updated frontmatter
    const { body } = this.parseFrontmatter(content);
    const finalContent = this.serializeFrontmatter(frontmatter) + body;

    writeFileSync(filePath, finalContent, "utf-8");

    // Refresh index
    const parentDir = path.dirname(filePath);
    await this.refreshIndex(parentDir);

    return { contentHash: this.computeHash(finalContent) };
  }

  /**
   * Delete a note and its co-located .assets/ directory.
   */
  async deleteNote(level: NoteLevel, opts: NoteResolveOpts, notePath: string): Promise<boolean> {
    const notesDir = this.resolveNotesDir(level, opts);
    if (!notesDir) return false;

    const filePath = this.resolveNotePath(notesDir, notePath);
    if (!existsSync(filePath)) return false;

    // Delete the .md file
    unlinkSync(filePath);

    // Delete co-located .assets/ directory if it exists
    const assetsDir = this.assetsDir(filePath);
    if (existsSync(assetsDir)) {
      rmSync(assetsDir, { recursive: true, force: true });
    }

    // Refresh index
    const parentDir = path.dirname(filePath);
    await this.refreshIndex(parentDir);

    return true;
  }

  /* ── Folders ─────────────────────────────────────────────────────── */

  /**
   * List the folder structure for a notes directory.
   */
  async listFolders(level: NoteLevel, opts: NoteResolveOpts): Promise<NoteFolderEntry[]> {
    const notesDir = this.resolveNotesDir(level, opts);
    if (!notesDir || !existsSync(notesDir)) return [];

    return this.scanFolders(notesDir, "");
  }

  /**
   * Create a folder within the notes directory.
   */
  async createFolder(level: NoteLevel, opts: NoteResolveOpts, folderPath: string): Promise<void> {
    const notesDir = this.resolveNotesDir(level, opts);
    if (!notesDir) throw new Error("Cannot resolve notes directory for the given level.");

    const targetDir = path.join(notesDir, folderPath);
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  }

  /* ── Image Upload ────────────────────────────────────────────────── */

  /**
   * Upload an image to the note's co-located .assets/ directory.
   * Returns the relative path for embedding in markdown.
   */
  async uploadImage(
    level: NoteLevel,
    opts: NoteResolveOpts,
    notePath: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<NoteImageResult> {
    const notesDir = this.resolveNotesDir(level, opts);
    if (!notesDir) throw new Error("Cannot resolve notes directory for the given level.");

    const filePath = this.resolveNotePath(notesDir, notePath);
    if (!existsSync(filePath)) throw new Error(`Note not found: ${notePath}`);

    const assetsPath = this.assetsDir(filePath);
    if (!existsSync(assetsPath)) mkdirSync(assetsPath, { recursive: true });

    // Generate filename: <timestamp>_<hash>.<ext>
    const ext = this.mimeToExt(mimeType);
    const hash = crypto.createHash("md5").update(buffer).digest("hex").slice(0, 8);
    const timestamp = Date.now();
    const filename = `${timestamp}_${hash}.${ext}`;

    writeFileSync(path.join(assetsPath, filename), buffer);

    // Return the relative path from the note's perspective
    const noteBasename = path.basename(filePath, ".md");
    const relativePath = `${noteBasename}.assets/${filename}`;

    return { relativePath, filename };
  }

  /**
   * Get the absolute path to an image file within a note's assets.
   */
  getImagePath(level: NoteLevel, opts: NoteResolveOpts, notePath: string, filename: string): string | null {
    const notesDir = this.resolveNotesDir(level, opts);
    if (!notesDir) return null;

    const filePath = this.resolveNotePath(notesDir, notePath);
    const assetsPath = this.assetsDir(filePath);
    const imgPath = path.join(assetsPath, filename);

    if (!existsSync(imgPath)) return null;

    // Security: ensure the resolved path is within the assets directory
    const resolvedImg = path.resolve(imgPath);
    const resolvedAssets = path.resolve(assetsPath);
    if (!resolvedImg.startsWith(resolvedAssets)) return null;

    return imgPath;
  }

  /* ── Move ─────────────────────────────────────────────────────────── */

  /**
   * Move a note (and its .assets/) from one location to another.
   * Supports cross-level moves (e.g., personal → project).
   */
  async moveNote(moveOpts: NoteMoveOpts): Promise<boolean> {
    const fromDir = this.resolveNotesDir(moveOpts.fromLevel, moveOpts.fromOpts);
    const toDir = this.resolveNotesDir(moveOpts.toLevel, moveOpts.toOpts);
    if (!fromDir || !toDir) return false;

    const fromFile = this.resolveNotePath(fromDir, moveOpts.fromPath);
    const toFile = this.resolveNotePath(toDir, moveOpts.toPath);

    if (!existsSync(fromFile)) return false;
    if (existsSync(toFile)) throw new Error(`Target note already exists: ${moveOpts.toPath}`);

    // Ensure target directory exists
    const toParent = path.dirname(toFile);
    if (!existsSync(toParent)) mkdirSync(toParent, { recursive: true });

    // Move the .md file
    renameSync(fromFile, toFile);

    // Move the .assets/ directory if it exists
    const fromAssets = this.assetsDir(fromFile);
    const toAssets = this.assetsDir(toFile);
    if (existsSync(fromAssets)) {
      renameSync(fromAssets, toAssets);
    }

    // Refresh indexes for both source and target directories
    const fromParent = path.dirname(fromFile);
    await this.refreshIndex(fromParent);
    await this.refreshIndex(toParent);

    return true;
  }

  /* ── Search ──────────────────────────────────────────────────────── */

  /**
   * Search notes across one or all levels using simple text matching.
   */
  async searchNotes(
    query: string,
    opts: NoteResolveOpts,
    levels?: NoteLevel[],
  ): Promise<NoteSearchResult[]> {
    const results: NoteSearchResult[] = [];
    const levelsToSearch: NoteLevel[] = levels ?? ["personal", "public", "project", "epic"];
    const lowerQuery = query.toLowerCase();

    for (const level of levelsToSearch) {
      const notesDir = this.resolveNotesDir(level, opts);
      if (!notesDir || !existsSync(notesDir)) continue;

      this.searchInDir(notesDir, notesDir, level, lowerQuery, results);
    }

    return results.slice(0, 50); // Cap at 50 results
  }

  /* ── Index Generation ────────────────────────────────────────────── */

  /**
   * Regenerate _notes-index.json for a directory from frontmatter.
   */
  async refreshIndex(notesDir: string): Promise<void> {
    if (!existsSync(notesDir)) return;
    const entries = this.scanDirectory(notesDir);
    const index: NotesIndex = {
      generatedAt: new Date().toISOString(),
      notes: entries,
    };
    writeFileSync(
      path.join(notesDir, "_notes-index.json"),
      JSON.stringify(index, null, 2),
      "utf-8",
    );
  }

  /* ── Private Helpers ─────────────────────────────────────────────── */

  /**
   * Resolve a note path (relative) to an absolute filesystem path.
   * Ensures .md extension.
   */
  private resolveNotePath(notesDir: string, notePath: string): string {
    const normalized = notePath.endsWith(".md") ? notePath : `${notePath}.md`;
    // Security: resolve and verify it's within the notes directory
    const resolved = path.resolve(notesDir, normalized);
    const resolvedNotesDir = path.resolve(notesDir);
    if (!resolved.startsWith(resolvedNotesDir)) {
      throw new Error("Path traversal detected.");
    }
    return resolved;
  }

  /** Get the .assets/ directory path for a note file. */
  private assetsDir(noteFilePath: string): string {
    const basename = path.basename(noteFilePath, ".md");
    return path.join(path.dirname(noteFilePath), `${basename}.assets`);
  }

  /** Convert MIME type to file extension. */
  private mimeToExt(mimeType: string): string {
    const map: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
    };
    return map[mimeType] ?? "png";
  }

  /** Read index from _notes-index.json if it exists and is fresh enough. */
  private readIndex(dir: string): NoteEntry[] | null {
    const indexPath = path.join(dir, "_notes-index.json");
    if (!existsSync(indexPath)) return null;
    try {
      const data: NotesIndex = JSON.parse(readFileSync(indexPath, "utf-8"));
      // Consider index stale if older than 60 seconds
      const age = Date.now() - new Date(data.generatedAt).getTime();
      if (age > 60_000) return null;
      return data.notes;
    } catch {
      return null;
    }
  }

  /** Scan directory and generate index, returning entries. */
  private scanAndIndex(dir: string): NoteEntry[] {
    const entries = this.scanDirectory(dir);
    // Write index for next time (best effort)
    try {
      const index: NotesIndex = {
        generatedAt: new Date().toISOString(),
        notes: entries,
      };
      writeFileSync(
        path.join(dir, "_notes-index.json"),
        JSON.stringify(index, null, 2),
        "utf-8",
      );
    } catch { /* best effort */ }
    return entries;
  }

  /** Scan a directory for .md files and subdirectories. */
  private scanDirectory(dir: string): NoteEntry[] {
    if (!existsSync(dir)) return [];
    const entries: NoteEntry[] = [];

    try {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        // Skip hidden files, index files, and .assets directories
        if (item.name.startsWith(".") || item.name.startsWith("_")) continue;
        if (item.name.endsWith(".assets")) continue;

        if (item.isDirectory()) {
          // Count notes in subdirectory
          const subDir = path.join(dir, item.name);
          const childCount = this.countNotesInDir(subDir);
          entries.push({
            path: item.name,
            title: item.name.replace(/[-_]/g, " "),
            tags: [],
            created: "",
            updated: "",
            wordCount: 0,
            isFolder: true,
            childCount,
          });
        } else if (item.name.endsWith(".md")) {
          const filePath = path.join(dir, item.name);
          try {
            const content = readFileSync(filePath, "utf-8");
            const { frontmatter, body } = this.parseFrontmatter(content);
            const stat = statSync(filePath);
            entries.push({
              path: item.name,
              title: frontmatter.title,
              tags: frontmatter.tags,
              created: frontmatter.created || stat.birthtime.toISOString(),
              updated: frontmatter.updated || stat.mtime.toISOString(),
              wordCount: this.countWords(body),
            });
          } catch { /* skip unreadable files */ }
        }
      }
    } catch { /* directory unreadable */ }

    // Sort: folders first, then by updated (newest first)
    entries.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      if (a.isFolder && b.isFolder) return a.title.localeCompare(b.title);
      return (b.updated || "").localeCompare(a.updated || "");
    });

    return entries;
  }

  /** Count .md files recursively in a directory. */
  private countNotesInDir(dir: string): number {
    if (!existsSync(dir)) return 0;
    let count = 0;
    try {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".") || item.name.startsWith("_")) continue;
        if (item.name.endsWith(".assets")) continue;
        if (item.isDirectory()) {
          count += this.countNotesInDir(path.join(dir, item.name));
        } else if (item.name.endsWith(".md")) {
          count++;
        }
      }
    } catch { /* best effort */ }
    return count;
  }

  /** Recursively scan folders and build folder tree. */
  private scanFolders(dir: string, relativePath: string): NoteFolderEntry[] {
    if (!existsSync(dir)) return [];
    const folders: NoteFolderEntry[] = [];

    try {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (!item.isDirectory()) continue;
        if (item.name.startsWith(".") || item.name.startsWith("_")) continue;
        if (item.name.endsWith(".assets")) continue;

        const subPath = relativePath ? `${relativePath}/${item.name}` : item.name;
        const fullPath = path.join(dir, item.name);
        const noteCount = this.countNotesInDir(fullPath);
        const subfolders = this.scanFolders(fullPath, subPath);

        folders.push({
          name: item.name,
          path: subPath,
          noteCount,
          subfolders,
        });
      }
    } catch { /* best effort */ }

    return folders.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Search for a query in all .md files within a directory (recursive). */
  private searchInDir(
    dir: string,
    rootDir: string,
    level: NoteLevel,
    lowerQuery: string,
    results: NoteSearchResult[],
  ): void {
    if (!existsSync(dir)) return;

    try {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".") || item.name.startsWith("_")) continue;
        if (item.name.endsWith(".assets")) continue;

        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
          this.searchInDir(fullPath, rootDir, level, lowerQuery, results);
        } else if (item.name.endsWith(".md")) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            const lines = content.split("\n");
            const { frontmatter } = this.parseFrontmatter(content);
            const relativePath = path.relative(rootDir, fullPath);

            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                results.push({
                  level,
                  path: relativePath,
                  title: frontmatter.title,
                  matchLine: lines[i].trim().slice(0, 200),
                  lineNumber: i + 1,
                });
                break; // One match per file
              }
            }
          } catch { /* skip unreadable */ }
        }

        // Cap results
        if (results.length >= 50) return;
      }
    } catch { /* best effort */ }
  }
}
