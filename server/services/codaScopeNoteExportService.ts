/* ── CodaScope: Note Export Service ──────────────────────────────────
   Generates governed ZIP exports of notes with a manifest.
   Uses `archiver` for ZIP creation.

   Responsibilities:
   - Recursive note collection within a scope+visibility
   - ZIP generation with manifest, notes, attachments, versions
   - SHA256 checksums for attachments
   - Temporary export storage with 1-hour expiry
   - Audit event logging
   ──────────────────────────────────────────────────────────────────── */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  statSync,
  createWriteStream,
  rmSync,
} from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import archiver from "archiver";
import type { CodaScopeNoteService, NoteResolveOpts } from "./codaScopeNoteService.js";
import type { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";
import type { CodaScopeNoteAnnotationService } from "./codaScopeNoteAnnotationService.js";
import type { NoteScope, NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";

/* ── Types ────────────────────────────────────────────────────────── */

export interface ExportOptions {
  notePaths?: string[];
  includeVersions?: boolean;
  includeAnnotations?: boolean;
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
  format: "codascope-notes";
  formatVersion: 1;
  exportedAt: string;
  sourceInstance?: string;
  scope: { type: string; id?: string };
  visibility: string;
  exportedBy: string;
  items: ManifestItem[];
}

interface ExportRecord {
  exportId: string;
  zipPath: string;
  createdAt: number;
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeNoteExportService {
  private root: string;
  private noteSvc: CodaScopeNoteService;
  private auditSvc: CodaScopeNoteAuditService;
  private annotationSvc: CodaScopeNoteAnnotationService;
  private exports = new Map<string, ExportRecord>();

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

  /* ── Export generation ────────────────────────────────────────────── */

  async generateExport(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    options: ExportOptions = {},
  ): Promise<string> {
    const exportId = randomUUID();
    const userId = opts.userId ?? "default";

    // Log audit: export requested
    this.auditSvc.log({
      event: "note.export_requested",
      timestamp: new Date().toISOString(),
      actor: userId,
      noteId: "",
      scope,
      visibility,
      path: "",
      metadata: { exportId, options },
    });

    const notesDir = this.noteSvc.resolveNotesDir(scope, visibility, opts);
    if (!notesDir || !existsSync(notesDir)) {
      throw new Error("Notes directory not found for the given scope/visibility.");
    }

    // Collect all notes recursively
    const noteFiles = this.collectNotes(notesDir, notesDir, options.notePaths);
    if (noteFiles.length === 0) {
      throw new Error("No notes found to export.");
    }

    // Ensure export directory
    const exportDir = path.join(this.root, "_exports");
    if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const zipFilename = `export-${timestamp}.zip`;
    const zipPath = path.join(exportDir, `${exportId}-${zipFilename}`);

    // Build manifest items and create ZIP
    const items: ManifestItem[] = [];

    const archive = archiver("zip", { zlib: { level: 6 } });
    const output = createWriteStream(zipPath);

    const archivePromise = new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      archive.on("error", reject);
    });

    archive.pipe(output);

    for (const noteFile of noteFiles) {
      const relativePath = path.relative(notesDir, noteFile);
      const content = readFileSync(noteFile, "utf-8");
      const { frontmatter } = this.noteSvc.parseFrontmatter(content);

      const contentFile = `notes/${relativePath}`;
      archive.append(content, { name: contentFile });

      // Collect attachments
      const attachments: Array<{ path: string; sha256: string }> = [];
      const basename = path.basename(noteFile, ".md");
      const assetsDir = path.join(path.dirname(noteFile), `${basename}.assets`);

      if (existsSync(assetsDir)) {
        const assetFiles = this.collectFiles(assetsDir);
        for (const assetFile of assetFiles) {
          const assetRelative = path.relative(notesDir, assetFile);
          const assetContent = readFileSync(assetFile);
          const sha256 = crypto.createHash("sha256").update(assetContent).digest("hex");

          archive.append(assetContent, { name: `notes/${assetRelative}` });
          attachments.push({
            path: `notes/${assetRelative}`,
            sha256,
          });
        }
      }

      // Versions (optional)
      let versionsIncluded = false;
      if (options.includeVersions) {
        const versionsDir = path.join(path.dirname(noteFile), `${basename}.versions`);
        if (existsSync(versionsDir)) {
          const versionFiles = this.collectFiles(versionsDir);
          for (const vFile of versionFiles) {
            const vRelative = path.relative(notesDir, vFile);
            archive.file(vFile, { name: `versions/${vRelative}` });
          }
          versionsIncluded = versionFiles.length > 0;
        }
      }

      // Annotations (optional — stored as JSON alongside notes)
      let annotationsIncluded = false;
      if (options.includeAnnotations) {
        try {
          const annotations = await this.annotationSvc.listAnnotations(
            scope, visibility, opts, relativePath.replace(/\.md$/, ""),
          );
          if (annotations.length > 0) {
            const annotationJson = JSON.stringify(annotations, null, 2);
            const annotationPath = `notes/${relativePath.replace(/\.md$/, ".annotations.json")}`;
            archive.append(annotationJson, { name: annotationPath });
            annotationsIncluded = true;
          }
        } catch { /* best effort — annotations are optional */ }
      }

      items.push({
        noteId: frontmatter.id,
        path: relativePath,
        contentFile,
        visibility,
        owner: frontmatter.owner,
        attachments,
        frontmatter: { title: frontmatter.title, tags: frontmatter.tags },
        versionsIncluded,
        annotationsIncluded,
      });
    }

    // Build manifest
    const manifest: ExportManifest = {
      format: "codascope-notes",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      scope: { type: scope, id: opts.projectId ?? opts.epicId },
      visibility,
      exportedBy: userId,
      items,
    };

    archive.append(JSON.stringify(manifest, null, 2), { name: "codascope-notes-manifest.json" });
    await archive.finalize();
    await archivePromise;

    // Store the export record
    this.exports.set(exportId, {
      exportId,
      zipPath,
      createdAt: Date.now(),
    });

    // Log audit: export completed
    this.auditSvc.log({
      event: "note.export_completed",
      timestamp: new Date().toISOString(),
      actor: userId,
      noteId: "",
      scope,
      visibility,
      path: "",
      metadata: { exportId, noteCount: items.length },
    });

    return exportId;
  }

  /* ── Download ─────────────────────────────────────────────────────── */

  getExportFile(exportId: string): string | null {
    const record = this.exports.get(exportId);
    if (!record) return null;
    if (!existsSync(record.zipPath)) {
      this.exports.delete(exportId);
      return null;
    }
    return record.zipPath;
  }

  /* ── Cleanup ──────────────────────────────────────────────────────── */

  cleanupExpired(): number {
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();
    let cleaned = 0;

    for (const [id, record] of this.exports) {
      if (now - record.createdAt > ONE_HOUR) {
        try {
          if (existsSync(record.zipPath)) unlinkSync(record.zipPath);
        } catch { /* best effort */ }
        this.exports.delete(id);
        cleaned++;
      }
    }

    // Also clean orphaned files in the _exports directory
    const exportDir = path.join(this.root, "_exports");
    if (existsSync(exportDir)) {
      try {
        const files = readdirSync(exportDir);
        for (const file of files) {
          const filePath = path.join(exportDir, file);
          try {
            const stat = statSync(filePath);
            if (now - stat.mtimeMs > ONE_HOUR) {
              unlinkSync(filePath);
              cleaned++;
            }
          } catch { /* skip */ }
        }
      } catch { /* best effort */ }
    }

    return cleaned;
  }

  /* ── Private helpers ──────────────────────────────────────────────── */

  /** Recursively collect .md note files, optionally filtered by paths. */
  private collectNotes(dir: string, rootDir: string, filterPaths?: string[]): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;

    try {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".")) continue;
        if (item.name.startsWith("_") && item.name !== "_inbox") continue;
        if (item.name.endsWith(".assets") || item.name.endsWith(".versions")) continue;

        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
          results.push(...this.collectNotes(fullPath, rootDir, filterPaths));
        } else if (item.name.endsWith(".md")) {
          if (filterPaths && filterPaths.length > 0) {
            const rel = path.relative(rootDir, fullPath);
            // Match if any filter path is a prefix of, or equals, the relative path
            const matches = filterPaths.some(
              (fp) => rel === fp || rel === `${fp}.md` || rel.startsWith(`${fp}/`) || rel.startsWith(`${fp}.md/`),
            );
            if (!matches) continue;
          }
          results.push(fullPath);
        }
      }
    } catch { /* best effort */ }

    return results;
  }

  /** Recursively collect all files in a directory. */
  private collectFiles(dir: string): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;

    try {
      const items = readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".")) continue;
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          results.push(...this.collectFiles(fullPath));
        } else {
          results.push(fullPath);
        }
      }
    } catch { /* best effort */ }

    return results;
  }
}
