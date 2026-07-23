/* ── CodaScope: Epic Annotation Service ─────────────────────────────
   Actor-aware, versioned block annotations for epic documents.

   Storage layout:
   <epicId>/annotations/<documentId>-annotations.json

   Version 2 is the only write format. Unversioned legacy files are validated
   and migrated under the per-epic persistence coordinator. Unknown versions
   and malformed discussion graphs fail closed without rewriting their bytes.
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { collectAnnotationDescendants } from "../../src/apps/codascope/codaScopeTypes.js";
import type {
  Annotation,
  AnnotationAttachmentState,
  AnnotationOrigin,
  AnnotationStatus,
  BlockInfo,
  BlockAnchor,
  EpicAnnotationDetachmentReason,
} from "../../src/apps/codascope/codaScopeTypes.js";
import { assertSafePathSegment } from "./codaScopePathSafety.js";
import {
  CodaScopePersistence,
  CodaScopePersistenceCorruptError,
  CodaScopePersistenceError,
  codaScopePersistence,
} from "./codaScopePersistence.js";

const ANNOTATIONS_VERSION = 2 as const;
const ANNOTATIONS_SUFFIX = "-annotations.json";
const VALID_STATUSES = new Set<AnnotationStatus>(["open", "resolved", "wontfix"]);
const VALID_ATTACHMENT_STATES = new Set<AnnotationAttachmentState>(["attached", "needs_review", "orphaned"]);
const VALID_DETACHMENT_REASONS = new Set<EpicAnnotationDetachmentReason>([
  "legacy_unverified",
  "block_missing_exact_text",
  "block_missing_ambiguous_text",
  "block_missing_no_match",
]);

interface AnnotationsFileV2 {
  version: typeof ANNOTATIONS_VERSION;
  annotations: Annotation[];
}

interface LoadedAnnotationsFile {
  file: AnnotationsFileV2;
  legacy: boolean;
}

interface EpicAnnotationCatalogEntry {
  documentId: string;
  loaded: LoadedAnnotationsFile;
  annotation: Annotation;
}

interface EpicAnnotationCatalog {
  documents: Map<string, LoadedAnnotationsFile>;
  byId: Map<string, EpicAnnotationCatalogEntry>;
}

export interface AnnotationActor {
  username: string;
  origin: AnnotationOrigin;
}

export type AnnotationServiceErrorCode = "invalid_input" | "invalid_status_transition" | "conflict";

export class CodaScopeAnnotationError extends Error {
  constructor(
    readonly code: AnnotationServiceErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "CodaScopeAnnotationError";
  }
}

export function isAnnotationServiceError(error: unknown): error is CodaScopeAnnotationError {
  return error instanceof CodaScopeAnnotationError;
}

export class CodaScopeAnnotationService {
  private root: string;

  constructor(
    root: string,
    private readonly persistence: CodaScopePersistence = codaScopePersistence,
  ) {
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
        } catch { /* skip unrelated corrupt project metadata */ }
      }
    }
    return null;
  }

  private epicDir(projectDir: string, epicId: string): string {
    return path.join(projectDir, "epics", assertSafePathSegment(epicId, "epic ID"));
  }

  private annotationsDir(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "annotations");
  }

  private annotationsPath(projectDir: string, epicId: string, documentId: string): string {
    const safeDocumentId = assertSafePathSegment(documentId, "document ID");
    return path.join(this.annotationsDir(projectDir, epicId), `${safeDocumentId}${ANNOTATIONS_SUFFIX}`);
  }

  private mutationKey(projectDir: string, epicId: string): string {
    return this.persistence.canonicalKey("epic-annotations", this.annotationsDir(projectDir, epicId));
  }

  /** Match the authoritative writers' key so document saves cannot interleave with reattachment. */
  private documentMutationKey(projectDir: string, epicId: string, documentId: string): string {
    return documentId === "definition"
      ? this.persistence.canonicalKey("epic-storage", path.join(projectDir, "epics"))
      : this.persistence.canonicalKey("design-index", path.join(this.epicDir(projectDir, epicId), "designs"));
  }

  private readDocumentContent(projectDir: string, epicId: string, documentId: string): string | null {
    const filePath = documentId === "definition"
      ? path.join(this.epicDir(projectDir, epicId), "definition.md")
      : path.join(
          this.epicDir(projectDir, epicId),
          "designs",
          assertSafePathSegment(documentId, "document ID"),
          "content.md",
        );
    try {
      return readFileSync(filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new CodaScopePersistenceError({ storage: "annotation_document", epicId, documentId });
    }
  }

  private annotationDocumentIds(projectDir: string, epicId: string): string[] {
    const directory = this.annotationsDir(projectDir, epicId);
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((filename) => filename.endsWith(ANNOTATIONS_SUFFIX))
      .map((filename) => filename.slice(0, -ANNOTATIONS_SUFFIX.length))
      .map((documentId) => {
        try {
          return assertSafePathSegment(documentId, "document ID");
        } catch {
          throw new CodaScopePersistenceCorruptError({ storage: "epic_annotations", epicId, documentId });
        }
      })
      .sort();
  }

  /* ── File I/O helpers ──────────────────────────────────────────── */

  private readAnnotations(
    projectDir: string,
    epicId: string,
    documentId: string,
  ): Promise<LoadedAnnotationsFile> {
    const filePath = this.annotationsPath(projectDir, epicId, documentId);
    return this.persistence.readJson(filePath, {
      context: { storage: "epic_annotations", epicId, documentId },
      missing: () => ({
        file: { version: ANNOTATIONS_VERSION, annotations: [] },
        legacy: false,
      }),
      validate: (value) => parseAnnotationsFile(value, epicId, documentId),
    });
  }

  private writeAnnotations(
    projectDir: string,
    epicId: string,
    documentId: string,
    data: AnnotationsFileV2,
  ): Promise<void> {
    validateAnnotationsV2(data, epicId, documentId);
    return this.persistence.writeJson(
      this.annotationsPath(projectDir, epicId, documentId),
      data,
      { storage: "epic_annotations", epicId, documentId },
    );
  }

  /** Read and validate the complete epic-wide ID namespace under its mutation key. */
  private async readEpicCatalog(
    projectDir: string,
    epicId: string,
    includeDocumentId?: string,
  ): Promise<EpicAnnotationCatalog> {
    const documentIds = new Set(this.annotationDocumentIds(projectDir, epicId));
    if (includeDocumentId) documentIds.add(assertSafePathSegment(includeDocumentId, "document ID"));

    const documents = new Map<string, LoadedAnnotationsFile>();
    const byId = new Map<string, EpicAnnotationCatalogEntry>();
    for (const documentId of [...documentIds].sort()) {
      const loaded = await this.readAnnotations(projectDir, epicId, documentId);
      documents.set(documentId, loaded);
      for (const annotation of loaded.file.annotations) {
        if (byId.has(annotation.id)) {
          throw new CodaScopePersistenceCorruptError({
            storage: "epic_annotations",
            epicId,
            annotationId: annotation.id,
          });
        }
        byId.set(annotation.id, { documentId, loaded, annotation });
      }
    }
    return { documents, byId };
  }

  /* ── Block ID computation ──────────────────────────────────────── */

  /** Parse Markdown into deterministic heading-scoped blocks. */
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
      blocks.push({
        blockId: `blk_${currentSection}_${indexInSection}_${hash}`,
        sectionSlug: currentSection,
        lineStart: blockStart + 1,
        lineEnd: endLine + 1,
        content,
      });
      indexInSection += 1;
      blockLines = [];
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trimStart().startsWith("```")) {
        if (inCodeFence) {
          blockLines.push(line);
          inCodeFence = false;
          flushBlock(index);
          blockStart = index + 1;
        } else {
          if (blockLines.length > 0) flushBlock(index - 1);
          blockStart = index;
          blockLines = [line];
          inCodeFence = true;
        }
        continue;
      }
      if (inCodeFence) {
        blockLines.push(line);
        continue;
      }

      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        if (blockLines.length > 0) flushBlock(index - 1);
        currentSection = slugify(headingMatch[2]);
        indexInSection = 0;
        blockStart = index;
        blockLines = [line];
        flushBlock(index);
        blockStart = index + 1;
        continue;
      }

      if (line.trim() === "") {
        if (blockLines.length > 0) flushBlock(index - 1);
        blockStart = index + 1;
        continue;
      }
      if (blockLines.length === 0) blockStart = index;
      blockLines.push(line);
    }

    if (blockLines.length > 0) flushBlock(lines.length - 1);
    return blocks;
  }

  /* ── Annotation reads and reconciliation ───────────────────────── */

  /**
   * List a document's annotations. If content is supplied, attachment state
   * is reconciled and persisted. Anchors are never substituted or moved.
   */
  async listAnnotations(
    projectId: string,
    epicId: string,
    documentId: string,
    documentContent?: string,
  ): Promise<Annotation[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];

    return this.persistence.withMutation(this.mutationKey(projectDir, epicId), async () => {
      const catalog = await this.readEpicCatalog(projectDir, epicId, documentId);
      const loaded = catalog.documents.get(documentId)!;
      const reconciled = documentContent === undefined
        ? false
        : this.reconcileAttachments(loaded.file.annotations, this.computeBlockIds(documentContent));
      if (loaded.legacy || reconciled) {
        await this.writeAnnotations(projectDir, epicId, documentId, loaded.file);
      }
      return loaded.file.annotations;
    });
  }

  private reconcileAttachments(annotations: Annotation[], blocks: BlockInfo[]): boolean {
    let changed = false;
    const now = new Date().toISOString();

    for (const root of annotations.filter((annotation) => !annotation.parentId)) {
      const exactBlock = blocks.some((block) => block.blockId === root.anchor.blockId);
      const exactTextCandidates = exactBlock || !root.anchor.anchorText
        ? []
        : blocks.filter((block) => block.content === root.anchor.anchorText);
      const nextState: AnnotationAttachmentState = exactBlock
        ? "attached"
        : exactTextCandidates.length > 0 ? "needs_review" : "orphaned";
      const nextReason: EpicAnnotationDetachmentReason | undefined = exactBlock
        ? undefined
        : exactTextCandidates.length > 1
          ? "block_missing_ambiguous_text"
          : exactTextCandidates.length === 1
            ? "block_missing_exact_text"
            : "block_missing_no_match";

      changed = applyAttachmentState(root, nextState, nextReason, now) || changed;
      for (const descendant of collectAnnotationDescendants(annotations, root.id)) {
        if (!sameAnchor(descendant.anchor, root.anchor)) {
          descendant.anchor = { ...root.anchor };
          changed = true;
        }
        changed = applyAttachmentState(descendant, nextState, nextReason, now) || changed;
      }
    }
    return changed;
  }

  /* ── Actor-aware mutations ─────────────────────────────────────── */

  async createAnnotation(
    projectId: string,
    epicId: string,
    documentId: string,
    actor: AnnotationActor,
    data: {
      anchor?: BlockAnchor;
      body: string;
      parentId?: string;
      documentVersion?: number;
    },
  ): Promise<Annotation> {
    assertMutationFields(data, ["anchor", "body", "parentId", "documentVersion"]);
    const trustedActor = validateActor(actor);
    const body = validateBody(data.body);
    if (data.parentId !== undefined && (!data.parentId || typeof data.parentId !== "string")) {
      throw invalidInput("parentId must be a non-empty string.");
    }
    if (data.documentVersion !== undefined
      && (!Number.isSafeInteger(data.documentVersion) || data.documentVersion < 0)) {
      throw invalidInput("documentVersion must be a non-negative integer.");
    }
    if (!data.parentId) validateBlockAnchor(data.anchor);

    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    return this.persistence.withMutation(this.mutationKey(projectDir, epicId), async () => {
      const catalog = await this.readEpicCatalog(projectDir, epicId, documentId);
      const loaded = catalog.documents.get(documentId)!;
      const parent = data.parentId
        ? catalog.byId.get(data.parentId)?.annotation
        : undefined;
      if (data.parentId && (!parent || parent.documentId !== documentId || parent.parentId)) {
        throw invalidInput("parentId must identify a root annotation in this document.");
      }

      const now = new Date().toISOString();
      let annotationId = "";
      for (let attempt = 0; attempt < 32 && !annotationId; attempt += 1) {
        const candidate = `ann_${crypto.randomBytes(12).toString("hex")}`;
        if (!catalog.byId.has(candidate)) annotationId = candidate;
      }
      if (!annotationId) {
        throw new CodaScopePersistenceError({ storage: "epic_annotations", epicId, operation: "allocate_id" });
      }
      const annotation: Annotation = {
        id: annotationId,
        epicId,
        documentId,
        documentVersion: data.documentVersion ?? parent?.documentVersion ?? 0,
        anchor: { ...(parent?.anchor ?? data.anchor!) },
        author: trustedActor.username,
        origin: trustedActor.origin,
        ownership: "owned",
        createdAt: now,
        body,
        parentId: data.parentId,
        status: parent?.status ?? "open",
        reactions: [],
        attachmentState: parent?.attachmentState ?? "attached",
        ...(parent?.detachedReason ? { detachedReason: parent.detachedReason } : {}),
        ...(parent?.detachedAt ? { detachedAt: parent.detachedAt } : {}),
        ...(parent?.reattachedAt ? { reattachedAt: parent.reattachedAt } : {}),
      };
      loaded.file.annotations.push(annotation);
      await this.writeAnnotations(projectDir, epicId, documentId, loaded.file);
      return annotation;
    });
  }

  async updateAnnotation(
    projectId: string,
    epicId: string,
    annotationId: string,
    actor: AnnotationActor,
    changes: { status?: AnnotationStatus; body?: string },
  ): Promise<Annotation | null> {
    assertMutationFields(changes, ["status", "body"]);
    const trustedActor = validateActor(actor);
    if (changes.body === undefined && changes.status === undefined) {
      throw invalidInput("Provide a body or status update.");
    }
    const body = changes.body === undefined ? undefined : validateBody(changes.body);
    if (changes.status !== undefined && !VALID_STATUSES.has(changes.status)) {
      throw new CodaScopeAnnotationError("invalid_status_transition", "Annotation status transition is not allowed.");
    }

    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;
    return this.persistence.withMutation(this.mutationKey(projectDir, epicId), async () => {
      const catalog = await this.readEpicCatalog(projectDir, epicId);
      const located = catalog.byId.get(annotationId);
      if (!located) return null;
      const { documentId, loaded, annotation } = located;

      // Body ownership is intentionally indistinguishable from absence.
      if (body !== undefined
        && (annotation.deletedAt || annotation.ownership !== "owned" || annotation.author !== trustedActor.username)) {
        return null;
      }
      if (changes.status !== undefined) {
        if (annotation.parentId || !isValidStatusTransition(annotation.status, changes.status)) {
          throw new CodaScopeAnnotationError("invalid_status_transition", "Annotation status transition is not allowed.");
        }
      }

      let changed = false;
      if (body !== undefined && annotation.body !== body) {
        annotation.body = body;
        changed = true;
      }
      if (changes.status !== undefined) {
        for (const item of [annotation, ...collectAnnotationDescendants(loaded.file.annotations, annotation.id)]) {
          if (item.status !== changes.status) {
            item.status = changes.status;
            changed = true;
          }
        }
      }
      if (changed) await this.writeAnnotations(projectDir, epicId, documentId, loaded.file);
      return annotation;
    });
  }

  async addReaction(
    projectId: string,
    epicId: string,
    annotationId: string,
    actor: AnnotationActor,
    emoji: string,
  ): Promise<Annotation | null> {
    return this.changeReaction(projectId, epicId, annotationId, actor, emoji, true);
  }

  async removeReaction(
    projectId: string,
    epicId: string,
    annotationId: string,
    actor: AnnotationActor,
    emoji: string,
  ): Promise<Annotation | null> {
    return this.changeReaction(projectId, epicId, annotationId, actor, emoji, false);
  }

  private async changeReaction(
    projectId: string,
    epicId: string,
    annotationId: string,
    actor: AnnotationActor,
    emoji: string,
    add: boolean,
  ): Promise<Annotation | null> {
    const trustedActor = validateActor(actor);
    const token = validateReaction(emoji);
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return this.persistence.withMutation(this.mutationKey(projectDir, epicId), async () => {
      const catalog = await this.readEpicCatalog(projectDir, epicId);
      const located = catalog.byId.get(annotationId);
      if (!located || located.annotation.deletedAt) return null;
      const { documentId, loaded, annotation } = located;
      const index = annotation.reactions.findIndex(
        (reaction) => reaction.emoji === token && reaction.user === trustedActor.username,
      );
      if (add && index < 0) {
        annotation.reactions.push({ emoji: token, user: trustedActor.username });
        await this.writeAnnotations(projectDir, epicId, documentId, loaded.file);
      } else if (!add && index >= 0) {
        annotation.reactions.splice(index, 1);
        await this.writeAnnotations(projectDir, epicId, documentId, loaded.file);
      }
      return annotation;
    });
  }

  async deleteAnnotation(
    projectId: string,
    epicId: string,
    annotationId: string,
    actor: AnnotationActor,
  ): Promise<boolean> {
    const trustedActor = validateActor(actor);
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    return this.persistence.withMutation(this.mutationKey(projectDir, epicId), async () => {
      const catalog = await this.readEpicCatalog(projectDir, epicId);
      const located = catalog.byId.get(annotationId);
      if (!located) return false;
      const { documentId, loaded, annotation } = located;
      if (annotation.deletedAt
        || annotation.ownership !== "owned"
        || annotation.author !== trustedActor.username) {
        return false;
      }

      const descendants = collectAnnotationDescendants(loaded.file.annotations, annotation.id);
      if (descendants.length === 0) {
        loaded.file.annotations = loaded.file.annotations.filter((item) => item.id !== annotation.id);
      } else {
        annotation.body = "";
        annotation.reactions = [];
        annotation.deletedAt = new Date().toISOString();
        annotation.deletedBy = trustedActor.username;
      }
      await this.writeAnnotations(projectDir, epicId, documentId, loaded.file);
      return true;
    });
  }

  async reattachAnnotation(
    projectId: string,
    epicId: string,
    documentId: string,
    annotationId: string,
    expectedContentHash: string,
    targetBlockId: string,
  ): Promise<Annotation | null> {
    if (!expectedContentHash || typeof expectedContentHash !== "string"
      || !targetBlockId || typeof targetBlockId !== "string") {
      throw invalidInput("A current content hash and exact target block ID are required.");
    }
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return this.persistence.withMutation(
      this.documentMutationKey(projectDir, epicId, documentId),
      () => this.persistence.withMutation(this.mutationKey(projectDir, epicId), async () => {
        const catalog = await this.readEpicCatalog(projectDir, epicId, documentId);
        const currentContent = this.readDocumentContent(projectDir, epicId, documentId);
        if (currentContent === null) return null;
        if (hashContent(currentContent) !== expectedContentHash) {
          throw conflict("Document content changed. Reload before reattaching the annotation.");
        }
        const targetBlock = this.computeBlockIds(currentContent)
          .find((block) => block.blockId === targetBlockId);
        if (!targetBlock) throw invalidInput("The selected annotation block no longer exists.");

        const located = catalog.byId.get(annotationId);
        if (!located || located.documentId !== documentId) return null;
        const { loaded, annotation: root } = located;
        if (root.parentId) throw invalidInput("Replies cannot be reattached independently.");

        const now = new Date().toISOString();
        const anchor: BlockAnchor = {
          blockId: targetBlock.blockId,
          sectionSlug: targetBlock.sectionSlug,
          anchorText: targetBlock.content,
          lineNumber: targetBlock.lineStart,
        };
        for (const annotation of [root, ...collectAnnotationDescendants(loaded.file.annotations, root.id)]) {
          annotation.anchor = { ...anchor };
          annotation.attachmentState = "attached";
          annotation.reattachedAt = now;
          delete annotation.detachedAt;
          delete annotation.detachedReason;
        }
        await this.writeAnnotations(projectDir, epicId, documentId, loaded.file);
        return root;
      }),
    );
  }

  /** Count open root threads across an epic. */
  async getOpenAnnotationCount(projectId: string, epicId: string): Promise<number> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return 0;
    return this.persistence.withMutation(this.mutationKey(projectDir, epicId), async () => {
      const catalog = await this.readEpicCatalog(projectDir, epicId);
      let count = 0;
      for (const [documentId, loaded] of catalog.documents) {
        if (loaded.legacy) await this.writeAnnotations(projectDir, epicId, documentId, loaded.file);
        count += loaded.file.annotations.filter(
          (annotation) => !annotation.parentId && annotation.status === "open",
        ).length;
      }
      return count;
    });
  }
}

/* ── Schema validation and migration ─────────────────────────────── */

export function validateEpicAnnotationsFile(
  value: unknown,
  epicId: string,
  documentId: string,
): { version: 2; annotations: Annotation[] } {
  return parseAnnotationsFile(value, epicId, documentId).file;
}

function parseAnnotationsFile(value: unknown, epicId: string, documentId: string): LoadedAnnotationsFile {
  if (!isRecord(value)) throw new Error("invalid annotations file");
  if (Object.hasOwn(value, "version")) {
    if (value.version !== ANNOTATIONS_VERSION) throw new Error("unknown annotations version");
    const file = validateAnnotationsV2(value, epicId, documentId);
    return { file, legacy: false };
  }

  validateLegacyAnnotationsFile(value, epicId, documentId);
  const now = new Date().toISOString();
  const legacyAnnotations = value.annotations as LegacyAnnotation[];
  const annotations: Annotation[] = legacyAnnotations.map((annotation) => ({
    ...annotation,
    anchor: { ...annotation.anchor },
    reactions: annotation.reactions.map((reaction) => ({ ...reaction })),
    origin: annotation.author === "agent" ? "agent" : "user",
    ownership: annotation.author === "agent" ? "legacy_unowned" : "owned",
    attachmentState: "needs_review",
    detachedReason: "legacy_unverified",
    detachedAt: now,
  }));
  const byId = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  for (const annotation of annotations) {
    if (!annotation.parentId) continue;
    const root = rootOf(annotation, byId);
    annotation.anchor = { ...root.anchor };
    annotation.status = root.status;
    annotation.attachmentState = root.attachmentState;
    annotation.detachedReason = root.detachedReason;
    annotation.detachedAt = root.detachedAt;
  }
  return {
    file: validateAnnotationsV2({ version: ANNOTATIONS_VERSION, annotations }, epicId, documentId),
    legacy: true,
  };
}

interface LegacyAnnotation {
  id: string;
  epicId: string;
  documentId: string;
  documentVersion: number;
  anchor: BlockAnchor;
  author: string;
  createdAt: string;
  body: string;
  parentId?: string;
  status: AnnotationStatus;
  reactions: Array<{ emoji: string; user: string }>;
}

function validateLegacyAnnotationsFile(value: Record<string, unknown>, epicId: string, documentId: string): void {
  assertExactKeys(value, ["annotations"]);
  if (!Array.isArray(value.annotations)) throw new Error("invalid legacy annotations file");
  for (const annotation of value.annotations) validateLegacyAnnotation(annotation, epicId, documentId);
  validateDiscussionGraph(value.annotations as LegacyAnnotation[]);
}

function validateLegacyAnnotation(value: unknown, epicId: string, documentId: string): asserts value is LegacyAnnotation {
  if (!isRecord(value)) throw new Error("invalid legacy annotation");
  assertExactKeys(value, [
    "id", "epicId", "documentId", "documentVersion", "anchor", "author", "createdAt",
    "body", "parentId", "status", "reactions",
  ], ["parentId"]);
  validateCommonAnnotationFields(value, epicId, documentId);
}

function validateAnnotationsV2(value: unknown, epicId: string, documentId: string): AnnotationsFileV2 {
  if (!isRecord(value)) throw new Error("invalid annotations file");
  assertExactKeys(value, ["version", "annotations"]);
  if (value.version !== ANNOTATIONS_VERSION || !Array.isArray(value.annotations)) {
    throw new Error("invalid annotations version");
  }
  for (const annotation of value.annotations) validateAnnotationV2(annotation, epicId, documentId);
  validateDiscussionGraph(value.annotations as Annotation[]);
  validateV2ThreadAttachments(value.annotations as Annotation[]);
  return value as unknown as AnnotationsFileV2;
}

function validateAnnotationV2(value: unknown, epicId: string, documentId: string): asserts value is Annotation {
  if (!isRecord(value)) throw new Error("invalid annotation");
  assertExactKeys(value, [
    "id", "epicId", "documentId", "documentVersion", "anchor", "author", "origin", "ownership",
    "createdAt", "body", "parentId", "status", "reactions", "attachmentState", "detachedReason",
    "detachedAt", "reattachedAt", "deletedAt", "deletedBy",
  ], ["parentId", "detachedReason", "detachedAt", "reattachedAt", "deletedAt", "deletedBy"]);
  validateCommonAnnotationFields(value, epicId, documentId);
  if ((value.origin !== "user" && value.origin !== "agent")
    || (value.ownership !== "owned" && value.ownership !== "legacy_unowned")
    || !VALID_ATTACHMENT_STATES.has(value.attachmentState as AnnotationAttachmentState)
    || (value.detachedReason !== undefined && !VALID_DETACHMENT_REASONS.has(value.detachedReason as EpicAnnotationDetachmentReason))
    || !optionalString(value.detachedAt)
    || !optionalString(value.reattachedAt)
    || !optionalString(value.deletedAt)
    || !optionalString(value.deletedBy)
    || (value.ownership === "legacy_unowned" && (value.origin !== "agent" || value.author !== "agent"))
    || (value.deletedAt !== undefined && value.deletedBy === undefined)
    || (value.deletedBy !== undefined && value.deletedAt === undefined)
    || (value.deletedAt !== undefined && (value.body !== "" || (value.reactions as unknown[]).length > 0))
    || (value.attachmentState === "attached" && (value.detachedReason !== undefined || value.detachedAt !== undefined))
    || (value.attachmentState !== "attached" && (value.detachedReason === undefined || value.detachedAt === undefined))) {
    throw new Error("invalid version 2 annotation");
  }
}

function validateV2ThreadAttachments(annotations: Annotation[]): void {
  const byId = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  for (const annotation of annotations) {
    if (!annotation.parentId) continue;
    const root = rootOf(annotation, byId);
    if (!sameAnchor(annotation.anchor, root.anchor)
      || annotation.status !== root.status
      || annotation.attachmentState !== root.attachmentState
      || annotation.detachedReason !== root.detachedReason
      || annotation.detachedAt !== root.detachedAt) {
      throw new Error("annotation descendants must inherit root thread state");
    }
  }
}

function validateCommonAnnotationFields(value: Record<string, unknown>, epicId: string, documentId: string): void {
  if (typeof value.id !== "string" || !value.id
    || value.epicId !== epicId
    || value.documentId !== documentId
    || !Number.isSafeInteger(value.documentVersion)
    || (value.documentVersion as number) < 0
    || typeof value.author !== "string" || !value.author
    || typeof value.createdAt !== "string" || !value.createdAt
    || typeof value.body !== "string"
    || (value.parentId !== undefined && (typeof value.parentId !== "string" || !value.parentId))
    || !VALID_STATUSES.has(value.status as AnnotationStatus)
    || !Array.isArray(value.reactions)) {
    throw new Error("invalid annotation record");
  }
  validateBlockAnchor(value.anchor);
  const pairs = new Set<string>();
  for (const reaction of value.reactions) {
    if (!isRecord(reaction)) throw new Error("invalid reaction");
    assertExactKeys(reaction, ["emoji", "user"]);
    if (typeof reaction.emoji !== "string" || !reaction.emoji
      || typeof reaction.user !== "string" || !reaction.user) {
      throw new Error("invalid reaction");
    }
    const key = `${reaction.emoji}\u0000${reaction.user}`;
    if (pairs.has(key)) throw new Error("duplicate reaction");
    pairs.add(key);
  }
}

function validateDiscussionGraph(annotations: Array<{ id: string; parentId?: string }>): void {
  const byId = new Map<string, { id: string; parentId?: string }>();
  for (const annotation of annotations) {
    if (byId.has(annotation.id)) throw new Error("duplicate annotation ID");
    byId.set(annotation.id, annotation);
  }
  for (const annotation of annotations) {
    if (annotation.parentId && !byId.has(annotation.parentId)) throw new Error("missing annotation parent");
    const visited = new Set<string>();
    let current: { id: string; parentId?: string } | undefined = annotation;
    while (current?.parentId) {
      if (visited.has(current.id)) throw new Error("cyclic annotation parent chain");
      visited.add(current.id);
      current = byId.get(current.parentId);
    }
  }
}

/* ── Mutation helpers ────────────────────────────────────────────── */

function validateActor(actor: AnnotationActor): AnnotationActor {
  if (!actor || typeof actor.username !== "string" || !actor.username.trim()
    || (actor.origin !== "user" && actor.origin !== "agent")) {
    throw invalidInput("A trusted annotation actor is required.");
  }
  return { username: actor.username, origin: actor.origin };
}

function validateBody(body: unknown): string {
  if (typeof body !== "string" || !body.trim()) throw invalidInput("body must be a non-empty string.");
  return body;
}

function validateReaction(emoji: unknown): string {
  if (typeof emoji !== "string") throw invalidInput("emoji must be a non-empty reaction token.");
  const token = emoji.trim();
  if (!token || Array.from(token).length > 32) {
    throw invalidInput("emoji must be between 1 and 32 characters.");
  }
  return token;
}

function validateBlockAnchor(value: unknown): asserts value is BlockAnchor {
  if (!isRecord(value)) throw invalidInput("anchor must be a block anchor.");
  assertExactKeys(value, ["blockId", "sectionSlug", "anchorText", "lineNumber"]);
  if (typeof value.blockId !== "string" || !value.blockId
    || typeof value.sectionSlug !== "string"
    || typeof value.anchorText !== "string"
    || typeof value.lineNumber !== "number" || !Number.isFinite(value.lineNumber)) {
    throw invalidInput("anchor must contain blockId, sectionSlug, anchorText, and lineNumber.");
  }
}

function isValidStatusTransition(current: AnnotationStatus, next: AnnotationStatus): boolean {
  if (current === next) return true;
  if (current === "open") return next === "resolved" || next === "wontfix";
  return next === "open";
}

function rootOf<T extends { id: string; parentId?: string }>(annotation: T, byId: Map<string, T>): T {
  let current = annotation;
  const visited = new Set<string>();
  while (current.parentId) {
    if (visited.has(current.id)) throw new Error("cyclic annotation parent chain");
    visited.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) throw new Error("missing annotation parent");
    current = parent;
  }
  return current;
}

function applyAttachmentState(
  annotation: Annotation,
  state: AnnotationAttachmentState,
  reason: EpicAnnotationDetachmentReason | undefined,
  now: string,
): boolean {
  let changed = false;
  if (annotation.attachmentState !== state) {
    annotation.attachmentState = state;
    changed = true;
  }
  if (state === "attached") {
    if (annotation.detachedReason !== undefined) {
      delete annotation.detachedReason;
      changed = true;
    }
    if (annotation.detachedAt !== undefined) {
      delete annotation.detachedAt;
      changed = true;
    }
  } else {
    if (annotation.detachedReason !== reason) {
      annotation.detachedReason = reason;
      changed = true;
    }
    if (!annotation.detachedAt) {
      annotation.detachedAt = now;
      changed = true;
    }
  }
  return changed;
}

function sameAnchor(left: BlockAnchor, right: BlockAnchor): boolean {
  return left.blockId === right.blockId
    && left.sectionSlug === right.sectionSlug
    && left.anchorText === right.anchorText
    && left.lineNumber === right.lineNumber;
}

function invalidInput(message: string): CodaScopeAnnotationError {
  return new CodaScopeAnnotationError("invalid_input", message);
}

function conflict(message: string): CodaScopeAnnotationError {
  return new CodaScopeAnnotationError("conflict", message, 409);
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function assertMutationFields(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw invalidInput("Annotation mutation data must be an object.");
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw invalidInput("Annotation mutation contains unsupported fields.");
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: string[],
  optional: string[] = [],
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) throw new Error("unknown schema field");
  const optionalSet = new Set(optional);
  for (const key of allowed) {
    if (!optionalSet.has(key) && !Object.hasOwn(value, key)) throw new Error("missing schema field");
  }
}

function optionalString(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "root";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
