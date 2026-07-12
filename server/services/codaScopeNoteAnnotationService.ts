/* ── CodaScope: Note Annotation Service ──────────────────────────────
   Block-level annotations for notes (at any level).

   Responsibilities:
   - Annotation CRUD (create, list, update, delete) with block-level anchoring
   - Thread management (replies via parentId, resolve/reopen)
   - Block ID computation (deterministic from markdown content)
   - Anchor repair (fuzzy re-match when note content changes)

   Storage layout:
   <notesDir>/_annotations/<note-basename>-annotations.json

   Follows pattern of codaScopeAnnotationService.ts, adapted for the
   note path-resolution model (level + opts + path) instead of
   (projectId + epicId + documentId).
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  Annotation,
  AnnotationStatus,
  BlockInfo,
  BlockAnchor,
} from "../../src/apps/codascope/codaScopeTypes.js";
import type { NoteScope, NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";
import type { CodaScopeNoteService, NoteResolveOpts } from "./codaScopeNoteService.js";

/* ── Storage schema ──────────────────────────────────────────────── */

interface NoteAnnotationsFile {
  annotations: NoteAnnotation[];
}

/**
 * A note annotation extends the base Annotation with note-specific
 * context fields instead of epicId/documentId.
 */
export interface NoteAnnotation extends Omit<Annotation, "epicId" | "documentId" | "documentVersion"> {
  /** Note scope where this annotation lives */
  noteScope: NoteScope;
  /** Note visibility */
  noteVisibility: NoteVisibility;
  /** Note path (relative within the notes dir, e.g. "meeting-notes/standup.md") */
  notePath: string;
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeNoteAnnotationService {
  private noteSvc: CodaScopeNoteService;

  constructor(noteSvc: CodaScopeNoteService) {
    this.noteSvc = noteSvc;
  }

  setNoteService(noteSvc: CodaScopeNoteService): void {
    this.noteSvc = noteSvc;
  }

  /* ── Path helpers ──────────────────────────────────────────────── */

  private annotationsDir(notesDir: string): string {
    return path.join(notesDir, "_annotations");
  }

  private annotationsPath(notesDir: string, notePath: string): string {
    // Derive a safe filename from the note path
    const basename = this.noteBasename(notePath);
    return path.join(this.annotationsDir(notesDir), `${basename}-annotations.json`);
  }

  /** Derive a filesystem-safe basename from a note path. */
  private noteBasename(notePath: string): string {
    // "meeting-notes/standup.md" → "meeting-notes--standup"
    const withoutExt = notePath.replace(/\.md$/i, "");
    return withoutExt.replace(/\//g, "--");
  }

  /* ── File I/O helpers ──────────────────────────────────────────── */

  private readAnnotations(notesDir: string, notePath: string): NoteAnnotationsFile {
    const p = this.annotationsPath(notesDir, notePath);
    if (!existsSync(p)) return { annotations: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { annotations: [] };
    }
  }

  private writeAnnotations(notesDir: string, notePath: string, data: NoteAnnotationsFile): void {
    const dir = this.annotationsDir(notesDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      this.annotationsPath(notesDir, notePath),
      JSON.stringify(data, null, 2),
      "utf-8",
    );
  }

  /* ── Block ID Computation ──────────────────────────────────────── */

  /**
   * Parse markdown into blocks with deterministic IDs.
   * Same algorithm as CodaScopeAnnotationService.computeBlockIds.
   */
  computeBlocks(markdown: string): BlockInfo[] {
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
          blockLines.push(line);
          inCodeFence = false;
          flushBlock(i);
          blockStart = i + 1;
          continue;
        } else {
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
        if (blockLines.length > 0) flushBlock(i - 1);
        currentSection = slugify(headingMatch[2]);
        indexInSection = 0;
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

      if (blockLines.length === 0) blockStart = i;
      blockLines.push(line);
    }

    if (blockLines.length > 0) flushBlock(lines.length - 1);

    return blocks;
  }

  /* ── Anchor Repair ────────────────────────────────────────────── */

  private resolveAnchor(anchor: BlockAnchor, blocks: BlockInfo[]): BlockInfo | null {
    // Exact match by blockId
    const exact = blocks.find((b) => b.blockId === anchor.blockId);
    if (exact) return exact;

    // Fuzzy match by anchorText
    if (anchor.anchorText) {
      const normalizedAnchor = anchor.anchorText.toLowerCase().trim();
      let bestMatch: BlockInfo | null = null;
      let bestScore = 0;

      for (const block of blocks) {
        const normalizedContent = block.content.toLowerCase();
        if (normalizedContent.includes(normalizedAnchor)) {
          const sectionMatch = block.sectionSlug === anchor.sectionSlug ? 2 : 0;
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

    // Fallback: nearest line number in same section
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

  /** List all annotations for a note, with re-anchored block IDs. */
  async listAnnotations(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    noteContent?: string,
  ): Promise<NoteAnnotation[]> {
    const notesDir = this.noteSvc.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return [];

    const file = this.readAnnotations(notesDir, notePath);
    if (!noteContent) return file.annotations;

    // Re-anchor against current content
    const blocks = this.computeBlocks(noteContent);
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

  /** Create a new annotation on a note. */
  async createAnnotation(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    data: {
      anchor: BlockAnchor;
      author: string;
      body: string;
      parentId?: string;
    },
  ): Promise<NoteAnnotation> {
    const notesDir = this.noteSvc.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) throw new Error("Cannot resolve notes directory");

    const id = `nann_${crypto.randomBytes(6).toString("hex")}`;
    const annotation: NoteAnnotation = {
      id,
      noteScope: scope,
      noteVisibility: visibility,
      notePath,
      anchor: data.anchor,
      author: data.author,
      createdAt: new Date().toISOString(),
      body: data.body,
      parentId: data.parentId,
      status: "open",
      reactions: [],
    };

    const file = this.readAnnotations(notesDir, notePath);
    file.annotations.push(annotation);
    this.writeAnnotations(notesDir, notePath, file);

    return annotation;
  }

  /** Update an annotation (status, body, reactions). */
  async updateAnnotation(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    annotationId: string,
    changes: {
      status?: AnnotationStatus;
      body?: string;
      reactions?: Array<{ emoji: string; user: string }>;
    },
  ): Promise<NoteAnnotation | null> {
    const notesDir = this.noteSvc.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return null;

    const file = this.readAnnotations(notesDir, notePath);
    const idx = file.annotations.findIndex((a) => a.id === annotationId);
    if (idx < 0) return null;

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
    this.writeAnnotations(notesDir, notePath, file);
    return ann;
  }

  /** Delete an annotation (and its replies). */
  async deleteAnnotation(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    annotationId: string,
  ): Promise<boolean> {
    const notesDir = this.noteSvc.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return false;

    const file = this.readAnnotations(notesDir, notePath);
    const targetIdx = file.annotations.findIndex((a) => a.id === annotationId);
    if (targetIdx < 0) return false;

    // Remove annotation + all replies (recursive)
    const idsToRemove = new Set([annotationId]);
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
    this.writeAnnotations(notesDir, notePath, file);
    return true;
  }

  /** Count open annotations for a note. */
  async getOpenAnnotationCount(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): Promise<number> {
    const notesDir = this.noteSvc.resolveNotesDir(scope, visibility, opts);
    if (!notesDir) return 0;

    const file = this.readAnnotations(notesDir, notePath);
    return file.annotations.filter((a) => a.status === "open" && !a.parentId).length;
  }
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "root";
}
