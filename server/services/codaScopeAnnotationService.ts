/* ── CodaScope: Annotation & Directive Service ───────────────────────
   Block-level annotations and insertion directives for epic documents.

   Responsibilities:
   - Annotation CRUD (create, list, update, delete) with block-level anchoring
   - Thread management (replies via parentId, resolve/reopen)
   - Block ID computation (deterministic from markdown content)
   - Anchor repair (fuzzy re-match when document changes)
   - Insertion directive management (create, execute, apply, undo)

   Storage layout:
   <epicId>/annotations/<documentId>-annotations.json
   <epicId>/directives/<documentId>-directives.json
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  Annotation,
  AnnotationStatus,
  InsertionDirective,
  DirectiveType,
  DirectiveStatus,
  BlockInfo,
  BlockAnchor,
} from "../../src/apps/codascope/codaScopeTypes.js";

/* ── Storage schemas ─────────────────────────────────────────────── */

interface AnnotationsFile {
  annotations: Annotation[];
}

interface DirectivesFile {
  directives: InsertionDirective[];
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeAnnotationService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path helpers ──────────────────────────────────────────────── */

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

  private annotationsDir(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "annotations");
  }

  private annotationsPath(projectDir: string, epicId: string, documentId: string): string {
    return path.join(this.annotationsDir(projectDir, epicId), `${documentId}-annotations.json`);
  }

  private directivesDir(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "directives");
  }

  private directivesPath(projectDir: string, epicId: string, documentId: string): string {
    return path.join(this.directivesDir(projectDir, epicId), `${documentId}-directives.json`);
  }

  /* ── File I/O helpers ──────────────────────────────────────────── */

  private readAnnotations(projectDir: string, epicId: string, documentId: string): AnnotationsFile {
    const p = this.annotationsPath(projectDir, epicId, documentId);
    if (!existsSync(p)) return { annotations: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { annotations: [] };
    }
  }

  private writeAnnotations(projectDir: string, epicId: string, documentId: string, data: AnnotationsFile): void {
    const dir = this.annotationsDir(projectDir, epicId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.annotationsPath(projectDir, epicId, documentId), JSON.stringify(data, null, 2), "utf-8");
  }

  private readDirectives(projectDir: string, epicId: string, documentId: string): DirectivesFile {
    const p = this.directivesPath(projectDir, epicId, documentId);
    if (!existsSync(p)) return { directives: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { directives: [] };
    }
  }

  private writeDirectives(projectDir: string, epicId: string, documentId: string, data: DirectivesFile): void {
    const dir = this.directivesDir(projectDir, epicId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.directivesPath(projectDir, epicId, documentId), JSON.stringify(data, null, 2), "utf-8");
  }

  /* ── Block ID Computation ──────────────────────────────────────── */

  /**
   * Parse markdown into blocks with deterministic IDs.
   *
   * Algorithm:
   * 1. Split by headings → sections
   * 2. Within each section, identify blocks (paragraphs, code fences, lists)
   * 3. Each block → blk_<sectionSlug>_<indexInSection>_<hash4>
   */
  computeBlockIds(markdown: string): BlockInfo[] {
    if (!markdown.trim()) return [];

    const lines = markdown.split("\n");
    const blocks: BlockInfo[] = [];
    let currentSection = "root";
    let indexInSection = 0;
    let blockStart = 0;
    let blockLines: string[] = [];
    let inCodeFence = false;

    const flushBlock = (endLine: number) => {
      const content = blockLines.join("\n").trim();
      if (!content) {
        blockLines = [];
        return;
      }

      const hash = crypto.createHash("md5").update(content).digest("hex").slice(0, 4);
      const blockId = `blk_${currentSection}_${indexInSection}_${hash}`;

      blocks.push({
        blockId,
        sectionSlug: currentSection,
        lineStart: blockStart + 1, // 1-indexed
        lineEnd: endLine + 1,      // 1-indexed
        content,
      });

      indexInSection++;
      blockLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track code fences
      if (line.trimStart().startsWith("```")) {
        if (inCodeFence) {
          // End of code fence — include this line in the block
          blockLines.push(line);
          inCodeFence = false;
          flushBlock(i);
          blockStart = i + 1;
          continue;
        } else {
          // Start of code fence — flush any accumulated text first
          if (blockLines.length > 0) flushBlock(i - 1);
          blockStart = i;
          blockLines = [line];
          inCodeFence = true;
          continue;
        }
      }

      if (inCodeFence) {
        blockLines.push(line);
        continue;
      }

      // Heading detection
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        // Flush previous block
        if (blockLines.length > 0) flushBlock(i - 1);

        // Update section context
        currentSection = slugify(headingMatch[2]);
        indexInSection = 0;

        // The heading itself is a block
        blockStart = i;
        blockLines = [line];
        flushBlock(i);
        blockStart = i + 1;
        continue;
      }

      // Blank line — potential block separator
      if (line.trim() === "") {
        if (blockLines.length > 0) {
          flushBlock(i - 1);
          blockStart = i + 1;
        } else {
          blockStart = i + 1;
        }
        continue;
      }

      // Accumulate content
      if (blockLines.length === 0) blockStart = i;
      blockLines.push(line);
    }

    // Flush remaining block
    if (blockLines.length > 0) flushBlock(lines.length - 1);

    return blocks;
  }

  /* ── Anchor Repair (fuzzy re-anchoring) ────────────────────────── */

  /**
   * Try to find the best matching block for an annotation's anchor.
   * Falls back to fuzzy text matching when blockId doesn't match.
   */
  private resolveAnchor(anchor: BlockAnchor, blocks: BlockInfo[]): BlockInfo | null {
    // Exact match by blockId
    const exact = blocks.find((b) => b.blockId === anchor.blockId);
    if (exact) return exact;

    // Fuzzy match by anchorText
    if (anchor.anchorText) {
      const normalizedAnchor = anchor.anchorText.toLowerCase().trim();

      // Find block containing the anchor text
      let bestMatch: BlockInfo | null = null;
      let bestScore = 0;

      for (const block of blocks) {
        const normalizedContent = block.content.toLowerCase();
        if (normalizedContent.includes(normalizedAnchor)) {
          // Prefer blocks in the same section
          const sectionMatch = block.sectionSlug === anchor.sectionSlug ? 2 : 0;
          // Prefer shorter blocks (more precise match)
          const precision = 1 / (block.content.length + 1);
          const score = sectionMatch + precision;

          if (score > bestScore) {
            bestScore = score;
            bestMatch = block;
          }
        }
      }

      if (bestMatch) return bestMatch;
    }

    // Fallback: nearest line number match within the same section
    const sameSection = blocks.filter((b) => b.sectionSlug === anchor.sectionSlug);
    if (sameSection.length > 0) {
      let nearest = sameSection[0];
      let nearestDist = Math.abs(nearest.lineStart - anchor.lineNumber);
      for (const b of sameSection) {
        const dist = Math.abs(b.lineStart - anchor.lineNumber);
        if (dist < nearestDist) {
          nearest = b;
          nearestDist = dist;
        }
      }
      return nearest;
    }

    return null;
  }

  /* ── Annotation CRUD ───────────────────────────────────────────── */

  /** List all annotations for a document, with re-anchored block IDs. */
  async listAnnotations(
    projectId: string,
    epicId: string,
    documentId: string,
    documentContent?: string,
  ): Promise<Annotation[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];

    const file = this.readAnnotations(projectDir, epicId, documentId);
    if (!documentContent) return file.annotations;

    // Re-anchor: resolve each annotation's block against current document
    const blocks = this.computeBlockIds(documentContent);
    return file.annotations.map((ann) => {
      const resolved = this.resolveAnchor(ann.anchor, blocks);
      if (resolved && resolved.blockId !== ann.anchor.blockId) {
        return {
          ...ann,
          anchor: {
            ...ann.anchor,
            blockId: resolved.blockId,
            sectionSlug: resolved.sectionSlug,
            lineNumber: resolved.lineStart,
          },
        };
      }
      return ann;
    });
  }

  /** Create a new annotation. */
  async createAnnotation(
    projectId: string,
    epicId: string,
    documentId: string,
    data: {
      anchor: BlockAnchor;
      author: string;
      body: string;
      parentId?: string;
      documentVersion?: number;
    },
  ): Promise<Annotation> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    const id = `ann_${crypto.randomBytes(6).toString("hex")}`;
    const annotation: Annotation = {
      id,
      epicId,
      documentId,
      documentVersion: data.documentVersion ?? 0,
      anchor: data.anchor,
      author: data.author,
      createdAt: new Date().toISOString(),
      body: data.body,
      parentId: data.parentId,
      status: "open",
      reactions: [],
    };

    const file = this.readAnnotations(projectDir, epicId, documentId);
    file.annotations.push(annotation);
    this.writeAnnotations(projectDir, epicId, documentId, file);

    return annotation;
  }

  /** Update an annotation (status, body, reactions). */
  async updateAnnotation(
    projectId: string,
    epicId: string,
    annotationId: string,
    changes: {
      status?: AnnotationStatus;
      body?: string;
      reactions?: Array<{ emoji: string; user: string }>;
    },
  ): Promise<Annotation | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    // Search all annotation files for this epic
    const annDir = this.annotationsDir(projectDir, epicId);
    if (!existsSync(annDir)) return null;

    const files = readdirSync(annDir).filter((f) => f.endsWith("-annotations.json"));

    for (const filename of files) {
      const docId = filename.replace("-annotations.json", "");
      const file = this.readAnnotations(projectDir, epicId, docId);
      const idx = file.annotations.findIndex((a) => a.id === annotationId);

      if (idx >= 0) {
        const ann = file.annotations[idx];
        if (changes.status !== undefined) ann.status = changes.status;
        if (changes.body !== undefined) ann.body = changes.body;
        if (changes.reactions !== undefined) ann.reactions = changes.reactions;

        // If resolving a parent, also resolve all replies
        if (changes.status === "resolved" && !ann.parentId) {
          for (const reply of file.annotations) {
            if (reply.parentId === annotationId) {
              reply.status = "resolved";
            }
          }
        }

        file.annotations[idx] = ann;
        this.writeAnnotations(projectDir, epicId, docId, file);
        return ann;
      }
    }

    return null;
  }

  /** Delete an annotation (and its replies). */
  async deleteAnnotation(
    projectId: string,
    epicId: string,
    annotationId: string,
  ): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const annDir = this.annotationsDir(projectDir, epicId);
    if (!existsSync(annDir)) return false;

    const files = readdirSync(annDir).filter((f) => f.endsWith("-annotations.json"));

    for (const filename of files) {
      const docId = filename.replace("-annotations.json", "");
      const file = this.readAnnotations(projectDir, epicId, docId);
      const targetIdx = file.annotations.findIndex((a) => a.id === annotationId);

      if (targetIdx >= 0) {
        // Remove the annotation and all its replies
        const idsToRemove = new Set([annotationId]);
        // Recursively find all replies
        let found = true;
        while (found) {
          found = false;
          for (const ann of file.annotations) {
            if (ann.parentId && idsToRemove.has(ann.parentId) && !idsToRemove.has(ann.id)) {
              idsToRemove.add(ann.id);
              found = true;
            }
          }
        }

        file.annotations = file.annotations.filter((a) => !idsToRemove.has(a.id));
        this.writeAnnotations(projectDir, epicId, docId, file);
        return true;
      }
    }

    return false;
  }

  /** Count open annotations across all documents for an epic. */
  async getOpenAnnotationCount(projectId: string, epicId: string): Promise<number> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return 0;

    const annDir = this.annotationsDir(projectDir, epicId);
    if (!existsSync(annDir)) return 0;

    let count = 0;
    const files = readdirSync(annDir).filter((f) => f.endsWith("-annotations.json"));

    for (const filename of files) {
      const docId = filename.replace("-annotations.json", "");
      const file = this.readAnnotations(projectDir, epicId, docId);
      // Count top-level open annotations (not replies)
      count += file.annotations.filter((a) => a.status === "open" && !a.parentId).length;
    }

    return count;
  }

  /* ── Directive CRUD ────────────────────────────────────────────── */

  /** List all directives for a document. */
  async listDirectives(
    projectId: string,
    epicId: string,
    documentId: string,
  ): Promise<InsertionDirective[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];
    return this.readDirectives(projectDir, epicId, documentId).directives;
  }

  /** Create a new directive. */
  async createDirective(
    projectId: string,
    epicId: string,
    documentId: string,
    data: {
      type: DirectiveType;
      afterLine: number;
      startLine?: number;
      endLine?: number;
      blockId?: string;
      anchorText?: string;
      instruction: string;
      author: string;
    },
  ): Promise<InsertionDirective> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    const id = `dir_${crypto.randomBytes(6).toString("hex")}`;
    const directive: InsertionDirective = {
      id,
      epicId,
      documentId,
      type: data.type,
      afterLine: data.afterLine,
      startLine: data.startLine,
      endLine: data.endLine,
      blockId: data.blockId,
      anchorText: data.anchorText,
      instruction: data.instruction,
      author: data.author,
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    const file = this.readDirectives(projectDir, epicId, documentId);
    file.directives.push(directive);
    this.writeDirectives(projectDir, epicId, documentId, file);

    return directive;
  }

  /** Update a directive (status, generatedContent, etc). */
  async updateDirective(
    projectId: string,
    epicId: string,
    directiveId: string,
    documentId: string,
    changes: Partial<InsertionDirective>,
  ): Promise<InsertionDirective | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const file = this.readDirectives(projectDir, epicId, documentId);
    const idx = file.directives.findIndex((d) => d.id === directiveId);
    if (idx < 0) return null;

    const directive = file.directives[idx];
    Object.assign(directive, changes);
    file.directives[idx] = directive;
    this.writeDirectives(projectDir, epicId, documentId, file);

    return directive;
  }

  /** Delete a directive. */
  async deleteDirective(
    projectId: string,
    epicId: string,
    directiveId: string,
    documentId: string,
  ): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const file = this.readDirectives(projectDir, epicId, documentId);
    const before = file.directives.length;
    file.directives = file.directives.filter((d) => d.id !== directiveId);
    if (file.directives.length === before) return false;

    this.writeDirectives(projectDir, epicId, documentId, file);
    return true;
  }

  /**
   * Apply a directive's generated content to the document.
   * Stores a pre-apply snapshot for undo support.
   * Returns the updated document content.
   */
  async applyDirective(
    projectId: string,
    epicId: string,
    documentId: string,
    directiveId: string,
    getDocContent: () => Promise<string>,
    setDocContent: (content: string) => Promise<void>,
  ): Promise<{ directive: InsertionDirective; newContent: string } | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const file = this.readDirectives(projectDir, epicId, documentId);
    const directive = file.directives.find((d) => d.id === directiveId);
    if (!directive || !directive.generatedContent) return null;

    const currentContent = await getDocContent();
    const lines = currentContent.split("\n");
    const generated = directive.generatedContent;

    let newContent: string;

    if (directive.type === "insert") {
      // Insert after the specified line
      const insertAt = Math.min(directive.afterLine, lines.length);
      lines.splice(insertAt, 0, generated);
      newContent = lines.join("\n");
    } else if (directive.type === "replace" && directive.startLine !== undefined && directive.endLine !== undefined) {
      // Replace the line range
      const start = Math.max(0, directive.startLine - 1); // 1-indexed → 0-indexed
      const end = Math.min(lines.length, directive.endLine);
      lines.splice(start, end - start, generated);
      newContent = lines.join("\n");
    } else if (directive.type === "expand" && directive.startLine !== undefined && directive.endLine !== undefined) {
      // Expand: replace the range with expanded content
      const start = Math.max(0, directive.startLine - 1);
      const end = Math.min(lines.length, directive.endLine);
      lines.splice(start, end - start, generated);
      newContent = lines.join("\n");
    } else {
      return null;
    }

    // Store snapshot and update
    directive.preApplySnapshot = currentContent;
    directive.status = "applied";
    directive.appliedAt = new Date().toISOString();

    // Adjust other directives' line numbers for the shift
    const generatedLineCount = generated.split("\n").length;
    let shift: number;
    if (directive.type === "insert") {
      shift = generatedLineCount;
    } else {
      const originalLineCount = (directive.endLine ?? directive.afterLine) - (directive.startLine ?? directive.afterLine) + 1;
      shift = generatedLineCount - originalLineCount;
    }

    if (shift !== 0) {
      const affectAfterLine = directive.type === "insert" ? directive.afterLine : (directive.startLine ?? directive.afterLine);
      for (const other of file.directives) {
        if (other.id === directiveId) continue;
        if (other.status === "applied") continue; // don't adjust already-applied
        if (other.afterLine > affectAfterLine) other.afterLine += shift;
        if (other.startLine !== undefined && other.startLine > affectAfterLine) other.startLine += shift;
        if (other.endLine !== undefined && other.endLine > affectAfterLine) other.endLine += shift;
      }
    }

    this.writeDirectives(projectDir, epicId, documentId, file);
    await setDocContent(newContent);

    return { directive, newContent };
  }

  /**
   * Undo an applied directive by restoring from pre-apply snapshot.
   */
  async undoDirective(
    projectId: string,
    epicId: string,
    documentId: string,
    directiveId: string,
    setDocContent: (content: string) => Promise<void>,
  ): Promise<InsertionDirective | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const file = this.readDirectives(projectDir, epicId, documentId);
    const directive = file.directives.find((d) => d.id === directiveId);
    if (!directive || directive.status !== "applied" || !directive.preApplySnapshot) return null;

    // Restore the document
    await setDocContent(directive.preApplySnapshot);

    // Reset directive state
    directive.status = "pending";
    directive.preApplySnapshot = undefined;
    directive.appliedAt = undefined;
    // Keep generatedContent so user can re-apply if desired

    this.writeDirectives(projectDir, epicId, documentId, file);

    return directive;
  }

  /**
   * Reject a directive — clear generated content, reset to pending.
   */
  async rejectDirective(
    projectId: string,
    epicId: string,
    documentId: string,
    directiveId: string,
  ): Promise<InsertionDirective | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const file = this.readDirectives(projectDir, epicId, documentId);
    const directive = file.directives.find((d) => d.id === directiveId);
    if (!directive) return null;

    directive.status = "pending";
    directive.generatedContent = undefined;

    this.writeDirectives(projectDir, epicId, documentId, file);
    return directive;
  }
}

/* ── Helpers ──────────────────────────────────────────────────────── */

/** Convert heading text to a URL-safe slug. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "root";
}
