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
import type { CodaScopeNoteService, NoteResolveOpts } from "./codaScopeNoteService.js";
import type { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";
import type { CodaScopeNoteBundleService } from "./codaScopeNoteBundleService.js";
import type { NoteScope, NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";
import {
  NOTE_ARCHIVE_LIMITS,
  openValidatedZipBuffer,
  openValidatedZipFile,
  readZipEntry,
} from "./codaScopeZipArchiveService.js";

/* ── Constants ────────────────────────────────────────────────────── */

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

type ZipSource = Buffer | string;

interface ZipEntry {
  read(): Promise<Buffer>;
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeNoteImportService {
  private root: string;
  private noteSvc: CodaScopeNoteService;
  private auditSvc: CodaScopeNoteAuditService;
  private bundleSvc: CodaScopeNoteBundleService;

  constructor(
    root: string,
    noteSvc: CodaScopeNoteService,
    auditSvc: CodaScopeNoteAuditService,
    bundleSvc: CodaScopeNoteBundleService,
  ) {
    this.root = root;
    this.noteSvc = noteSvc;
    this.auditSvc = auditSvc;
    this.bundleSvc = bundleSvc;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  setServices(
    noteSvc: CodaScopeNoteService,
    auditSvc: CodaScopeNoteAuditService,
    bundleSvc: CodaScopeNoteBundleService,
  ): void {
    this.noteSvc = noteSvc;
    this.auditSvc = auditSvc;
    this.bundleSvc = bundleSvc;
  }

  /* ── Preview ──────────────────────────────────────────────────────── */

  async previewImport(
    zipBuffer: Buffer,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
  ): Promise<ImportPreview> {
    return this.previewImportSource(zipBuffer, destScope, destVisibility, opts);
  }

  /** Disk-backed alternative used by HTTP uploads. */
  async previewImportFile(
    zipPath: string,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
  ): Promise<ImportPreview> {
    return this.previewImportSource(zipPath, destScope, destVisibility, opts);
  }

  private async previewImportSource(
    zipSource: ZipSource,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
  ): Promise<ImportPreview> {
    const userId = opts.userId ?? "default";

    // Parse the ZIP
    const { manifest, entries, compressedBytes } = await this.parseZip(zipSource);

    // Log audit: preview
    this.auditSvc.log({
      event: "note.import_previewed",
      timestamp: new Date().toISOString(),
      actor: userId,
      noteId: "",
      scope: destScope,
      visibility: destVisibility,
      path: "",
      metadata: { noteCount: manifest?.items.length ?? 0, zipSizeBytes: compressedBytes },
    });

    const warnings: string[] = [];

    if (!manifest) {
      warnings.push("No codascope-notes-manifest.json found. Import will use file structure.");
      // Build a preview from raw entries
      return this.buildPreviewFromEntries(entries, destScope, destVisibility, opts, warnings, compressedBytes);
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
      totalSizeBytes: compressedBytes,
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
    return this.executeImportSource(zipBuffer, destScope, destVisibility, opts, collisionStrategy);
  }

  /** Disk-backed alternative used by HTTP uploads. */
  async executeImportFile(
    zipPath: string,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
    collisionStrategy: CollisionStrategy = "skip",
  ): Promise<ImportReport> {
    return this.executeImportSource(zipPath, destScope, destVisibility, opts, collisionStrategy);
  }

  private async executeImportSource(
    zipSource: ZipSource,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
    collisionStrategy: CollisionStrategy,
  ): Promise<ImportReport> {
    const correlationId = randomUUID();
    const userId = opts.userId ?? "default";

    if (!this.noteSvc.resolveNotesDir(destScope, destVisibility, opts)) {
      throw new Error("Cannot resolve notes directory for the given scope/visibility.");
    }

    const { manifest, entries } = await this.parseZip(zipSource);

    let imported = 0;
    let skipped = 0;
    let renamed = 0;
    const failed: Array<{ path: string; error: string }> = [];
    const warnings: string[] = [];

    if (!manifest) {
      // No manifest — import raw .md files from the ZIP
      for (const [entryPath, entry] of entries) {
        if (!entryPath.endsWith(".md") || entryPath.includes(".versions/")) continue;
        // Strip leading notes/ prefix if present
        let notePath = entryPath;
        if (notePath.startsWith("notes/")) notePath = notePath.slice(6);

        try {
          const content = await entry.read();
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
        const entry = entries.get(contentKey);
        if (!entry) {
          failed.push({ path: item.path, error: "Content file not found in ZIP." });
          continue;
        }

        try {
          const content = await entry.read();
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

  private async parseZip(zipSource: ZipSource): Promise<{
    manifest: ExportManifest | null;
    entries: Map<string, ZipEntry>;
    compressedBytes: number;
  }> {
    const entries = new Map<string, ZipEntry>();
    let manifest: ExportManifest | null = null;
    const archive = typeof zipSource === "string"
      ? await openValidatedZipFile(zipSource, NOTE_ARCHIVE_LIMITS)
      : await openValidatedZipBuffer(zipSource, NOTE_ARCHIVE_LIMITS);
    let streamedBytes = 0;

    for (const [entryPath, file] of archive.entries) {
      const entry: ZipEntry = {
        read: async () => {
          const content = await readZipEntry(file, NOTE_ARCHIVE_LIMITS.maxEntryUncompressedBytes);
          streamedBytes += content.length;
          if (streamedBytes > NOTE_ARCHIVE_LIMITS.maxTotalUncompressedBytes) {
            throw new Error(`ZIP expanded content exceeds the ${NOTE_ARCHIVE_LIMITS.maxTotalUncompressedBytes / 1024 / 1024} MB limit.`);
          }
          return content;
        },
      };
      entries.set(entryPath, entry);
      if (entryPath === "codascope-notes-manifest.json") {
        try {
          manifest = JSON.parse((await entry.read()).toString("utf-8"));
        } catch {
          // Malformed manifest — will be treated as warning.
        }
      }
    }

    return { manifest, entries, compressedBytes: archive.compressedBytes };
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

  /** Restore a note's portable artifacts through the shared bundle service. */
  private async restoreCompanions(
    entries: Map<string, ZipEntry>,
    sourceNotePath: string,
    targetNotePath: string,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
    warnings: string[],
  ): Promise<void> {
    const companionEntries = await this.materializeCompanionEntries(entries, sourceNotePath);
    const restored = await this.bundleSvc.restoreArchiveContents(
      destScope, destVisibility, opts, sourceNotePath, targetNotePath, companionEntries,
    );
    if (restored.annotationWarning) warnings.push(`${targetNotePath}: ${restored.annotationWarning}`);
    const unresolved = restored.annotations.filter((annotation) => !annotation.parentId && !annotation.archivedAt && (
      !("kind" in annotation.anchor) || annotation.anchor.attachmentState !== "attached"
    ));
    if (unresolved.length > 0) {
      warnings.push(`${targetNotePath}: ${unresolved.length} imported annotation${unresolved.length === 1 ? " requires" : "s require"} review; no marker was auto-attached.`);
    }
  }

  /** Load only the companion files belonging to the note currently being imported. */
  private async materializeCompanionEntries(
    entries: Map<string, ZipEntry>,
    sourceNotePath: string,
  ): Promise<Map<string, Buffer>> {
    const result = new Map<string, Buffer>();
    const assetPrefix = `${sourceNotePath.replace(/\.md$/i, "")}.assets/`;
    const versionPrefix = `${sourceNotePath.replace(/\.md$/i, "")}.versions/`;
    const annotationPath = `${sourceNotePath.replace(/\.md$/i, "")}.annotations.json`;

    for (const [entryPath, entry] of entries) {
      const normalized = entryPath.startsWith("notes/")
        ? entryPath.slice(6)
        : entryPath.startsWith("versions/")
          ? entryPath.slice(9)
          : entryPath;
      if (
        normalized.startsWith(assetPrefix)
        || normalized.startsWith(versionPrefix)
        || normalized === annotationPath
      ) {
        result.set(entryPath, await entry.read());
      }
    }
    return result;
  }

  /* ── Private: preview from raw entries (no manifest) ──────────────── */

  private async buildPreviewFromEntries(
    entries: Map<string, ZipEntry>,
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
        const entry = entries.get(entryPath);
        let title = path.basename(notePath, ".md").replace(/[-_]/g, " ");

        if (entry) {
          try {
            const content = await entry.read();
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
