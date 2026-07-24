/* ── CodaScope: Design Doc Service ───────────────────────────────────
   CRUD for epic design documents.
   Follows existing service patterns (module singleton, atomic writes,
   project-directory-based storage).

   Responsibilities:
   - Design doc CRUD (create, read, update, delete, list)
   - Markdown file I/O with word/block count computation
   - Per-doc version history (create, list, get, revert)
   - Server-side resize metadata mutation (mermaid height, image dimensions)
   - Content hashing for optimistic concurrency control
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

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { rm, rmdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { EpicDesignDoc } from "../../src/apps/codascope/codaScopeTypes.js";
import {
  assertPositiveSafeInteger,
  assertSafePathSegment,
  assertStrictDescendant,
  assertVersionIndex,
} from "./codaScopePathSafety.js";
import {
  CodaScopePersistence,
  CodaScopePersistenceCorruptError,
  CodaScopePersistenceError,
  codaScopePersistence,
} from "./codaScopePersistence.js";

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

interface DesignVersionTransaction {
  version: DesignDocVersion;
  previousIndexBytes: Buffer | null;
  snapshotPath: string;
  versionsDirectoryExisted: boolean;
  prune: DesignSnapshotBackup[];
}

export interface DesignDocVersionedEditOptions {
  author: string;
  summary: string;
  expectedHash?: string;
}

export interface DesignDocMutationVersion {
  author: string;
  summary: string;
}

export interface CompanionPublication<T> {
  value: T;
  rollback: () => Promise<void>;
}

export type DesignDocCompanionMutation<T> =
  | { kind: "noop"; value: T }
  | {
    kind: "commit";
    content: string;
    publish: () => Promise<CompanionPublication<T>>;
  };

export type DesignDocCompanionMutationResult<T> =
  | { doc: EpicDesignDoc; contentHash: string; companion: T }
  | null;

export type DesignDocUpdateResult =
  | { doc: EpicDesignDoc; contentHash: string }
  | { conflict: true; currentHash: string; currentContent: string }
  | null;

interface DesignSnapshotBackup {
  version: DesignDocVersion;
  filePath: string;
  content: Buffer;
}

interface DesignContentMutationState {
  index: DesignsIndex;
  previousIndex: DesignsIndex;
  doc: EpicDesignDoc;
  filePath: string;
  previousContent: string;
}

/* ── Resize / delete types ────────────────────────────────────────── */

export type ResizeOp =
  | { type: "mermaid"; index: number; height: number }
  | { type: "image"; index: number; width: number; height: number }
  | { type: "delete-mermaid"; index: number }
  | { type: "delete-image"; index: number }
  | { type: "delete-codeblock"; index: number };

export type CosmeticResizeOp = Extract<ResizeOp, { type: "mermaid" | "image" }>;
export type DestructiveResizeOp = Extract<ResizeOp, { type: `delete-${string}` }>;

/* ── Constants ────────────────────────────────────────────────────── */

const MAX_VERSIONS = 10;

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeDesignDocService {
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
    return path.join(projectDir, "epics", assertSafePathSegment(epicId, "epic ID"), "designs");
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
    const safeDocId = assertSafePathSegment(docId, "document ID");
    const newPath = path.join(designDir, safeDocId, "content.md");
    const oldPath = path.join(designDir, `${safeDocId}.md`);

    // New layout already exists — use it
    if (existsSync(newPath)) return newPath;

    // Old flat layout exists — migrate it
    if (existsSync(oldPath)) {
      try {
        const docDir = path.join(designDir, safeDocId);
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
    return path.join(this.designsDir(projectDir, epicId), assertSafePathSegment(docId, "document ID"));
  }

  /** Versions directory for a specific design doc */
  private versionsDir(projectDir: string, epicId: string, docId: string): string {
    return path.join(this.docDir(projectDir, epicId, docId), "versions");
  }

  /** Versions index path for a specific design doc */
  private versionsIndexPath(projectDir: string, epicId: string, docId: string): string {
    return path.join(this.versionsDir(projectDir, epicId, docId), "versions.json");
  }

  private versionFilePath(vDir: string, version: unknown): string {
    const safeVersion = assertPositiveSafeInteger(version, "design version number");
    const filename = `v${String(safeVersion).padStart(3, "0")}.md`;
    return assertStrictDescendant(vDir, path.join(vDir, filename), "design version file");
  }

  /* ── Index helpers ────────────────────────────────────────────────── */

  private async readIndex(projectDir: string, epicId: string): Promise<DesignsIndex> {
    const p = this.indexPath(projectDir, epicId);
    const index = await this.persistence.readJson(p, {
      context: { storage: "design_index", epicId },
      missing: () => {
        const designDir = this.designsDir(projectDir, epicId);
        const hasDocuments = existsSync(designDir)
          && readdirSync(designDir, { withFileTypes: true })
            .some((entry) => !entry.name.startsWith(".") && entry.name !== "designs.json");
        if (hasDocuments) throw new CodaScopePersistenceCorruptError({ storage: "design_index", epicId });
        return { docs: [] };
      },
      validate: validateDesignsIndex,
    });
    this.assertDesignIndexStorage(this.designsDir(projectDir, epicId), epicId, index);
    return index;
  }

  private writeIndex(projectDir: string, epicId: string, index: DesignsIndex): Promise<void> {
    validateDesignsIndex(index);
    return this.persistence.writeJson(
      this.indexPath(projectDir, epicId),
      index,
      { storage: "design_index", epicId },
    );
  }

  /* ── Version index helpers ───────────────────────────────────────── */

  private async readVersionsIndex(projectDir: string, epicId: string, docId: string): Promise<DesignDocVersionsIndex> {
    const p = this.versionsIndexPath(projectDir, epicId, docId);
    const index = await this.persistence.readJson(p, {
      context: { storage: "design_versions", epicId, documentId: docId },
      missing: () => {
        const versionDir = this.versionsDir(projectDir, epicId, docId);
        const hasSnapshots = existsSync(versionDir)
          && readdirSync(versionDir).some((entry) => /^v\d+\.md$/.test(entry));
        if (hasSnapshots) {
          throw new CodaScopePersistenceCorruptError({
            storage: "design_versions",
            epicId,
            documentId: docId,
          });
        }
        return { versions: [], maxVersions: MAX_VERSIONS };
      },
      validate: validateDesignVersionsIndex,
    });
    const versionDir = this.versionsDir(projectDir, epicId, docId);
    for (const version of index.versions) {
      if (!existsSync(this.versionFilePath(versionDir, version.number))) {
        throw new CodaScopePersistenceCorruptError({
          storage: "design_versions",
          epicId,
          documentId: docId,
        });
      }
    }
    return index;
  }

  private writeVersionsIndex(projectDir: string, epicId: string, docId: string, index: DesignDocVersionsIndex): Promise<void> {
    assertVersionIndex(index, "number", "design version number");
    return this.persistence.writeJson(
      this.versionsIndexPath(projectDir, epicId, docId),
      index,
      { storage: "design_versions", epicId, documentId: docId },
    );
  }

  private designsMutationKey(projectDir: string, epicId: string): string {
    return this.persistence.canonicalKey("design-index", this.designsDir(projectDir, epicId));
  }

  private versionMutationKey(projectDir: string, epicId: string, docId: string): string {
    return this.persistence.canonicalKey("design-versions", this.docDir(projectDir, epicId, docId));
  }

  /**
   * Operations that touch both the design index/content and version history
   * always acquire the epic designs key before the per-document version key.
   */
  private withDesignVersionMutation<T>(
    projectDir: string,
    epicId: string,
    docId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.persistence.withMutation(this.designsMutationKey(projectDir, epicId), () => (
      this.persistence.withMutation(this.versionMutationKey(projectDir, epicId, docId), operation)
    ));
  }

  /**
   * Canonical multi-file ordering for directive-backed design mutations:
   * design index/content -> document versions -> directive sidecar.
   * No caller may acquire the trailing sidecar key and then enter this method.
   */
  private withDesignVersionCompanionMutation<T>(
    projectDir: string,
    epicId: string,
    docId: string,
    companionMutationKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.persistence.withMutation(this.designsMutationKey(projectDir, epicId), () => (
      this.persistence.withMutation(this.versionMutationKey(projectDir, epicId, docId), () => (
        this.persistence.withMutation(companionMutationKey, operation)
      ))
    ));
  }

  private assertDesignIndexStorage(designsDir: string, epicId: string, index: DesignsIndex): void {
    for (const doc of index.docs) {
      if (doc.epicId !== epicId) {
        throw new CodaScopePersistenceCorruptError({
          storage: "design_index",
          epicId,
          documentId: doc.id,
        });
      }
      const currentPath = path.join(designsDir, doc.id, "content.md");
      const legacyPath = path.join(designsDir, `${doc.id}.md`);
      if (!existsSync(currentPath) && !existsSync(legacyPath)) {
        throw new CodaScopePersistenceCorruptError({
          storage: "design_content",
          epicId,
          documentId: doc.id,
        });
      }
    }
  }

  /* ── Content helpers ──────────────────────────────────────────────── */

  /** Compute a short SHA-256 hash of the given text (first 16 hex chars). */
  private computeHash(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
  }

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

  private async readContentMutationState(
    projectDir: string,
    epicId: string,
    docId: string,
  ): Promise<DesignContentMutationState | null> {
    const index = await this.readIndex(projectDir, epicId);
    const doc = index.docs.find((candidate) => candidate.id === docId);
    if (!doc) return null;
    const filePath = this.docPath(projectDir, epicId, docId);
    return {
      index,
      previousIndex: cloneDesignsIndex(index),
      doc,
      filePath,
      previousContent: readFileSync(filePath, "utf-8"),
    };
  }

  private conflictForExpectedHash(
    previousContent: string,
    expectedHash?: string,
  ): { conflict: true; currentHash: string; currentContent: string } | null {
    if (expectedHash === undefined) return null;
    const currentHash = this.computeHash(previousContent);
    return currentHash === expectedHash
      ? null
      : { conflict: true, currentHash, currentContent: previousContent };
  }

  private async persistContentMutation(
    projectDir: string,
    epicId: string,
    docId: string,
    state: DesignContentMutationState,
    content: string,
  ): Promise<{ doc: EpicDesignDoc; contentHash: string }> {
    await this.persistence.writeFile(
      state.filePath,
      content,
      { storage: "design_content", epicId, documentId: docId },
    );
    state.doc.updatedAt = new Date().toISOString();
    state.doc.wordCount = this.countWords(content);
    state.doc.blockCount = this.countBlocks(content);
    try {
      await this.writeIndex(projectDir, epicId, state.index);
    } catch (error) {
      try {
        await this.persistence.writeFile(
          state.filePath,
          state.previousContent,
          { storage: "design_content", epicId, documentId: docId },
        );
        await this.writeIndex(projectDir, epicId, state.previousIndex);
      } catch {
        throw new CodaScopePersistenceError({
          storage: "design_content",
          epicId,
          documentId: docId,
          recovery: "operator_required",
        });
      }
      throw error;
    }
    return { doc: state.doc, contentHash: this.computeHash(content) };
  }

  private async rollbackVersionAfterMutationFailure(
    projectDir: string,
    epicId: string,
    docId: string,
    transaction: DesignVersionTransaction,
    error: unknown,
  ): Promise<never> {
    try {
      await this.rollbackCreatedVersion(projectDir, epicId, docId, transaction);
    } catch {
      throw new CodaScopePersistenceError({
        storage: "design_versions",
        epicId,
        documentId: docId,
        recovery: "operator_required",
      });
    }
    throw error;
  }

  private async rollbackCommittedContentMutation(
    projectDir: string,
    epicId: string,
    docId: string,
    state: DesignContentMutationState,
    transaction: DesignVersionTransaction,
    publication: CompanionPublication<unknown> | null,
    error: unknown,
  ): Promise<never> {
    let rollbackFailed = false;
    if (publication) {
      try {
        await publication.rollback();
      } catch {
        rollbackFailed = true;
      }
    }
    try {
      await this.persistence.writeFile(
        state.filePath,
        state.previousContent,
        { storage: "design_content", epicId, documentId: docId },
      );
      await this.writeIndex(projectDir, epicId, state.previousIndex);
    } catch {
      rollbackFailed = true;
    }
    try {
      await this.rollbackCreatedVersion(projectDir, epicId, docId, transaction);
    } catch {
      rollbackFailed = true;
    }
    if (rollbackFailed) {
      throw new CodaScopePersistenceError({
        storage: "design_directive_transaction",
        epicId,
        documentId: docId,
        recovery: "operator_required",
      });
    }
    throw error;
  }

  /* ── CRUD ─────────────────────────────────────────────────────────── */

  /** List all design docs for an epic. */
  async listDesignDocs(projectId: string, epicId: string): Promise<EpicDesignDoc[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];
    return (await this.readIndex(projectDir, epicId)).docs;
  }

  /** Create a new design doc with optional initial content. */
  async createDesignDoc(projectId: string, epicId: string, opts: {
    title: string;
    content?: string;
    createdBy?: string;
  }): Promise<EpicDesignDoc> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    return this.persistence.withMutation(this.designsMutationKey(projectDir, epicId), async () => {
      const index = await this.readIndex(projectDir, epicId);
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
      const contentPath = path.join(this.docDir(projectDir, epicId, id), "content.md");
      await this.persistence.writeFile(
        contentPath,
        initialContent,
        { storage: "design_content", epicId, documentId: id },
      );
      index.docs.push(doc);
      try {
        await this.writeIndex(projectDir, epicId, index);
      } catch (error) {
        await rm(this.docDir(projectDir, epicId, id), { recursive: true, force: true });
        throw error;
      }
      return doc;
    });
  }

  /** Get design doc content (markdown) with content hash for concurrency control. */
  async getDesignDoc(projectId: string, epicId: string, docId: string): Promise<{ doc: EpicDesignDoc; content: string; contentHash: string } | null> {
    assertSafePathSegment(docId, "document ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const index = await this.readIndex(projectDir, epicId);
    const doc = index.docs.find((d) => d.id === docId);
    if (!doc) return null;

    const filePath = this.docPath(projectDir, epicId, docId);
    const content = readFileSync(filePath, "utf-8");
    const contentHash = this.computeHash(content);

    return { doc, content, contentHash };
  }

  /**
   * Update design doc content.
   * If `expectedHash` is provided, the update is rejected if the current
   * on-disk content hash doesn't match (optimistic concurrency control).
   * Returns `{ doc, contentHash }` on success, or `{ conflict: true, currentHash, currentContent }` on mismatch.
   */
  async updateDesignDoc(
    projectId: string,
    epicId: string,
    docId: string,
    content: string,
    expectedHash?: string,
  ): Promise<DesignDocUpdateResult> {
    assertSafePathSegment(docId, "document ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return this.persistence.withMutation(this.designsMutationKey(projectDir, epicId), async () => {
      const state = await this.readContentMutationState(projectDir, epicId, docId);
      if (!state) return null;
      const conflict = this.conflictForExpectedHash(state.previousContent, expectedHash);
      if (conflict) return conflict;
      return this.persistContentMutation(projectDir, epicId, docId, state, content);
    });
  }

  /**
   * Create a pre-edit snapshot and publish a content/index update under the
   * shared design-then-version lock order.
   */
  async updateDesignDocWithVersion(
    projectId: string,
    epicId: string,
    docId: string,
    content: string,
    options: DesignDocVersionedEditOptions,
  ): Promise<DesignDocUpdateResult> {
    assertSafePathSegment(docId, "document ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return this.withDesignVersionMutation(projectDir, epicId, docId, async () => {
      const state = await this.readContentMutationState(projectDir, epicId, docId);
      if (!state) return null;
      const conflict = this.conflictForExpectedHash(state.previousContent, options.expectedHash);
      if (conflict) return conflict;
      if (content === state.previousContent) {
        return {
          doc: state.doc,
          contentHash: this.computeHash(state.previousContent),
        };
      }

      const transaction = await this.createVersionUnlocked(
        projectDir,
        epicId,
        docId,
        options.author,
        options.summary,
        state.previousContent,
      );
      let updated: { doc: EpicDesignDoc; contentHash: string };
      try {
        updated = await this.persistContentMutation(projectDir, epicId, docId, state, content);
      } catch (error) {
        return this.rollbackVersionAfterMutationFailure(
          projectDir,
          epicId,
          docId,
          transaction,
          error,
        );
      }
      await this.pruneCommittedDesignSnapshots(projectDir, epicId, docId, transaction.prune);
      return updated;
    });
  }

  /**
   * Transform the current document and publish one companion sidecar while
   * holding the complete design/version/sidecar boundary. The transformation
   * sees content read after all locks are held. Companion publication is last;
   * any publication or snapshot-pruning failure rolls content, metadata,
   * version state, and the companion back to their exact predecessors.
   */
  async mutateDesignDocWithVersionAndCompanion<T>(
    projectId: string,
    epicId: string,
    docId: string,
    companionMutationKey: string,
    options: DesignDocMutationVersion,
    prepare: (currentContent: string) => Promise<DesignDocCompanionMutation<T>>,
  ): Promise<DesignDocCompanionMutationResult<T>> {
    assertSafePathSegment(docId, "document ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return this.withDesignVersionCompanionMutation(
      projectDir,
      epicId,
      docId,
      companionMutationKey,
      async () => {
        const state = await this.readContentMutationState(projectDir, epicId, docId);
        if (!state) return null;
        const prepared = await prepare(state.previousContent);
        if (prepared.kind === "noop") {
          return {
            doc: state.doc,
            contentHash: this.computeHash(state.previousContent),
            companion: prepared.value,
          };
        }

        const transaction = await this.createVersionUnlocked(
          projectDir,
          epicId,
          docId,
          options.author,
          options.summary,
          state.previousContent,
        );
        try {
          await this.persistContentMutation(
            projectDir,
            epicId,
            docId,
            state,
            prepared.content,
          );
        } catch (error) {
          return this.rollbackVersionAfterMutationFailure(
            projectDir,
            epicId,
            docId,
            transaction,
            error,
          );
        }

        let publication: CompanionPublication<T> | null = null;
        try {
          publication = await prepared.publish();
          await this.pruneCommittedDesignSnapshots(projectDir, epicId, docId, transaction.prune);
        } catch (error) {
          return this.rollbackCommittedContentMutation(
            projectDir,
            epicId,
            docId,
            state,
            transaction,
            publication,
            error,
          );
        }
        return {
          doc: state.doc,
          contentHash: this.computeHash(prepared.content),
          companion: publication.value,
        };
      },
    );
  }

  /** Archive a design doc (soft delete — preserves file on disk). Also clears pin. */
  async archiveDesignDoc(projectId: string, epicId: string, docId: string): Promise<boolean> {
    assertSafePathSegment(docId, "document ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    return this.persistence.withMutation(this.designsMutationKey(projectDir, epicId), async () => {
      const index = await this.readIndex(projectDir, epicId);
      const doc = index.docs.find((candidate) => candidate.id === docId);
      if (!doc) return false;
      doc.archivedAt = new Date().toISOString();
      delete doc.pinnedAt;
      await this.writeIndex(projectDir, epicId, index);
      return true;
    });
  }

  /** Pin a design doc. */
  async pinDesignDoc(projectId: string, epicId: string, docId: string): Promise<boolean> {
    assertSafePathSegment(docId, "document ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    return this.persistence.withMutation(this.designsMutationKey(projectDir, epicId), async () => {
      const index = await this.readIndex(projectDir, epicId);
      const doc = index.docs.find((candidate) => candidate.id === docId);
      if (!doc) return false;
      doc.pinnedAt = new Date().toISOString();
      await this.writeIndex(projectDir, epicId, index);
      return true;
    });
  }

  /** Unpin a design doc. */
  async unpinDesignDoc(projectId: string, epicId: string, docId: string): Promise<boolean> {
    assertSafePathSegment(docId, "document ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    return this.persistence.withMutation(this.designsMutationKey(projectDir, epicId), async () => {
      const index = await this.readIndex(projectDir, epicId);
      const doc = index.docs.find((candidate) => candidate.id === docId);
      if (!doc || !doc.pinnedAt) return false;
      delete doc.pinnedAt;
      await this.writeIndex(projectDir, epicId, index);
      return true;
    });
  }

  /** Unarchive a design doc (restore from soft delete). */
  async unarchiveDesignDoc(projectId: string, epicId: string, docId: string): Promise<boolean> {
    assertSafePathSegment(docId, "document ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    return this.persistence.withMutation(this.designsMutationKey(projectDir, epicId), async () => {
      const index = await this.readIndex(projectDir, epicId);
      const doc = index.docs.find((candidate) => candidate.id === docId);
      if (!doc || !doc.archivedAt) return false;
      delete doc.archivedAt;
      await this.writeIndex(projectDir, epicId, index);
      return true;
    });
  }

  /* ── Server-Side Resize ─────────────────────────────────────────────── */

  /**
   * Apply resize or delete mutation to the document content server-side.
   * Reads the current content.md from disk, applies the transformation,
   * and writes it back. Resize ops do NOT create version snapshots (cosmetic);
   * delete ops DO create snapshots (destructive).
   * Returns the updated content + hash, or null if the doc doesn't exist.
   */
  async applyResizeMetadata(
    projectId: string,
    epicId: string,
    docId: string,
    resize: CosmeticResizeOp,
  ): Promise<{ doc: EpicDesignDoc; content: string; contentHash: string } | null>;
  async applyResizeMetadata(
    projectId: string,
    epicId: string,
    docId: string,
    resize: DestructiveResizeOp,
    version: DesignDocMutationVersion,
  ): Promise<{ doc: EpicDesignDoc; content: string; contentHash: string } | null>;
  async applyResizeMetadata(
    projectId: string,
    epicId: string,
    docId: string,
    resize: ResizeOp,
    version?: DesignDocMutationVersion,
  ): Promise<{ doc: EpicDesignDoc; content: string; contentHash: string } | null> {
    assertSafePathSegment(docId, "document ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const isDestructive = isDestructiveResizeOp(resize);
    if (isDestructive && (
      !version
      || typeof version.author !== "string"
      || !version.author.trim()
      || typeof version.summary !== "string"
      || !version.summary.trim()
    )) {
      throw new Error("Destructive design document mutations require version author and summary.");
    }
    if (!isDestructive && version !== undefined) {
      throw new Error("Cosmetic design document resizes cannot create versions.");
    }

    const operation = async () => {
      const state = await this.readContentMutationState(projectDir, epicId, docId);
      if (!state) return null;
      let content = state.previousContent;
      let updated = false;

      if (resize.type === "mermaid") {
        const roundedHeight = Math.round(resize.height);
        let mermaidIdx = 0;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const fenceMatch = lines[i].match(/^(\s*(`{3,}|~{3,})\s*mermaid)\s*(?:\{height=\d+\})?\s*$/);
          if (fenceMatch) {
            if (mermaidIdx === resize.index) {
              lines[i] = `${fenceMatch[1]} {height=${roundedHeight}}`;
              updated = true;
              break;
            }
            mermaidIdx++;
          }
        }
        if (updated) content = lines.join("\n");
      } else if (resize.type === "image") {
        const rw = Math.round(resize.width);
        const rh = Math.round(resize.height);
        let imgIdx = 0;
        const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        let match: RegExpExecArray | null;

        while ((match = imgRegex.exec(content)) !== null) {
          if (imgIdx === resize.index) {
            const fullMatch = match[0];
            let alt = match[1];
            const url = match[2];
            // Strip existing |WxH from alt
            alt = alt.replace(/\|\d+x\d+$/, "").trim();
            const newTag = `![${alt}|${rw}x${rh}](${url})`;
            content = content.slice(0, match.index) + newTag + content.slice(match.index + fullMatch.length);
            updated = true;
            break;
          }
          imgIdx++;
        }
      } else if (resize.type === "delete-mermaid") {
        // Remove the Nth mermaid fence block (opening fence + content + closing fence)
        let mermaidIdx = 0;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const fenceMatch = lines[i].match(/^(\s*)(`{3,}|~{3,})\s*mermaid\s*(?:\{height=\d+\})?\s*$/);
          if (fenceMatch) {
            if (mermaidIdx === resize.index) {
              const fenceChar = fenceMatch[2][0]; // ` or ~
              const fenceLen = fenceMatch[2].length;
              // Find closing fence
              let closeIdx = -1;
              for (let j = i + 1; j < lines.length; j++) {
                const closeMatch = lines[j].match(new RegExp(`^\\s*${fenceChar.replace(/[`~]/g, "\\$&")}{${fenceLen},}\\s*$`));
                if (closeMatch) { closeIdx = j; break; }
              }
              if (closeIdx >= 0) {
                // Remove lines i..closeIdx, plus trailing blank line if present
                let removeEnd = closeIdx + 1;
                if (removeEnd < lines.length && lines[removeEnd].trim() === "") removeEnd++;
                // Also remove leading blank line if present
                let removeStart = i;
                if (removeStart > 0 && lines[removeStart - 1].trim() === "") removeStart--;
                lines.splice(removeStart, removeEnd - removeStart);
                updated = true;
              }
              break;
            }
            mermaidIdx++;
          }
        }
        if (updated) content = lines.join("\n");
      } else if (resize.type === "delete-image") {
        // Remove the Nth markdown image
        let imgIdx = 0;
        const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        let match: RegExpExecArray | null;

        while ((match = imgRegex.exec(content)) !== null) {
          if (imgIdx === resize.index) {
            const before = content.slice(0, match.index);
            const after = content.slice(match.index + match[0].length);
            // If the image was on its own line, remove the entire line (+ trailing newline)
            const lineStart = before.lastIndexOf("\n") + 1;
            const lineEnd = after.indexOf("\n");
            const lineBefore = before.slice(lineStart);
            const lineAfter = lineEnd >= 0 ? after.slice(0, lineEnd) : after;
            if (lineBefore.trim() === "" && lineAfter.trim() === "") {
              // Image was alone on the line — remove the whole line
              let removeFrom = lineStart > 0 ? lineStart - 1 : lineStart; // eat preceding newline
              let removeTo = match.index + match[0].length + (lineEnd >= 0 ? lineEnd + 1 : after.length);
              // Also eat one extra blank line after if present
              const restAfter = content.slice(removeTo);
              if (restAfter.startsWith("\n")) removeTo++;
              content = content.slice(0, removeFrom) + content.slice(removeTo);
            } else {
              // Image is inline — just remove the tag
              content = before + after;
            }
            updated = true;
            break;
          }
          imgIdx++;
        }
      } else if (resize.type === "delete-codeblock") {
        // Remove the Nth code fence block (any language, including bare fences)
        let codeIdx = 0;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const fenceMatch = lines[i].match(/^(\s*)(`{3,}|~{3,})(.*)$/);
          if (fenceMatch) {
            // Skip mermaid fences — those are handled by delete-mermaid
            const lang = fenceMatch[3].trim().split(/\s/)[0].toLowerCase();
            if (lang === "mermaid") {
              // Skip past the closing fence
              const fc = fenceMatch[2][0];
              const fl = fenceMatch[2].length;
              for (let j = i + 1; j < lines.length; j++) {
                if (new RegExp(`^\\s*${fc.replace(/[`~]/g, "\\$&")}{${fl},}\\s*$`).test(lines[j])) {
                  i = j;
                  break;
                }
              }
              continue;
            }
            if (codeIdx === resize.index) {
              const fenceChar = fenceMatch[2][0];
              const fenceLen = fenceMatch[2].length;
              // Find closing fence
              let closeIdx = -1;
              for (let j = i + 1; j < lines.length; j++) {
                const closeMatch = lines[j].match(new RegExp(`^\\s*${fenceChar.replace(/[`~]/g, "\\$&")}{${fenceLen},}\\s*$`));
                if (closeMatch) { closeIdx = j; break; }
              }
              if (closeIdx >= 0) {
                let removeEnd = closeIdx + 1;
                if (removeEnd < lines.length && lines[removeEnd].trim() === "") removeEnd++;
                let removeStart = i;
                if (removeStart > 0 && lines[removeStart - 1].trim() === "") removeStart--;
                lines.splice(removeStart, removeEnd - removeStart);
                updated = true;
              }
              break;
            }
            // Not our target — skip to closing fence
            const fc = fenceMatch[2][0];
            const fl = fenceMatch[2].length;
            for (let j = i + 1; j < lines.length; j++) {
              if (new RegExp(`^\\s*${fc.replace(/[`~]/g, "\\$&")}{${fl},}\\s*$`).test(lines[j])) {
                i = j;
                break;
              }
            }
            codeIdx++;
          }
        }
        if (updated) content = lines.join("\n");
      }

      if (!updated) return null;

      const transaction = isDestructive
        ? await this.createVersionUnlocked(
          projectDir,
          epicId,
          docId,
          version!.author,
          version!.summary,
          state.previousContent,
        )
        : null;
      let result: { doc: EpicDesignDoc; contentHash: string };
      try {
        result = await this.persistContentMutation(projectDir, epicId, docId, state, content);
      } catch (error) {
        if (transaction) {
          return this.rollbackVersionAfterMutationFailure(
            projectDir,
            epicId,
            docId,
            transaction,
            error,
          );
        }
        throw error;
      }
      if (transaction) {
        await this.pruneCommittedDesignSnapshots(projectDir, epicId, docId, transaction.prune);
      }
      return { doc: result.doc, content, contentHash: result.contentHash };
    };

    return isDestructive
      ? this.withDesignVersionMutation(projectDir, epicId, docId, operation)
      : this.persistence.withMutation(this.designsMutationKey(projectDir, epicId), operation);
  }

  /* ── Bulk read (used by version service and getEpic) ──────────────── */

  /** Read the designs index directly from a project dir (no projectId lookup). */
  async readDesignsIndex(epicDir: string): Promise<EpicDesignDoc[]> {
    const indexPath = path.join(epicDir, "designs", "designs.json");
    const epicId = path.basename(epicDir);
    const index = await this.persistence.readJson(indexPath, {
      context: { storage: "design_index", epicId },
      missing: () => {
        const designsDir = path.dirname(indexPath);
        const hasDocuments = existsSync(designsDir)
          && readdirSync(designsDir, { withFileTypes: true })
            .some((entry) => !entry.name.startsWith(".") && entry.name !== "designs.json");
        if (hasDocuments) throw new CodaScopePersistenceCorruptError({ storage: "design_index", epicId });
        return { docs: [] };
      },
      validate: validateDesignsIndex,
    });
    this.assertDesignIndexStorage(path.dirname(indexPath), epicId, index);
    return index.docs;
  }

  /* ── Version History ─────────────────────────────────────────────── */

  /**
   * Create a version snapshot of the current document content.
   * Max 10 versions — oldest are pruned automatically.
   */
  async createVersion(projectId: string, epicId: string, docId: string, author: string, summary: string): Promise<DesignDocVersion> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");
    return this.withDesignVersionMutation(projectDir, epicId, docId, async () => {
      const state = await this.readContentMutationState(projectDir, epicId, docId);
      if (!state) throw new Error("Design doc not found");
      const transaction = await this.createVersionUnlocked(
        projectDir,
        epicId,
        docId,
        author,
        summary,
        state.previousContent,
      );
      await this.pruneCommittedDesignSnapshots(projectDir, epicId, docId, transaction.prune);
      return transaction.version;
    });
  }

  /** List all versions for a design doc. */
  async listDocVersions(projectId: string, epicId: string, docId: string): Promise<DesignDocVersion[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];
    return (await this.readVersionsIndex(projectDir, epicId, docId)).versions;
  }

  /** Get a specific version's content. */
  async getDocVersion(projectId: string, epicId: string, docId: string, versionNum: number): Promise<{ version: DesignDocVersion; content: string } | null> {
    const safeVersion = assertPositiveSafeInteger(versionNum, "design version number");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const vIndex = await this.readVersionsIndex(projectDir, epicId, docId);
    const vMeta = vIndex.versions.find((v) => v.number === safeVersion);
    if (!vMeta) return null;

    const vDir = this.versionsDir(projectDir, epicId, docId);
    const vFile = this.versionFilePath(vDir, safeVersion);
    if (!existsSync(vFile)) {
      throw new CodaScopePersistenceCorruptError({
        storage: "design_versions",
        epicId,
        documentId: docId,
      });
    }

    return { version: vMeta, content: readFileSync(vFile, "utf-8") };
  }

  /**
   * Revert to a specific version. This:
   * 1. Creates a NEW version snapshot of current content (so the revert itself is undoable)
   * 2. Copies the target version content back to content.md
   * 3. Updates the doc metadata
   * Returns the restored content.
   */
  async revertToVersion(
    projectId: string,
    epicId: string,
    docId: string,
    versionNum: number,
    author: string,
  ): Promise<{ content: string; revertVersion: DesignDocVersion } | null> {
    if (typeof author !== "string" || !author.trim()) {
      throw new Error("Design document revert requires an authenticated author.");
    }
    const safeVersion = assertPositiveSafeInteger(versionNum, "design version number");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return this.withDesignVersionMutation(projectDir, epicId, docId, async () => {
      const state = await this.readContentMutationState(projectDir, epicId, docId);
      if (!state) return null;
      const index = await this.readVersionsIndex(projectDir, epicId, docId);
      const targetMeta = index.versions.find((version) => version.number === safeVersion);
      if (!targetMeta) return null;
      const targetPath = this.versionFilePath(this.versionsDir(projectDir, epicId, docId), safeVersion);
      if (!existsSync(targetPath)) {
        throw new CodaScopePersistenceCorruptError({
          storage: "design_versions",
          epicId,
          documentId: docId,
        });
      }
      const targetContent = readFileSync(targetPath, "utf-8");
      const transaction = await this.createVersionUnlocked(
        projectDir,
        epicId,
        docId,
        author,
        `Reverted to version ${safeVersion}`,
        state.previousContent,
      );

      try {
        await this.persistContentMutation(projectDir, epicId, docId, state, targetContent);
      } catch (error) {
        return this.rollbackVersionAfterMutationFailure(
          projectDir,
          epicId,
          docId,
          transaction,
          error,
        );
      }

      await this.pruneCommittedDesignSnapshots(projectDir, epicId, docId, transaction.prune);
      return { content: targetContent, revertVersion: transaction.version };
    });
  }

  private async createVersionUnlocked(
    projectDir: string,
    epicId: string,
    docId: string,
    author: string,
    summary: string,
    currentContent?: string,
  ): Promise<DesignVersionTransaction> {
    // The index is validated before docPath can perform legacy migration.
    const indexPath = this.versionsIndexPath(projectDir, epicId, docId);
    const previousIndexBytes = existsSync(indexPath) ? readFileSync(indexPath) : null;
    const previousIndex = await this.readVersionsIndex(projectDir, epicId, docId);
    const versionsDirectoryExisted = existsSync(this.versionsDir(projectDir, epicId, docId));
    const snapshotContent = currentContent
      ?? readFileSync(this.docPath(projectDir, epicId, docId), "utf-8");
    let maxVersion = 0;
    for (const version of previousIndex.versions) maxVersion = Math.max(maxVersion, version.number);
    const nextNum = assertPositiveSafeInteger(maxVersion + 1, "design version number");
    const snapshotPath = this.versionFilePath(this.versionsDir(projectDir, epicId, docId), nextNum);
    const version: DesignDocVersion = {
      number: nextNum,
      createdAt: new Date().toISOString(),
      author,
      summary,
      wordCount: this.countWords(snapshotContent),
    };
    const nextIndex: DesignDocVersionsIndex = {
      maxVersions: MAX_VERSIONS,
      versions: [...previousIndex.versions, version],
    };
    const pruneVersions = nextIndex.versions.length > MAX_VERSIONS
      ? nextIndex.versions.slice(0, nextIndex.versions.length - MAX_VERSIONS)
      : [];
    const versionDirectory = this.versionsDir(projectDir, epicId, docId);
    const prune = pruneVersions.map((prunedVersion) => {
      const filePath = this.versionFilePath(versionDirectory, prunedVersion.number);
      if (!existsSync(filePath)) {
        throw new CodaScopePersistenceCorruptError({
          storage: "design_versions",
          epicId,
          documentId: docId,
        });
      }
      return {
        version: prunedVersion,
        filePath,
        content: readFileSync(filePath),
      };
    });
    nextIndex.versions = nextIndex.versions.slice(-MAX_VERSIONS);

    await this.persistence.writeFile(
      snapshotPath,
      snapshotContent,
      { storage: "design_version_snapshot", epicId, documentId: docId },
    );
    try {
      await this.writeVersionsIndex(projectDir, epicId, docId, nextIndex);
    } catch (error) {
      try {
        await rm(snapshotPath, { force: true });
        if (!versionsDirectoryExisted) {
          await rmdir(this.versionsDir(projectDir, epicId, docId));
        }
      } catch {
        throw new CodaScopePersistenceError({
          storage: "design_versions",
          epicId,
          documentId: docId,
          recovery: "operator_required",
        });
      }
      throw error;
    }
    return {
      version,
      previousIndexBytes,
      snapshotPath,
      versionsDirectoryExisted,
      prune,
    };
  }

  private async rollbackCreatedVersion(
    projectDir: string,
    epicId: string,
    docId: string,
    transaction: DesignVersionTransaction,
  ): Promise<void> {
    for (const backup of transaction.prune) {
      if (!existsSync(backup.filePath)) {
        await this.persistence.writeFile(
          backup.filePath,
          backup.content,
          { storage: "design_version_snapshot", epicId, documentId: docId },
        );
      }
    }
    const indexPath = this.versionsIndexPath(projectDir, epicId, docId);
    if (transaction.previousIndexBytes) {
      await this.persistence.writeFile(
        indexPath,
        transaction.previousIndexBytes,
        { storage: "design_versions", epicId, documentId: docId },
      );
    } else {
      await rm(indexPath, { force: true });
    }
    await rm(transaction.snapshotPath, { force: true });
    if (!transaction.versionsDirectoryExisted) {
      await rmdir(this.versionsDir(projectDir, epicId, docId));
    }
  }

  private async pruneCommittedDesignSnapshots(
    projectDir: string,
    epicId: string,
    docId: string,
    snapshots: DesignSnapshotBackup[],
  ): Promise<void> {
    try {
      for (const snapshot of snapshots) {
        await rm(snapshot.filePath, { force: true });
      }
    } catch {
      throw new CodaScopePersistenceError({
        storage: "design_versions",
        epicId,
        documentId: docId,
        recovery: "orphan_snapshot",
      });
    }
  }

  /* ── Design Doc Images ──────────────────────────────────────────── */

  /**
   * Upload an image file to a design doc's images/ directory.
   * Returns the relative path usable in markdown (images/<filename>).
   */
  async uploadDocImage(
    projectId: string,
    epicId: string,
    docId: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ relativePath: string; filename: string }> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    const docDirectory = this.docDir(projectDir, epicId, docId);
    const imagesDir = path.join(docDirectory, "images");
    if (!existsSync(imagesDir)) mkdirSync(imagesDir, { recursive: true });

    // Generate unique filename: <timestamp>_<hash>.<ext>
    const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const hash = crypto.createHash("md5").update(buffer).digest("hex").slice(0, 8);
    const filename = `${Date.now()}_${hash}.${ext}`;

    writeFileSync(path.join(imagesDir, filename), buffer);

    return {
      relativePath: `images/${filename}`,
      filename,
    };
  }

  /**
   * Get the filesystem path for a design doc image.
   * Returns null if the file doesn't exist.
   */
  getDocImagePath(projectId: string, epicId: string, docId: string, filename: string): string | null {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const safeName = assertSafePathSegment(filename, "image filename");
    const imagePath = path.join(this.docDir(projectDir, epicId, docId), "images", safeName);
    return existsSync(imagePath) ? imagePath : null;
  }
}

function validateDesignsIndex(value: unknown): DesignsIndex {
  if (!isRecord(value) || !Array.isArray(value.docs)) throw new Error("invalid designs index");
  const ids = new Set<string>();
  for (const doc of value.docs) {
    if (!isRecord(doc)
      || typeof doc.id !== "string"
      || typeof doc.epicId !== "string"
      || typeof doc.title !== "string"
      || typeof doc.createdAt !== "string"
      || typeof doc.updatedAt !== "string"
      || typeof doc.createdBy !== "string"
      || !isNonNegativeNumber(doc.wordCount)
      || !isNonNegativeNumber(doc.blockCount)
      || !isNonNegativeNumber(doc.annotationCount)
      || !isNonNegativeNumber(doc.directiveCount)
      || (doc.template !== undefined && typeof doc.template !== "string")
      || (doc.archivedAt !== undefined && typeof doc.archivedAt !== "string")
      || (doc.pinnedAt !== undefined && typeof doc.pinnedAt !== "string")
      || ids.has(doc.id)) {
      throw new Error("invalid design record");
    }
    assertSafePathSegment(doc.id, "document ID");
    ids.add(doc.id);
  }
  return value as unknown as DesignsIndex;
}

function validateDesignVersionsIndex(value: unknown): DesignDocVersionsIndex {
  assertVersionIndex(value, "number", "design version number");
  if (!isRecord(value)
    || !Array.isArray(value.versions)
    || typeof value.maxVersions !== "number"
    || !Number.isSafeInteger(value.maxVersions)
    || value.maxVersions <= 0) {
    throw new Error("invalid design version index");
  }
  for (const version of value.versions) {
    if (!isRecord(version)
      || typeof version.createdAt !== "string"
      || typeof version.author !== "string"
      || typeof version.summary !== "string"
      || !isNonNegativeNumber(version.wordCount)) {
      throw new Error("invalid design version record");
    }
  }
  return value as unknown as DesignDocVersionsIndex;
}

function cloneDesignsIndex(index: DesignsIndex): DesignsIndex {
  return { docs: index.docs.map((doc) => ({ ...doc })) };
}

function isDestructiveResizeOp(resize: ResizeOp): resize is DestructiveResizeOp {
  return resize.type === "delete-mermaid"
    || resize.type === "delete-image"
    || resize.type === "delete-codeblock";
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
