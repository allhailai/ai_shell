/* ── CodaScope: Artifact Service ─────────────────────────────────────
   Core CRUD + build orchestration for visual HTML artifacts.

   Responsibilities:
   - Artifact spec CRUD (create, read, update, delete, list)
   - Build pipeline orchestration (stub — agent wired in Phase 2)
   - Section extraction from built HTML (parse <section data-section-id> elements)
   - Section management: hide/unhide/reorder + recompose index.html
   - Spec hashing for staleness detection
   - Source resolution (auto-discover epic context)
   - Preview HTML generation (inject annotation script)

   Storage layout:
   <projectDir>/epics/<epicId>/artifacts/
   ├── artifacts.json
   └── <artifactId>/
       ├── spec.md
       ├── builds/
       │   ├── index.html
       │   ├── .artifact-annotations.json
       │   ├── .artifact-sections.json
       │   ├── .sections/
       │   └── .versions/
       └── sources/
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  ArtifactSpec,
  ArtifactSection,
  ArtifactSectionsResponse,
  ArtifactBuildProgress,
  ArtifactBuildVersion,
} from "../../src/apps/codascope/codaScopeTypes.js";
import { getAnnotationScript } from "./codaScopeArtifactAnnotationScript.js";

/* ── Storage schemas ─────────────────────────────────────────────── */

interface ArtifactsIndex {
  artifacts: ArtifactSpec[];
}

interface SectionsManifest {
  sections: ArtifactSection[];
  contractVersion: number;
  hiddenSectionIds: string[];
}

/* ── Build progress tracking — see CodaScopeArtifactService.buildProgress */

/* ── HTML entity decoder for section title extraction ─────────────── */

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeArtifactService {
  private root: string;
  private buildProgress = new Map<string, ArtifactBuildProgress>();

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

  private artifactsDir(projectDir: string, epicId: string): string {
    return path.join(projectDir, "epics", epicId, "artifacts");
  }

  private indexPath(projectDir: string, epicId: string): string {
    return path.join(this.artifactsDir(projectDir, epicId), "artifacts.json");
  }

  private artifactDir(projectDir: string, epicId: string, artifactId: string): string {
    return path.join(this.artifactsDir(projectDir, epicId), artifactId);
  }

  private buildsDir(projectDir: string, epicId: string, artifactId: string): string {
    return path.join(this.artifactDir(projectDir, epicId, artifactId), "builds");
  }

  private indexHtmlPath(projectDir: string, epicId: string, artifactId: string): string {
    return path.join(this.buildsDir(projectDir, epicId, artifactId), "index.html");
  }

  private sectionsManifestPath(projectDir: string, epicId: string, artifactId: string): string {
    return path.join(this.buildsDir(projectDir, epicId, artifactId), ".artifact-sections.json");
  }

  private sectionFragmentsDir(projectDir: string, epicId: string, artifactId: string): string {
    return path.join(this.buildsDir(projectDir, epicId, artifactId), ".sections");
  }

  private versionsDir(projectDir: string, epicId: string, artifactId: string): string {
    return path.join(this.buildsDir(projectDir, epicId, artifactId), ".versions");
  }

  /* ── Index helpers ────────────────────────────────────────────────── */

  private readIndex(projectDir: string, epicId: string): ArtifactsIndex {
    const p = this.indexPath(projectDir, epicId);
    if (!existsSync(p)) return { artifacts: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { artifacts: [] };
    }
  }

  private writeIndex(projectDir: string, epicId: string, index: ArtifactsIndex): void {
    const dir = this.artifactsDir(projectDir, epicId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.indexPath(projectDir, epicId), JSON.stringify(index, null, 2), "utf-8");
  }

  /* ── Sections manifest helpers ─────────────────────────────────── */

  private readSectionsManifest(projectDir: string, epicId: string, artifactId: string): SectionsManifest {
    const p = this.sectionsManifestPath(projectDir, epicId, artifactId);
    if (!existsSync(p)) return { sections: [], contractVersion: 1, hiddenSectionIds: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { sections: [], contractVersion: 1, hiddenSectionIds: [] };
    }
  }

  private writeSectionsManifest(projectDir: string, epicId: string, artifactId: string, manifest: SectionsManifest): void {
    const dir = this.buildsDir(projectDir, epicId, artifactId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.sectionsManifestPath(projectDir, epicId, artifactId), JSON.stringify(manifest, null, 2), "utf-8");
  }

  /* ── Hash helpers ──────────────────────────────────────────────── */

  private computeHash(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
  }

  /* ── Build progress key ────────────────────────────────────────── */

  private buildKey(projectId: string, epicId: string, artifactId: string): string {
    return `${projectId}:${epicId}:${artifactId}`;
  }

  /* ── CRUD ─────────────────────────────────────────────────────────── */

  /** Create a new artifact spec. */
  async createArtifact(projectId: string, epicId: string, data: {
    title: string;
    body?: string;
    modelId?: string | null;
    sources?: string[];
    autoDiscoverContext?: boolean;
    createdBy?: string;
  }): Promise<ArtifactSpec> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    const now = new Date().toISOString();
    const id = `art_${crypto.randomBytes(6).toString("hex")}`;
    const body = data.body ?? "";

    const spec: ArtifactSpec = {
      id,
      epicId,
      title: data.title,
      body,
      modelId: data.modelId ?? null,
      sources: data.sources ?? [],
      autoDiscoverContext: data.autoDiscoverContext ?? true,
      lastBuilt: null,
      status: "draft",
      buildSpecHash: null,
      currentSpecHash: this.computeHash(body),
      createdAt: now,
      updatedAt: now,
      createdBy: data.createdBy ?? "user",
    };

    // Write spec.md with YAML frontmatter
    const artDir = this.artifactDir(projectDir, epicId, id);
    mkdirSync(artDir, { recursive: true });
    this.writeSpecFile(artDir, spec);

    // Update index
    const index = this.readIndex(projectDir, epicId);
    index.artifacts.push(spec);
    this.writeIndex(projectDir, epicId, index);

    return spec;
  }

  /** Get a single artifact spec. */
  async getArtifact(projectId: string, epicId: string, artifactId: string): Promise<ArtifactSpec | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const index = this.readIndex(projectDir, epicId);
    return index.artifacts.find((a) => a.id === artifactId) ?? null;
  }

  /** List all artifacts for an epic. */
  async listArtifacts(projectId: string, epicId: string): Promise<ArtifactSpec[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];

    const index = this.readIndex(projectDir, epicId);
    // Refresh currentSpecHash for staleness detection
    for (const spec of index.artifacts) {
      spec.currentSpecHash = this.computeHash(spec.body);
    }
    return index.artifacts;
  }

  /** Update an artifact spec. */
  async updateArtifact(projectId: string, epicId: string, artifactId: string, updates: {
    title?: string;
    body?: string;
    modelId?: string | null;
    sources?: string[];
    autoDiscoverContext?: boolean;
  }): Promise<ArtifactSpec | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const index = this.readIndex(projectDir, epicId);
    const spec = index.artifacts.find((a) => a.id === artifactId);
    if (!spec) return null;

    if (updates.title !== undefined) spec.title = updates.title;
    if (updates.body !== undefined) spec.body = updates.body;
    if (updates.modelId !== undefined) spec.modelId = updates.modelId;
    if (updates.sources !== undefined) spec.sources = updates.sources;
    if (updates.autoDiscoverContext !== undefined) spec.autoDiscoverContext = updates.autoDiscoverContext;

    spec.updatedAt = new Date().toISOString();
    spec.currentSpecHash = this.computeHash(spec.body);

    // Update staleness: if spec changed since last build, mark as stale
    if (spec.buildSpecHash && spec.currentSpecHash !== spec.buildSpecHash) {
      spec.status = "stale";
    }

    // Persist spec.md
    const artDir = this.artifactDir(projectDir, epicId, artifactId);
    if (existsSync(artDir)) {
      this.writeSpecFile(artDir, spec);
    }

    this.writeIndex(projectDir, epicId, index);
    return spec;
  }

  /** Delete an artifact spec and all associated files. */
  async deleteArtifact(projectId: string, epicId: string, artifactId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const index = this.readIndex(projectDir, epicId);
    const idx = index.artifacts.findIndex((a) => a.id === artifactId);
    if (idx < 0) return false;

    index.artifacts.splice(idx, 1);
    this.writeIndex(projectDir, epicId, index);

    // Remove artifact directory
    const artDir = this.artifactDir(projectDir, epicId, artifactId);
    if (existsSync(artDir)) {
      rmSync(artDir, { recursive: true, force: true });
    }

    return true;
  }

  /** Pin an artifact. */
  async pinArtifact(projectId: string, epicId: string, artifactId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const index = this.readIndex(projectDir, epicId);
    const spec = index.artifacts.find((a) => a.id === artifactId);
    if (!spec) return false;

    spec.pinnedAt = new Date().toISOString();
    this.writeIndex(projectDir, epicId, index);
    return true;
  }

  /** Unpin an artifact. */
  async unpinArtifact(projectId: string, epicId: string, artifactId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const index = this.readIndex(projectDir, epicId);
    const spec = index.artifacts.find((a) => a.id === artifactId);
    if (!spec || !spec.pinnedAt) return false;

    delete spec.pinnedAt;
    this.writeIndex(projectDir, epicId, index);
    return true;
  }

  /** Archive an artifact (soft delete). Also clears pin. */
  async archiveArtifact(projectId: string, epicId: string, artifactId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const index = this.readIndex(projectDir, epicId);
    const spec = index.artifacts.find((a) => a.id === artifactId);
    if (!spec) return false;

    spec.archivedAt = new Date().toISOString();
    delete spec.pinnedAt;
    this.writeIndex(projectDir, epicId, index);
    return true;
  }

  /** Unarchive an artifact (restore from soft delete). */
  async unarchiveArtifact(projectId: string, epicId: string, artifactId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const index = this.readIndex(projectDir, epicId);
    const spec = index.artifacts.find((a) => a.id === artifactId);
    if (!spec || !spec.archivedAt) return false;

    delete spec.archivedAt;
    this.writeIndex(projectDir, epicId, index);
    return true;
  }

  /* ── Spec file I/O ─────────────────────────────────────────────── */

  private writeSpecFile(artDir: string, spec: ArtifactSpec): void {
    const frontmatter = [
      "---",
      `title: "${spec.title.replace(/"/g, '\\"')}"`,
      `modelId: ${spec.modelId ? `"${spec.modelId}"` : "null"}`,
      `sources: ${JSON.stringify(spec.sources)}`,
      `autoDiscoverContext: ${spec.autoDiscoverContext}`,
      `createdAt: "${spec.createdAt}"`,
      `updatedAt: "${spec.updatedAt}"`,
      `createdBy: "${spec.createdBy}"`,
      "---",
    ].join("\n");
    writeFileSync(path.join(artDir, "spec.md"), `${frontmatter}\n\n${spec.body}`, "utf-8");
  }

  /* ── Build pipeline ────────────────────────────────────────────── */

  /**
   * Trigger an artifact build.
   * The agentCallback parameter is injected in Phase 2 — for now this method
   * throws if no callback is provided.
   */
  async buildArtifact(
    projectId: string,
    epicId: string,
    artifactId: string,
    _modelId?: string,
    agentCallback?: (spec: ArtifactSpec) => Promise<string>,
  ): Promise<void> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    const index = this.readIndex(projectDir, epicId);
    const spec = index.artifacts.find((a) => a.id === artifactId);
    if (!spec) throw new Error("Artifact not found");

    if (!agentCallback) {
      throw new Error("Agent service not configured");
    }

    const key = this.buildKey(projectId, epicId, artifactId);
    this.buildProgress.set(key, {
      artifactId,
      status: "building",
      startedAt: new Date().toISOString(),
    });

    try {
      // Invoke agent and get HTML output
      const html = await agentCallback(spec);

      // Ensure builds directory
      const buildsDirectory = this.buildsDir(projectDir, epicId, artifactId);
      if (!existsSync(buildsDirectory)) mkdirSync(buildsDirectory, { recursive: true });

      // Write index.html
      writeFileSync(this.indexHtmlPath(projectDir, epicId, artifactId), html, "utf-8");

      // Extract sections
      this.extractAndPersistSections(projectDir, epicId, artifactId, html);

      // Update spec status
      spec.lastBuilt = new Date().toISOString();
      spec.status = "built";
      spec.buildSpecHash = this.computeHash(spec.body);
      spec.currentSpecHash = spec.buildSpecHash;
      spec.updatedAt = spec.lastBuilt;
      this.writeIndex(projectDir, epicId, index);

      this.buildProgress.set(key, {
        artifactId,
        status: "complete",
        startedAt: this.buildProgress.get(key)?.startedAt,
      });
    } catch (err) {
      this.buildProgress.set(key, {
        artifactId,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        startedAt: this.buildProgress.get(key)?.startedAt,
      });
      throw err;
    }
  }

  /** Get the current build status for an artifact. */
  getBuildStatus(projectId: string, epicId: string, artifactId: string): ArtifactBuildProgress {
    const key = this.buildKey(projectId, epicId, artifactId);
    return this.buildProgress.get(key) ?? { artifactId, status: "idle" };
  }

  /** Update build progress externally (used by route handler during agent execution). */
  setBuildProgress(projectId: string, epicId: string, artifactId: string, progress: ArtifactBuildProgress): void {
    const key = this.buildKey(projectId, epicId, artifactId);
    this.buildProgress.set(key, progress);
  }

  /** Read the raw built HTML (without annotation script injection). */
  getBuiltHtml(projectId: string, epicId: string, artifactId: string): string | null {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;
    const htmlPath = this.indexHtmlPath(projectDir, epicId, artifactId);
    if (!existsSync(htmlPath)) return null;
    return readFileSync(htmlPath, "utf-8");
  }

  /**
   * Re-extract sections from updated HTML (public API for route handlers).
   * Accepts projectId and resolves the project directory internally.
   */
  reExtractSections(projectId: string, epicId: string, artifactId: string, html: string): void {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return;
    this.extractAndPersistSections(projectDir, epicId, artifactId, html);
  }

  /* ── Section extraction ────────────────────────────────────────── */

  /**
   * Discover sections in HTML using regex-based parsing.
   * Matches <section id="..." ...> and <section ... id="..." ...> patterns.
   * Expects flat (non-nested) sections per the build contract.
   */
  discoverSectionsFromHtml(html: string): ArtifactSection[] {
    const sections: ArtifactSection[] = [];
    const seenIds = new Set<string>();
    const regex = /<section\s[^>]*id="([^"]+)"[^>]*>/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) !== null) {
      const id = match[1];
      const startIdx = match.index;
      const openTag = match[0];

      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const sectionEnd = html.indexOf("</section>", startIdx);
      if (sectionEnd === -1) continue;

      // Guard: no nested <section> between this tag and its close
      const nextOpen = html.indexOf("<section ", startIdx + openTag.length);
      if (nextOpen !== -1 && nextOpen < sectionEnd) continue;

      // Extract heading for title
      const sectionContent = html.slice(startIdx, sectionEnd);
      const headingMatch = sectionContent.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
      const title = headingMatch
        ? decodeHtmlEntities(headingMatch[1].replace(/<[^>]+>/g, "").trim())
        : id;

      // Detect hidden sections
      const hidden = /data-hidden="true"/.test(openTag) || /display\s*:\s*none/.test(openTag);

      sections.push({ id, title, hidden });
    }

    return sections;
  }

  /** Extract sections from built HTML and persist to manifest + fragment files. */
  private extractAndPersistSections(projectDir: string, epicId: string, artifactId: string, html: string): void {
    const sections = this.discoverSectionsFromHtml(html);

    // Write section fragments
    const fragDir = this.sectionFragmentsDir(projectDir, epicId, artifactId);
    if (!existsSync(fragDir)) mkdirSync(fragDir, { recursive: true });

    for (const section of sections) {
      const fragment = this.extractSectionHtml(html, section.id);
      if (fragment) {
        writeFileSync(path.join(fragDir, `${section.id}.html`), fragment, "utf-8");
      }
    }

    // Write sections manifest
    const manifest: SectionsManifest = {
      sections,
      contractVersion: 1,
      hiddenSectionIds: sections.filter((s) => s.hidden).map((s) => s.id),
    };
    this.writeSectionsManifest(projectDir, epicId, artifactId, manifest);
  }

  /** Extract a single section's inner HTML from the full document. */
  private extractSectionHtml(html: string, sectionId: string): string | null {
    const escapedId = sectionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`<section\\s[^>]*id="${escapedId}"[^>]*>`);
    const match = regex.exec(html);
    if (!match) return null;

    const innerStart = match.index + match[0].length;
    const innerEnd = html.indexOf("</section>", innerStart);
    if (innerEnd === -1) return null;

    // Guard against nested sections
    const nextOpen = html.indexOf("<section ", innerStart);
    if (nextOpen !== -1 && nextOpen < innerEnd) return null;

    return html.slice(innerStart, innerEnd).trim();
  }

  /** List sections for an artifact (from manifest or by re-parsing HTML). */
  async extractSections(projectId: string, epicId: string, artifactId: string): Promise<ArtifactSectionsResponse> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return { sections: [], regeneratedSections: [], regenerationCount: 0, contractVersion: null, hiddenSectionIds: [] };

    // Try cached manifest first
    const manifest = this.readSectionsManifest(projectDir, epicId, artifactId);
    if (manifest.sections.length > 0) {
      return {
        sections: manifest.sections,
        regeneratedSections: [],
        regenerationCount: 0,
        contractVersion: manifest.contractVersion,
        hiddenSectionIds: manifest.hiddenSectionIds,
      };
    }

    // Re-parse from HTML
    const htmlPath = this.indexHtmlPath(projectDir, epicId, artifactId);
    if (!existsSync(htmlPath)) {
      return { sections: [], regeneratedSections: [], regenerationCount: 0, contractVersion: null, hiddenSectionIds: [] };
    }

    const html = readFileSync(htmlPath, "utf-8");
    this.extractAndPersistSections(projectDir, epicId, artifactId, html);

    const updatedManifest = this.readSectionsManifest(projectDir, epicId, artifactId);
    return {
      sections: updatedManifest.sections,
      regeneratedSections: [],
      regenerationCount: 0,
      contractVersion: updatedManifest.contractVersion,
      hiddenSectionIds: updatedManifest.hiddenSectionIds,
    };
  }

  /* ── Section management ────────────────────────────────────────── */

  /** Hide a section by adding data-hidden="true" and display:none. */
  async hideSection(projectId: string, epicId: string, artifactId: string, sectionId: string): Promise<ArtifactSectionsResponse> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    const manifest = this.readSectionsManifest(projectDir, epicId, artifactId);
    const section = manifest.sections.find((s) => s.id === sectionId);
    if (!section) throw new Error("Section not found");

    section.hidden = true;
    if (!manifest.hiddenSectionIds.includes(sectionId)) {
      manifest.hiddenSectionIds.push(sectionId);
    }

    this.writeSectionsManifest(projectDir, epicId, artifactId, manifest);
    await this.recomposeHtml(projectDir, epicId, artifactId);

    return {
      sections: manifest.sections,
      regeneratedSections: [],
      regenerationCount: 0,
      contractVersion: manifest.contractVersion,
      hiddenSectionIds: manifest.hiddenSectionIds,
    };
  }

  /** Unhide a section. */
  async unhideSection(projectId: string, epicId: string, artifactId: string, sectionId: string): Promise<ArtifactSectionsResponse> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    const manifest = this.readSectionsManifest(projectDir, epicId, artifactId);
    const section = manifest.sections.find((s) => s.id === sectionId);
    if (!section) throw new Error("Section not found");

    section.hidden = false;
    manifest.hiddenSectionIds = manifest.hiddenSectionIds.filter((id) => id !== sectionId);

    this.writeSectionsManifest(projectDir, epicId, artifactId, manifest);
    await this.recomposeHtml(projectDir, epicId, artifactId);

    return {
      sections: manifest.sections,
      regeneratedSections: [],
      regenerationCount: 0,
      contractVersion: manifest.contractVersion,
      hiddenSectionIds: manifest.hiddenSectionIds,
    };
  }

  /** Reorder sections and recompose HTML. */
  async reorderSections(projectId: string, epicId: string, artifactId: string, orderedSectionIds: string[]): Promise<ArtifactSectionsResponse> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    const manifest = this.readSectionsManifest(projectDir, epicId, artifactId);

    // Reorder sections to match the provided order
    const reordered: ArtifactSection[] = [];
    for (const id of orderedSectionIds) {
      const section = manifest.sections.find((s) => s.id === id);
      if (section) reordered.push(section);
    }
    // Append any sections not in the provided order (defensive)
    for (const section of manifest.sections) {
      if (!orderedSectionIds.includes(section.id)) {
        reordered.push(section);
      }
    }

    manifest.sections = reordered;
    this.writeSectionsManifest(projectDir, epicId, artifactId, manifest);
    await this.recomposeHtml(projectDir, epicId, artifactId);

    return {
      sections: manifest.sections,
      regeneratedSections: [],
      regenerationCount: 0,
      contractVersion: manifest.contractVersion,
      hiddenSectionIds: manifest.hiddenSectionIds,
    };
  }

  /**
   * Recompose index.html from section fragments in manifest order.
   * Reads the current HTML, extracts the header/footer (everything before first
   * section and after last section), then reassembles sections in manifest order.
   */
  async recomposeHtml(projectDir: string, epicId: string, artifactId: string): Promise<void> {
    const htmlPath = this.indexHtmlPath(projectDir, epicId, artifactId);
    if (!existsSync(htmlPath)) return;

    const html = readFileSync(htmlPath, "utf-8");
    const manifest = this.readSectionsManifest(projectDir, epicId, artifactId);
    if (manifest.sections.length === 0) return;

    // Find boundaries: everything before the first section and after the last section
    const discoveredSections = this.discoverRawSections(html);
    if (discoveredSections.length === 0) return;

    const firstStart = discoveredSections[0].outerStart;
    const lastEnd = discoveredSections[discoveredSections.length - 1].outerEnd;

    const header = html.slice(0, firstStart);
    const footer = html.slice(lastEnd);

    // Build section HTML map from the original HTML
    const sectionHtmlMap = new Map<string, string>();
    for (const raw of discoveredSections) {
      sectionHtmlMap.set(raw.id, raw.outerHtml);
    }

    // Reassemble in manifest order, applying hidden state
    const reassembled: string[] = [];
    for (const section of manifest.sections) {
      let sectionHtml = sectionHtmlMap.get(section.id);
      if (!sectionHtml) continue;

      if (section.hidden) {
        // Add data-hidden and display:none
        if (!sectionHtml.includes('data-hidden="true"')) {
          sectionHtml = sectionHtml.replace(/<section(\s)/, '<section data-hidden="true" style="display:none"$1');
        }
      } else {
        // Remove data-hidden and display:none if present
        sectionHtml = sectionHtml.replace(/\s*data-hidden="true"/g, "");
        sectionHtml = sectionHtml.replace(/\s*style="display:none"/g, "");
      }

      reassembled.push(sectionHtml);
    }

    const newHtml = header + reassembled.join("\n") + footer;
    writeFileSync(htmlPath, newHtml, "utf-8");
  }

  /**
   * Discover raw sections with their outer HTML and positions.
   * Internal helper for recompose operations.
   */
  private discoverRawSections(html: string): Array<{ id: string; outerStart: number; outerEnd: number; outerHtml: string }> {
    const sections: Array<{ id: string; outerStart: number; outerEnd: number; outerHtml: string }> = [];
    const seenIds = new Set<string>();
    const regex = /<section\s[^>]*id="([^"]+)"[^>]*>/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) !== null) {
      const id = match[1];
      const startIdx = match.index;
      const openTag = match[0];

      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const sectionEnd = html.indexOf("</section>", startIdx);
      if (sectionEnd === -1) continue;

      const nextOpen = html.indexOf("<section ", startIdx + openTag.length);
      if (nextOpen !== -1 && nextOpen < sectionEnd) continue;

      const outerEnd = sectionEnd + "</section>".length;
      sections.push({
        id,
        outerStart: startIdx,
        outerEnd,
        outerHtml: html.slice(startIdx, outerEnd),
      });
    }

    return sections;
  }

  /* ── Preview ───────────────────────────────────────────────────── */

  /** Get preview HTML with annotation script injected. */
  async getPreviewHtml(projectId: string, epicId: string, artifactId: string): Promise<string | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const htmlPath = this.indexHtmlPath(projectDir, epicId, artifactId);
    if (!existsSync(htmlPath)) return null;

    let html = readFileSync(htmlPath, "utf-8");

    // Inject annotation script before </body> or at the end
    const annotationScript = getAnnotationScript();
    const bodyCloseIdx = html.lastIndexOf("</body>");
    if (bodyCloseIdx !== -1) {
      html = html.slice(0, bodyCloseIdx) + annotationScript + "\n" + html.slice(bodyCloseIdx);
    } else {
      html += "\n" + annotationScript;
    }

    return html;
  }

  /** Get the filesystem path to the preview HTML file. */
  getPreviewPath(projectId: string, epicId: string, artifactId: string): string | null {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;
    return this.indexHtmlPath(projectDir, epicId, artifactId);
  }

  /* ── Spec hash helpers ─────────────────────────────────────────── */

  /** Check if an artifact's spec has changed since last build. */
  isStale(spec: ArtifactSpec): boolean {
    if (!spec.buildSpecHash) return false;
    return spec.currentSpecHash !== spec.buildSpecHash;
  }
}
