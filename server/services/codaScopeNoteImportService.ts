/* ── CodaScope: Note Import Service ──────────────────────────────────
   Validates, previews, and executes ZIP imports of notes.
   Uses `unzipper` for ZIP parsing.

   Responsibilities:
   - ZIP validation (size, entry count, path traversal)
   - Manifest parsing and collision detection
   - Preview generation (note count, attachments, collisions)
   - Import execution with collision strategies
   - Audit event logging
   ──────────────────────────────────────────────────────────────────── */

import path from "node:path";
import { randomUUID } from "node:crypto";
import * as unzipper from "unzipper";
import type { CodaScopeNoteService, NoteResolveOpts } from "./codaScopeNoteService.js";
import type { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";
import type { CodaScopeNoteAnnotationService } from "./codaScopeNoteAnnotationService.js";
import type { NoteScope, NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";

/* ── Constants ────────────────────────────────────────────────────── */

const MAX_ZIP_SIZE = 50 * 1024 * 1024; // compressed upload size
const MAX_ENTRY_COUNT = 5_000;
const MAX_ENTRY_UNCOMPRESSED_SIZE = 25 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_SIZE = 200 * 1024 * 1024;

/* ── Types ────────────────────────────────────────────────────────── */

export type CollisionStrategy = "skip" | "rename" | "import-as-copy";

export interface ImportPreview {
  sourceScope: string;
  sourceVisibility: string;
  noteCount: number;
  attachmentCount: number;
  totalSizeBytes: number;
  collisions: Array<{
    importPath: string;
    existingNoteId: string;
    existingTitle: string;
  }>;
  items: Array<{
    path: string;
    title: string;
    hasAttachments: boolean;
    hasVersions: boolean;
  }>;
  warnings: string[];
}

export interface ImportReport {
  imported: number;
  skipped: number;
  renamed: number;
  failed: Array<{ path: string; error: string }>;
  warnings: string[];
  correlationId: string;
}

interface ManifestItem {
  noteId: string;
  path: string;
  contentFile: string;
  visibility: string;
  owner: string;
  attachments: Array<{ path: string; sha256: string }>;
  frontmatter: { title: string; tags: string[] };
  versionsIncluded: boolean;
  annotationsIncluded: boolean;
  annotationAnchorFormatVersion?: number;
}

interface ExportManifest {
  format: string;
  formatVersion: number;
  exportedAt: string;
  sourceInstance?: string;
  scope: { type: string; id?: string };
  visibility: string;
  exportedBy: string;
  items: ManifestItem[];
}

interface ImportedNote {
  status: "imported" | "skipped" | "renamed";
  path: string;
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeNoteImportService {
  private root: string;
  private noteSvc: CodaScopeNoteService;
  private auditSvc: CodaScopeNoteAuditService;
  private annotationSvc: CodaScopeNoteAnnotationService;

  constructor(
    root: string,
    noteSvc: CodaScopeNoteService,
    auditSvc: CodaScopeNoteAuditService,
    annotationSvc: CodaScopeNoteAnnotationService,
  ) {
    this.root = root;
    this.noteSvc = noteSvc;
    this.auditSvc = auditSvc;
    this.annotationSvc = annotationSvc;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  setServices(
    noteSvc: CodaScopeNoteService,
    auditSvc: CodaScopeNoteAuditService,
    annotationSvc: CodaScopeNoteAnnotationService,
  ): void {
    this.noteSvc = noteSvc;
    this.auditSvc = auditSvc;
    this.annotationSvc = annotationSvc;
  }

  /* ── Preview ──────────────────────────────────────────────────────── */

  async previewImport(
    zipBuffer: Buffer,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
  ): Promise<ImportPreview> {
    const userId = opts.userId ?? "default";

    // Validate size
    if (zipBuffer.length > MAX_ZIP_SIZE) {
      throw new Error(`ZIP file exceeds maximum size of ${MAX_ZIP_SIZE / 1024 / 1024} MB.`);
    }

    // Parse the ZIP
    const { manifest, entries } = await this.parseZip(zipBuffer);

    // Log audit: preview
    this.auditSvc.log({
      event: "note.import_previewed",
      timestamp: new Date().toISOString(),
      actor: userId,
      noteId: "",
      scope: destScope,
      visibility: destVisibility,
      path: "",
      metadata: { noteCount: manifest?.items.length ?? 0, zipSizeBytes: zipBuffer.length },
    });

    const warnings: string[] = [];

    if (!manifest) {
      warnings.push("No codascope-notes-manifest.json found. Import will use file structure.");
      // Build a preview from raw entries
      return this.buildPreviewFromEntries(entries, destScope, destVisibility, opts, warnings, zipBuffer.length);
    }

    if (manifest.format !== "codascope-notes") {
      warnings.push(`Unexpected format: "${manifest.format}". Expected "codascope-notes".`);
    }
    if (manifest.formatVersion !== 1 && manifest.formatVersion !== 2) {
      warnings.push(`Unexpected format version: ${manifest.formatVersion}. Expected 1 or 2.`);
    }

    // Detect collisions
    const collisions: ImportPreview["collisions"] = [];
    const notesDir = this.noteSvc.resolveNotesDir(destScope, destVisibility, opts);

    for (const item of manifest.items) {
      if (item.annotationsIncluded && manifest.formatVersion >= 2 && item.annotationAnchorFormatVersion !== 1) {
        warnings.push(`${item.path}: unknown annotation-anchor format; annotations will require review after import.`);
      }
      if (!notesDir) continue;
      try {
        const existing = await this.noteSvc.readNote(destScope, destVisibility, opts, item.path);
        if (existing) {
          collisions.push({
            importPath: item.path,
            existingNoteId: existing.frontmatter.id,
            existingTitle: existing.frontmatter.title,
          });
        }
      } catch { /* note doesn't exist — no collision */ }
    }

    // Count attachments
    let attachmentCount = 0;
    for (const item of manifest.items) {
      attachmentCount += item.attachments.length;
    }

    return {
      sourceScope: manifest.scope.type,
      sourceVisibility: manifest.visibility,
      noteCount: manifest.items.length,
      attachmentCount,
      totalSizeBytes: zipBuffer.length,
      collisions,
      items: manifest.items.map((item) => ({
        path: item.path,
        title: item.frontmatter.title,
        hasAttachments: item.attachments.length > 0,
        hasVersions: item.versionsIncluded,
      })),
      warnings,
    };
  }

  /* ── Execute ──────────────────────────────────────────────────────── */

  async executeImport(
    zipBuffer: Buffer,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
    collisionStrategy: CollisionStrategy = "skip",
  ): Promise<ImportReport> {
    const correlationId = randomUUID();
    const userId = opts.userId ?? "default";

    // Validate size
    if (zipBuffer.length > MAX_ZIP_SIZE) {
      throw new Error(`ZIP file exceeds maximum size of ${MAX_ZIP_SIZE / 1024 / 1024} MB.`);
    }

    if (!this.noteSvc.resolveNotesDir(destScope, destVisibility, opts)) {
      throw new Error("Cannot resolve notes directory for the given scope/visibility.");
    }

    const { manifest, entries } = await this.parseZip(zipBuffer);

    let imported = 0;
    let skipped = 0;
    let renamed = 0;
    const failed: Array<{ path: string; error: string }> = [];
    const warnings: string[] = [];

    if (!manifest) {
      // No manifest — import raw .md files from the ZIP
      for (const [entryPath, content] of entries) {
        if (!entryPath.endsWith(".md") || entryPath.includes(".versions/")) continue;
        // Strip leading notes/ prefix if present
        let notePath = entryPath;
        if (notePath.startsWith("notes/")) notePath = notePath.slice(6);

        try {
          const result = await this.importSingleNote(
            notePath, content, destScope, destVisibility, opts, collisionStrategy,
          );
          if (result.status === "imported") imported++;
          else if (result.status === "skipped") skipped++;
          else { imported++; renamed++; }
          if (result.status !== "skipped") {
            await this.restoreCompanions(entries, notePath, result.path, destScope, destVisibility, opts, warnings);
          }
        } catch (err: unknown) {
          failed.push({ path: notePath, error: err instanceof Error ? err.message : String(err) });
        }
      }
    } else {
      // Manifest-driven import
      for (const item of manifest.items) {
        const contentKey = item.contentFile;
        const content = entries.get(contentKey);
        if (!content) {
          failed.push({ path: item.path, error: "Content file not found in ZIP." });
          continue;
        }

        try {
          // Ensure imported note gets a new ID if the existing ID collides
          let noteContent = content.toString("utf-8");
          noteContent = this.reassignNoteId(noteContent, destScope, destVisibility, opts);

          const result = await this.importSingleNote(
            item.path, Buffer.from(noteContent, "utf-8"),
            destScope, destVisibility, opts, collisionStrategy,
          );
          if (result.status === "imported") imported++;
          else if (result.status === "skipped") skipped++;
          else { imported++; renamed++; }

          if (result.status === "skipped") continue;

          await this.restoreCompanions(entries, item.path, result.path, destScope, destVisibility, opts, warnings);
        } catch (err: unknown) {
          failed.push({ path: item.path, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    // Log audit
    this.auditSvc.log({
      event: imported > 0 ? "note.import_completed" : "note.import_failed",
      timestamp: new Date().toISOString(),
      actor: userId,
      noteId: "",
      scope: destScope,
      visibility: destVisibility,
      path: "",
      correlationId,
      metadata: { imported, skipped, renamed, failedCount: failed.length, warningCount: warnings.length, collisionStrategy },
    });

    return { imported, skipped, renamed, failed, warnings, correlationId };
  }

  /* ── Private: ZIP parsing ─────────────────────────────────────────── */

  private async parseZip(zipBuffer: Buffer): Promise<{
    manifest: ExportManifest | null;
    entries: Map<string, Buffer>;
  }> {
    const entries = new Map<string, Buffer>();
    let manifest: ExportManifest | null = null;
    let entryCount = 0;
    let totalUncompressedSize = 0;

    const directory = await unzipper.Open.buffer(zipBuffer);

    for (const file of directory.files) {
      entryCount++;
      if (entryCount > MAX_ENTRY_COUNT) {
        throw new Error(`ZIP contains more than ${MAX_ENTRY_COUNT} entries.`);
      }

      // Path traversal protection
      const normalizedPath = path.normalize(file.path);
      if (
        normalizedPath.startsWith("..")
        || normalizedPath.includes(`/..${path.sep}`)
        || path.isAbsolute(normalizedPath)
        || file.path.includes("\\")
      ) {
        throw new Error(`Path traversal detected in ZIP entry: "${file.path}"`);
      }

      if (file.type === "Directory") continue;

      if (file.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_SIZE) {
        throw new Error(`ZIP entry exceeds the ${MAX_ENTRY_UNCOMPRESSED_SIZE / 1024 / 1024} MB limit: "${file.path}"`);
      }
      if (totalUncompressedSize + file.uncompressedSize > MAX_TOTAL_UNCOMPRESSED_SIZE) {
        throw new Error(`ZIP expanded content exceeds the ${MAX_TOTAL_UNCOMPRESSED_SIZE / 1024 / 1024} MB limit.`);
      }

      const content = await this.readEntryWithLimit(
        file,
        Math.min(MAX_ENTRY_UNCOMPRESSED_SIZE, MAX_TOTAL_UNCOMPRESSED_SIZE - totalUncompressedSize),
      );
      totalUncompressedSize += content.length;
      entries.set(file.path, content);

      // Parse manifest
      if (file.path === "codascope-notes-manifest.json") {
        try {
          manifest = JSON.parse(content.toString("utf-8"));
        } catch {
          // Malformed manifest — will be treated as warning
        }
      }
    }

    return { manifest, entries };
  }

  /** Read a ZIP entry without allowing a forged size header to exhaust memory. */
  private async readEntryWithLimit(file: unzipper.File, maxSize: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;

    for await (const chunk of file.stream()) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxSize) {
        throw new Error(`ZIP entry exceeds the permitted expanded-content limit: "${file.path}"`);
      }
      chunks.push(buffer);
    }

    return Buffer.concat(chunks, size);
  }

  /* ── Private: single note import ──────────────────────────────────── */

  private async importSingleNote(
    notePath: string,
    content: Buffer,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
    collisionStrategy: CollisionStrategy,
  ): Promise<ImportedNote> {
    // Check if note already exists
    const existing = await this.noteSvc.readNote(destScope, destVisibility, opts, notePath);

    if (existing) {
      switch (collisionStrategy) {
        case "skip":
          return { status: "skipped", path: notePath };

        case "rename": {
          const renamed = this.getRenamePath(notePath);
          await this.noteSvc.createNote(destScope, destVisibility, opts, renamed, content.toString("utf-8"));
          return { status: "renamed", path: renamed };
        }

        case "import-as-copy": {
          const copyPath = this.getCopyPath(notePath);
          const noteContent = this.reassignNoteId(content.toString("utf-8"), destScope, destVisibility, opts);
          await this.noteSvc.createNote(destScope, destVisibility, opts, copyPath, noteContent);
          return { status: "renamed", path: copyPath };
        }

        default:
          return { status: "skipped", path: notePath };
      }
    }

    await this.noteSvc.createNote(destScope, destVisibility, opts, notePath, content.toString("utf-8"));
    return { status: "imported", path: notePath };
  }

  /* ── Private: collision path helpers ───────────────────────────────── */

  private getRenamePath(notePath: string): string {
    const ext = path.extname(notePath);
    const base = notePath.slice(0, notePath.length - ext.length);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
    return `${base} (imported ${timestamp})${ext}`;
  }

  private getCopyPath(notePath: string): string {
    const ext = path.extname(notePath);
    const base = notePath.slice(0, notePath.length - ext.length);
    return `${base} (copy)${ext}`;
  }

  /* ── Private: ID reassignment ─────────────────────────────────────── */

  /**
   * If the imported note's frontmatter ID already exists in the target,
   * replace it with a new UUID.
   */
  private reassignNoteId(
    content: string,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
  ): string {
    const { frontmatter } = this.noteSvc.parseFrontmatter(content);

    // Always assign a new ID on import to avoid collisions
    const newId = randomUUID();
    // Replace the id line in frontmatter
    return content.replace(
      /^id:\s*.+$/m,
      `id: ${newId}`,
    );
  }

  /** Restore every companion in one physical note bundle and reconcile it. */
  private async restoreCompanions(
    entries: Map<string, Buffer>,
    sourceNotePath: string,
    targetNotePath: string,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
    warnings: string[],
  ): Promise<void> {
    const sourceBase = sourceNotePath.replace(/\.md$/, "");
    const assetsPrefix = `${sourceBase}.assets/`;
    const versionsPrefix = `${sourceBase}.versions/`;
    const annotationsPath = `${sourceBase}.annotations.json`;
    let annotationRestored = false;

    for (const [entryPath, content] of entries) {
      const normalized = entryPath.startsWith("notes/")
        ? entryPath.slice(6)
        : entryPath.startsWith("versions/")
          ? entryPath.slice(9)
          : entryPath;
      if (normalized.startsWith(assetsPrefix)) {
        this.noteSvc.writeNoteBundleCompanion(
          destScope, destVisibility, opts, targetNotePath,
          "asset", normalized.slice(assetsPrefix.length), content,
        );
      } else if (normalized.startsWith(versionsPrefix)) {
        this.noteSvc.writeNoteBundleCompanion(
          destScope, destVisibility, opts, targetNotePath,
          "version", normalized.slice(versionsPrefix.length), content,
        );
      } else if (normalized === annotationsPath) {
        try {
          const sidecar = JSON.parse(content.toString("utf-8"));
          if (Array.isArray(sidecar) || Array.isArray(sidecar?.annotations)) {
            this.annotationSvc.replaceAnnotations(
              destScope, destVisibility, opts, targetNotePath, sidecar,
            );
            annotationRestored = true;
          } else {
            warnings.push(`${targetNotePath}: annotation sidecar was malformed and was not imported.`);
          }
        } catch {
          warnings.push(`${targetNotePath}: annotation sidecar was malformed and was not imported.`);
        }
      }
    }

    if (!annotationRestored) this.annotationSvc.ensurePhysicalSidecar(destScope, destVisibility, opts, targetNotePath);
    const reconciled = await this.annotationSvc.reconcileAfterNoteWrite(
      destScope, destVisibility, opts, targetNotePath,
    );
    const unresolved = reconciled.filter((annotation) => !annotation.parentId && !annotation.archivedAt && (
      !("kind" in annotation.anchor) || annotation.anchor.attachmentState !== "attached"
    ));
    if (unresolved.length > 0) {
      warnings.push(`${targetNotePath}: ${unresolved.length} imported annotation${unresolved.length === 1 ? " requires" : "s require"} review; no marker was auto-attached.`);
    }
  }

  /* ── Private: preview from raw entries (no manifest) ──────────────── */

  private async buildPreviewFromEntries(
    entries: Map<string, Buffer>,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
    warnings: string[],
    totalSizeBytes: number,
  ): Promise<ImportPreview> {
    const noteEntries: Array<{ path: string; title: string; hasAttachments: boolean; hasVersions: boolean }> = [];
    const collisions: ImportPreview["collisions"] = [];
    let attachmentCount = 0;

    for (const [entryPath] of entries) {
      // Only consider .md files as notes
      let notePath = entryPath;
      if (notePath.startsWith("notes/")) notePath = notePath.slice(6);

      if (notePath.endsWith(".md") && !notePath.includes(".versions/")) {
        const content = entries.get(entryPath);
        let title = path.basename(notePath, ".md").replace(/[-_]/g, " ");

        if (content) {
          try {
            const { frontmatter } = this.noteSvc.parseFrontmatter(content.toString("utf-8"));
            title = frontmatter.title;
          } catch { /* use filename */ }
        }

        // Check for attachments
        const basename = path.basename(notePath, ".md");
        const assetPrefix = path.dirname(notePath) === "."
          ? `${basename}.assets/`
          : `${path.dirname(notePath)}/${basename}.assets/`;
        const hasAttachments = [...entries.keys()].some((k) => {
          const stripped = k.startsWith("notes/") ? k.slice(6) : k;
          return stripped.startsWith(assetPrefix);
        });

        if (hasAttachments) {
          attachmentCount += [...entries.keys()].filter((k) => {
            const stripped = k.startsWith("notes/") ? k.slice(6) : k;
            return stripped.startsWith(assetPrefix);
          }).length;
        }

        // Check collision
        try {
          const existing = await this.noteSvc.readNote(destScope, destVisibility, opts, notePath);
          if (existing) {
            collisions.push({
              importPath: notePath,
              existingNoteId: existing.frontmatter.id,
              existingTitle: existing.frontmatter.title,
            });
          }
        } catch { /* no collision */ }

        noteEntries.push({ path: notePath, title, hasAttachments, hasVersions: false });
      }
    }

    return {
      sourceScope: "unknown",
      sourceVisibility: "unknown",
      noteCount: noteEntries.length,
      attachmentCount,
      totalSizeBytes,
      collisions,
      items: noteEntries,
      warnings,
    };
  }
}
