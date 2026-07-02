/* ── CodaScope: Epic Knowledge Directory Service ────────────────────
   Manages the unified knowledge/ directory for each epic.
   Handles source CRUD, blocked download tracking, epic wiki CRUD,
   and research plan management.

   Storage structure:
     <epicDir>/knowledge/
     ├── wiki/               # Epic-scoped wiki pages (research synthesis)
     ├── sources/            # Downloaded + human-uploaded
     │   ├── manifest.json   # Source metadata index
     │   ├── <hash>/         # Per-source directory
     │   │   ├── original.<ext>
     │   │   ├── content.md
     │   │   └── meta.json
     │   └── blocked.json
     └── research_plan.json
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  EpicKnowledgeSource,
  EpicKnowledgeManifest,
  BlockedDownload,
  BlockedDownloadList,
  EpicWikiPage,
  ResearchPlan,
} from "../../src/apps/codascope/codaScopeTypes.js";

/* ── Helpers ────────────────────────────────────────────────────────── */

function nowIso(): string {
  return new Date().toISOString();
}

function generateId(): string {
  return crypto.randomBytes(8).toString("hex");
}

/** Atomic write: temp → rename for crash safety. */
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.tmp.${crypto.randomBytes(4).toString("hex")}`;
  await fs.writeFile(tmpPath, data, "utf-8");
  await fs.rename(tmpPath, filePath);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeEpicKnowledgeService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path helpers ──────────────────────────────────────────────────── */

  /** Resolve the project directory for a given project ID. */
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

  private epicDir(projectDir: string, epicId: string): string {
    return path.join(projectDir, "epics", epicId);
  }

  private knowledgeDir(epicDir: string): string {
    return path.join(epicDir, "knowledge");
  }

  private sourcesDir(epicDir: string): string {
    return path.join(this.knowledgeDir(epicDir), "sources");
  }

  private manifestPath(epicDir: string): string {
    return path.join(this.sourcesDir(epicDir), "manifest.json");
  }

  private blockedPath(epicDir: string): string {
    return path.join(this.sourcesDir(epicDir), "blocked.json");
  }

  private wikiDir(epicDir: string): string {
    return path.join(this.knowledgeDir(epicDir), "wiki");
  }

  private researchPlanPath(epicDir: string): string {
    return path.join(this.knowledgeDir(epicDir), "research_plan.json");
  }

  private sourceDir(epicDir: string, sourceId: string): string {
    return path.join(this.sourcesDir(epicDir), sourceId);
  }

  /** Resolve epicDir from project ID + epic ID. Returns null if not found. */
  private resolveEpicDir(projectId: string, epicId: string): string | null {
    const projDir = this.projectDir(projectId);
    if (!projDir) return null;
    const ed = this.epicDir(projDir, epicId);
    return existsSync(ed) ? ed : null;
  }

  /* ── Initialization ────────────────────────────────────────────────── */

  /**
   * Initialize the knowledge/ directory structure for a new epic.
   * Called during epic creation.
   */
  initializeKnowledgeDir(epicDir: string): void {
    const kDir = this.knowledgeDir(epicDir);
    const sDir = this.sourcesDir(epicDir);
    const wDir = this.wikiDir(epicDir);

    mkdirSync(kDir, { recursive: true });
    mkdirSync(sDir, { recursive: true });
    mkdirSync(wDir, { recursive: true });

    // Initialize manifest
    if (!existsSync(this.manifestPath(epicDir))) {
      const manifest: EpicKnowledgeManifest = {
        sources: [],
        lastUpdatedAt: nowIso(),
      };
      writeFileSync(this.manifestPath(epicDir), JSON.stringify(manifest, null, 2), "utf-8");
    }

    // Initialize blocked list
    if (!existsSync(this.blockedPath(epicDir))) {
      const blocked: BlockedDownloadList = { items: [] };
      writeFileSync(this.blockedPath(epicDir), JSON.stringify(blocked, null, 2), "utf-8");
    }
  }

  /* ── Source CRUD ────────────────────────────────────────────────────── */

  /** Read the source manifest. */
  private readManifest(epicDir: string): EpicKnowledgeManifest {
    const p = this.manifestPath(epicDir);
    if (!existsSync(p)) return { sources: [], lastUpdatedAt: nowIso() };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { sources: [], lastUpdatedAt: nowIso() };
    }
  }

  /** Write the source manifest atomically. */
  private async writeManifest(epicDir: string, manifest: EpicKnowledgeManifest): Promise<void> {
    manifest.lastUpdatedAt = nowIso();
    await atomicWrite(this.manifestPath(epicDir), JSON.stringify(manifest, null, 2));
  }

  /** Add a new source to the manifest and create its directory. */
  async addSource(projectId: string, epicId: string, source: Omit<EpicKnowledgeSource, "id">): Promise<EpicKnowledgeSource> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) throw new Error("Epic not found");

    const id = generateId();
    const fullSource: EpicKnowledgeSource = { ...source, id };

    // Create source directory
    const srcDir = this.sourceDir(epicDir, id);
    mkdirSync(srcDir, { recursive: true });

    // Write meta.json
    writeFileSync(path.join(srcDir, "meta.json"), JSON.stringify(fullSource, null, 2), "utf-8");

    // Update manifest
    const manifest = this.readManifest(epicDir);
    manifest.sources.push(fullSource);
    await this.writeManifest(epicDir, manifest);

    return fullSource;
  }

  /** List all sources for an epic. */
  async listSources(projectId: string, epicId: string): Promise<EpicKnowledgeSource[]> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return [];
    return this.readManifest(epicDir).sources;
  }

  /** Get a single source by ID. */
  async getSource(projectId: string, epicId: string, sourceId: string): Promise<EpicKnowledgeSource | null> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return null;
    const manifest = this.readManifest(epicDir);
    return manifest.sources.find((s) => s.id === sourceId) ?? null;
  }

  /** Update a source's status and optional metadata. */
  async updateSourceStatus(projectId: string, epicId: string, sourceId: string, status: EpicKnowledgeSource["status"], meta?: Partial<EpicKnowledgeSource>): Promise<void> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) throw new Error("Epic not found");

    const manifest = this.readManifest(epicDir);
    const source = manifest.sources.find((s) => s.id === sourceId);
    if (!source) throw new Error("Source not found");

    source.status = status;
    if (meta) Object.assign(source, meta);
    if (status === "ready") source.processedAt = nowIso();

    // Update meta.json in source directory
    const srcDir = this.sourceDir(epicDir, sourceId);
    if (existsSync(srcDir)) {
      writeFileSync(path.join(srcDir, "meta.json"), JSON.stringify(source, null, 2), "utf-8");
    }

    await this.writeManifest(epicDir, manifest);
  }

  /** Get the original file and extracted markdown for a source. */
  async getSourceContent(projectId: string, epicId: string, sourceId: string): Promise<{ original: Buffer | null; markdown: string | null }> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return { original: null, markdown: null };

    const srcDir = this.sourceDir(epicDir, sourceId);
    if (!existsSync(srcDir)) return { original: null, markdown: null };

    // Find original file
    let original: Buffer | null = null;
    const files = readdirSync(srcDir);
    const originalFile = files.find((f) => f.startsWith("original."));
    if (originalFile) {
      original = readFileSync(path.join(srcDir, originalFile));
    }

    // Read markdown
    let markdown: string | null = null;
    const mdPath = path.join(srcDir, "content.md");
    if (existsSync(mdPath)) {
      markdown = readFileSync(mdPath, "utf-8");
    }

    return { original, markdown };
  }

  /** Store the original file for a source. */
  async storeOriginalFile(projectId: string, epicId: string, sourceId: string, buffer: Buffer, ext: string): Promise<string> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) throw new Error("Epic not found");

    const srcDir = this.sourceDir(epicDir, sourceId);
    mkdirSync(srcDir, { recursive: true });
    const filePath = path.join(srcDir, `original.${ext}`);
    writeFileSync(filePath, buffer);
    return filePath;
  }

  /** Store extracted markdown for a source. */
  async storeExtractedMarkdown(projectId: string, epicId: string, sourceId: string, markdown: string): Promise<void> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) throw new Error("Epic not found");

    const srcDir = this.sourceDir(epicDir, sourceId);
    if (!existsSync(srcDir)) throw new Error("Source directory not found");

    await atomicWrite(path.join(srcDir, "content.md"), markdown);

    // Update markdown size in manifest
    const manifest = this.readManifest(epicDir);
    const source = manifest.sources.find((s) => s.id === sourceId);
    if (source) {
      source.sizeBytesMarkdown = Buffer.byteLength(markdown, "utf-8");
    }
    await this.writeManifest(epicDir, manifest);
  }

  /** Delete a source and its directory. */
  async deleteSource(projectId: string, epicId: string, sourceId: string): Promise<boolean> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return false;

    const srcDir = this.sourceDir(epicDir, sourceId);
    if (existsSync(srcDir)) {
      rmSync(srcDir, { recursive: true, force: true });
    }

    const manifest = this.readManifest(epicDir);
    const before = manifest.sources.length;
    manifest.sources = manifest.sources.filter((s) => s.id !== sourceId);
    if (manifest.sources.length === before) return false;

    await this.writeManifest(epicDir, manifest);
    return true;
  }

  /* ── Blocked Downloads ─────────────────────────────────────────────── */

  /** Read the blocked downloads list. */
  private readBlocked(epicDir: string): BlockedDownloadList {
    const p = this.blockedPath(epicDir);
    if (!existsSync(p)) return { items: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { items: [] };
    }
  }

  /** Write the blocked downloads list atomically. */
  private async writeBlocked(epicDir: string, blocked: BlockedDownloadList): Promise<void> {
    await atomicWrite(this.blockedPath(epicDir), JSON.stringify(blocked, null, 2));
  }

  /** Add a blocked download record. */
  async addBlockedDownload(projectId: string, epicId: string, item: Omit<BlockedDownload, "id">): Promise<BlockedDownload> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) throw new Error("Epic not found");

    const id = generateId();
    const fullItem: BlockedDownload = { ...item, id };

    const blocked = this.readBlocked(epicDir);
    blocked.items.push(fullItem);
    await this.writeBlocked(epicDir, blocked);

    return fullItem;
  }

  /** List blocked downloads for an epic. */
  async listBlockedDownloads(projectId: string, epicId: string, includeDismissed = false): Promise<BlockedDownload[]> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return [];

    const blocked = this.readBlocked(epicDir);
    if (includeDismissed) return blocked.items;
    return blocked.items.filter((item) => item.status !== "dismissed");
  }

  /** Dismiss a blocked download. */
  async dismissBlockedDownload(projectId: string, epicId: string, blockId: string): Promise<void> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) throw new Error("Epic not found");

    const blocked = this.readBlocked(epicDir);
    const item = blocked.items.find((i) => i.id === blockId);
    if (!item) throw new Error("Blocked download not found");

    item.status = "dismissed";
    item.dismissedAt = nowIso();
    await this.writeBlocked(epicDir, blocked);
  }

  /** Mark a blocked download as resolved, linking it to the resolving source. */
  async resolveBlockedDownload(projectId: string, epicId: string, blockId: string, sourceId: string): Promise<void> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) throw new Error("Epic not found");

    const blocked = this.readBlocked(epicDir);
    const item = blocked.items.find((i) => i.id === blockId);
    if (!item) throw new Error("Blocked download not found");

    item.status = "resolved";
    item.resolvedAt = nowIso();
    item.resolvedSourceId = sourceId;
    await this.writeBlocked(epicDir, blocked);
  }

  /* ── Epic Wiki (Research Synthesis) ────────────────────────────────── */

  /** List all epic wiki pages. */
  async listEpicWikiPages(projectId: string, epicId: string): Promise<EpicWikiPage[]> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return [];

    const wDir = this.wikiDir(epicDir);
    if (!existsSync(wDir)) return [];

    const pages: EpicWikiPage[] = [];
    const files = readdirSync(wDir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const pageId = file.replace(/\.md$/, "");
      const filePath = path.join(wDir, file);
      const content = readFileSync(filePath, "utf-8");
      const stat = statSync(filePath);

      // Try to read page metadata
      const metaPath = path.join(wDir, `${pageId}.meta.json`);
      let meta: Partial<EpicWikiPage> = {};
      if (existsSync(metaPath)) {
        try { meta = JSON.parse(readFileSync(metaPath, "utf-8")); } catch { /* ignore */ }
      }

      pages.push({
        id: pageId,
        title: meta.title ?? this.titleFromSlug(pageId),
        createdAt: meta.createdAt ?? stat.birthtime.toISOString(),
        updatedAt: meta.updatedAt ?? stat.mtime.toISOString(),
        wordCount: countWords(content),
        sourceRefs: meta.sourceRefs ?? [],
      });
    }

    return pages;
  }

  /** Read a specific epic wiki page's content. */
  async readEpicWikiPage(projectId: string, epicId: string, pageId: string): Promise<string | null> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return null;

    const filePath = path.join(this.wikiDir(epicDir), `${pageId}.md`);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf-8");
  }

  /** Create or update an epic wiki page. */
  async writeEpicWikiPage(projectId: string, epicId: string, pageId: string, title: string, content: string, sourceRefs?: string[]): Promise<EpicWikiPage> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) throw new Error("Epic not found");

    const wDir = this.wikiDir(epicDir);
    mkdirSync(wDir, { recursive: true });

    const filePath = path.join(wDir, `${pageId}.md`);
    const metaPath = path.join(wDir, `${pageId}.meta.json`);

    const now = nowIso();
    const isNew = !existsSync(filePath);

    await atomicWrite(filePath, content);

    // Read existing meta or create new
    let meta: EpicWikiPage;
    if (!isNew && existsSync(metaPath)) {
      try {
        const existing = JSON.parse(readFileSync(metaPath, "utf-8")) as EpicWikiPage;
        meta = {
          ...existing,
          title,
          updatedAt: now,
          wordCount: countWords(content),
          sourceRefs: sourceRefs ?? existing.sourceRefs,
        };
      } catch {
        meta = { id: pageId, title, createdAt: now, updatedAt: now, wordCount: countWords(content), sourceRefs: sourceRefs ?? [] };
      }
    } else {
      meta = { id: pageId, title, createdAt: now, updatedAt: now, wordCount: countWords(content), sourceRefs: sourceRefs ?? [] };
    }

    await atomicWrite(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  /** Delete an epic wiki page. */
  async deleteEpicWikiPage(projectId: string, epicId: string, pageId: string): Promise<boolean> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return false;

    const filePath = path.join(this.wikiDir(epicDir), `${pageId}.md`);
    const metaPath = path.join(this.wikiDir(epicDir), `${pageId}.meta.json`);

    if (!existsSync(filePath)) return false;

    rmSync(filePath, { force: true });
    if (existsSync(metaPath)) rmSync(metaPath, { force: true });

    return true;
  }

  /* ── Research Plan ─────────────────────────────────────────────────── */

  /** Get the research plan for an epic. Returns null if none exists. */
  async getResearchPlan(projectId: string, epicId: string): Promise<ResearchPlan | null> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return null;

    const p = this.researchPlanPath(epicDir);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return null;
    }
  }

  /** Update the research plan for an epic. */
  async updateResearchPlan(projectId: string, epicId: string, plan: ResearchPlan): Promise<void> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) throw new Error("Epic not found");

    plan.updatedAt = nowIso();
    await atomicWrite(this.researchPlanPath(epicDir), JSON.stringify(plan, null, 2));
  }

  /* ── Utility ───────────────────────────────────────────────────────── */

  /** Convert a slug to a human-readable title. */
  private titleFromSlug(slug: string): string {
    return slug
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** Get the epicDir for external callers (e.g., epic service initialization). */
  getEpicDirForInit(projectDir: string, epicId: string): string {
    return this.epicDir(projectDir, epicId);
  }
}
