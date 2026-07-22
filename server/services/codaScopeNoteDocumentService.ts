/* ── CodaScope: Note Document Service ────────────────────────────────
   Owns opaque document metadata and blobs inside a note's existing asset
   bundle. It deliberately does not move notes, create ZIPs, or read document
   contents: CodaScopeNoteTransferService and the bundle services remain the
   sole lifecycle pipeline for the complete companion directory.
   ──────────────────────────────────────────────────────────────────── */

import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { NoteDocument, NoteDocumentListResponse, NoteScope, NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";
import type { CodaScopeNoteService, NoteResolveOpts } from "./codaScopeNoteService.js";
import type { CodaScopeNoteUserPrefsService } from "./codaScopeNoteUserPrefsService.js";
import {
  assertSafePathSegment,
  assertStrictDescendant,
  resolveWithin,
} from "./codaScopePathSafety.js";

interface DocumentManifest {
  version: 1;
  documents: NoteDocument[];
}

export interface NoteDocumentDownload {
  absolutePath: string;
  filename: string;
  mimeType: string | null;
}

export interface CreateNoteDocumentInput {
  temporaryPath: string;
  originalFilename: string;
  declaredMimeType?: string | null;
}

const DOCUMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_NOTE_BYTES = 500 * 1024 * 1024;
const MAX_DISPLAY_NAME_LENGTH = 255;
const MAX_COMMENT_LENGTH = 20_000;

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function safeDisplayName(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_DISPLAY_NAME_LENGTH || hasControlCharacters(normalized)) {
    throw new Error(`Invalid ${field}.`);
  }
  return normalized;
}

function safeOriginalFilename(value: string): string {
  const basename = path.basename(value).trim();
  return safeDisplayName(basename || "document", "filename");
}

/** Hash a file without buffering a potentially 100 MB upload in memory. */
async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export class CodaScopeNoteDocumentService {
  static readonly MAX_FILE_BYTES = MAX_FILE_BYTES;
  static readonly MAX_NOTE_BYTES = MAX_NOTE_BYTES;

  constructor(
    private noteSvc: CodaScopeNoteService,
    private userPrefsSvc: CodaScopeNoteUserPrefsService,
  ) {}

  setServices(noteSvc: CodaScopeNoteService, userPrefsSvc: CodaScopeNoteUserPrefsService): void {
    this.noteSvc = noteSvc;
    this.userPrefsSvc = userPrefsSvc;
  }

  async listDocuments(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): Promise<NoteDocumentListResponse> {
    const { note, bundle } = await this.requireAuthorizedNote(scope, visibility, opts, notePath);
    const manifest = await this.readManifest(bundle.assetsDir);
    const userId = this.requireActor(opts);
    const starred = new Set(this.userPrefsSvc.getDocumentStars(userId)
      .filter((item) => item.noteId === note.frontmatter.id)
      .map((item) => item.documentId));
    const documents = manifest.documents.map((document) => ({ ...document, starred: starred.has(document.id) || undefined }));
    const orderActive = (left: NoteDocument, right: NoteDocument) => {
      const leftPinned = Boolean(left.pinnedAt);
      const rightPinned = Boolean(right.pinnedAt);
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
      if (Boolean(left.starred) !== Boolean(right.starred)) return left.starred ? -1 : 1;
      return right.uploadedAt.localeCompare(left.uploadedAt);
    };
    const active = documents.filter((document) => !document.archivedAt).sort(orderActive);
    const archived = documents.filter((document) => document.archivedAt)
      .sort((left, right) => (right.archivedAt ?? "").localeCompare(left.archivedAt ?? ""));
    return {
      active,
      archived,
      totalBytes: manifest.documents.reduce((total, document) => total + document.sizeBytes, 0),
      maxBytes: MAX_NOTE_BYTES,
    };
  }

  /** Stage outside the manifest, then publish blob and manifest atomically. */
  async createDocument(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    input: CreateNoteDocumentInput,
  ): Promise<NoteDocument> {
    try {
    const actor = this.requireActor(opts);
    const { note, bundle } = await this.requireAuthorizedNote(scope, visibility, opts, notePath);
    if (!existsSync(input.temporaryPath)) throw new Error("Uploaded file is missing.");
    const fileStat = statSync(input.temporaryPath);
    if (!fileStat.isFile()) throw new Error("Uploaded path is not a file.");
    if (fileStat.size > MAX_FILE_BYTES) throw new Error("Document exceeds the 100 MB per-file limit.");
    const manifest = await this.readManifest(bundle.assetsDir);
    const existingBytes = manifest.documents.reduce((total, document) => total + document.sizeBytes, 0);
    if (existingBytes + fileStat.size > MAX_NOTE_BYTES) {
      throw new Error("Document would exceed the 500 MB per-note limit.");
    }

    const id = randomUUID();
    const originalFilename = safeOriginalFilename(input.originalFilename);
    const documentsRoot = this.documentsRoot(bundle.assetsDir);
    const stagingDir = assertStrictDescendant(
      documentsRoot,
      path.join(documentsRoot, `.upload-${id}`),
      "document upload staging target",
    );
    const finalDir = assertStrictDescendant(
      documentsRoot,
      path.join(documentsRoot, id),
      "document upload target",
    );
    const blobPath = path.join(stagingDir, "blob");
    const now = new Date().toISOString();
    const sha256 = await hashFile(input.temporaryPath);
    const document: NoteDocument = {
      id,
      storedPath: `documents/${id}/blob`,
      originalFilename,
      displayName: originalFilename,
      declaredMimeType: this.normalizeMimeType(input.declaredMimeType),
      detectedMimeType: null,
      sizeBytes: fileStat.size,
      sha256,
      uploadedAt: now,
      uploadedBy: actor,
      comment: "",
    };

    mkdirSync(documentsRoot, { recursive: true });
    if (existsSync(stagingDir) || existsSync(finalDir)) throw new Error("Document storage collision.");
    try {
      mkdirSync(stagingDir, { recursive: false });
      // Copy to the final filesystem first so the last rename is atomic even
      // when the temporary upload directory is on another volume.
      copyFileSync(input.temporaryPath, blobPath);
      const copied = statSync(blobPath);
      if (copied.size !== document.sizeBytes || await hashFile(blobPath) !== document.sha256) {
        throw new Error("Uploaded file changed while being staged.");
      }
      renameSync(stagingDir, finalDir);
      manifest.documents.push(document);
      this.writeManifest(bundle.assetsDir, manifest);
      return document;
    } catch (error) {
      rmSync(stagingDir, { recursive: true, force: true });
      rmSync(finalDir, { recursive: true, force: true });
      throw error;
    }
    } finally {
      try { unlinkSync(input.temporaryPath); } catch { /* already cleaned by multer or caller */ }
    }
  }

  async updateDocument(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    documentId: string,
    changes: { displayName?: string; comment?: string },
  ): Promise<NoteDocument> {
    const actor = this.requireActor(opts);
    const { bundle } = await this.requireAuthorizedNote(scope, visibility, opts, notePath);
    const manifest = await this.readManifest(bundle.assetsDir);
    const document = this.findDocument(manifest, documentId);
    const previousDisplayName = document.displayName;
    if (changes.displayName !== undefined) document.displayName = safeDisplayName(changes.displayName, "display name");
    if (changes.comment !== undefined) {
      if (typeof changes.comment !== "string" || changes.comment.length > MAX_COMMENT_LENGTH || hasControlCharacters(changes.comment.replace(/\n|\r|\t/g, ""))) {
        throw new Error("Invalid document comment.");
      }
      document.comment = changes.comment;
      document.commentUpdatedAt = new Date().toISOString();
      document.commentUpdatedBy = actor;
    }
    this.writeManifest(bundle.assetsDir, manifest);
    if (document.displayName !== previousDisplayName) {
      this.userPrefsSvc.updateDocumentStarDisplayName(document.id, document.displayName);
    }
    return document;
  }

  async setArchived(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    documentId: string,
    archived: boolean,
  ): Promise<NoteDocument> {
    const actor = this.requireActor(opts);
    const { bundle } = await this.requireAuthorizedNote(scope, visibility, opts, notePath);
    const manifest = await this.readManifest(bundle.assetsDir);
    const document = this.findDocument(manifest, documentId);
    if (archived) {
      document.archivedAt = new Date().toISOString();
      document.archivedBy = actor;
    } else {
      delete document.archivedAt;
      delete document.archivedBy;
    }
    this.writeManifest(bundle.assetsDir, manifest);
    return document;
  }

  async setPinned(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    documentId: string,
    pinned: boolean,
  ): Promise<NoteDocument> {
    const actor = this.requireActor(opts);
    const { bundle } = await this.requireAuthorizedNote(scope, visibility, opts, notePath);
    const manifest = await this.readManifest(bundle.assetsDir);
    const document = this.findDocument(manifest, documentId);
    if (pinned) {
      document.pinnedAt = new Date().toISOString();
      document.pinnedBy = actor;
    } else {
      delete document.pinnedAt;
      delete document.pinnedBy;
    }
    this.writeManifest(bundle.assetsDir, manifest);
    return document;
  }

  async setStarred(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    documentId: string,
    starred: boolean,
  ): Promise<NoteDocument> {
    const actor = this.requireActor(opts);
    const { note, bundle } = await this.requireAuthorizedNote(scope, visibility, opts, notePath);
    const manifest = await this.readManifest(bundle.assetsDir);
    const document = this.findDocument(manifest, documentId);
    if (starred) {
      this.userPrefsSvc.starDocument(actor, {
        documentId: document.id,
        noteId: note.frontmatter.id,
        scope,
        visibility,
        path: this.canonicalNotePath(notePath),
        displayName: document.displayName,
      });
    } else {
      this.userPrefsSvc.unstarDocument(actor, document.id);
    }
    return { ...document, starred: starred || undefined };
  }

  async resolveDownload(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    documentId: string,
  ): Promise<NoteDocumentDownload> {
    const { bundle } = await this.requireAuthorizedNote(scope, visibility, opts, notePath);
    const manifest = await this.readManifest(bundle.assetsDir);
    const document = this.findDocument(manifest, documentId);
    return {
      absolutePath: this.documentBlobPath(bundle.assetsDir, document),
      filename: document.displayName,
      mimeType: document.detectedMimeType ?? document.declaredMimeType,
    };
  }

  /** Used only by agent tools after their actor-scoped parent-note check. */
  async resolveAgentPath(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    documentId: string,
  ): Promise<string> {
    return (await this.resolveDownload(scope, visibility, opts, notePath, documentId)).absolutePath;
  }

  /** Validate a bundle manifest without changing lifecycle ownership. */
  async validateManifestForNote(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): Promise<void> {
    const { bundle } = await this.requireAuthorizedNote(scope, visibility, opts, notePath);
    await this.readManifest(bundle.assetsDir);
  }

  private async requireAuthorizedNote(scope: NoteScope, visibility: NoteVisibility, opts: NoteResolveOpts, notePath: string) {
    this.requireActor(opts);
    const canonicalPath = this.canonicalNotePath(notePath);
    const note = await this.noteSvc.readNote(scope, visibility, opts, canonicalPath);
    const bundle = this.noteSvc.getNoteFileBundle(scope, visibility, opts, canonicalPath);
    if (!note || !bundle) throw new Error("Note not found or not accessible.");
    return { note, bundle };
  }

  private requireActor(opts: NoteResolveOpts): string {
    if (!opts.userId) throw new Error("Authenticated actor is required.");
    return assertSafePathSegment(opts.userId, "user ID");
  }

  private canonicalNotePath(notePath: string): string {
    return notePath.endsWith(".md") ? notePath : `${notePath}.md`;
  }

  private documentsRoot(assetsDir: string): string {
    return path.join(assetsDir, "documents");
  }

  private manifestPath(assetsDir: string): string {
    return path.join(this.documentsRoot(assetsDir), "index.json");
  }

  private documentBlobPath(assetsDir: string, document: NoteDocument): string {
    const root = this.documentsRoot(assetsDir);
    const expected = `documents/${document.id}/blob`;
    if (document.storedPath !== expected) throw new Error("Document manifest has an unsafe stored path.");
    return resolveWithin(root, `${document.id}/blob`, "document blob path");
  }

  private async readManifest(assetsDir: string): Promise<DocumentManifest> {
    const manifestPath = this.manifestPath(assetsDir);
    if (!existsSync(manifestPath)) return { version: 1, documents: [] };
    let manifest: DocumentManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as DocumentManifest;
    } catch {
      throw new Error("Document manifest is unreadable.");
    }
    if (manifest?.version !== 1 || !Array.isArray(manifest.documents)) {
      throw new Error("Document manifest has an unsupported format.");
    }
    const ids = new Set<string>();
    let total = 0;
    for (const document of manifest.documents) {
      this.validateDocumentRecord(document, ids);
      const blobPath = this.documentBlobPath(assetsDir, document);
      if (!existsSync(blobPath)) throw new Error(`Document blob is missing for ${document.id}.`);
      const stat = statSync(blobPath);
      if (!stat.isFile() || stat.size !== document.sizeBytes) throw new Error(`Document blob size does not match for ${document.id}.`);
      if (await hashFile(blobPath) !== document.sha256) throw new Error(`Document blob checksum does not match for ${document.id}.`);
      total += document.sizeBytes;
      if (total > MAX_NOTE_BYTES) throw new Error("Document manifest exceeds the 500 MB per-note limit.");
    }
    return manifest;
  }

  private validateDocumentRecord(document: NoteDocument, ids: Set<string>): void {
    if (!document || typeof document !== "object" || !DOCUMENT_ID_RE.test(document.id) || ids.has(document.id)) {
      throw new Error("Document manifest contains an invalid or duplicate ID.");
    }
    ids.add(document.id);
    if (document.storedPath !== `documents/${document.id}/blob`) {
      throw new Error("Document manifest contains an unsafe stored path.");
    }
    safeOriginalFilename(document.originalFilename);
    safeDisplayName(document.displayName, "display name");
    if (!Number.isSafeInteger(document.sizeBytes) || document.sizeBytes < 0 || document.sizeBytes > MAX_FILE_BYTES) {
      throw new Error("Document manifest contains an invalid size.");
    }
    if (!/^[a-f0-9]{64}$/i.test(document.sha256)) throw new Error("Document manifest contains an invalid checksum.");
    if (typeof document.uploadedAt !== "string" || typeof document.uploadedBy !== "string" || typeof document.comment !== "string") {
      throw new Error("Document manifest contains invalid metadata.");
    }
  }

  private writeManifest(assetsDir: string, manifest: DocumentManifest): void {
    const root = this.documentsRoot(assetsDir);
    mkdirSync(root, { recursive: true });
    const target = this.manifestPath(assetsDir);
    const temporary = `${target}.tmp.${randomUUID()}`;
    try {
      writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
      renameSync(temporary, target);
    } finally {
      try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* best effort */ }
    }
  }

  private findDocument(manifest: DocumentManifest, documentId: string): NoteDocument {
    assertSafePathSegment(documentId, "document ID");
    if (!DOCUMENT_ID_RE.test(documentId)) throw new Error("Invalid document ID.");
    const document = manifest.documents.find((item) => item.id === documentId);
    if (!document) throw new Error("Document not found.");
    return document;
  }

  private normalizeMimeType(value: string | null | undefined): string | null {
    if (!value || typeof value !== "string") return null;
    const trimmed = value.trim().toLowerCase();
    return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(trimmed) ? trimmed : null;
  }
}
