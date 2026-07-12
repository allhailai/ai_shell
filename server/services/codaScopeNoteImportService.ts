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

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as unzipper from "unzipper";
import type { CodaScopeNoteService, NoteResolveOpts } from "./codaScopeNoteService.js";
import type { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";
import type { NoteScope, NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";

/* ── Constants ────────────────────────────────────────────────────── */

const MAX_ZIP_SIZE = 500 * 1024 * 1024; // 500 MB
const MAX_ENTRY_COUNT = 10_000;

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

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeNoteImportService {
  private root: string;
  private noteSvc: CodaScopeNoteService;
  private auditSvc: CodaScopeNoteAuditService;

  constructor(
    root: string,
    noteSvc: CodaScopeNoteService,
    auditSvc: CodaScopeNoteAuditService,
  ) {
    this.root = root;
    this.noteSvc = noteSvc;
    this.auditSvc = auditSvc;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  setServices(noteSvc: CodaScopeNoteService, auditSvc: CodaScopeNoteAuditService): void {
    this.noteSvc = noteSvc;
    this.auditSvc = auditSvc;
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
    if (manifest.formatVersion !== 1) {
      warnings.push(`Unexpected format version: ${manifest.formatVersion}. Expected 1.`);
    }

    // Detect collisions
    const collisions: ImportPreview["collisions"] = [];
    const notesDir = this.noteSvc.resolveNotesDir(destScope, destVisibility, opts);

    for (const item of manifest.items) {
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

    const notesDir = this.noteSvc.resolveNotesDir(destScope, destVisibility, opts);
    if (!notesDir) {
      throw new Error("Cannot resolve notes directory for the given scope/visibility.");
    }

    const { manifest, entries } = await this.parseZip(zipBuffer);

    let imported = 0;
    let skipped = 0;
    let renamed = 0;
    const failed: Array<{ path: string; error: string }> = [];

    if (!manifest) {
      // No manifest — import raw .md files from the ZIP
      for (const [entryPath, content] of entries) {
        if (!entryPath.endsWith(".md")) continue;
        // Strip leading notes/ prefix if present
        let notePath = entryPath;
        if (notePath.startsWith("notes/")) notePath = notePath.slice(6);

        try {
          const result = await this.importSingleNote(
            notePath, content, destScope, destVisibility, opts, notesDir, collisionStrategy,
          );
          if (result === "imported") imported++;
          else if (result === "skipped") skipped++;
          else if (result === "renamed") { imported++; renamed++; }
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
            destScope, destVisibility, opts, notesDir, collisionStrategy,
          );
          if (result === "imported") imported++;
          else if (result === "skipped") skipped++;
          else if (result === "renamed") { imported++; renamed++; }

          // Import attachments
          for (const att of item.attachments) {
            const attContent = entries.get(att.path);
            if (attContent) {
              const attNotePath = result === "renamed"
                ? this.getRenamePath(item.path)
                : item.path;
              this.writeAttachment(notesDir, attNotePath, att.path, attContent);
            }
          }

          // Import versions (if present in the ZIP)
          if (item.versionsIncluded) {
            const versionPrefix = `versions/${item.path.replace(/\.md$/, ".versions/")}`;
            for (const [entryPath, vContent] of entries) {
              if (entryPath.startsWith(versionPrefix)) {
                const vRelative = entryPath.slice("versions/".length);
                this.writeVersionFile(notesDir, vRelative, vContent);
              }
            }
          }
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
      metadata: { imported, skipped, renamed, failedCount: failed.length, collisionStrategy },
    });

    return { imported, skipped, renamed, failed, correlationId };
  }

  /* ── Private: ZIP parsing ─────────────────────────────────────────── */

  private async parseZip(zipBuffer: Buffer): Promise<{
    manifest: ExportManifest | null;
    entries: Map<string, Buffer>;
  }> {
    const entries = new Map<string, Buffer>();
    let manifest: ExportManifest | null = null;
    let entryCount = 0;

    const directory = await unzipper.Open.buffer(zipBuffer);

    for (const file of directory.files) {
      entryCount++;
      if (entryCount > MAX_ENTRY_COUNT) {
        throw new Error(`ZIP contains more than ${MAX_ENTRY_COUNT} entries.`);
      }

      // Path traversal protection
      const normalizedPath = path.normalize(file.path);
      if (normalizedPath.startsWith("..") || normalizedPath.includes("/../") || path.isAbsolute(normalizedPath)) {
        throw new Error(`Path traversal detected in ZIP entry: "${file.path}"`);
      }

      if (file.type === "Directory") continue;

      const content = await file.buffer();
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

  /* ── Private: single note import ──────────────────────────────────── */

  private async importSingleNote(
    notePath: string,
    content: Buffer,
    destScope: NoteScope,
    destVisibility: NoteVisibility,
    opts: NoteResolveOpts,
    notesDir: string,
    collisionStrategy: CollisionStrategy,
  ): Promise<"imported" | "skipped" | "renamed"> {
    // Check if note already exists
    const existing = await this.noteSvc.readNote(destScope, destVisibility, opts, notePath);

    if (existing) {
      switch (collisionStrategy) {
        case "skip":
          return "skipped";

        case "rename": {
          const renamed = this.getRenamePath(notePath);
          await this.noteSvc.createNote(destScope, destVisibility, opts, renamed, content.toString("utf-8"));
          return "renamed";
        }

        case "import-as-copy": {
          const copyPath = this.getCopyPath(notePath);
          const noteContent = this.reassignNoteId(content.toString("utf-8"), destScope, destVisibility, opts);
          await this.noteSvc.createNote(destScope, destVisibility, opts, copyPath, noteContent);
          return "renamed";
        }

        default:
          return "skipped";
      }
    }

    await this.noteSvc.createNote(destScope, destVisibility, opts, notePath, content.toString("utf-8"));
    return "imported";
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

  /* ── Private: attachment writing ──────────────────────────────────── */

  private writeAttachment(
    notesDir: string,
    notePath: string,
    attZipPath: string,
    content: Buffer,
  ): void {
    try {
      // Determine the on-disk path for the attachment
      // attZipPath is like "notes/folder/note.assets/image.png"
      // We need to strip the leading "notes/" prefix
      let relative = attZipPath;
      if (relative.startsWith("notes/")) relative = relative.slice(6);

      const targetPath = path.join(notesDir, relative);
      const targetDir = path.dirname(targetPath);

      // Security: ensure within notesDir
      const resolved = path.resolve(targetPath);
      if (!resolved.startsWith(path.resolve(notesDir))) return;

      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      writeFileSync(targetPath, content);
    } catch { /* best effort */ }
  }

  /* ── Private: version file writing ────────────────────────────────── */

  private writeVersionFile(notesDir: string, vRelativePath: string, content: Buffer): void {
    try {
      const targetPath = path.join(notesDir, vRelativePath);
      const targetDir = path.dirname(targetPath);

      // Security: ensure within notesDir
      const resolved = path.resolve(targetPath);
      if (!resolved.startsWith(path.resolve(notesDir))) return;

      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      writeFileSync(targetPath, content);
    } catch { /* best effort */ }
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
