/* ── CodaScope: Note Annotation Service ──────────────────────────────
   Thread persistence and coordinated marker-aware note mutations.

   Placement authority is the paired HTML-comment marker in Markdown. The
   sidecar stores thread data and recovery context, never a line-based pin.
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  AnnotationAttachmentState,
  AnnotationStatus,
  BlockAnchor,
  BlockInfo,
  InlineAnnotationAnchor,
  NoteScope,
  NoteVisibility,
} from "../../src/apps/codascope/codaScopeTypes.js";
import type { CodaScopeNoteService, NoteConflictResult, NoteResolveOpts } from "./codaScopeNoteService.js";
import {
  annotationContext,
  findExactTextOccurrences,
  insertInlineAnnotationAnchors,
  parseInlineAnnotationAnchors,
  removeInlineAnnotationAnchors,
  type InlineAnnotationRange,
} from "./codaScopeNoteAnnotationAnchorService.js";

interface NoteAnnotationsFile {
  annotations: NoteAnnotation[];
}

export interface NoteAnnotation {
  id: string;
  noteScope: NoteScope;
  noteVisibility: NoteVisibility;
  notePath: string;
  /** Inline anchors are authoritative. A BlockAnchor is migration-only input. */
  anchor: InlineAnnotationAnchor | BlockAnchor;
  legacyAnchor?: BlockAnchor;
  author: string;
  createdAt: string;
  body: string;
  parentId?: string;
  status: AnnotationStatus;
  reactions: Array<{ emoji: string; user: string }>;
  archivedAt?: string;
  archivedBy?: string;
}

export interface AnnotationRenderTarget extends InlineAnnotationRange {
  annotationId: string;
  count: number;
  hasOpen: boolean;
}

export interface AnnotationMarkerRange {
  from: number;
  to: number;
}

export interface AnnotationMutationResult {
  annotation: NoteAnnotation;
  content: string;
  contentHash: string;
}

export type AnnotationMutationOutcome = AnnotationMutationResult | NoteConflictResult;

export class CodaScopeNoteAnnotationService {
  constructor(private noteSvc: CodaScopeNoteService) {}

  setNoteService(noteSvc: CodaScopeNoteService): void {
    this.noteSvc = noteSvc;
  }

  /* ── Sidecar I/O ───────────────────────────────────────────────── */

  private annotationPath(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): string {
    const bundle = this.noteSvc.resolveNoteFileBundle(scope, visibility, opts, notePath);
    if (!bundle) throw new Error("Cannot resolve note annotation storage.");
    return bundle.annotationFile;
  }

  private readAnnotations(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): NoteAnnotationsFile {
    const filePath = this.annotationPath(scope, visibility, opts, notePath);
    if (!existsSync(filePath)) return { annotations: [] };
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
      return Array.isArray(parsed?.annotations) ? parsed as NoteAnnotationsFile : { annotations: [] };
    } catch {
      return { annotations: [] };
    }
  }

  private writeAnnotations(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    data: NoteAnnotationsFile,
  ): void {
    const physical = this.annotationPath(scope, visibility, opts, notePath);
    const dir = path.dirname(physical);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const temporary = `${physical}.tmp.${crypto.randomUUID()}`;
    writeFileSync(temporary, JSON.stringify(data, null, 2), "utf-8");
    renameSync(temporary, physical);
  }

  /* ── Reconciliation ────────────────────────────────────────────── */

  /**
   * Reconcile marker validity after an ordinary note-body write. This never
   * uses quote matching to move a pin; it only updates attachment state.
   */
  async reconcileAfterNoteWrite(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): Promise<NoteAnnotation[]> {
    return this.reconcileNote(scope, visibility, opts, notePath, false);
  }

  /**
   * Reconcile one note. On read, legacy anchors are evaluated once for a
   * provably unique in-section match; anything less becomes needs_review.
   */
  async reconcileNote(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    migrateLegacy = false,
  ): Promise<NoteAnnotation[]> {
    if (migrateLegacy) await this.migrateLegacyAnchors(scope, visibility, opts, notePath);

    const note = await this.noteSvc.readNote(scope, visibility, opts, notePath);
    if (!note) return [];
    const file = this.readAnnotations(scope, visibility, opts, notePath);
    const body = this.noteSvc.parseFrontmatter(note.content).body;
    const locationChanged = this.deriveAnnotationLocations(file.annotations, scope, visibility, notePath);
    const reconciliationChanged = this.applyReconciliation(file.annotations, body, note.contentHash);
    if (locationChanged || reconciliationChanged) this.writeAnnotations(scope, visibility, opts, notePath, file);
    return file.annotations;
  }

  private applyReconciliation(annotations: NoteAnnotation[], body: string, contentHash: string): boolean {
    const parsed = parseInlineAnnotationAnchors(body);
    let changed = false;
    const now = new Date().toISOString();

    for (const annotation of annotations) {
      if (annotation.parentId || annotation.archivedAt) continue;
      if (!isInlineAnchor(annotation.anchor)) {
        // Existing block anchors are intentionally not rendered. They become
        // explicit review items unless the one-time migration proved safe.
        const legacy = annotation.legacyAnchor ?? annotation.anchor;
        annotation.legacyAnchor = legacy;
        annotation.anchor = this.detachedInlineAnchor(annotation.id, legacy.anchorText, body, contentHash, "needs_review", "external_edit");
        changed = true;
      }

      const anchor = annotation.anchor as InlineAnnotationAnchor;
      const issues = parsed.issuesById[anchor.markerId] ?? [];
      const parsedRange = parsed.ranges.find((range) => range.id === anchor.markerId);
      // A pair around no remaining source text is not an attached range. It
      // represents a user deletion, not permission to pin the thread to a
      // nearby line or another matching quote.
      const validPair = parsedRange && body.slice(parsedRange.rangeFrom, parsedRange.rangeTo).length > 0
        ? parsedRange
        : undefined;
      const nextState: AnnotationAttachmentState = issues.length > 0
        ? "needs_review"
        : validPair ? "attached"
          // A legacy anchor that failed the one-time uniqueness proof must
          // remain an explicit review item, not be downgraded to a guessed
          // missing-marker attachment.
          : annotation.legacyAnchor && anchor.attachmentState === "needs_review" ? "needs_review"
            : "orphaned";
      const reason = issues.includes("duplicate_marker")
        ? "duplicate_marker"
        : issues.length > 0
          ? "malformed_markers"
          : validPair ? undefined : parsedRange ? "external_edit" : "marker_removed";

      if (anchor.attachmentState !== nextState || anchor.detachedReason !== reason) {
        anchor.attachmentState = nextState;
        anchor.detachedReason = reason;
        if (nextState === "attached") {
          anchor.lastVerifiedAt = now;
          delete anchor.lastDetachedAt;
          delete anchor.detachedReason;
        } else {
          anchor.lastDetachedAt = now;
        }
        changed = true;
      } else if (nextState === "attached" && anchor.lastVerifiedAt !== now) {
        anchor.lastVerifiedAt = now;
        changed = true;
      }
    }
    return changed;
  }

  private deriveAnnotationLocations(
    annotations: NoteAnnotation[],
    scope: NoteScope,
    visibility: NoteVisibility,
    notePath: string,
  ): boolean {
    let changed = false;
    for (const annotation of annotations) {
      if (annotation.noteScope !== scope || annotation.noteVisibility !== visibility || annotation.notePath !== notePath) {
        annotation.noteScope = scope;
        annotation.noteVisibility = visibility;
        annotation.notePath = notePath;
        changed = true;
      }
    }
    return changed;
  }

  private async migrateLegacyAnchors(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): Promise<void> {
    const note = await this.noteSvc.readNote(scope, visibility, opts, notePath);
    if (!note) return;
    const file = this.readAnnotations(scope, visibility, opts, notePath);
    if (file.annotations.length === 0) return;

    let body = this.noteSvc.parseFrontmatter(note.content).body;
    let changed = false;
    for (const annotation of file.annotations) {
      if (annotation.parentId || annotation.archivedAt || isInlineAnchor(annotation.anchor)) continue;
      const legacy = annotation.anchor;
      const candidates = findExactTextOccurrences(body, legacy.anchorText)
        .filter((candidate) => this.sectionAtOffset(body, candidate.from) === legacy.sectionSlug);
      annotation.legacyAnchor = legacy;
      if (candidates.length === 1) {
        const candidate = candidates[0];
        body = insertInlineAnnotationAnchors(body, {
          id: annotation.id,
          from: candidate.from,
          to: candidate.to,
          selectedText: legacy.anchorText,
        });
        const context = annotationContext(body, candidate.from, candidate.to);
        annotation.anchor = {
          kind: "range",
          markerId: annotation.id,
          quote: legacy.anchorText,
          prefix: context.prefix,
          suffix: context.suffix,
          createdAtContentHash: note.contentHash,
          attachmentState: "attached",
          lastVerifiedAt: new Date().toISOString(),
        };
      } else {
        annotation.anchor = this.detachedInlineAnchor(annotation.id, legacy.anchorText, body, note.contentHash, "needs_review", "external_edit");
      }
      changed = true;
    }
    if (!changed) return;

    const originalBody = this.noteSvc.parseFrontmatter(note.content).body;
    if (body !== originalBody) {
      const outcome = await this.writeNoteAndSidecar(scope, visibility, opts, notePath, note, body, file);
      if ("conflict" in outcome) return;
    } else {
      this.writeAnnotations(scope, visibility, opts, notePath, file);
    }
  }

  private detachedInlineAnchor(
    markerId: string,
    quote: string,
    body: string,
    contentHash: string,
    state: "needs_review" | "orphaned",
    reason: InlineAnnotationAnchor["detachedReason"],
  ): InlineAnnotationAnchor {
    const occurrence = findExactTextOccurrences(body, quote)[0];
    const context = occurrence ? annotationContext(body, occurrence.from, occurrence.to) : { prefix: "", suffix: "" };
    return {
      kind: "range",
      markerId,
      quote,
      prefix: context.prefix,
      suffix: context.suffix,
      createdAtContentHash: contentHash,
      attachmentState: state,
      lastDetachedAt: new Date().toISOString(),
      detachedReason: reason,
    };
  }

  /* ── Marker-aware mutations ────────────────────────────────────── */

  async createRangeAnnotation(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    data: { from: number; to: number; selectedText: string; expectedHash: string; author: string; body: string },
  ): Promise<AnnotationMutationOutcome> {
    const note = await this.noteSvc.readNote(scope, visibility, opts, notePath);
    if (!note) throw new Error("Note not found.");
    if (note.contentHash !== data.expectedHash) return this.conflict(note);

    const body = this.noteSvc.parseFrontmatter(note.content).body;
    const id = `nann_${crypto.randomBytes(12).toString("hex")}`;
    const nextBody = insertInlineAnnotationAnchors(body, { id, from: data.from, to: data.to, selectedText: data.selectedText });
    const context = annotationContext(body, data.from, data.to);
    const annotation: NoteAnnotation = {
      id,
      noteScope: scope,
      noteVisibility: visibility,
      notePath,
      anchor: {
        kind: "range",
        markerId: id,
        quote: data.selectedText,
        prefix: context.prefix,
        suffix: context.suffix,
        createdAtContentHash: note.contentHash,
        attachmentState: "attached",
        lastVerifiedAt: new Date().toISOString(),
      },
      author: data.author,
      createdAt: new Date().toISOString(),
      body: data.body,
      status: "open",
      reactions: [],
    };
    const file = this.readAnnotations(scope, visibility, opts, notePath);
    file.annotations.push(annotation);
    return this.writeNoteAndSidecar(scope, visibility, opts, notePath, note, nextBody, file, annotation);
  }

  async reattachRangeAnnotation(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    annotationId: string,
    data: { from: number; to: number; selectedText: string; expectedHash: string },
  ): Promise<AnnotationMutationOutcome | null> {
    const note = await this.noteSvc.readNote(scope, visibility, opts, notePath);
    if (!note) return null;
    if (note.contentHash !== data.expectedHash) return this.conflict(note);
    const file = this.readAnnotations(scope, visibility, opts, notePath);
    const annotation = file.annotations.find((item) => item.id === annotationId && !item.parentId && !item.archivedAt);
    if (!annotation) return null;

    const body = this.noteSvc.parseFrontmatter(note.content).body;
    if (body.slice(data.from, data.to) !== data.selectedText) {
      throw new Error("The selected text no longer matches the note content. Reload and try again.");
    }
    const parsed = parseInlineAnnotationAnchors(body);
    const removed = parsed.markers.filter((marker) => marker.id === annotationId).sort((a, b) => a.from - b.from);
    const reattachedBody = removeInlineAnnotationAnchors(body, annotationId);
    const adjustedFrom = adjustedOffset(data.from, removed);
    const adjustedTo = adjustedOffset(data.to, removed);
    const nextBody = insertInlineAnnotationAnchors(reattachedBody, {
      id: annotationId,
      from: adjustedFrom,
      to: adjustedTo,
      selectedText: data.selectedText,
    });
    const context = annotationContext(reattachedBody, adjustedFrom, adjustedTo);
    const previous = isInlineAnchor(annotation.anchor) ? annotation.anchor : undefined;
    annotation.anchor = {
      kind: "range",
      markerId: annotationId,
      quote: data.selectedText,
      prefix: context.prefix,
      suffix: context.suffix,
      createdAtContentHash: previous?.createdAtContentHash ?? note.contentHash,
      attachmentState: "attached",
      lastVerifiedAt: new Date().toISOString(),
    };
    return this.writeNoteAndSidecar(scope, visibility, opts, notePath, note, nextBody, file, annotation);
  }

  /** Create a reply, or accept a legacy block anchor during staged migration. */
  async createAnnotation(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    data: { anchor?: BlockAnchor; author: string; body: string; parentId?: string },
  ): Promise<NoteAnnotation> {
    const file = this.readAnnotations(scope, visibility, opts, notePath);
    const parent = data.parentId ? file.annotations.find((item) => item.id === data.parentId) : undefined;
    if (data.parentId && !parent) throw new Error("Parent annotation not found.");
    if (!data.parentId && !data.anchor) throw new Error("Legacy anchor is required.");
    const annotation: NoteAnnotation = {
      id: `nann_${crypto.randomBytes(12).toString("hex")}`,
      noteScope: scope,
      noteVisibility: visibility,
      notePath,
      anchor: parent?.anchor ?? data.anchor!,
      legacyAnchor: parent?.legacyAnchor ?? data.anchor,
      author: data.author,
      createdAt: new Date().toISOString(),
      body: data.body,
      parentId: data.parentId,
      status: "open",
      reactions: [],
    };
    file.annotations.push(annotation);
    this.writeAnnotations(scope, visibility, opts, notePath, file);
    return annotation;
  }

  async updateAnnotation(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    annotationId: string,
    changes: { status?: AnnotationStatus; body?: string; reactions?: Array<{ emoji: string; user: string }> },
  ): Promise<NoteAnnotation | null> {
    const file = this.readAnnotations(scope, visibility, opts, notePath);
    const annotation = file.annotations.find((item) => item.id === annotationId && !item.archivedAt);
    if (!annotation) return null;
    if (changes.status !== undefined) annotation.status = changes.status;
    if (changes.body !== undefined) annotation.body = changes.body;
    if (changes.reactions !== undefined) annotation.reactions = changes.reactions;
    if (changes.status === "resolved" && !annotation.parentId) {
      for (const reply of file.annotations) if (reply.parentId === annotationId) reply.status = "resolved";
    }
    this.writeAnnotations(scope, visibility, opts, notePath, file);
    return annotation;
  }

  /** Archive a thread and remove its marker pair without destroying the audit record. */
  async archiveAnnotation(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    annotationId: string,
    actor: string,
    expectedHash?: string,
  ): Promise<AnnotationMutationOutcome | null> {
    const note = await this.noteSvc.readNote(scope, visibility, opts, notePath);
    if (!note) return null;
    if (expectedHash && note.contentHash !== expectedHash) return this.conflict(note);
    const file = this.readAnnotations(scope, visibility, opts, notePath);
    const target = file.annotations.find((item) => item.id === annotationId && !item.archivedAt);
    if (!target) return null;
    const now = new Date().toISOString();
    target.archivedAt = now;
    target.archivedBy = actor;
    for (const reply of file.annotations) {
      if (reply.parentId === annotationId) {
        reply.archivedAt = now;
        reply.archivedBy = actor;
      }
    }
    if (target.parentId) {
      this.writeAnnotations(scope, visibility, opts, notePath, file);
      return { annotation: target, content: this.noteSvc.parseFrontmatter(note.content).body, contentHash: note.contentHash };
    }
    const body = this.noteSvc.parseFrontmatter(note.content).body;
    const nextBody = removeInlineAnnotationAnchors(body, annotationId);
    return this.writeNoteAndSidecar(scope, visibility, opts, notePath, note, nextBody, file, target);
  }

  /** Backwards-compatible boolean API for existing callers. */
  async deleteAnnotation(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    annotationId: string,
  ): Promise<boolean> {
    return (await this.archiveAnnotation(scope, visibility, opts, notePath, annotationId, opts.userId ?? "default")) !== null;
  }

  async listAnnotations(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): Promise<NoteAnnotation[]> {
    return this.reconcileNote(scope, visibility, opts, notePath, false);
  }

  async getRenderTargets(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): Promise<AnnotationRenderTarget[]> {
    const annotations = await this.reconcileNote(scope, visibility, opts, notePath, false);
    const note = await this.noteSvc.readNote(scope, visibility, opts, notePath);
    if (!note) return [];
    const parsed = parseInlineAnnotationAnchors(this.noteSvc.parseFrontmatter(note.content).body);
    const targets: AnnotationRenderTarget[] = [];
    for (const root of annotations) {
      if (root.parentId || root.archivedAt || !isInlineAnchor(root.anchor) || root.anchor.attachmentState !== "attached") continue;
      const anchor = root.anchor;
      const range = parsed.ranges.find((item) => item.id === anchor.markerId);
      if (!range) continue;
      const count = 1 + annotations.filter((item) => item.parentId === root.id && !item.archivedAt).length;
      targets.push({ ...range, annotationId: root.id, count, hasOpen: root.status === "open" });
    }
    return targets.sort((a, b) => a.rangeFrom - b.rangeFrom || a.rangeTo - b.rangeTo);
  }

  /** Marker syntax can stay hidden even when a pair is invalid and has no pin. */
  async getMarkerRanges(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): Promise<AnnotationMarkerRange[]> {
    const note = await this.noteSvc.readNote(scope, visibility, opts, notePath);
    if (!note) return [];
    return parseInlineAnnotationAnchors(this.noteSvc.parseFrontmatter(note.content).body)
      .markers.map((marker) => ({ from: marker.from, to: marker.to }));
  }

  async getOpenAnnotationCount(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts, notePath: string): Promise<number> {
    const annotations = await this.listAnnotations(scope, visibility, opts, notePath);
    return annotations.filter((item) => !item.parentId && !item.archivedAt && item.status === "open").length;
  }

  /* ── Compatibility and transfer ────────────────────────────────── */

  /** Kept for the legacy endpoint and migration evaluation; never used for pin placement. */
  computeBlocks(markdown: string): BlockInfo[] {
    const blocks: BlockInfo[] = [];
    let sectionSlug = "root";
    let blockStart = 0;
    let lines: string[] = [];
    const sourceLines = markdown.split("\n");
    const flush = (lineEnd: number) => {
      const content = lines.join("\n").trim();
      if (!content) return;
      const hash = crypto.createHash("md5").update(content).digest("hex").slice(0, 4);
      blocks.push({ blockId: `blk_${sectionSlug}_${blocks.length}_${hash}`, sectionSlug, lineStart: blockStart + 1, lineEnd: lineEnd + 1, content });
      lines = [];
    };
    for (let index = 0; index < sourceLines.length; index++) {
      const line = sourceLines[index];
      const heading = line.match(/^#{1,6}\s+(.+)/);
      if (heading) {
        flush(index - 1);
        sectionSlug = slugify(heading[1]);
        blockStart = index;
        lines = [line];
      } else if (!line.trim()) {
        flush(index - 1);
        blockStart = index + 1;
      } else {
        if (lines.length === 0) blockStart = index;
        lines.push(line);
      }
    }
    flush(sourceLines.length - 1);
    return blocks;
  }

  replaceAnnotations(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    sidecar: NoteAnnotation[] | NoteAnnotationsFile,
  ): void {
    const annotations = Array.isArray(sidecar) ? sidecar : sidecar.annotations;
    this.writeAnnotations(scope, visibility, opts, notePath, {
      annotations: annotations.map((annotation) => ({ ...annotation, noteScope: scope, noteVisibility: visibility, notePath })),
    });
  }

  /* ── Coordinated write helpers ─────────────────────────────────── */

  private async writeNoteAndSidecar(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    priorNote: Awaited<ReturnType<CodaScopeNoteService["readNote"]>> & {},
    nextBody: string,
    nextSidecar: NoteAnnotationsFile,
    annotation?: NoteAnnotation,
  ): Promise<AnnotationMutationOutcome> {
    if (!priorNote) throw new Error("Note not found.");
    const nextContent = this.noteSvc.serializeFrontmatter(priorNote.frontmatter) + nextBody;
    const update = await this.noteSvc.updateNote(scope, visibility, opts, notePath, nextContent, priorNote.contentHash);
    if (!update) throw new Error("Note not found.");
    if ("conflict" in update) return update;

    try {
      this.writeAnnotations(scope, visibility, opts, notePath, nextSidecar);
    } catch (error) {
      // Do not claim success with marker-only content. Restore the old note
      // body using the hash returned by the successful first write.
      const rollback = await this.noteSvc.updateNote(scope, visibility, opts, notePath, priorNote.content, update.contentHash);
      if (!rollback || "conflict" in rollback) {
        throw new Error("Annotation sidecar write failed and note rollback needs recovery.");
      }
      throw new Error(`Annotation sidecar write failed; note content was rolled back. ${error instanceof Error ? error.message : ""}`.trim());
    }

    const saved = await this.noteSvc.readNote(scope, visibility, opts, notePath);
    if (!saved) throw new Error("Annotation was written but the note could not be read back.");
    const savedAnnotation = annotation ?? nextSidecar.annotations.find((item) => !item.parentId && !item.archivedAt);
    if (!savedAnnotation) throw new Error("Annotation sidecar did not contain the updated annotation.");
    return {
      annotation: savedAnnotation,
      content: this.noteSvc.parseFrontmatter(saved.content).body,
      contentHash: saved.contentHash,
    };
  }

  private conflict(note: NonNullable<Awaited<ReturnType<CodaScopeNoteService["readNote"]>>>): NoteConflictResult {
    return { conflict: true, currentHash: note.contentHash, currentContent: note.content };
  }

  private sectionAtOffset(markdown: string, offset: number): string {
    let section = "root";
    let cursor = 0;
    for (const line of markdown.split("\n")) {
      if (cursor > offset) break;
      const heading = line.match(/^#{1,6}\s+(.+)/);
      if (heading) section = slugify(heading[1]);
      cursor += line.length + 1;
    }
    return section;
  }
}

function isInlineAnchor(anchor: InlineAnnotationAnchor | BlockAnchor): anchor is InlineAnnotationAnchor {
  return (anchor as InlineAnnotationAnchor).kind === "range";
}

function adjustedOffset(offset: number, markers: Array<{ from: number; to: number }>): number {
  return offset - markers.reduce((total, marker) => total + (marker.to <= offset ? marker.to - marker.from : 0), 0);
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "root";
}
