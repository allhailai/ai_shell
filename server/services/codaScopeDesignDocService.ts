/* ── CodaScope: Design Doc Service ───────────────────────────────────
   CRUD for epic design documents.
   Follows existing service patterns (module singleton, atomic writes,
   project-directory-based storage).

   Responsibilities:
   - Design doc CRUD (create, read, update, delete, list)
   - Markdown file I/O with word/block count computation
   - Per-doc version history (create, list, get, revert)
   - Storage migration: flat <docId>.md → <docId>/content.md

   Storage layout (post-migration):
   <epicDir>/designs/
     designs.json           (doc index)
     <docId>/
       content.md           (current document content)
       versions/
         v001.md
         v002.md
         versions.json      (version metadata index)
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, statSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { EpicDesignDoc } from "../../src/apps/codascope/codaScopeTypes.js";

/* ── Storage schema ───────────────────────────────────────────────── */

interface DesignsIndex {
  docs: EpicDesignDoc[];
}

/* ── Version types ────────────────────────────────────────────────── */

export interface DesignDocVersion {
  number: number;
  createdAt: string;
  author: string;
  summary: string;
  wordCount: number;
}

interface DesignDocVersionsIndex {
  versions: DesignDocVersion[];
  maxVersions: number;
}

/* ── Constants ────────────────────────────────────────────────────── */

const MAX_VERSIONS = 10;

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeDesignDocService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path helpers ─────────────────────────────────────────────────── */

  private projectDir(projectId: string): string | null {
    if (!existsSync(this.root)) return null;
    const entries = readdirSync(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectPath = path.join(this.root, entry.name, "project.json");
      if (existsSync(projectPath)) {
        try {
          const data = JSON.parse(readFileSync(projectPath, "utf-8"));
          if (data.id === projectId) return path.join(this.root, entry.name);
        } catch { /* skip corrupted */ }
      }
    }
    return null;
  }

  private designsDir(projectDir: string, epicId: string): string {
    return path.join(projectDir, "epics", epicId, "designs");
  }

  private indexPath(projectDir: string, epicId: string): string {
    return path.join(this.designsDir(projectDir, epicId), "designs.json");
  }

  /**
   * Returns the path to the document content file.
   * Handles migration from flat layout (<docId>.md) to directory layout (<docId>/content.md).
   * On first access to a flat-layout doc, the file is automatically migrated.
   */
  private docPath(projectDir: string, epicId: string, docId: string): string {
    const designDir = this.designsDir(projectDir, epicId);
    const newPath = path.join(designDir, docId, "content.md");
    const oldPath = path.join(designDir, `${docId}.md`);

    // New layout already exists — use it
    if (existsSync(newPath)) return newPath;

    // Old flat layout exists — migrate it
    if (existsSync(oldPath)) {
      try {
        const docDir = path.join(designDir, docId);
        mkdirSync(docDir, { recursive: true });
        renameSync(oldPath, newPath);
        return newPath;
      } catch {
        // Migration failed — fall back to old path
        return oldPath;
      }
    }

    // Neither exists — return new-layout path (for creation)
    return newPath;
  }

  /** Directory for a specific design doc */
  private docDir(projectDir: string, epicId: string, docId: string): string {
    return path.join(this.designsDir(projectDir, epicId), docId);
  }

  /** Versions directory for a specific design doc */
  private versionsDir(projectDir: string, epicId: string, docId: string): string {
    return path.join(this.docDir(projectDir, epicId, docId), "versions");
  }

  /** Versions index path for a specific design doc */
  private versionsIndexPath(projectDir: string, epicId: string, docId: string): string {
    return path.join(this.versionsDir(projectDir, epicId, docId), "versions.json");
  }

  /* ── Index helpers ────────────────────────────────────────────────── */

  private readIndex(projectDir: string, epicId: string): DesignsIndex {
    const p = this.indexPath(projectDir, epicId);
    if (!existsSync(p)) return { docs: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { docs: [] };
    }
  }

  private writeIndex(projectDir: string, epicId: string, index: DesignsIndex): void {
    const dir = this.designsDir(projectDir, epicId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.indexPath(projectDir, epicId), JSON.stringify(index, null, 2), "utf-8");
  }

  /* ── Version index helpers ───────────────────────────────────────── */

  private readVersionsIndex(projectDir: string, epicId: string, docId: string): DesignDocVersionsIndex {
    const p = this.versionsIndexPath(projectDir, epicId, docId);
    if (!existsSync(p)) return { versions: [], maxVersions: MAX_VERSIONS };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { versions: [], maxVersions: MAX_VERSIONS };
    }
  }

  private writeVersionsIndex(projectDir: string, epicId: string, docId: string, index: DesignDocVersionsIndex): void {
    const dir = this.versionsDir(projectDir, epicId, docId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.versionsIndexPath(projectDir, epicId, docId), JSON.stringify(index, null, 2), "utf-8");
  }

  /* ── Content helpers ──────────────────────────────────────────────── */

  /** Count words in markdown text. */
  private countWords(text: string): number {
    if (!text.trim()) return 0;
    return text.trim().split(/\s+/).length;
  }

  /** Count markdown blocks (paragraphs, headings, list items, code fences). */
  private countBlocks(text: string): number {
    if (!text.trim()) return 0;
    const lines = text.split("\n");
    let blocks = 0;
    let inCodeFence = false;
    let prevLineBlank = true;

    for (const line of lines) {
      const trimmed = line.trim();

      // Code fence boundaries
      if (trimmed.startsWith("```")) {
        inCodeFence = !inCodeFence;
        blocks++;
        prevLineBlank = false;
        continue;
      }

      if (inCodeFence) {
        prevLineBlank = false;
        continue;
      }

      // Blank line
      if (!trimmed) {
        prevLineBlank = true;
        continue;
      }

      // Headings
      if (trimmed.startsWith("#")) {
        blocks++;
        prevLineBlank = false;
        continue;
      }

      // List items
      if (/^[-*+]\s|^\d+\.\s/.test(trimmed)) {
        blocks++;
        prevLineBlank = false;
        continue;
      }

      // Paragraph start (after a blank line)
      if (prevLineBlank) {
        blocks++;
      }

      prevLineBlank = false;
    }

    return blocks;
  }

  /* ── CRUD ─────────────────────────────────────────────────────────── */

  /** List all design docs for an epic. */
  async listDesignDocs(projectId: string, epicId: string): Promise<EpicDesignDoc[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];
    return this.readIndex(projectDir, epicId).docs;
  }

  /** Create a new design doc with optional initial content. */
  async createDesignDoc(projectId: string, epicId: string, opts: {
    title: string;
    content?: string;
    createdBy?: string;
  }): Promise<EpicDesignDoc> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    const now = new Date().toISOString();
    const id = `doc_${crypto.randomBytes(6).toString("hex")}`;

    const initialContent = opts.content ?? "";

    const doc: EpicDesignDoc = {
      id,
      epicId,
      title: opts.title,
      createdAt: now,
      updatedAt: now,
      createdBy: opts.createdBy ?? "user",
      wordCount: this.countWords(initialContent),
      blockCount: this.countBlocks(initialContent),
      annotationCount: 0,
      directiveCount: 0,
    };

    // Write markdown file in the new directory layout
    const docDirectory = this.docDir(projectDir, epicId, id);
    if (!existsSync(docDirectory)) mkdirSync(docDirectory, { recursive: true });
    writeFileSync(path.join(docDirectory, "content.md"), initialContent, "utf-8");

    // Update index
    const index = this.readIndex(projectDir, epicId);
    index.docs.push(doc);
    this.writeIndex(projectDir, epicId, index);

    return doc;
  }

  /** Get design doc content (markdown). */
  async getDesignDoc(projectId: string, epicId: string, docId: string): Promise<{ doc: EpicDesignDoc; content: string } | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const index = this.readIndex(projectDir, epicId);
    const doc = index.docs.find((d) => d.id === docId);
    if (!doc) return null;

    const filePath = this.docPath(projectDir, epicId, docId);
    const content = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";

    return { doc, content };
  }

  /** Update design doc content. */
  async updateDesignDoc(projectId: string, epicId: string, docId: string, content: string): Promise<EpicDesignDoc | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const index = this.readIndex(projectDir, epicId);
    const doc = index.docs.find((d) => d.id === docId);
    if (!doc) return null;

    // Ensure docPath triggers migration if needed
    const filePath = this.docPath(projectDir, epicId, docId);
    const docDirectory = path.dirname(filePath);
    if (!existsSync(docDirectory)) mkdirSync(docDirectory, { recursive: true });
    writeFileSync(filePath, content, "utf-8");

    // Update metadata
    doc.updatedAt = new Date().toISOString();
    doc.wordCount = this.countWords(content);
    doc.blockCount = this.countBlocks(content);
    this.writeIndex(projectDir, epicId, index);

    return doc;
  }

  /** Archive a design doc (soft delete — preserves file on disk). */
  async archiveDesignDoc(projectId: string, epicId: string, docId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const index = this.readIndex(projectDir, epicId);
    const doc = index.docs.find((d) => d.id === docId);
    if (!doc) return false;

    doc.archivedAt = new Date().toISOString();
    this.writeIndex(projectDir, epicId, index);
    return true;
  }

  /** Unarchive a design doc (restore from soft delete). */
  async unarchiveDesignDoc(projectId: string, epicId: string, docId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const index = this.readIndex(projectDir, epicId);
    const doc = index.docs.find((d) => d.id === docId);
    if (!doc || !doc.archivedAt) return false;

    delete doc.archivedAt;
    this.writeIndex(projectDir, epicId, index);
    return true;
  }

  /* ── Bulk read (used by version service and getEpic) ──────────────── */

  /** Read the designs index directly from a project dir (no projectId lookup). */
  readDesignsIndex(epicDir: string): EpicDesignDoc[] {
    const indexPath = path.join(epicDir, "designs", "designs.json");
    if (!existsSync(indexPath)) return [];
    try {
      const data: DesignsIndex = JSON.parse(readFileSync(indexPath, "utf-8"));
      return data.docs;
    } catch {
      return [];
    }
  }

  /* ── Version History ─────────────────────────────────────────────── */

  /**
   * Create a version snapshot of the current document content.
   * Max 10 versions — oldest are pruned automatically.
   */
  async createVersion(projectId: string, epicId: string, docId: string, author: string, summary: string): Promise<DesignDocVersion> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    // Ensure content file exists (triggers migration if needed)
    const contentPath = this.docPath(projectDir, epicId, docId);
    if (!existsSync(contentPath)) throw new Error("Design doc not found");

    const currentContent = readFileSync(contentPath, "utf-8");
    const vDir = this.versionsDir(projectDir, epicId, docId);
    if (!existsSync(vDir)) mkdirSync(vDir, { recursive: true });

    // Read existing versions index
    const vIndex = this.readVersionsIndex(projectDir, epicId, docId);

    // Determine next version number
    const nextNum = vIndex.versions.length > 0
      ? Math.max(...vIndex.versions.map((v) => v.number)) + 1
      : 1;

    // Pad version number to 3 digits for consistent file sorting
    const versionFilename = `v${String(nextNum).padStart(3, "0")}.md`;
    writeFileSync(path.join(vDir, versionFilename), currentContent, "utf-8");

    const version: DesignDocVersion = {
      number: nextNum,
      createdAt: new Date().toISOString(),
      author,
      summary,
      wordCount: this.countWords(currentContent),
    };

    vIndex.versions.push(version);

    // Prune beyond max versions (delete oldest)
    while (vIndex.versions.length > MAX_VERSIONS) {
      const oldest = vIndex.versions.shift()!;
      const oldFile = path.join(vDir, `v${String(oldest.number).padStart(3, "0")}.md`);
      try { if (existsSync(oldFile)) unlinkSync(oldFile); } catch { /* best effort */ }
    }

    this.writeVersionsIndex(projectDir, epicId, docId, vIndex);
    return version;
  }

  /** List all versions for a design doc. */
  async listDocVersions(projectId: string, epicId: string, docId: string): Promise<DesignDocVersion[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];
    return this.readVersionsIndex(projectDir, epicId, docId).versions;
  }

  /** Get a specific version's content. */
  async getDocVersion(projectId: string, epicId: string, docId: string, versionNum: number): Promise<{ version: DesignDocVersion; content: string } | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const vIndex = this.readVersionsIndex(projectDir, epicId, docId);
    const vMeta = vIndex.versions.find((v) => v.number === versionNum);
    if (!vMeta) return null;

    const vDir = this.versionsDir(projectDir, epicId, docId);
    const vFile = path.join(vDir, `v${String(versionNum).padStart(3, "0")}.md`);
    if (!existsSync(vFile)) return null;

    return { version: vMeta, content: readFileSync(vFile, "utf-8") };
  }

  /**
   * Revert to a specific version. This:
   * 1. Creates a NEW version snapshot of current content (so the revert itself is undoable)
   * 2. Copies the target version content back to content.md
   * 3. Updates the doc metadata
   * Returns the restored content.
   */
  async revertToVersion(projectId: string, epicId: string, docId: string, versionNum: number): Promise<{ content: string; revertVersion: DesignDocVersion } | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    // Get the target version content
    const target = await this.getDocVersion(projectId, epicId, docId, versionNum);
    if (!target) return null;

    // Create a snapshot of the current content before reverting
    const revertVersion = await this.createVersion(
      projectId, epicId, docId, "user", `Reverted to version ${versionNum}`,
    );

    // Write the reverted content
    const updated = await this.updateDesignDoc(projectId, epicId, docId, target.content);
    if (!updated) return null;

    return { content: target.content, revertVersion };
  }
}
