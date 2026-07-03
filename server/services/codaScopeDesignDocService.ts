/* ── CodaScope: Design Doc Service ───────────────────────────────────
   CRUD for epic design documents.
   Follows existing service patterns (module singleton, atomic writes,
   project-directory-based storage).

   Responsibilities:
   - Design doc CRUD (create, read, update, delete, list)
   - Markdown file I/O with word/block count computation
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { EpicDesignDoc } from "../../src/apps/codascope/codaScopeTypes.js";

/* ── Storage schema ───────────────────────────────────────────────── */

interface DesignsIndex {
  docs: EpicDesignDoc[];
}

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

  private docPath(projectDir: string, epicId: string, docId: string): string {
    return path.join(this.designsDir(projectDir, epicId), `${docId}.md`);
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

    // Write markdown file
    const designDir = this.designsDir(projectDir, epicId);
    if (!existsSync(designDir)) mkdirSync(designDir, { recursive: true });
    writeFileSync(this.docPath(projectDir, epicId, id), initialContent, "utf-8");

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

    // Write content
    writeFileSync(this.docPath(projectDir, epicId, docId), content, "utf-8");

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
}
