/* ── CodaScope: Note Package Services — Integration Test ───────────── */

import { describe, it, expect, afterEach } from "vitest";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { ZipArchive } from "archiver";
import { CodaScopeNoteService } from "./codaScopeNoteService.js";
import { CodaScopeNoteAnnotationService } from "./codaScopeNoteAnnotationService.js";
import { CodaScopeNoteBundleService } from "./codaScopeNoteBundleService.js";
import { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";
import { CodaScopeNoteExportService } from "./codaScopeNoteExportService.js";
import { CodaScopeNoteImportService } from "./codaScopeNoteImportService.js";
import { CodaScopeNoteTransferService } from "./codaScopeNoteTransferService.js";
import { CodaScopeNoteUserPrefsService } from "./codaScopeNoteUserPrefsService.js";
import { CodaScopeNoteLinkIndexService } from "./codaScopeNoteLinkIndexService.js";

const roots: string[] = [];

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `note-package-${crypto.randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CodaScope note packages", () => {
  it("round-trips nested notes, assets, versions, and annotations through export/import", async () => {
    const root = tmpDir();
    const noteSvc = new CodaScopeNoteService(root);
    const annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
    const bundleSvc = new CodaScopeNoteBundleService(noteSvc, annotationSvc);
    const auditSvc = new CodaScopeNoteAuditService(root);
    const opts = { userId: "alan" };

    await noteSvc.createNote("codascope", "private", opts, "research/decision.md", "# Decision\n\nKeep the whole package.");
    await noteSvc.uploadImage("codascope", "private", opts, "research/decision.md", Buffer.from("image"), "image/png");
    const source = await noteSvc.readNote("codascope", "private", opts, "research/decision.md");
    await noteSvc.updateNote(
      "codascope", "private", opts, "research/decision.md",
      `${source!.content}\nUpdated.`, source!.contentHash,
    );
    const annotationNote = await noteSvc.readNote("codascope", "private", opts, "research/decision.md");
    const annotationBody = noteSvc.parseFrontmatter(annotationNote!.content).body;
    const anchorFrom = annotationBody.indexOf("whole package");
    await annotationSvc.createRangeAnnotation("codascope", "private", opts, "research/decision.md", {
      from: anchorFrom,
      to: anchorFrom + "whole package".length,
      selectedText: "whole package",
      expectedHash: annotationNote!.contentHash,
      author: "alan",
      body: "Carry this comment with the note.",
    });

    const exportSvc = new CodaScopeNoteExportService(root, noteSvc, auditSvc, bundleSvc);
    const exportId = await exportSvc.generateExport("codascope", "private", opts, {
      notePaths: ["research"],
      includeVersions: true,
    });
    const archivePath = exportSvc.getExportFile(exportId)!;

    const importSvc = new CodaScopeNoteImportService(root, noteSvc, auditSvc, bundleSvc);
    const report = await importSvc.executeImport(
      readFileSync(archivePath),
      "codascope",
      "shared",
      opts,
      "skip",
    );

    expect(report).toMatchObject({ imported: 1, skipped: 0, renamed: 0, failed: [] });
    expect(await noteSvc.readNote("codascope", "shared", opts, "research/decision.md")).not.toBeNull();
    const bundle = noteSvc.getNoteFileBundle("codascope", "shared", opts, "research/decision.md")!;
    expect(existsWithContent(bundle.assetsDir)).toBe(true);
    expect(existsWithContent(bundle.versionsDir)).toBe(true);
    expect(existsSync(bundle.annotationFile)).toBe(true);
    const annotations = await annotationSvc.listAnnotations("codascope", "shared", opts, "research/decision.md");
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      noteVisibility: "shared",
      notePath: "research/decision.md",
    });
    expect((annotations[0].anchor as any).attachmentState).toBe("attached");
  });

  it("keeps one complete nested annotation bundle intact through move, export/import, collision rename, and archive restore", async () => {
    const root = tmpDir();
    const noteSvc = new CodaScopeNoteService(root);
    const annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
    const bundleSvc = new CodaScopeNoteBundleService(noteSvc, annotationSvc);
    const auditSvc = new CodaScopeNoteAuditService(root);
    const transferSvc = new CodaScopeNoteTransferService(
      noteSvc,
      bundleSvc,
      new CodaScopeNoteUserPrefsService(root),
      new CodaScopeNoteLinkIndexService(noteSvc),
      auditSvc,
    );
    const opts = { userId: "alan" };
    const sourcePath = "research/nested/decision.md";
    const movedPath = "published/decision.md";

    await noteSvc.createNote("codascope", "private", opts, sourcePath, "# Decision\n\nKeep the durable annotation bundle together.");
    await noteSvc.uploadImage("codascope", "private", opts, sourcePath, Buffer.from("image"), "image/png");
    const initial = await noteSvc.readNote("codascope", "private", opts, sourcePath);
    await noteSvc.updateNote("codascope", "private", opts, sourcePath, `${initial!.content}\n\nVersioned.`, initial!.contentHash);
    const annotationNote = await noteSvc.readNote("codascope", "private", opts, sourcePath);
    const annotationBody = noteSvc.parseFrontmatter(annotationNote!.content).body;
    const selectedText = "durable annotation bundle";
    const from = annotationBody.indexOf(selectedText);
    const created = await annotationSvc.createRangeAnnotation("codascope", "private", opts, sourcePath, {
      from,
      to: from + selectedText.length,
      selectedText,
      expectedHash: annotationNote!.contentHash,
      author: "alan",
      body: "Keep this rationale.",
    });
    if ("conflict" in created) throw new Error("unexpected annotation conflict");
    const rootAnnotationId = created.annotation.id;
    const reply = await annotationSvc.createAnnotation("codascope", "private", opts, sourcePath, {
      parentId: rootAnnotationId,
      author: "jules",
      body: "Reply travels with the thread.",
    });
    await annotationSvc.updateAnnotation("codascope", "private", opts, sourcePath, rootAnnotationId, {
      reactions: [{ emoji: "ack", user: "jules" }],
    });
    const sourceBundle = noteSvc.collectNoteBundle("codascope", "private", opts, sourcePath)!;
    expect(existsSync(sourceBundle.annotationFile)).toBe(true);

    const moved = await transferSvc.moveFile({
      fromScope: "codascope",
      fromVisibility: "private",
      fromOpts: opts,
      fromPath: sourcePath,
      toScope: "codascope",
      toVisibility: "private",
      toOpts: opts,
      toPath: movedPath,
    });
    expect(moved.moved).toBe(true);
    const movedBundle = noteSvc.collectNoteBundle("codascope", "private", opts, movedPath)!;
    expect(existsWithContent(movedBundle.assetsDir)).toBe(true);
    expect(existsWithContent(movedBundle.versionsDir)).toBe(true);
    expect(existsSync(movedBundle.annotationFile)).toBe(true);

    const exportSvc = new CodaScopeNoteExportService(root, noteSvc, auditSvc, bundleSvc);
    const exportId = await exportSvc.generateExport("codascope", "private", opts, {
      notePaths: ["published"],
      includeVersions: true,
    });
    const archive = readFileSync(exportSvc.getExportFile(exportId)!);
    const importSvc = new CodaScopeNoteImportService(root, noteSvc, auditSvc, bundleSvc);
    expect(await importSvc.executeImport(archive, "codascope", "shared", opts, "skip"))
      .toMatchObject({ imported: 1, skipped: 0, failed: [] });
    expect(await importSvc.executeImport(archive, "codascope", "shared", opts, "rename"))
      .toMatchObject({ imported: 1, renamed: 1, failed: [] });

    const importedEntries = (await noteSvc.listNotes("codascope", "shared", opts, "published"))
      .filter((entry) => !entry.isFolder);
    expect(importedEntries).toHaveLength(2);
    for (const entry of importedEntries) {
      const importedBundle = noteSvc.collectNoteBundle("codascope", "shared", opts, entry.path)!;
      expect(existsWithContent(importedBundle.assetsDir)).toBe(true);
      expect(existsWithContent(importedBundle.versionsDir)).toBe(true);
      expect(existsSync(importedBundle.annotationFile)).toBe(true);
      const annotations = await annotationSvc.listAnnotations("codascope", "shared", opts, entry.path);
      expect(annotations.map((annotation) => annotation.id).sort()).toEqual([rootAnnotationId, reply.id].sort());
      expect(annotations.find((annotation) => annotation.id === rootAnnotationId)).toMatchObject({
        noteScope: "codascope",
        noteVisibility: "shared",
        notePath: entry.path,
        reactions: [{ emoji: "ack", user: "jules" }],
      });
      const importedNote = await noteSvc.readNote("codascope", "shared", opts, entry.path);
      expect(importedNote!.content).toContain(`id="${rootAnnotationId}"`);
    }

    const archived = await bundleSvc.archiveNote("codascope", "private", opts, movedPath);
    await noteSvc.createNote("codascope", "private", opts, movedPath, "Collision placeholder.");
    const restored = await bundleSvc.restoreNote("codascope", "private", opts, archived!.noteId);
    expect(restored?.restoredPath).toMatch(/^published\/decision \(restored\)\.md$/);
    const restoredBundle = noteSvc.collectNoteBundle("codascope", "private", opts, restored!.restoredPath)!;
    expect(existsWithContent(restoredBundle.assetsDir)).toBe(true);
    expect(existsWithContent(restoredBundle.versionsDir)).toBe(true);
    expect(existsSync(restoredBundle.annotationFile)).toBe(true);
    const restoredAnnotations = await annotationSvc.listAnnotations("codascope", "private", opts, restored!.restoredPath);
    expect(restoredAnnotations.map((annotation) => annotation.id).sort()).toEqual([rootAnnotationId, reply.id].sort());
    expect(restoredAnnotations.find((annotation) => annotation.id === rootAnnotationId)?.notePath).toBe(restored!.restoredPath);
  });

  it("reconciles annotation sidecars imported from a ZIP without a manifest", async () => {
    const root = tmpDir();
    const noteSvc = new CodaScopeNoteService(root);
    const annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
    const bundleSvc = new CodaScopeNoteBundleService(noteSvc, annotationSvc);
    const auditSvc = new CodaScopeNoteAuditService(root);
    const opts = { userId: "alan" };

    await noteSvc.createNote("codascope", "private", opts, "fallback.md", "# Fallback\n\nThis marker must be verified.");
    const source = await noteSvc.readNote("codascope", "private", opts, "fallback.md");
    const body = noteSvc.parseFrontmatter(source!.content).body;
    const selectedText = "marker must be verified";
    const from = body.indexOf(selectedText);
    const created = await annotationSvc.createRangeAnnotation("codascope", "private", opts, "fallback.md", {
      from,
      to: from + selectedText.length,
      selectedText,
      expectedHash: source!.contentHash,
      author: "alan",
      body: "Check the fallback path.",
    });
    if ("conflict" in created) throw new Error("unexpected annotation conflict");
    const bundle = noteSvc.collectNoteBundle("codascope", "private", opts, "fallback.md")!;
    const rawZip = path.join(root, "fallback.zip");
    await writeZip(rawZip, [
      { path: "notes/fallback.md", content: readFileSync(bundle.noteFile) },
      { path: "notes/fallback.annotations.json", content: readFileSync(bundle.annotationFile) },
    ]);

    const importSvc = new CodaScopeNoteImportService(root, noteSvc, auditSvc, bundleSvc);
    const report = await importSvc.executeImport(readFileSync(rawZip), "codascope", "shared", opts, "skip");
    expect(report).toMatchObject({ imported: 1, failed: [] });
    const annotations = await annotationSvc.listAnnotations("codascope", "shared", opts, "fallback.md");
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({ id: created.annotation.id, noteVisibility: "shared", notePath: "fallback.md" });
    expect((annotations[0].anchor as any).attachmentState).toBe("attached");
  });
});

function existsWithContent(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

async function writeZip(zipPath: string, entries: Array<{ path: string; content: Buffer }>): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = createWriteStream(zipPath);
  const complete = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });
  archive.pipe(output);
  for (const entry of entries) archive.append(entry.content, { name: entry.path });
  await archive.finalize();
  await complete;
}
