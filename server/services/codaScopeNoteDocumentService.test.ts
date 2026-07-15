import { describe, it, expect, afterEach } from "vitest";
import { existsSync, ftruncateSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, closeSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { CodaScopeNoteService } from "./codaScopeNoteService.js";
import { CodaScopeNoteUserPrefsService } from "./codaScopeNoteUserPrefsService.js";
import { CodaScopeNoteDocumentService } from "./codaScopeNoteDocumentService.js";
import { CodaScopeNoteAnnotationService } from "./codaScopeNoteAnnotationService.js";
import { CodaScopeNoteBundleService } from "./codaScopeNoteBundleService.js";
import { CodaScopeNoteTransferService } from "./codaScopeNoteTransferService.js";
import { CodaScopeNoteLinkIndexService } from "./codaScopeNoteLinkIndexService.js";
import { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";

const roots: string[] = [];

function tmpDir(): string {
  const root = path.join(os.tmpdir(), `note-document-${crypto.randomBytes(6).toString("hex")}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

function stagedFile(root: string, name: string, content: string | Buffer): string {
  const temp = path.join(root, name);
  writeFileSync(temp, content);
  return temp;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CodaScopeNoteDocumentService", () => {
  it("stores opaque files in the note bundle, keeps IDs/paths stable, and separates personal stars from shared pins", async () => {
    const root = tmpDir();
    const noteSvc = new CodaScopeNoteService(root);
    const prefs = new CodaScopeNoteUserPrefsService(root);
    const documents = new CodaScopeNoteDocumentService(noteSvc, prefs);
    const opts = { userId: "alice" };
    await noteSvc.createNote("codascope", "shared", opts, "research.md", "# Research");

    const created = await documents.createDocument("codascope", "shared", opts, "research.md", {
      temporaryPath: stagedFile(root, "upload.pdf", Buffer.from("opaque pdf bytes")),
      originalFilename: "report.pdf",
      declaredMimeType: "application/pdf",
    });
    expect(created.storedPath).toBe(`documents/${created.id}/blob`);
    expect(existsSync(path.join(root, "_notes", "shared", "research.assets", created.storedPath))).toBe(true);

    const renamed = await documents.updateDocument("codascope", "shared", opts, "research.md", created.id, {
      displayName: "Q3 report.pdf",
      comment: "Shared context",
    });
    expect(renamed).toMatchObject({ id: created.id, storedPath: created.storedPath, displayName: "Q3 report.pdf" });
    await documents.setPinned("codascope", "shared", opts, "research.md", created.id, true);
    await documents.setStarred("codascope", "shared", opts, "research.md", created.id, true);
    expect((await documents.listDocuments("codascope", "shared", opts, "research.md")).active[0]).toMatchObject({
      id: created.id,
      starred: true,
      pinnedBy: "alice",
    });
    expect((await documents.listDocuments("codascope", "shared", { userId: "bob" }, "research.md")).active[0]?.starred).toBeUndefined();
    expect(prefs.getDocumentStars("alice")[0]).toMatchObject({ documentId: created.id, noteId: (await noteSvc.readNote("codascope", "shared", opts, "research.md"))!.frontmatter.id });

    await documents.setArchived("codascope", "shared", opts, "research.md", created.id, true);
    const list = await documents.listDocuments("codascope", "shared", opts, "research.md");
    expect(list.active).toEqual([]);
    expect(list.archived[0]).toMatchObject({ id: created.id, starred: true });
    const download = await documents.resolveDownload("codascope", "shared", opts, "research.md", created.id);
    expect(readFileSync(download.absolutePath, "utf-8")).toBe("opaque pdf bytes");
  });

  it("rejects corrupted metadata and carries document bytes and star references through the transfer service", async () => {
    const root = tmpDir();
    const noteSvc = new CodaScopeNoteService(root);
    const prefs = new CodaScopeNoteUserPrefsService(root);
    const documents = new CodaScopeNoteDocumentService(noteSvc, prefs);
    const annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
    const bundleSvc = new CodaScopeNoteBundleService(noteSvc, annotationSvc);
    const auditSvc = new CodaScopeNoteAuditService(root);
    const transfer = new CodaScopeNoteTransferService(noteSvc, bundleSvc, prefs, new CodaScopeNoteLinkIndexService(noteSvc), auditSvc);
    const opts = { userId: "alice" };
    await noteSvc.createNote("codascope", "private", opts, "from/source.md", "# Source");
    const document = await documents.createDocument("codascope", "private", opts, "from/source.md", {
      temporaryPath: stagedFile(root, "upload.bin", Buffer.from("bundle bytes")),
      originalFilename: "source.bin",
    });
    await documents.setStarred("codascope", "private", opts, "from/source.md", document.id, true);

    const moved = await transfer.moveFile({
      fromScope: "codascope", fromVisibility: "private", fromOpts: opts, fromPath: "from/source.md",
      toScope: "codascope", toVisibility: "private", toOpts: opts, toPath: "to/target.md",
    });
    expect(moved.moved).toBe(true);
    const movedDocument = (await documents.listDocuments("codascope", "private", opts, "to/target.md")).active[0];
    expect(movedDocument).toMatchObject({ id: document.id, storedPath: document.storedPath, starred: true });
    expect(prefs.getDocumentStars("alice")[0]).toMatchObject({ path: "to/target.md" });

    const archived = await bundleSvc.archiveNote("codascope", "private", opts, "to/target.md");
    const restored = await bundleSvc.restoreNote("codascope", "private", opts, archived!.noteId);
    expect((await documents.listDocuments("codascope", "private", opts, restored!.restoredPath)).active[0])
      .toMatchObject({ id: document.id, storedPath: document.storedPath });

    const restoredAssets = `${path.basename(restored!.restoredPath, ".md")}.assets`;
    const manifestPath = path.join(root, "_notes", "private", "alice", path.dirname(restored!.restoredPath), restoredAssets, "documents", "index.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.documents[0].storedPath = "../../outside";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await expect(documents.listDocuments("codascope", "private", opts, "to/target.md"))
      .rejects.toThrow("unsafe stored path");
  });

  it("rejects an over-limit staged file before publishing a blob or manifest entry", async () => {
    const root = tmpDir();
    const noteSvc = new CodaScopeNoteService(root);
    const documents = new CodaScopeNoteDocumentService(noteSvc, new CodaScopeNoteUserPrefsService(root));
    const opts = { userId: "alice" };
    await noteSvc.createNote("codascope", "private", opts, "quota.md", "# Quota");
    const upload = path.join(root, "too-large.bin");
    const descriptor = openSync(upload, "w");
    ftruncateSync(descriptor, CodaScopeNoteDocumentService.MAX_FILE_BYTES + 1);
    closeSync(descriptor);

    await expect(documents.createDocument("codascope", "private", opts, "quota.md", {
      temporaryPath: upload,
      originalFilename: "too-large.bin",
    })).rejects.toThrow("100 MB");
    expect(existsSync(upload)).toBe(false);
    expect(existsSync(path.join(root, "_notes", "private", "alice", "quota.assets", "documents", "index.json"))).toBe(false);
  });
});
