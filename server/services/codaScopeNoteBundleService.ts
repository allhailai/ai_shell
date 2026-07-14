/* ── CodaScope: Note Bundle Service ───────────────────────────────────
   The single authority for a complete note bundle: Markdown, assets,
   versions, and the co-located annotation sidecar. Move, archive, export,
   and import orchestration use this service so a new note artifact is added
   to one lifecycle boundary rather than several divergent code paths.
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import type { NoteScope, NoteVisibility } from "../../src/apps/codascope/codaScopeTypes.js";
import type {
  CodaScopeNoteService,
  NoteFolderMoveOpts,
  NoteMoveOpts,
  NoteResolveOpts,
} from "./codaScopeNoteService.js";
import type { CollectedNoteFileBundle } from "./codaScopeNoteFileService.js";
import type { CodaScopeNoteAnnotationService, NoteAnnotation } from "./codaScopeNoteAnnotationService.js";

export interface NoteBundleFileContent {
  relativePath: string;
  content: Buffer;
}

export interface NoteBundleCompanionContent {
  assets: NoteBundleFileContent[];
  versions: NoteBundleFileContent[];
  /** The canonical `{ annotations: [...] }` sidecar, when present. */
  annotation?: Buffer;
}

export interface NoteBundleRestoreResult {
  annotations: NoteAnnotation[];
  annotationWarning?: string;
}

export interface NoteBundleArchiveEntry {
  path: string;
  content: Buffer;
}

export interface NoteBundleArchiveContents {
  markdown: Buffer;
  entries: NoteBundleArchiveEntry[];
  attachments: Array<{ path: string; sha256: string }>;
  versionsIncluded: boolean;
  annotationsIncluded: true;
}

/**
 * Coordinates physical bundle operations with the annotation service's
 * derived path/scope metadata and anchor validation. It deliberately leaves
 * audit, user-preference, link-index, ZIP, and collision policy decisions to
 * the operation-specific services.
 */
export class CodaScopeNoteBundleService {
  constructor(
    private noteSvc: CodaScopeNoteService,
    private annotationSvc: CodaScopeNoteAnnotationService,
  ) {}

  setServices(noteSvc: CodaScopeNoteService, annotationSvc: CodaScopeNoteAnnotationService): void {
    this.noteSvc = noteSvc;
    this.annotationSvc = annotationSvc;
  }

  /** Enumerate every physical artifact belonging to one existing note. */
  collect(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): CollectedNoteFileBundle | null {
    return this.noteSvc.collectNoteBundle(scope, visibility, opts, notePath);
  }

  /**
   * Serialize every portable artifact for one note using the canonical ZIP
   * layout. Export does not need to know which sidecars or companion folders
   * exist; it appends these generic entries as-is.
   */
  async collectArchiveContents(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    includeVersions: boolean,
  ): Promise<NoteBundleArchiveContents | null> {
    await this.rebase(scope, visibility, opts, notePath);
    const bundle = this.collect(scope, visibility, opts, notePath);
    if (!bundle) return null;

    const entries: NoteBundleArchiveEntry[] = [];
    const markdown = readFileSync(bundle.noteFile);
    entries.push({ path: `notes/${notePath}`, content: markdown });

    const attachments: Array<{ path: string; sha256: string }> = [];
    for (const asset of bundle.assets) {
      const archivePath = `notes/${this.assetPrefix(notePath)}${this.zipRelativePath(asset.relativePath)}`;
      const content = readFileSync(asset.absolutePath);
      entries.push({ path: archivePath, content });
      attachments.push({
        path: archivePath,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
      });
    }

    if (includeVersions) {
      for (const version of bundle.versions) {
        entries.push({
          path: `versions/${this.versionPrefix(notePath)}${this.zipRelativePath(version.relativePath)}`,
          content: readFileSync(version.absolutePath),
        });
      }
    }

    entries.push({
      path: `notes/${this.annotationPath(notePath)}`,
      content: bundle.annotation
        ? readFileSync(bundle.annotation.absolutePath)
        : Buffer.from(JSON.stringify({ annotations: [] }, null, 2)),
    });

    return {
      markdown,
      entries,
      attachments,
      versionsIncluded: includeVersions && bundle.versions.length > 0,
      annotationsIncluded: true,
    };
  }

  /** Move one full bundle atomically, then rebase its derived annotation data. */
  async moveFile(options: NoteMoveOpts): Promise<boolean> {
    const moved = await this.noteSvc.moveNote(options);
    if (!moved) return false;

    try {
      await this.rebase(options.toScope, options.toVisibility, options.toOpts, options.toPath);
      return true;
    } catch (error) {
      try {
        await this.noteSvc.moveNote({
          fromScope: options.toScope,
          fromVisibility: options.toVisibility,
          fromOpts: options.toOpts,
          fromPath: options.toPath,
          toScope: options.fromScope,
          toVisibility: options.fromVisibility,
          toOpts: options.fromOpts,
          toPath: options.fromPath,
        });
        await this.rebase(options.fromScope, options.fromVisibility, options.fromOpts, options.fromPath);
      } catch { /* best effort rollback after a failed rebase */ }
      throw error;
    }
  }

  /** Move one directory tree, preserving all physical note bundles. */
  async moveFolder(options: NoteFolderMoveOpts): Promise<boolean> {
    const moved = await this.noteSvc.moveFolder(options);
    if (!moved) return false;

    try {
      await this.rebaseFolder(options.toScope, options.toVisibility, options.toOpts, options.toFolder);
      return true;
    } catch (error) {
      try {
        await this.noteSvc.moveFolder({
          fromScope: options.toScope,
          fromVisibility: options.toVisibility,
          fromOpts: options.toOpts,
          fromFolder: options.toFolder,
          toScope: options.fromScope,
          toVisibility: options.fromVisibility,
          toOpts: options.fromOpts,
          toFolder: options.fromFolder,
        });
        await this.rebaseFolder(options.fromScope, options.fromVisibility, options.fromOpts, options.fromFolder);
      } catch { /* best effort rollback after a failed rebase */ }
      throw error;
    }
  }

  /** Archive one complete physical bundle without splitting its companions. */
  async archiveNote(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    reason?: string,
  ): ReturnType<CodaScopeNoteService["archiveNote"]> {
    return this.noteSvc.archiveNote(scope, visibility, opts, notePath, reason);
  }

  /** Archive a directory tree of complete physical note bundles. */
  async archiveFolder(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    folderPath: string,
    reason?: string,
  ): ReturnType<CodaScopeNoteService["archiveFolder"]> {
    return this.noteSvc.archiveFolder(scope, visibility, opts, folderPath, reason);
  }

  /** Restore an archived bundle or tree, then rebase its derived metadata. */
  async restoreNote(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    noteId: string,
  ): ReturnType<CodaScopeNoteService["restoreNote"]> {
    const result = await this.noteSvc.restoreNote(scope, visibility, opts, noteId);
    if (!result) return null;
    if (result.meta.kind === "folder") {
      await this.rebaseFolder(scope, visibility, opts, result.restoredPath);
    } else {
      await this.rebase(scope, visibility, opts, result.restoredPath);
    }
    return result;
  }

  /** Delete permanently, or archive, a complete physical note bundle. */
  async deleteNote(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    permanent?: boolean,
  ): ReturnType<CodaScopeNoteService["deleteNote"]> {
    return this.noteSvc.deleteNote(scope, visibility, opts, notePath, permanent);
  }

  /** Archive many complete note bundles under one caller-provided policy. */
  async bulkArchive(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    noteIds: string[],
    reason?: string,
  ): ReturnType<CodaScopeNoteService["bulkArchive"]> {
    return this.noteSvc.bulkArchive(scope, visibility, opts, noteIds, reason);
  }

  /** Restore all portable companion files into a newly-created destination note. */
  async restoreCompanions(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
    content: NoteBundleCompanionContent,
  ): Promise<NoteBundleRestoreResult> {
    for (const asset of content.assets) {
      this.noteSvc.writeNoteBundleCompanion(scope, visibility, opts, notePath, "asset", asset.relativePath, asset.content);
    }
    for (const version of content.versions) {
      this.noteSvc.writeNoteBundleCompanion(scope, visibility, opts, notePath, "version", version.relativePath, version.content);
    }

    let annotationWarning: string | undefined;
    if (content.annotation) {
      try {
        const parsed = JSON.parse(content.annotation.toString("utf-8"));
        if (!Array.isArray(parsed) && !Array.isArray(parsed?.annotations)) {
          annotationWarning = "annotation sidecar was malformed and was not imported.";
        } else {
          this.annotationSvc.replaceAnnotations(scope, visibility, opts, notePath, parsed);
        }
      } catch {
        annotationWarning = "annotation sidecar was malformed and was not imported.";
      }
    }

    return {
      annotations: await this.rebase(scope, visibility, opts, notePath),
      annotationWarning,
    };
  }

  /**
   * Restore one note's portable companion entries. ZIP path interpretation is
   * intentionally here, alongside ZIP entry construction above.
   */
  async restoreArchiveContents(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    sourceNotePath: string,
    targetNotePath: string,
    entries: Map<string, Buffer>,
  ): Promise<NoteBundleRestoreResult> {
    const assets: NoteBundleFileContent[] = [];
    const versions: NoteBundleFileContent[] = [];
    let annotation: Buffer | undefined;
    const assetsPrefix = this.assetPrefix(sourceNotePath);
    const versionsPrefix = this.versionPrefix(sourceNotePath);
    const annotationsPath = this.annotationPath(sourceNotePath);

    for (const [entryPath, content] of entries) {
      const normalized = entryPath.startsWith("notes/")
        ? entryPath.slice(6)
        : entryPath.startsWith("versions/")
          ? entryPath.slice(9)
          : entryPath;
      if (normalized.startsWith(assetsPrefix)) {
        assets.push({ relativePath: normalized.slice(assetsPrefix.length), content });
      } else if (normalized.startsWith(versionsPrefix)) {
        versions.push({ relativePath: normalized.slice(versionsPrefix.length), content });
      } else if (normalized === annotationsPath) {
        annotation = content;
      }
    }

    return this.restoreCompanions(scope, visibility, opts, targetNotePath, { assets, versions, annotation });
  }

  /** Re-derive the location fields and attachment state for one moved/restored note. */
  async rebase(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    notePath: string,
  ): Promise<NoteAnnotation[]> {
    return this.annotationSvc.reconcileAfterNoteWrite(scope, visibility, opts, notePath);
  }

  /** Re-derive annotation metadata for every note in a moved/restored tree. */
  async rebaseFolder(
    scope: NoteScope,
    visibility: NoteVisibility,
    opts: NoteResolveOpts,
    folderPath: string,
  ): Promise<void> {
    const visit = async (folder: string): Promise<void> => {
      const entries = await this.noteSvc.listNotes(scope, visibility, opts, folder);
      for (const entry of entries) {
        if (entry.isFolder) await visit(entry.path);
        else await this.rebase(scope, visibility, opts, entry.path);
      }
    };
    await visit(folderPath);
  }

  private assetPrefix(notePath: string): string {
    return `${notePath.replace(/\.md$/i, "")}.assets/`;
  }

  private versionPrefix(notePath: string): string {
    return `${notePath.replace(/\.md$/i, "")}.versions/`;
  }

  private annotationPath(notePath: string): string {
    return `${notePath.replace(/\.md$/i, "")}.annotations.json`;
  }

  private zipRelativePath(relativePath: string): string {
    return relativePath.split(path.sep).join("/");
  }
}
