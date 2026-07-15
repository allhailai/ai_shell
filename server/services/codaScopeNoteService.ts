/* ── CodaScope: Note Service ──────────────────────────────────────────
   Filesystem-based CRUD for notes using scope (codascope, project, epic)
   and visibility (shared, private).
   Follows existing service patterns (module singleton, atomic writes,
   content hashing).

   Responsibilities:
   - Path resolution for each scope + visibility combination
   - Frontmatter parsing (regex-based, no npm deps) with id + owner
   - Note CRUD (create, read, update, delete, list)
   - Folder management (list, create)
   - Image upload to co-located .assets/ directories
   - Content hashing for optimistic concurrency control
   - Index generation (_notes-index.json)
   - Full-text search (within scope, both visibilities)
   - Atomic move of complete note bundles

   Storage layout:
   <root>/_notes/shared/                            (codascope shared notes)
   <root>/_notes/private/<userId>/                   (codascope private notes)
   <project-dir>/_notes/shared/                      (project shared notes)
   <project-dir>/_notes/private/<userId>/             (project private notes)
   <project-dir>/epics/<epicId>/_notes/shared/        (epic shared notes)
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
import { randomUUID } from "node:crypto";
import type {
  NoteScope,
  NoteVisibility,
  NoteFrontmatter,
  NoteEntry,
  NoteFolderEntry,
  NoteArchiveMeta,
  NoteTagIndexEntry,
  NoteActivityEntry,
} from "../../src/apps/codascope/codaScopeTypes.js";
import { ProjectDirResolver } from "./codaScopeProjectDirResolver.js";
import { assertSafePathSegment, isSafePathSegment, resolveWithin } from "./codaScopePathSafety.js";
import {
  CodaScopeNoteFileService,
  type CollectedNoteFileBundle,
  type NoteBundleCompanionKind,
  type NoteBundleFile,
  type NoteFileBundle,
} from "./codaScopeNoteFileService.js";
import { stripInlineAnnotationMarkers } from "./codaScopeNoteAnnotationAnchorService.js";

/* ── Types ────────────────────────────────────────────────────────── */

export interface NoteResolveOpts {
  /** User ID (derived from session, used for private note paths) */
  userId?: string;
  /** Project ID (required for project/epic scopes) */
  projectId?: string;
  /** Epic ID (required for epic scope) */
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
  scope: NoteScope;
  visibility: NoteVisibility;
  path: string;
  title: string;
  matchLine: string;
  lineNumber: number;
}

export interface NoteMoveOpts {
  fromScope: NoteScope;
  fromVisibility: NoteVisibility;
  fromOpts: NoteResolveOpts;
  fromPath: string;
  toScope: NoteScope;
  toVisibility: NoteVisibility;
  toOpts: NoteResolveOpts;
  toPath: string;
}

export interface NoteFolderMoveOpts {
  fromScope: NoteScope;
  fromVisibility: NoteVisibility;
  fromOpts: NoteResolveOpts;
  fromFolder: string;
  toScope: NoteScope;
  toVisibility: NoteVisibility;
  toOpts: NoteResolveOpts;
  /** Full relative destination path, including the folder name. */
  toFolder: string;
}

export interface NoteVersionEntry {
  version: string;    // "v001", "v002", etc.
  savedAt: string;    // ISO timestamp
  sizeBytes: number;
}

export interface NoteVersionContent {
  version: string;
  content: string;
  savedAt: string;
}

/* ── Index schema ─────────────────────────────────────────────────── */

interface NotesIndexEditorMeta {
  noteId: string;
  lastEditor?: string;
  lastEditedAt?: string;
}

interface NotesIndex {
  generatedAt: string;
  notes: NoteEntry[];
  /** Per-note editor metadata, keyed by noteId — survives re-scans */
  editorMeta?: NotesIndexEditorMeta[];
}

interface TagIndex {
  generatedAt: string;
  tags: NoteTagIndexEntry[];
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeNoteService {
  private root: string;
  private dirResolver: ProjectDirResolver;
  private readonly fileSvc = new CodaScopeNoteFileService();

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
   * Resolve the notes directory for a given scope, visibility, and options.
   * Returns null if the required context (project, epic) cannot be resolved.
   */
  resolveNotesDir(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts): string | null {
    switch (scope) {
      case "codascope": {
        if (visibility === "private") {
          const userId = assertSafePathSegment(opts.userId ?? "default", "user ID");
          return path.join(this.root, "_notes", "private", userId);
        }
        return path.join(this.root, "_notes", "shared");
      }
      case "project": {
        if (!opts.projectId) return null;
        const projectDir = this.dirResolver.resolve(opts.projectId);
        if (!projectDir) return null;
        if (visibility === "private") {
          const userId = assertSafePathSegment(opts.userId ?? "default", "user ID");
          return path.join(projectDir, "_notes", "private", userId);
        }
        return path.join(projectDir, "_notes", "shared");
      }
      case "epic": {
        if (!opts.projectId || !opts.epicId) return null;
        const projectDir = this.dirResolver.resolve(opts.projectId);
        if (!projectDir) return null;
        const epicId = assertSafePathSegment(opts.epicId, "epic ID");
        // Epic notes are team artifacts. Personal working notes belong in the
        // CodaScope or project private libraries, never in an Epic.
        if (visibility === "private") return null;
        return path.join(projectDir, "epics", epicId, "_notes", "shared");
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
          id: randomUUID(),
          title: "Untitled",
          tags: [],
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          owner: "default",
        },
        body: content,
      };
    }

    const yamlBlock = match[1];
    const body = match[2];

    // Parse individual YAML fields
    const idMatch = yamlBlock.match(/^id:\s*(.+)$/m);
    const titleMatch = yamlBlock.match(/^title:\s*(.+)$/m);
    const createdMatch = yamlBlock.match(/^created:\s*(.+)$/m);
    const updatedMatch = yamlBlock.match(/^updated:\s*(.+)$/m);
    const ownerMatch = yamlBlock.match(/^owner:\s*(.+)$/m);
    const tagsMatch = yamlBlock.match(/^tags:\s*\[([^\]]*)\]$/m);
    const statusMatch = yamlBlock.match(/^status:\s*(.+)$/m);
    const pinnedMatch = yamlBlock.match(/^pinned:\s*(.+)$/m);
    const pinnedAtMatch = yamlBlock.match(/^pinnedAt:\s*(.+)$/m);
    const pinnedByMatch = yamlBlock.match(/^pinnedBy:\s*(.+)$/m);

    const rawId = idMatch ? idMatch[1].trim().replace(/^["']|["']$/g, "") : "";
    const id = isSafePathSegment(rawId) ? rawId : randomUUID();
    const title = titleMatch ? titleMatch[1].trim().replace(/^["']|["']$/g, "") : "Untitled";
    const created = createdMatch ? createdMatch[1].trim() : new Date().toISOString();
    const updated = updatedMatch ? updatedMatch[1].trim() : new Date().toISOString();
    const owner = ownerMatch ? ownerMatch[1].trim().replace(/^["']|["']$/g, "") : "default";
    const tags = tagsMatch
      ? tagsMatch[1]
          .split(",")
          .map((t) => t.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean)
      : [];
    const statusRaw = statusMatch ? statusMatch[1].trim().replace(/^["']|["']$/g, "") : undefined;
    const status = (statusRaw === "draft" || statusRaw === "ready") ? statusRaw : undefined;
    const pinned = pinnedMatch?.[1].trim().toLowerCase() === "true";
    const pinnedAt = pinned && pinnedAtMatch ? pinnedAtMatch[1].trim().replace(/^["']|["']$/g, "") : undefined;
    const pinnedBy = pinned && pinnedByMatch ? pinnedByMatch[1].trim().replace(/^["']|["']$/g, "") : undefined;

    return {
      frontmatter: { id, title, tags, created, updated, owner, status, pinned: pinned || undefined, pinnedAt, pinnedBy },
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
    const lines = [
      "---",
      `id: ${fm.id}`,
      `title: ${fm.title}`,
      `tags: ${tagStr}`,
      `created: ${fm.created}`,
      `updated: ${fm.updated}`,
      `owner: ${fm.owner}`,
    ];
    if (fm.status) {
      lines.push(`status: ${fm.status}`);
    }
    if (fm.pinned) {
      lines.push("pinned: true");
      if (fm.pinnedAt) lines.push(`pinnedAt: ${fm.pinnedAt}`);
      if (fm.pinnedBy) lines.push(`pinnedBy: ${fm.pinnedBy}`);
    }
    lines.push("---", "");
    return lines.join("\n");
  }

  /**
   * Generate default frontmatter for a new note.
   */
  private defaultFrontmatter(
    title: string | undefined,
    opts: NoteResolveOpts | undefined,
    visibility: NoteVisibility,
  ): NoteFrontmatter {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    return {
      id: randomUUID(),
      title: title ?? `Untitled ${dateStr}`,
      tags: [],
      created: now.toISOString(),
      updated: now.toISOString(),
      owner: opts?.userId ?? "default",
      // Shared notes enter the collaboration workflow as drafts. Private
      // notes deliberately have no status, since they are personal working
      // material and should never show shared-workflow UI.
      status: visibility === "shared" ? "draft" : undefined,
    };
  }

  /* ── Content Helpers ─────────────────────────────────────────────── */

  /** Compute MD5 hash of content for optimistic concurrency. */
  private computeHash(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex");
  }

  private writeTextAtomically(filePath: string, content: string): void {
    const tempPath = `${filePath}.tmp.${randomUUID()}`;
    writeFileSync(tempPath, content, "utf-8");
    renameSync(tempPath, filePath);
  }

  /** Count words in text. */
  private countWords(text: string): number {
    const stripped = stripInlineAnnotationMarkers(text).trim();
    if (!stripped) return 0;
    return stripped.split(/\s+/).length;
  }

  /* ── CRUD ─────────────────────────────────────────────────────────── */

  /**
   * List notes in a directory (optionally filtered to a subfolder).
   * Returns entries from the index if available, or by scanning the directory.
   * Every returned path is relative to the note library root, including when
   * the listing itself is scoped to a nested folder. This keeps open, move,
   * star, recent, and drag-and-drop operations on one canonical path format.
   */
  async listNotes(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts, folder?: string): Promise<NoteEntry[]> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return [];

    const targetDir = folder ? resolveWithin(notesDir, folder, "folder path") : notesDir;
    if (!existsSync(targetDir)) return [];

    // Directory indexes store paths relative to their own directory so they
    // remain portable when a folder is moved. The public service contract is
    // relative to the library root, so prefix nested-list entries here.
    const indexEntries = this.readIndex(targetDir);
    const entries = indexEntries ?? this.scanAndIndex(targetDir);
    if (targetDir === notesDir) return entries;

    const folderPrefix = path.relative(notesDir, targetDir).split(path.sep).join("/");
    return entries.map((entry) => ({ ...entry, path: `${folderPrefix}/${entry.path}` }));
  }

  /**
   * Read a note's content, hash, and parsed frontmatter.
   */
  async readNote(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts, notePath: string): Promise<NoteReadResult | null> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
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
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    content?: string,
  ): Promise<NoteCreateResult> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) throw new Error("Cannot resolve notes directory for the given scope.");

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
      // User-provided frontmatter may set presentation fields, but identity
      // fields belong to the server and must never be path-bearing input.
      const { frontmatter, body } = this.parseFrontmatter(content);
      frontmatter.owner = opts.userId ?? "default";
      delete frontmatter.pinned;
      delete frontmatter.pinnedAt;
      delete frontmatter.pinnedBy;
      if (visibility === "private") delete frontmatter.status;
      finalContent = this.serializeFrontmatter(frontmatter) + body;
    } else {
      // Extract title from path or content
      const basename = path.basename(notePath, ".md");
      const title = basename.replace(/[-_]/g, " ");
      const fm = this.defaultFrontmatter(title, opts, visibility);
      finalContent = this.serializeFrontmatter(fm) + (content ?? "");
    }

    this.writeTextAtomically(filePath, finalContent);

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
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    content: string,
    expectedHash?: string,
  ): Promise<NoteUpdateResult | NoteConflictResult | null> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return null;

    const filePath = this.resolveNotePath(notesDir, notePath);
    if (!existsSync(filePath)) return null;

    const currentContent = readFileSync(filePath, "utf-8");

    // Optimistic concurrency check
    if (expectedHash) {
      const currentHash = this.computeHash(currentContent);
      if (currentHash !== expectedHash) {
        return { conflict: true, currentHash, currentContent };
      }
    }

    const { frontmatter: currentFrontmatter } = this.parseFrontmatter(currentContent);

    // Preserve stable server-owned metadata across edits. The client may
    // change the title, body, tags, and shared-note status, but cannot adopt
    // another owner or redirect reader-tracking through a crafted note ID.
    const { frontmatter } = this.parseFrontmatter(content);
    frontmatter.id = currentFrontmatter.id;
    frontmatter.owner = currentFrontmatter.owner;
    frontmatter.created = currentFrontmatter.created;
    frontmatter.updated = new Date().toISOString();
    frontmatter.pinned = currentFrontmatter.pinned;
    frontmatter.pinnedAt = currentFrontmatter.pinnedAt;
    frontmatter.pinnedBy = currentFrontmatter.pinnedBy;
    if (visibility === "private") delete frontmatter.status;

    // Reconstruct content with updated frontmatter
    const { body } = this.parseFrontmatter(content);
    const finalContent = this.serializeFrontmatter(frontmatter) + body;

    // Snapshot the current content BEFORE overwriting with the update
    this.snapshotVersion(filePath);

    this.writeTextAtomically(filePath, finalContent);

    // Refresh index with last-editor metadata
    const parentDir = path.dirname(filePath);
    const editor = opts.userId ?? "default";
    await this.refreshIndexWithEditor(parentDir, frontmatter.id, editor);

    return { contentHash: this.computeHash(finalContent) };
  }

  /**
   * Set shared server-owned pin metadata without accepting it from a client
   * content save. Pins stay in the markdown frontmatter so bundle transfers
   * and ZIP packaging preserve them automatically.
   */
  async setNotePin(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    pinned: boolean,
  ): Promise<NoteFrontmatter | null> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return null;
    const filePath = this.resolveNotePath(notesDir, notePath);
    if (!existsSync(filePath)) return null;

    const currentContent = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = this.parseFrontmatter(currentContent);
    if (pinned) {
      frontmatter.pinned = true;
      frontmatter.pinnedAt = new Date().toISOString();
      frontmatter.pinnedBy = opts.userId ?? "default";
    } else {
      delete frontmatter.pinned;
      delete frontmatter.pinnedAt;
      delete frontmatter.pinnedBy;
    }
    this.writeTextAtomically(filePath, this.serializeFrontmatter(frontmatter) + body);
    await this.refreshIndexWithEditor(path.dirname(filePath), frontmatter.id, opts.userId ?? "default");
    return frontmatter;
  }

  /**
   * Delete a note. By default, archives instead of destroying.
   * Set permanent=true for actual deletion (admin-only, enforced at route level).
   */
  async deleteNote(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts, notePath: string, permanent?: boolean): Promise<boolean> {
    if (!permanent) {
      // Soft delete: archive instead
      const meta = await this.archiveNote(scope, visibility, opts, notePath);
      return meta !== null;
    }

    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return false;

    const filePath = this.resolveNotePath(notesDir, notePath);
    if (!existsSync(filePath)) return false;

    this.fileSvc.deleteBundle(filePath);

    // Refresh index
    const parentDir = path.dirname(filePath);
    await this.refreshIndex(parentDir);

    return true;
  }

  /* ── Archive / Restore ───────────────────────────────────────────── */

  /** Resolve the archive directory for a given scope/visibility. */
  private resolveArchiveDir(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts): string | null {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return null;
    // _archive lives alongside the notes dirs: <notesRoot>/_archive/<visibility>/
    const notesRoot = path.dirname(notesDir); // up from shared/ or private/<userId>/
    if (visibility === "private" && opts.userId) {
      // For private notes the notesDir is <root>/_notes/private/<userId>
      // Archive is <root>/_notes/_archive/private/<userId>/
      return path.join(path.dirname(path.dirname(notesDir)), "_archive", "private", opts.userId ?? "default");
    }
    return path.join(notesRoot, "_archive", visibility);
  }

  /**
   * Archive a note: move it to _archive/<visibility>/<noteId>/ with metadata.
   */
  async archiveNote(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    reason?: string,
  ): Promise<NoteArchiveMeta | null> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return null;

    const filePath = this.resolveNotePath(notesDir, notePath);
    if (!existsSync(filePath)) return null;

    // Read frontmatter for UUID and title
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter } = this.parseFrontmatter(content);
    const noteId = frontmatter.id;

    // Create archive envelope
    const archiveDir = this.resolveArchiveDir(scope, visibility, opts);
    if (!archiveDir) return null;
    const envelopeDir = path.join(archiveDir, noteId);
    if (!existsSync(envelopeDir)) mkdirSync(envelopeDir, { recursive: true });

    const destMd = path.join(envelopeDir, path.basename(filePath));
    const meta: NoteArchiveMeta = {
      noteId,
      archivedAt: new Date().toISOString(),
      archivedBy: opts.userId ?? "default",
      originalPath: notePath,
      originalScope: scope,
      originalVisibility: visibility,
      reason,
      title: frontmatter.title,
    };
    let bundleMoved = false;
    try {
      bundleMoved = this.fileSvc.moveFile(filePath, destMd);
      if (!bundleMoved) return null;
      this.writeTextAtomically(
        path.join(envelopeDir, "_archive-meta.json"),
        JSON.stringify(meta, null, 2),
      );
    } catch (error) {
      if (bundleMoved) {
        try { this.fileSvc.moveFile(destMd, filePath); } catch { /* best effort rollback */ }
      }
      throw error;
    }

    // Refresh index for source directory
    const parentDir = path.dirname(filePath);
    await this.refreshIndex(parentDir);

    return meta;
  }

  /**
   * Archive a folder and all of its nested notes as one recoverable tree.
   * The directory rename keeps note IDs, attachments, and version history
   * together without turning a folder archive into a series of partial moves.
   */
  async archiveFolder(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    folderPath: string,
    reason?: string,
  ): Promise<NoteArchiveMeta | null> {
    if (!folderPath.trim()) throw new Error("A folder path is required.");
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return null;

    const sourceDir = resolveWithin(notesDir, folderPath, "folder path");
    if (sourceDir === notesDir || !existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) return null;

    const archiveDir = this.resolveArchiveDir(scope, visibility, opts);
    if (!archiveDir) return null;
    const archiveId = randomUUID();
    const envelopeDir = path.join(archiveDir, archiveId);
    mkdirSync(envelopeDir, { recursive: true });

    const meta: NoteArchiveMeta = {
      noteId: archiveId,
      kind: "folder",
      archivedAt: new Date().toISOString(),
      archivedBy: opts.userId ?? "default",
      originalPath: folderPath,
      originalScope: scope,
      originalVisibility: visibility,
      reason,
      title: path.basename(folderPath),
    };

    let folderMoved = false;
    const archivedFolder = path.join(envelopeDir, "content");
    try {
      this.writeTextAtomically(
        path.join(envelopeDir, "_archive-meta.json"),
        JSON.stringify(meta, null, 2),
      );
      renameSync(sourceDir, archivedFolder);
      folderMoved = true;
      await this.refreshIndex(path.dirname(sourceDir));
      return meta;
    } catch (error) {
      if (folderMoved && existsSync(archivedFolder) && !existsSync(sourceDir)) {
        renameSync(archivedFolder, sourceDir);
      }
      if (existsSync(envelopeDir)) rmSync(envelopeDir, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Restore an archived note back to its original location.
   * If the original path is occupied, appends " (restored)" to the filename.
   */
  async restoreNote(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    noteId: string,
  ): Promise<{ restoredPath: string; meta: NoteArchiveMeta } | null> {
    const archiveDir = this.resolveArchiveDir(scope, visibility, opts);
    if (!archiveDir) return null;

    const envelopeDir = path.join(archiveDir, noteId);
    if (!existsSync(envelopeDir)) return null;

    // Read archive metadata
    const metaPath = path.join(envelopeDir, "_archive-meta.json");
    if (!existsSync(metaPath)) return null;
    const meta: NoteArchiveMeta = JSON.parse(readFileSync(metaPath, "utf-8"));

    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return null;

    if (meta.kind === "folder") {
      const archivedFolder = path.join(envelopeDir, "content");
      if (!existsSync(archivedFolder) || !statSync(archivedFolder).isDirectory()) return null;

      let restorePath = meta.originalPath;
      let targetFolder = resolveWithin(notesDir, restorePath, "folder path");
      if (existsSync(targetFolder)) {
        const parent = path.dirname(restorePath);
        const base = path.basename(restorePath);
        let suffix = 1;
        do {
          const name = `${base} (restored${suffix === 1 ? "" : ` ${suffix}`})`;
          restorePath = parent === "." ? name : `${parent}/${name}`;
          targetFolder = resolveWithin(notesDir, restorePath, "folder path");
          suffix++;
        } while (existsSync(targetFolder));
      }

      const targetParent = path.dirname(targetFolder);
      if (!existsSync(targetParent)) mkdirSync(targetParent, { recursive: true });
      renameSync(archivedFolder, targetFolder);
      rmSync(envelopeDir, { recursive: true, force: true });
      await this.refreshIndex(targetParent);
      return { restoredPath: restorePath, meta };
    }

    // Determine restore path — append "(restored)" if original is occupied
    let restorePath = meta.originalPath;
    const targetFile = this.resolveNotePath(notesDir, restorePath);
    if (existsSync(targetFile)) {
      const ext = path.extname(restorePath);
      const base = restorePath.slice(0, restorePath.length - ext.length);
      restorePath = `${base} (restored)${ext}`;
    }
    const destFile = this.resolveNotePath(notesDir, restorePath);

    // Ensure target directory exists
    const destParent = path.dirname(destFile);
    if (!existsSync(destParent)) mkdirSync(destParent, { recursive: true });

    // Find the .md file in the envelope
    const envelopeItems = readdirSync(envelopeDir);
    const mdFile = envelopeItems.find((f: string) => f.endsWith(".md"));
    if (!mdFile) return null;

    this.fileSvc.moveFile(path.join(envelopeDir, mdFile), destFile);

    // Remove the envelope directory
    rmSync(envelopeDir, { recursive: true, force: true });

    // Refresh index
    await this.refreshIndex(destParent);

    return { restoredPath: restorePath, meta };
  }

  /**
   * List all archived notes for a given scope/visibility.
   */
  async listArchived(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
  ): Promise<NoteArchiveMeta[]> {
    const archiveDir = this.resolveArchiveDir(scope, visibility, opts);
    if (!archiveDir || !existsSync(archiveDir)) return [];

    const results: NoteArchiveMeta[] = [];

    try {
      const entries = readdirSync(archiveDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const metaPath = path.join(archiveDir, entry.name, "_archive-meta.json");
        if (existsSync(metaPath)) {
          try {
            const meta: NoteArchiveMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
            results.push(meta);
          } catch { /* skip corrupted */ }
        }
      }
    } catch { /* best effort */ }

    // Sort by archivedAt, newest first
    results.sort((a, b) => (b.archivedAt || "").localeCompare(a.archivedAt || ""));

    return results;
  }

  /* ── Folders ─────────────────────────────────────────────────────── */

  /**
   * List the folder structure for a notes directory.
   */
  async listFolders(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts): Promise<NoteFolderEntry[]> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir || !existsSync(notesDir)) return [];

    return this.scanFolders(notesDir, "");
  }

  /**
   * Create a folder within the notes directory.
   */
  async createFolder(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts, folderPath: string): Promise<void> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) throw new Error("Cannot resolve notes directory for the given scope.");

    const targetDir = resolveWithin(notesDir, folderPath, "folder path");
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  }

  /** Move an entire folder tree between folders, visibility libraries, or scopes. */
  async moveFolder(moveOpts: NoteFolderMoveOpts): Promise<boolean> {
    if (!moveOpts.fromFolder.trim() || !moveOpts.toFolder.trim()) {
      throw new Error("Source and destination folders are required.");
    }
    const fromDir = this.resolveNotesDir(moveOpts.fromScope, moveOpts.fromVisibility, moveOpts.fromOpts);
    const toDir = this.resolveNotesDir(moveOpts.toScope, moveOpts.toVisibility, moveOpts.toOpts);
    if (!fromDir || !toDir) return false;

    const sourceFolder = resolveWithin(fromDir, moveOpts.fromFolder, "source folder");
    const targetFolder = resolveWithin(toDir, moveOpts.toFolder, "destination folder");
    if (sourceFolder === fromDir || !existsSync(sourceFolder) || !statSync(sourceFolder).isDirectory()) return false;
    if (existsSync(targetFolder)) throw new Error(`Target folder already exists: ${moveOpts.toFolder}`);

    const relativeTarget = path.relative(sourceFolder, targetFolder);
    if (fromDir === toDir && relativeTarget && !relativeTarget.startsWith("..") && !path.isAbsolute(relativeTarget)) {
      throw new Error("A folder cannot be moved into itself.");
    }

    const targetParent = path.dirname(targetFolder);
    if (!existsSync(targetParent)) mkdirSync(targetParent, { recursive: true });
    let moved = false;
    try {
      renameSync(sourceFolder, targetFolder);
      moved = true;
      await this.refreshIndex(path.dirname(sourceFolder));
      await this.refreshIndex(targetParent);
      return true;
    } catch (error) {
      if (moved && existsSync(targetFolder) && !existsSync(sourceFolder)) {
        renameSync(targetFolder, sourceFolder);
      }
      throw error;
    }
  }

  /* ── Image Upload ────────────────────────────────────────────────── */

  /**
   * Upload an image to the note's co-located .assets/ directory.
   * Returns the relative path for embedding in markdown.
   */
  async uploadImage(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<NoteImageResult> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) throw new Error("Cannot resolve notes directory for the given scope.");

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
  getImagePath(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts, notePath: string, filename: string): string | null {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return null;

    const filePath = this.resolveNotePath(notesDir, notePath);
    const assetsPath = this.assetsDir(filePath);
    const safeFilename = assertSafePathSegment(filename, "image filename");
    const imgPath = path.join(assetsPath, safeFilename);

    if (!existsSync(imgPath)) return null;

    try {
      return resolveWithin(assetsPath, safeFilename, "image filename");
    } catch {
      return null;
    }
  }

  /**
   * Resolve the on-disk paths for a note bundle, whether or not the note has
   * been created yet. Import uses this to restore every companion to the
   * destination note's canonical location.
   */
  resolveNoteFileBundle(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): NoteFileBundle | null {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return null;
    const noteFile = this.resolveNotePath(notesDir, notePath);
    return this.fileSvc.getBundle(noteFile);
  }

  /** Collect every physical artifact currently present for one note. */
  collectNoteBundle(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): CollectedNoteFileBundle | null {
    const bundle = this.resolveNoteFileBundle(scope, visibility, opts, notePath);
    if (!bundle || !existsSync(bundle.noteFile)) return null;
    return this.fileSvc.collectNoteBundle(bundle.noteFile);
  }

  /** Backwards-compatible alias for callers that need bundle paths. */
  getNoteFileBundle(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): CollectedNoteFileBundle | null {
    const bundle = this.collectNoteBundle(scope, visibility, opts, notePath);
    if (!bundle) return null;
    return bundle;
  }

  /** Write an attachment or version into a note's managed companion bundle. */
  writeNoteBundleCompanion(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    kind: NoteBundleCompanionKind,
    relativePath: string,
    content: Buffer,
  ): void {
    const bundle = this.collectNoteBundle(scope, visibility, opts, notePath);
    if (!bundle) throw new Error(`Note not found: ${notePath}`);
    this.fileSvc.writeCompanionFile(bundle.noteFile, kind, relativePath, content);
  }

  /** List the managed files inside one note companion directory for export. */
  listNoteBundleCompanions(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    kind: NoteBundleCompanionKind,
  ): NoteBundleFile[] {
    const bundle = this.collectNoteBundle(scope, visibility, opts, notePath);
    return bundle ? this.fileSvc.listCompanionFiles(bundle.noteFile, kind) : [];
  }

  /* ── Move ─────────────────────────────────────────────────────────── */

  /**
   * Move a note (and its .assets/) from one location to another.
   * Supports cross-level moves (e.g., personal → project).
   */
  async moveNote(moveOpts: NoteMoveOpts): Promise<boolean> {
    const fromDir = this.resolveNotesDir(moveOpts.fromScope, moveOpts.fromVisibility, moveOpts.fromOpts);
    const toDir = this.resolveNotesDir(moveOpts.toScope, moveOpts.toVisibility, moveOpts.toOpts);
    if (!fromDir || !toDir) return false;

    const fromFile = this.resolveNotePath(fromDir, moveOpts.fromPath);
    const toFile = this.resolveNotePath(toDir, moveOpts.toPath);

    const fromParent = path.dirname(fromFile);
    const toParent = path.dirname(toFile);

    try {
      const moved = this.fileSvc.moveFile(fromFile, toFile);
      if (!moved) return false;
      await this.refreshIndex(fromParent);
      await this.refreshIndex(toParent);
    } catch (error) {
      try { await this.refreshIndex(fromParent); } catch { /* best effort */ }
      try { await this.refreshIndex(toParent); } catch { /* best effort */ }
      throw error;
    }

    return true;
  }

  /* ── Search ──────────────────────────────────────────────────────── */

  /**
   * Search notes across one or all levels using simple text matching.
   */
  async searchNotes(
    query: string,
    scope: NoteScope,
    opts: NoteResolveOpts,
  ): Promise<NoteSearchResult[]> {
    const results: NoteSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    // Search shared notes within this scope
    const sharedDir = this.resolveNotesDir(scope, "shared", opts);
    if (sharedDir && existsSync(sharedDir)) {
      this.searchInDir(sharedDir, sharedDir, scope, "shared", lowerQuery, results);
    }

    // Search current user's private notes within this scope
    const privateDir = this.resolveNotesDir(scope, "private", opts);
    if (privateDir && existsSync(privateDir)) {
      this.searchInDir(privateDir, privateDir, scope, "private", lowerQuery, results);
    }

    return results.slice(0, 50); // Cap at 50 results
  }

  /* ── Index Generation ────────────────────────────────────────────── */

  /**
   * Regenerate _notes-index.json for a directory from frontmatter.
   */
  async refreshIndex(notesDir: string): Promise<void> {
    if (!existsSync(notesDir)) return;
    this.writeIndex(notesDir, this.readIndexData(notesDir)?.editorMeta ?? []);
  }

  /**
   * Refresh an index after an edit while retaining a small, per-note record
   * of who made that edit. Keeping this separate from frontmatter avoids
   * rewriting user content for collaborative metadata.
   */
  private async refreshIndexWithEditor(
    notesDir: string,
    noteId: string,
    lastEditor: string,
  ): Promise<void> {
    if (!existsSync(notesDir)) return;

    const existingMeta = this.readIndexData(notesDir)?.editorMeta ?? [];
    const editorMeta = [
      ...existingMeta.filter((meta) => meta.noteId !== noteId),
      { noteId, lastEditor, lastEditedAt: new Date().toISOString() },
    ];
    this.writeIndex(notesDir, editorMeta);
  }

  /* ── Tag Index ──────────────────────────────────────────────────── */

  /**
   * Build (or return cached) tag index for a scope/visibility.
   * Scans all notes, extracts tags from frontmatter.
   * Cached in _notes/_tag-index.json with 60s TTL.
   */
  async buildTagIndex(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
  ): Promise<NoteTagIndexEntry[]> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir || !existsSync(notesDir)) return [];

    // Check cache
    const cachePath = path.join(notesDir, "_tag-index.json");
    if (existsSync(cachePath)) {
      try {
        const data: TagIndex = JSON.parse(readFileSync(cachePath, "utf-8"));
        const age = Date.now() - new Date(data.generatedAt).getTime();
        if (age < 60_000) return data.tags;
      } catch { /* regenerate */ }
    }

    // Scan all notes recursively
    const tagCounts = new Map<string, number>();
    this.scanTagsRecursive(notesDir, tagCounts);

    const tags: NoteTagIndexEntry[] = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    // Write cache
    try {
      const index: TagIndex = { generatedAt: new Date().toISOString(), tags };
      this.writeTextAtomically(cachePath, JSON.stringify(index, null, 2));
    } catch { /* best effort */ }

    return tags;
  }

  /** Recursively scan notes and collect tag counts. */
  private scanTagsRecursive(dir: string, tagCounts: Map<string, number>): void {
    if (!existsSync(dir)) return;
    try {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".")) continue;
        if (item.name.startsWith("_") && item.name !== "_inbox") continue;
        if (item.name.endsWith(".assets") || item.name.endsWith(".versions")) continue;

        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          this.scanTagsRecursive(fullPath, tagCounts);
        } else if (item.name.endsWith(".md")) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            const { frontmatter } = this.parseFrontmatter(content);
            for (const tag of frontmatter.tags) {
              tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
            }
          } catch { /* skip unreadable */ }
        }
      }
    } catch { /* best effort */ }
  }

  /* ── Find Note by ID ────────────────────────────────────────────── */

  /**
   * Find a note by its frontmatter UUID within a scope/visibility.
   * Returns { title, path } or null if not found.
   */
  async findNoteById(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    noteId: string,
  ): Promise<{ title: string; path: string } | null> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir || !existsSync(notesDir)) return null;
    return this.findNoteByIdInDir(notesDir, notesDir, noteId);
  }

  /** Recursively search for a note by its frontmatter id. */
  private findNoteByIdInDir(
    dir: string,
    rootDir: string,
    noteId: string,
  ): { title: string; path: string } | null {
    if (!existsSync(dir)) return null;
    try {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".")) continue;
        if (item.name.startsWith("_") && item.name !== "_inbox") continue;
        if (item.name.endsWith(".assets") || item.name.endsWith(".versions")) continue;

        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          const found = this.findNoteByIdInDir(fullPath, rootDir, noteId);
          if (found) return found;
        } else if (item.name.endsWith(".md")) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            const { frontmatter } = this.parseFrontmatter(content);
            if (frontmatter.id === noteId || frontmatter.id.toLowerCase() === noteId.toLowerCase()) {
              return {
                title: frontmatter.title,
                path: path.relative(rootDir, fullPath),
              };
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* best effort */ }
    return null;
  }

  /* ── Bulk Archive ───────────────────────────────────────────────── */

  /**
   * Archive multiple notes at once.
   * Returns { archived: number, failed: string[] }.
   */
  async bulkArchive(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    noteIds: string[],
    reason?: string,
  ): Promise<{ archived: number; failed: string[]; archivedPaths: { noteId: string; path: string }[] }> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return { archived: 0, failed: noteIds, archivedPaths: [] };

    let archived = 0;
    const failed: string[] = [];
    const archivedPaths: { noteId: string; path: string }[] = [];

    for (const noteId of noteIds) {
      // Find the note by its frontmatter id
      const found = await this.findNoteById(scope, visibility, opts, noteId);
      if (!found) {
        failed.push(noteId);
        continue;
      }

      try {
        const meta = await this.archiveNote(scope, visibility, opts, found.path, reason);
        if (meta) {
          archived++;
          archivedPaths.push({ noteId, path: found.path });
        } else {
          failed.push(noteId);
        }
      } catch {
        failed.push(noteId);
      }
    }

    return { archived, failed, archivedPaths };
  }

  /* ── Private Helpers ─────────────────────────────────────────────── */

  /**
   * Resolve a note path (relative) to an absolute filesystem path.
   * Ensures .md extension.
   */
  private resolveNotePath(notesDir: string, notePath: string): string {
    const normalized = notePath.endsWith(".md") ? notePath : `${notePath}.md`;
    return resolveWithin(notesDir, normalized, "note path");
  }

  /** Get the .assets/ directory path for a note file. */
  private assetsDir(noteFilePath: string): string {
    return this.fileSvc.getBundle(noteFilePath).assetsDir;
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
    const data = this.readIndexData(dir);
    if (!data) return null;
    try {
      // Consider index stale if older than 60 seconds
      const age = Date.now() - new Date(data.generatedAt).getTime();
      if (age > 60_000) return null;
      return this.withEditorMetadata(data.notes, data.editorMeta ?? []);
    } catch {
      return null;
    }
  }

  /** Read the complete index even when stale, so a rescan retains metadata. */
  private readIndexData(dir: string): NotesIndex | null {
    const indexPath = path.join(dir, "_notes-index.json");
    if (!existsSync(indexPath)) return null;
    try {
      return JSON.parse(readFileSync(indexPath, "utf-8")) as NotesIndex;
    } catch {
      return null;
    }
  }

  /** Attach durable index-only collaboration metadata to visible note entries. */
  private withEditorMetadata(entries: NoteEntry[], editorMeta: NotesIndexEditorMeta[]): NoteEntry[] {
    const metadataByNoteId = new Map(editorMeta.map((meta) => [meta.noteId, meta]));
    return entries.map((entry) => {
      const metadata = entry.noteId ? metadataByNoteId.get(entry.noteId) : undefined;
      return metadata
        ? { ...entry, lastEditor: metadata.lastEditor, lastEditedAt: metadata.lastEditedAt }
        : entry;
    });
  }

  /** Scan a directory and atomically replace its index payload. */
  private writeIndex(dir: string, editorMeta: NotesIndexEditorMeta[]): NoteEntry[] {
    const notes = this.withEditorMetadata(this.scanDirectory(dir), editorMeta);
    const index: NotesIndex = {
      generatedAt: new Date().toISOString(),
      notes,
      editorMeta,
    };
    this.writeTextAtomically(path.join(dir, "_notes-index.json"), JSON.stringify(index, null, 2));
    return notes;
  }

  /** Scan directory and generate index, returning entries. */
  private scanAndIndex(dir: string): NoteEntry[] {
    // Write index for next time (best effort)
    try {
      return this.writeIndex(dir, this.readIndexData(dir)?.editorMeta ?? []);
    } catch { /* best effort */ }
    return this.scanDirectory(dir);
  }

  /** Scan a directory for .md files and subdirectories. */
  private scanDirectory(dir: string): NoteEntry[] {
    if (!existsSync(dir)) return [];
    const entries: NoteEntry[] = [];

    try {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        // Skip hidden files, index files, and .assets directories
        // Allow _inbox as a special user-facing folder
        if (item.name.startsWith(".")) continue;
        if (item.name.startsWith("_") && item.name !== "_inbox") continue;
        if (item.name.endsWith(".assets") || item.name.endsWith(".versions")) continue;

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
              noteId: frontmatter.id,
              status: frontmatter.status,
              pinned: frontmatter.pinned,
              pinnedAt: frontmatter.pinnedAt,
              pinnedBy: frontmatter.pinnedBy,
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
        if (item.name.endsWith(".assets") || item.name.endsWith(".versions")) continue;
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
        if (item.name.endsWith(".assets") || item.name.endsWith(".versions")) continue;

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
    scope: NoteScope,
    visibility: NoteVisibility,
    lowerQuery: string,
    results: NoteSearchResult[],
  ): void {
    if (!existsSync(dir)) return;

    try {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".") || item.name.startsWith("_")) continue;
        if (item.name.endsWith(".assets")) continue;
        if (item.name.endsWith(".versions")) continue;

        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
          this.searchInDir(fullPath, rootDir, scope, visibility, lowerQuery, results);
        } else if (item.name.endsWith(".md")) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            const lines = stripInlineAnnotationMarkers(content).split("\n");
            const { frontmatter } = this.parseFrontmatter(content);
            const relativePath = path.relative(rootDir, fullPath);

            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                results.push({
                  scope,
                  visibility,
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

  /* ── Version History ──────────────────────────────────────────────── */

  /** Max number of version snapshots to keep per note. */
  private static readonly MAX_VERSIONS = 10;

  /** Get the versions directory for a note file. */
  private versionsDir(noteFilePath: string): string {
    return this.fileSvc.getBundle(noteFilePath).versionsDir;
  }

  /**
   * Snapshot the current content as a version.
   * Called automatically on updateNote.
   * Versions are named v001.md, v002.md, etc.
   * When MAX_VERSIONS is exceeded, the oldest is deleted.
   */
  private snapshotVersion(noteFilePath: string): void {
    try {
      if (!existsSync(noteFilePath)) return;

      const content = readFileSync(noteFilePath, "utf-8");
      const vDir = this.versionsDir(noteFilePath);
      if (!existsSync(vDir)) mkdirSync(vDir, { recursive: true });

      // Find existing versions
      const existing = this.listVersionFiles(vDir);

      // Determine next version number
      let nextNum = 1;
      if (existing.length > 0) {
        const lastVersion = existing[existing.length - 1];
        const match = lastVersion.match(/v(\d+)\.md$/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }

      const versionName = `v${String(nextNum).padStart(3, "0")}.md`;
      writeFileSync(path.join(vDir, versionName), content, "utf-8");

      // Prune old versions
      const allVersions = this.listVersionFiles(vDir);
      if (allVersions.length > CodaScopeNoteService.MAX_VERSIONS) {
        const toDelete = allVersions.slice(0, allVersions.length - CodaScopeNoteService.MAX_VERSIONS);
        for (const old of toDelete) {
          try { unlinkSync(path.join(vDir, old)); } catch { /* best effort */ }
        }
      }
    } catch { /* best effort — don't break saves */ }
  }

  /** List version files in sorted order. */
  private listVersionFiles(vDir: string): string[] {
    if (!existsSync(vDir)) return [];
    try {
      return readdirSync(vDir)
        .filter((f: string) => f.match(/^v\d+\.md$/))
        .sort();
    } catch {
      return [];
    }
  }

  /** List available versions for a note. */
  async listVersions(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): Promise<NoteVersionEntry[]> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return [];

    const filePath = this.resolveNotePath(notesDir, notePath);
    const vDir = this.versionsDir(filePath);
    const files = this.listVersionFiles(vDir);

    return files.map((f) => {
      const fullPath = path.join(vDir, f);
      const stat = statSync(fullPath);
      const version = f.replace(".md", "");
      return {
        version,
        savedAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      };
    });
  }

  /** Get a specific version's content. */
  async getVersion(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    version: string,
  ): Promise<NoteVersionContent | null> {
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return null;

    const filePath = this.resolveNotePath(notesDir, notePath);
    const vDir = this.versionsDir(filePath);
    const vPath = path.join(vDir, `${version}.md`);

    if (!existsSync(vPath)) return null;

    const content = readFileSync(vPath, "utf-8");
    const stat = statSync(vPath);

    return {
      version,
      content,
      savedAt: stat.mtime.toISOString(),
    };
  }

  /* ── Activity Feed ──────────────────────────────────────────────── */

  /**
   * Build a unified activity timeline for a note by merging:
   * - version history (edit events with size deltas)
   * - audit log entries (created, moved, archived, etc.)
   */
  async getActivity(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    auditService: { query(filters: { noteId: string; limit?: number }): import("../../src/apps/codascope/codaScopeTypes.js").NoteAuditEvent[] },
  ): Promise<NoteActivityEntry[]> {
    const entries: NoteActivityEntry[] = [];
    const notesDir = this.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return entries;

    const filePath = this.resolveNotePath(notesDir, notePath);
    if (!existsSync(filePath)) return entries;

    // Get noteId from current content
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = this.parseFrontmatter(content);
    const noteId = frontmatter.id;
    const currentWordCount = this.countWords(body);

    let auditEvents: import("../../src/apps/codascope/codaScopeTypes.js").NoteAuditEvent[] = [];
    try {
      auditEvents = auditService.query({ noteId, limit: 100 });
    } catch { /* audit not available */ }

    // 1. Version history plus audit entries → edits with actor and delta.
    // A snapshot is written immediately before each update, so pairing newest
    // snapshots with newest update events yields the before/after word delta.
    const vDir = this.versionsDir(filePath);
    if (existsSync(vDir)) {
      try {
        const versionFiles = readdirSync(vDir)
          .filter((f: string) => f.endsWith(".md"))
          .sort()
          .reverse();

        const snapshots: Array<{ savedAt: string; wordCount: number; label: string }> = [];

        for (const vf of versionFiles.slice(0, 50)) {
          const vPath = path.join(vDir, vf);
          try {
            const stat = statSync(vPath);
            const vContent = readFileSync(vPath, "utf-8");
            snapshots.push({
              savedAt: stat.mtime.toISOString(),
              wordCount: this.countWords(vContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")),
              label: vf.replace(".md", ""),
            });
          } catch { /* skip */ }
        }

        const updates = auditEvents
          .filter((event) => event.event === "note.updated")
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        for (let index = 0; index < snapshots.length; index++) {
          const snapshot = snapshots[index];
          const update = updates[index];
          const afterWordCount = index === 0 ? currentWordCount : snapshots[index - 1].wordCount;
          const delta = afterWordCount - snapshot.wordCount;
          const deltaLabel = delta > 0
            ? `Added ${delta} word${delta === 1 ? "" : "s"}`
            : delta < 0
              ? `Removed ${Math.abs(delta)} word${delta === -1 ? "" : "s"}`
              : "Edited note";

          entries.push({
            type: "edit",
            timestamp: update?.timestamp ?? snapshot.savedAt,
            actor: update?.actor ?? "unknown",
            details: `${deltaLabel} (${snapshot.label})`,
          });
        }

        // Retained audit entries can outnumber version snapshots after old
        // versions are pruned, so keep those edits visible as well.
        for (const update of updates.slice(snapshots.length, 50)) {
            entries.push({
              type: "edit",
              timestamp: update.timestamp,
              actor: update.actor,
              details: "Edited note",
            });
        }
      } catch { /* no versions dir */ }
    } else {
      for (const update of auditEvents.filter((event) => event.event === "note.updated").slice(0, 50)) {
        entries.push({
          type: "edit",
          timestamp: update.timestamp,
          actor: update.actor,
          details: "Edited note",
        });
      }
    }

    // 2. Non-edit audit log entries.
    try {
      for (const ev of auditEvents) {
        const typeMap: Record<string, NoteActivityEntry["type"]> = {
          "note.created": "created",
          "note.moved": "moved",
          "note.archived": "archived",
          "note.restored": "restored",
          "note.visibility_changed": "visibility_changed",
        };
        const type = typeMap[ev.event];
        if (!type) continue;

        let details = ev.event.replace("note.", "");
        if (ev.metadata) {
          const meta = ev.metadata as Record<string, unknown>;
          if (ev.event === "note.visibility_changed") {
            details = `Changed visibility from ${meta.fromVisibility} to ${meta.toVisibility}`;
          } else if (meta.fromScope || meta.toScope) {
            details = `Moved from ${meta.fromScope}/${meta.fromVisibility} to ${meta.toScope}/${meta.toVisibility}`;
          }
        }

        entries.push({
          type,
          timestamp: ev.timestamp,
          actor: ev.actor,
          details,
        });
      }
    } catch { /* audit not available */ }

    // Sort newest first
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return entries.slice(0, 50);
  }
}
