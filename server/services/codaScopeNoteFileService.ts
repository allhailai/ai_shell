/* ── CodaScope: Note File Service ────────────────────────────────────
   Owns the filesystem representation of one note: Markdown, its co-located
   asset and version directories, and its annotation sidecar. Higher-level
   services use this utility for move, import, export, and archive operations.
   ──────────────────────────────────────────────────────────────────── */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveWithin } from "./codaScopePathSafety.js";

export type NoteBundleCompanionKind = "asset" | "version";

export interface NoteFileBundle {
  noteFile: string;
  assetsDir: string;
  versionsDir: string;
  annotationFile: string;
}

export interface NoteBundleFile {
  absolutePath: string;
  relativePath: string;
}

export interface CollectedNoteFileBundle extends NoteFileBundle {
  assets: NoteBundleFile[];
  versions: NoteBundleFile[];
  annotation?: NoteBundleFile;
}

/**
 * The low-level, transactional filesystem utility for a note and its
 * co-located companion directories and sidecar path. It deliberately knows
 * nothing about scope, permissions, sidecar contents, or user preferences;
 * those belong to higher-level services.
 */
export class CodaScopeNoteFileService {
  getBundle(noteFile: string): NoteFileBundle {
    const basename = path.basename(noteFile, ".md");
    const parent = path.dirname(noteFile);
    return {
      noteFile,
      assetsDir: path.join(parent, `${basename}.assets`),
      versionsDir: path.join(parent, `${basename}.versions`),
      annotationFile: path.join(parent, `${basename}.annotations.json`),
    };
  }

  /** Enumerate every physical artifact belonging to a note. */
  collectNoteBundle(noteFile: string): CollectedNoteFileBundle {
    const bundle = this.getBundle(noteFile);
    return {
      ...bundle,
      assets: this.collectCompanionFiles(bundle.assetsDir),
      versions: this.collectCompanionFiles(bundle.versionsDir),
      annotation: existsSync(bundle.annotationFile)
        ? { absolutePath: bundle.annotationFile, relativePath: path.basename(bundle.annotationFile) }
        : undefined,
    };
  }

  /** Move a complete note bundle, rolling back every completed rename on failure. */
  moveFile(sourceNoteFile: string, targetNoteFile: string): boolean {
    if (!existsSync(sourceNoteFile)) return false;
    if (existsSync(targetNoteFile)) {
      throw new Error(`Target note already exists: ${targetNoteFile}`);
    }

    const source = this.collectNoteBundle(sourceNoteFile);
    const target = this.getBundle(targetNoteFile);
    if (existsSync(target.assetsDir) || existsSync(target.versionsDir) || existsSync(target.annotationFile)) {
      throw new Error(`Target note data already exists: ${targetNoteFile}`);
    }

    const targetParent = path.dirname(targetNoteFile);
    if (!existsSync(targetParent)) mkdirSync(targetParent, { recursive: true });

    let noteMoved = false;
    let assetsMoved = false;
    let versionsMoved = false;
    let annotationMoved = false;

    try {
      renameSync(source.noteFile, target.noteFile);
      noteMoved = true;

      if (source.assets.length > 0 || existsSync(source.assetsDir)) {
        renameSync(source.assetsDir, target.assetsDir);
        assetsMoved = true;
      }
      if (source.versions.length > 0 || existsSync(source.versionsDir)) {
        renameSync(source.versionsDir, target.versionsDir);
        versionsMoved = true;
      }
      if (source.annotation) {
        renameSync(source.annotationFile, target.annotationFile);
        annotationMoved = true;
      }
      return true;
    } catch (error) {
      try { if (annotationMoved && existsSync(target.annotationFile)) renameSync(target.annotationFile, source.annotationFile); } catch { /* best effort */ }
      try { if (versionsMoved && existsSync(target.versionsDir)) renameSync(target.versionsDir, source.versionsDir); } catch { /* best effort */ }
      try { if (assetsMoved && existsSync(target.assetsDir)) renameSync(target.assetsDir, source.assetsDir); } catch { /* best effort */ }
      try { if (noteMoved && existsSync(target.noteFile)) renameSync(target.noteFile, source.noteFile); } catch { /* best effort */ }
      throw error;
    }
  }

  /** Recursively list files in one companion directory. */
  listCompanionFiles(noteFile: string, kind: NoteBundleCompanionKind): NoteBundleFile[] {
    const bundle = this.collectNoteBundle(noteFile);
    return kind === "asset" ? bundle.assets : bundle.versions;
  }

  /** Permanently remove a note and every physical companion artifact. */
  deleteBundle(noteFile: string): boolean {
    const bundle = this.collectNoteBundle(noteFile);
    if (!existsSync(bundle.noteFile)) return false;
    rmSync(bundle.noteFile, { force: true });
    if (existsSync(bundle.assetsDir)) rmSync(bundle.assetsDir, { recursive: true, force: true });
    if (existsSync(bundle.versionsDir)) rmSync(bundle.versionsDir, { recursive: true, force: true });
    if (existsSync(bundle.annotationFile)) rmSync(bundle.annotationFile, { force: true });
    return true;
  }

  /** Write a file inside a note's asset or version companion directory. */
  writeCompanionFile(
    noteFile: string,
    kind: NoteBundleCompanionKind,
    relativePath: string,
    content: Buffer,
  ): void {
    const companionDir = this.companionDir(noteFile, kind);
    const target = resolveWithin(companionDir, relativePath, `${kind} path`);
    const targetParent = path.dirname(target);
    if (!existsSync(targetParent)) mkdirSync(targetParent, { recursive: true });
    writeFileSync(target, content);
  }

  private companionDir(noteFile: string, kind: NoteBundleCompanionKind): string {
    const bundle = this.getBundle(noteFile);
    return kind === "asset" ? bundle.assetsDir : bundle.versionsDir;
  }

  private collectCompanionFiles(root: string): NoteBundleFile[] {
    const files: NoteBundleFile[] = [];
    this.collectFiles(root, root, files);
    return files;
  }

  private collectFiles(dir: string, root: string, files: NoteBundleFile[]): void {
    if (!existsSync(dir)) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const absolutePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this.collectFiles(absolutePath, root, files);
        } else {
          files.push({
            absolutePath,
            relativePath: path.relative(root, absolutePath),
          });
        }
      }
    } catch { /* best effort during export inspection */ }
  }
}
