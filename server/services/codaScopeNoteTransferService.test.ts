/* ── CodaScope: Note Transfer Service — Unit Tests ─────────────────── */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { CodaScopeNoteService } from "./codaScopeNoteService.js";
import { CodaScopeNoteAnnotationService } from "./codaScopeNoteAnnotationService.js";
import { CodaScopeNoteUserPrefsService } from "./codaScopeNoteUserPrefsService.js";
import { CodaScopeNoteLinkIndexService } from "./codaScopeNoteLinkIndexService.js";
import { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";
import { CodaScopeNoteTransferService } from "./codaScopeNoteTransferService.js";

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `note-transfer-${crypto.randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("CodaScopeNoteTransferService", () => {
  let root: string;
  let noteSvc: CodaScopeNoteService;
  let annotationSvc: CodaScopeNoteAnnotationService;
  let prefsSvc: CodaScopeNoteUserPrefsService;
  let transferSvc: CodaScopeNoteTransferService;
  const alan = { userId: "alan" };

  beforeEach(() => {
    root = tmpDir();
    noteSvc = new CodaScopeNoteService(root);
    annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
    prefsSvc = new CodaScopeNoteUserPrefsService(root);
    transferSvc = new CodaScopeNoteTransferService(
      noteSvc,
      annotationSvc,
      prefsSvc,
      new CodaScopeNoteLinkIndexService(noteSvc),
      new CodaScopeNoteAuditService(root),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("moves a complete note bundle, annotations, and user references", async () => {
    await noteSvc.createNote("codascope", "private", alan, "inbox/decision.md", "# Decision\n\nKeep the bundle together.");
    await noteSvc.uploadImage("codascope", "private", alan, "inbox/decision.md", Buffer.from("image"), "image/png");
    const original = await noteSvc.readNote("codascope", "private", alan, "inbox/decision.md");
    await noteSvc.updateNote(
      "codascope", "private", alan, "inbox/decision.md",
      `${original!.content}\nUpdated.`, original!.contentHash,
    );
    const annotationNote = await noteSvc.readNote("codascope", "private", alan, "inbox/decision.md");
    const annotationBody = noteSvc.parseFrontmatter(annotationNote!.content).body;
    const anchorFrom = annotationBody.indexOf("bundle together");
    await annotationSvc.createRangeAnnotation("codascope", "private", alan, "inbox/decision.md", {
      from: anchorFrom,
      to: anchorFrom + "bundle together".length,
      selectedText: "bundle together",
      expectedHash: annotationNote!.contentHash,
      author: "alan",
      body: "Retain this rationale.",
    });
    prefsSvc.star("alan", {
      noteId: original!.frontmatter.id,
      scope: "codascope",
      visibility: "private",
      path: "inbox/decision.md",
      title: original!.frontmatter.title,
    });
    prefsSvc.addRecent("alan", {
      noteId: original!.frontmatter.id,
      scope: "codascope",
      visibility: "private",
      path: "inbox/decision.md",
      title: original!.frontmatter.title,
    });

    const result = await transferSvc.moveFile({
      fromScope: "codascope",
      fromVisibility: "private",
      fromOpts: alan,
      fromPath: "inbox/decision.md",
      toScope: "codascope",
      toVisibility: "private",
      toOpts: alan,
      toPath: "archive/decision.md",
    });

    expect(result.moved).toBe(true);
    expect(await noteSvc.readNote("codascope", "private", alan, "inbox/decision.md")).toBeNull();
    expect(await noteSvc.readNote("codascope", "private", alan, "archive/decision.md")).not.toBeNull();
    const bundle = noteSvc.getNoteFileBundle("codascope", "private", alan, "archive/decision.md")!;
    expect(existsSync(bundle.assetsDir)).toBe(true);
    expect(existsSync(bundle.versionsDir)).toBe(true);
    expect(existsSync(bundle.annotationFile)).toBe(true);

    const annotations = await annotationSvc.listAnnotations("codascope", "private", alan, "archive/decision.md");
    expect(annotations).toHaveLength(1);
    expect(annotations[0].notePath).toBe("archive/decision.md");
    expect((annotations[0].anchor as any).attachmentState).toBe("attached");
    expect(await annotationSvc.listAnnotations("codascope", "private", alan, "inbox/decision.md")).toHaveLength(0);
    expect(prefsSvc.getStarred("alan")[0].path).toBe("archive/decision.md");
    expect(prefsSvc.getRecents("alan")[0].path).toBe("archive/decision.md");
  });

  it("moves folder trees with their annotations and note references", async () => {
    await noteSvc.createNote("codascope", "private", alan, "research/decisions/choice.md", "# Choice");
    const source = await noteSvc.readNote("codascope", "private", alan, "research/decisions/choice.md");
    const folderAnnotationNote = await noteSvc.readNote("codascope", "private", alan, "research/decisions/choice.md");
    const folderAnnotationBody = noteSvc.parseFrontmatter(folderAnnotationNote!.content).body;
    const folderAnchorFrom = folderAnnotationBody.indexOf("Choice");
    await annotationSvc.createRangeAnnotation("codascope", "private", alan, "research/decisions/choice.md", {
      from: folderAnchorFrom,
      to: folderAnchorFrom + "Choice".length,
      selectedText: "Choice",
      expectedHash: folderAnnotationNote!.contentHash,
      author: "alan",
      body: "Review with the team.",
    });
    prefsSvc.star("alan", {
      noteId: source!.frontmatter.id,
      scope: "codascope",
      visibility: "private",
      path: "research/decisions/choice.md",
      title: source!.frontmatter.title,
    });

    const result = await transferSvc.moveFolder({
      fromScope: "codascope",
      fromVisibility: "private",
      fromOpts: alan,
      fromFolder: "research",
      toScope: "codascope",
      toVisibility: "shared",
      toOpts: alan,
      toFolder: "team/research",
    });

    expect(result.moved).toBe(true);
    expect(result.noteIds).toEqual([source!.frontmatter.id]);
    expect(await noteSvc.readNote("codascope", "shared", alan, "team/research/decisions/choice.md")).not.toBeNull();
    expect(existsSync(noteSvc.getNoteFileBundle("codascope", "shared", alan, "team/research/decisions/choice.md")!.annotationFile)).toBe(true);
    const annotations = await annotationSvc.listAnnotations("codascope", "shared", alan, "team/research/decisions/choice.md");
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      noteScope: "codascope",
      noteVisibility: "shared",
      notePath: "team/research/decisions/choice.md",
    });
    expect((annotations[0].anchor as any).attachmentState).toBe("attached");
    expect(prefsSvc.getStarred("alan")[0]).toMatchObject({
      visibility: "shared",
      path: "team/research/decisions/choice.md",
    });
  });

  it("removes other users' references when a shared note becomes private", async () => {
    await noteSvc.createNote("codascope", "shared", alan, "team.md", "# Team note");
    const source = await noteSvc.readNote("codascope", "shared", alan, "team.md");
    for (const userId of ["alan", "alex"]) {
      prefsSvc.star(userId, {
        noteId: source!.frontmatter.id,
        scope: "codascope",
        visibility: "shared",
        path: "team.md",
        title: source!.frontmatter.title,
      });
    }

    await transferSvc.moveFile({
      fromScope: "codascope",
      fromVisibility: "shared",
      fromOpts: alan,
      fromPath: "team.md",
      toScope: "codascope",
      toVisibility: "private",
      toOpts: alan,
      toPath: "private/team.md",
    });

    expect(prefsSvc.getStarred("alan")[0]).toMatchObject({
      visibility: "private",
      path: "private/team.md",
    });
    expect(prefsSvc.getStarred("alex")).toEqual([]);
  });
});
