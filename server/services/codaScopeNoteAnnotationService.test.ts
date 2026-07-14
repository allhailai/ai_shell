import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { CodaScopeNoteAnnotationService } from "./codaScopeNoteAnnotationService.js";
import { CodaScopeNoteService } from "./codaScopeNoteService.js";

const roots: string[] = [];
const opts = { userId: "alan" };

function tempRoot(): string {
  const root = path.join(os.tmpdir(), `note-inline-anchor-${crypto.randomBytes(6).toString("hex")}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CodaScopeNoteAnnotationService inline anchors", () => {
  it("creates an atomic marker/sidecar pair and renders only the validated range", async () => {
    const noteSvc = new CodaScopeNoteService(tempRoot());
    const annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
    await noteSvc.createNote("codascope", "private", opts, "decision.md", "# Decision\n\nThe API returns a signed URL.");
    const note = await noteSvc.readNote("codascope", "private", opts, "decision.md");
    const body = noteSvc.parseFrontmatter(note!.content).body;
    const from = body.indexOf("signed URL");

    const result = await annotationSvc.createRangeAnnotation("codascope", "private", opts, "decision.md", {
      from,
      to: from + "signed URL".length,
      selectedText: "signed URL",
      expectedHash: note!.contentHash,
      author: "alan",
      body: "Explain the expiry policy.",
    });

    expect("conflict" in result).toBe(false);
    if ("conflict" in result) return;
    expect(result.content).toContain("codascope:ann-start");
    expect(result.annotation.anchor).toMatchObject({ kind: "range", markerId: result.annotation.id, attachmentState: "attached" });
    const targets = await annotationSvc.getRenderTargets("codascope", "private", opts, "decision.md");
    expect(targets).toHaveLength(1);
    expect(result.content.slice(targets[0].rangeFrom, targets[0].rangeTo)).toBe("signed URL");
  });

  it("never reattaches a broken marker pair from repeated nearby text", async () => {
    const noteSvc = new CodaScopeNoteService(tempRoot());
    const annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
    await noteSvc.createNote("codascope", "private", opts, "duplicate.md", "First signed URL. Second signed URL.");
    const note = await noteSvc.readNote("codascope", "private", opts, "duplicate.md");
    const body = noteSvc.parseFrontmatter(note!.content).body;
    const from = body.indexOf("signed URL");
    const created = await annotationSvc.createRangeAnnotation("codascope", "private", opts, "duplicate.md", {
      from, to: from + "signed URL".length, selectedText: "signed URL", expectedHash: note!.contentHash, author: "alan", body: "Review.",
    });
    if ("conflict" in created) throw new Error("unexpected conflict");

    const broken = created.content.replace(/<!-- codascope:ann-end[^>]+ -->/, "");
    const stored = await noteSvc.readNote("codascope", "private", opts, "duplicate.md");
    await noteSvc.updateNote("codascope", "private", opts, "duplicate.md", noteSvc.serializeFrontmatter(stored!.frontmatter) + broken, stored!.contentHash);
    await annotationSvc.reconcileAfterNoteWrite("codascope", "private", opts, "duplicate.md");

    const annotation = (await annotationSvc.listAnnotations("codascope", "private", opts, "duplicate.md")).find((item) => item.id === created.annotation.id)!;
    expect((annotation.anchor as any).attachmentState).not.toBe("attached");
    expect(await annotationSvc.getRenderTargets("codascope", "private", opts, "duplicate.md")).toEqual([]);
  });

  it("marks an empty marker pair for review instead of pinning it to nearby text", async () => {
    const noteSvc = new CodaScopeNoteService(tempRoot());
    const annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
    await noteSvc.createNote("codascope", "private", opts, "deleted-text.md", "First signed URL. Second signed URL.");
    const note = await noteSvc.readNote("codascope", "private", opts, "deleted-text.md");
    const body = noteSvc.parseFrontmatter(note!.content).body;
    const from = body.indexOf("signed URL");
    const created = await annotationSvc.createRangeAnnotation("codascope", "private", opts, "deleted-text.md", {
      from, to: from + "signed URL".length, selectedText: "signed URL", expectedHash: note!.contentHash, author: "alan", body: "Review.",
    });
    if ("conflict" in created) throw new Error("unexpected conflict");
    const emptied = created.content.replace("signed URL", "");
    const stored = await noteSvc.readNote("codascope", "private", opts, "deleted-text.md");
    const updated = await noteSvc.updateNote("codascope", "private", opts, "deleted-text.md", noteSvc.serializeFrontmatter(stored!.frontmatter) + emptied, stored!.contentHash);
    if (!updated || "conflict" in updated) throw new Error("unexpected update failure");
    const annotation = (await annotationSvc.reconcileAfterNoteWrite("codascope", "private", opts, "deleted-text.md"))
      .find((item) => item.id === created.annotation.id)!;

    expect((annotation.anchor as any).attachmentState).toBe("orphaned");
    expect(await annotationSvc.getRenderTargets("codascope", "private", opts, "deleted-text.md")).toEqual([]);
  });

  it("only reattaches when the user supplies an explicit current selection", async () => {
    const noteSvc = new CodaScopeNoteService(tempRoot());
    const annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
    await noteSvc.createNote("codascope", "private", opts, "reattach.md", "First signed URL. Second signed URL.");
    const note = await noteSvc.readNote("codascope", "private", opts, "reattach.md");
    const body = noteSvc.parseFrontmatter(note!.content).body;
    const first = body.indexOf("signed URL");
    const created = await annotationSvc.createRangeAnnotation("codascope", "private", opts, "reattach.md", {
      from: first, to: first + "signed URL".length, selectedText: "signed URL", expectedHash: note!.contentHash, author: "alan", body: "Review.",
    });
    if ("conflict" in created) throw new Error("unexpected conflict");
    const stripped = created.content.replace(/<!-- codascope:ann-(start|end)[^>]+ -->/g, "");
    const stored = await noteSvc.readNote("codascope", "private", opts, "reattach.md");
    const updated = await noteSvc.updateNote("codascope", "private", opts, "reattach.md", noteSvc.serializeFrontmatter(stored!.frontmatter) + stripped, stored!.contentHash);
    if (!updated || "conflict" in updated) throw new Error("unexpected update failure");
    await annotationSvc.reconcileAfterNoteWrite("codascope", "private", opts, "reattach.md");
    const second = stripped.lastIndexOf("signed URL");

    const reattached = await annotationSvc.reattachRangeAnnotation("codascope", "private", opts, "reattach.md", created.annotation.id, {
      from: second, to: second + "signed URL".length, selectedText: "signed URL", expectedHash: updated.contentHash,
    });
    expect(reattached && !("conflict" in reattached)).toBe(true);
    expect(await annotationSvc.getRenderTargets("codascope", "private", opts, "reattach.md")).toHaveLength(1);
  });

  it("migrates a legacy anchor only when quote and section produce one safe match", async () => {
    const noteSvc = new CodaScopeNoteService(tempRoot());
    const annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
    await noteSvc.createNote("codascope", "private", opts, "legacy.md", "# Decision\n\nOnly safe text.");
    await annotationSvc.createAnnotation("codascope", "private", opts, "legacy.md", {
      anchor: { blockId: "blk_decision_0", sectionSlug: "decision", anchorText: "Only safe text", lineNumber: 3 }, author: "alan", body: "Legacy review.",
    });
    const migrated = await annotationSvc.reconcileNote("codascope", "private", opts, "legacy.md", true);
    expect((migrated[0].anchor as any).attachmentState).toBe("attached");

    await noteSvc.createNote("codascope", "private", opts, "ambiguous.md", "# Decision\n\nSame. Same.");
    await annotationSvc.createAnnotation("codascope", "private", opts, "ambiguous.md", {
      anchor: { blockId: "blk_decision_0", sectionSlug: "decision", anchorText: "Same", lineNumber: 3 }, author: "alan", body: "Legacy review.",
    });
    const ambiguous = await annotationSvc.reconcileNote("codascope", "private", opts, "ambiguous.md", true);
    expect((ambiguous[0].anchor as any).attachmentState).toBe("needs_review");
    expect(await annotationSvc.getRenderTargets("codascope", "private", opts, "ambiguous.md")).toEqual([]);
  });

  it("migrates a legacy library-level sidecar into the physical note bundle", async () => {
    const noteSvc = new CodaScopeNoteService(tempRoot());
    const annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
    await noteSvc.createNote("codascope", "private", opts, "legacy-storage.md", "Keep this marker.");
    const note = await noteSvc.readNote("codascope", "private", opts, "legacy-storage.md");
    const body = noteSvc.parseFrontmatter(note!.content).body;
    const created = await annotationSvc.createRangeAnnotation("codascope", "private", opts, "legacy-storage.md", {
      from: body.indexOf("marker"), to: body.indexOf("marker") + "marker".length,
      selectedText: "marker", expectedHash: note!.contentHash, author: "alan", body: "Preserve the sidecar.",
    });
    if ("conflict" in created) throw new Error("unexpected conflict");
    const bundle = noteSvc.collectNoteBundle("codascope", "private", opts, "legacy-storage.md")!;
    const legacyDir = path.join(noteSvc.resolveNotesDir("codascope", "private", opts)!, "_annotations");
    const legacyPath = path.join(legacyDir, "legacy-storage-annotations.json");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(legacyPath, readFileSync(bundle.annotationFile));
    rmSync(bundle.annotationFile);

    annotationSvc.ensurePhysicalSidecar("codascope", "private", opts, "legacy-storage.md");

    expect(existsSync(bundle.annotationFile)).toBe(true);
    expect(existsSync(legacyPath)).toBe(false);
    expect(await annotationSvc.getRenderTargets("codascope", "private", opts, "legacy-storage.md")).toHaveLength(1);
  });

  it("rolls the note body back when the sidecar write fails", async () => {
    const noteSvc = new CodaScopeNoteService(tempRoot());
    const annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
    await noteSvc.createNote("codascope", "private", opts, "rollback.md", "Anchor text.");
    const note = await noteSvc.readNote("codascope", "private", opts, "rollback.md");
    const body = noteSvc.parseFrontmatter(note!.content).body;
    const originalWriter = (annotationSvc as any).writeAnnotations;
    (annotationSvc as any).writeAnnotations = () => { throw new Error("disk unavailable"); };

    await expect(annotationSvc.createRangeAnnotation("codascope", "private", opts, "rollback.md", {
      from: body.indexOf("Anchor"), to: body.indexOf("Anchor") + "Anchor".length, selectedText: "Anchor", expectedHash: note!.contentHash, author: "alan", body: "Review.",
    })).rejects.toThrow(/rolled back/i);
    (annotationSvc as any).writeAnnotations = originalWriter;
    const after = await noteSvc.readNote("codascope", "private", opts, "rollback.md");
    expect(after!.content).not.toContain("codascope:ann-start");
  });
});
