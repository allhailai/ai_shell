import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodaScopeNoteService } from "./codaScopeNoteService.js";
import { CodaScopeNoteAnnotationService } from "./codaScopeNoteAnnotationService.js";
import { CodaScopeNoteBundleService } from "./codaScopeNoteBundleService.js";
import { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";
import { CodaScopeNoteUserPrefsService } from "./codaScopeNoteUserPrefsService.js";
import { CodaScopeNoteLinkIndexService } from "./codaScopeNoteLinkIndexService.js";
import { CodaScopeNoteTransferService } from "./codaScopeNoteTransferService.js";
import {
  CodaScopeWorkspaceNoteService,
  WorkspaceNoteConflictError,
  WorkspaceNoteInvalidInputError,
  WorkspaceNoteUnavailableError,
} from "./codaScopeWorkspaceNoteService.js";
import { buildWorkspaceNoteTools } from "./tools/codaScopeWorkspaceNoteTools.js";
import { WorkspaceTurnNoteGrantHolder } from "./codaScopeWorkspaceNoteGrant.js";
import {
  WorkspaceMutationActionCollector,
  WorkspaceMutationActionCollectorHolder,
} from "./codaScopeWorkspaceMutationActions.js";
import { WORKSPACE_NOTE_MAX_BODY } from "../../src/apps/codascope/workspaceMutationActionValidation.js";

describe("CodaScopeWorkspaceNoteService", () => {
  let root: string;
  let note: CodaScopeNoteService;
  let annotations: CodaScopeNoteAnnotationService;
  let bundle: CodaScopeNoteBundleService;
  let audit: CodaScopeNoteAuditService;
  let prefs: CodaScopeNoteUserPrefsService;
  let links: CodaScopeNoteLinkIndexService;
  let transfer: CodaScopeNoteTransferService;
  let service: CodaScopeWorkspaceNoteService;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "codascope-workspace-note-"));
    note = new CodaScopeNoteService(root);
    annotations = new CodaScopeNoteAnnotationService(note);
    bundle = new CodaScopeNoteBundleService(note, annotations);
    audit = new CodaScopeNoteAuditService(root);
    prefs = new CodaScopeNoteUserPrefsService(root);
    links = new CodaScopeNoteLinkIndexService(note);
    transfer = new CodaScopeNoteTransferService(
      note,
      bundle,
      prefs,
      links,
      audit,
    );
    service = new CodaScopeWorkspaceNoteService(
      note,
      bundle,
      transfer,
      annotations,
      links,
      prefs,
      audit,
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates private by default with server-owned identity and authoritative readback", async () => {
    const created = await service.createNote("alice", {
      path: "plans/launch.md",
      title: "Launch Plan",
      body: "First draft",
    }, { sharedRequested: false });

    expect(created).toMatchObject({
      scope: "codascope",
      visibility: "private",
      path: "plans/launch.md",
      title: "Launch Plan",
    });
    expect(created.stableId).toMatch(/^[0-9a-f-]{36}$/);
    expect(path.isAbsolute(created.path)).toBe(false);
    const stored = await note.readNote(
      "codascope",
      "private",
      { userId: "alice" },
      created.path,
    );
    expect(stored?.frontmatter).toMatchObject({
      id: created.stableId,
      owner: "alice",
      title: "Launch Plan",
    });
    expect(stored?.contentHash).toBe(created.contentHash);
    expect(audit.query({ noteId: created.stableId })).toEqual([
      expect.objectContaining({ event: "note.created", actor: "alice" }),
    ]);
  });

  it("allows explicit shared creation and denies ungranted shared creation", async () => {
    await expect(service.createNote("alice", {
      path: "shared.md",
      title: "Shared",
      body: "",
      visibility: "shared",
    }, { sharedRequested: false })).rejects.toBeInstanceOf(
      WorkspaceNoteInvalidInputError,
    );

    const created = await service.createNote("alice", {
      path: "shared.md",
      title: "Shared",
      body: "",
      visibility: "shared",
    }, { sharedRequested: true });
    expect(created.visibility).toBe("shared");
    expect((await service.resolveActiveNote("bob", created.stableId))?.path)
      .toBe("shared.md");
  });

  it("keeps frontmatter-looking input in the note body", async () => {
    const forged = [
      "---",
      "id: forged-id",
      "owner: mallory",
      "title: Forged",
      "---",
      "Body",
    ].join("\n");
    const created = await service.createNote("alice", {
      path: "safe.md",
      title: "Safe",
      body: forged,
    }, { sharedRequested: false });
    const editable = await service.readForEditing("alice", created.stableId);
    expect(editable?.body).toBe(forged);
    expect(editable?.stableId).not.toBe("forged-id");
    expect(editable?.title).toBe("Safe");
  });

  it("never overwrites an existing path", async () => {
    const first = await service.createNote("alice", {
      path: "collision.md",
      title: "First",
      body: "first",
    }, { sharedRequested: false });
    await expect(service.createNote("alice", {
      path: "collision.md",
      title: "Second",
      body: "second",
    }, { sharedRequested: false })).rejects.toBeInstanceOf(
      WorkspaceNoteInvalidInputError,
    );
    expect((await service.readForEditing("alice", first.stableId))?.body)
      .toBe("first");
  });

  it("isolates private notes by actor while resolving shared notes", async () => {
    const privateNote = await service.createNote("alice", {
      path: "private.md",
      title: "Private",
      body: "secret",
    }, { sharedRequested: false });
    const sharedNote = await service.createNote("alice", {
      path: "visible.md",
      title: "Visible",
      body: "shared",
      visibility: "shared",
    }, { sharedRequested: true });
    expect(await service.resolveActiveNote("bob", privateNote.stableId)).toBeNull();
    expect(await service.resolveActiveNote("bob", sharedNote.stableId))
      .toMatchObject({ visibility: "shared", path: "visible.md" });
  });

  it("fails closed for duplicate stable IDs and relevant malformed frontmatter", async () => {
    const created = await service.createNote("alice", {
      path: "one.md",
      title: "One",
      body: "body",
    }, { sharedRequested: false });
    const privateFile = path.join(root, "_notes", "private", "alice", "one.md");
    const sharedDir = path.join(root, "_notes", "shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(
      path.join(sharedDir, "duplicate.md"),
      readFileSync(privateFile, "utf-8"),
      "utf-8",
    );
    await expect(service.resolveActiveNote("alice", created.stableId))
      .rejects.toBeInstanceOf(WorkspaceNoteUnavailableError);

    rmSync(path.join(sharedDir, "duplicate.md"));
    writeFileSync(privateFile, [
      "---",
      `id: ${created.stableId}`,
      "tags: []",
      `created: ${new Date().toISOString()}`,
      `updated: ${new Date().toISOString()}`,
      "owner: alice",
      "---",
      "body",
    ].join("\n"), "utf-8");
    await expect(service.resolveActiveNote("alice", created.stableId))
      .rejects.toBeInstanceOf(WorkspaceNoteUnavailableError);
  });

  it("does not ignore a malformed duplicate raw ID that names a valid target", async () => {
    const created = await service.createNote("alice", {
      path: "valid.md",
      title: "Valid",
      body: "body",
    }, { sharedRequested: false });
    const sharedDir = path.join(root, "_notes", "shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(path.join(sharedDir, "malformed.md"), [
      "---",
      `id: ${created.stableId}`,
      "id: another-id",
      "title: Malformed",
      "tags: []",
      `created: ${new Date().toISOString()}`,
      `updated: ${new Date().toISOString()}`,
      "owner: alice",
      "---",
      "body",
    ].join("\n"), "utf-8");

    await expect(service.resolveActiveNote("alice", created.stableId))
      .rejects.toBeInstanceOf(WorkspaceNoteUnavailableError);
  });

  it("fails closed for oversized active content and never returns a partial editable body", async () => {
    const created = await service.createNote("alice", {
      path: "oversized.md",
      title: "Oversized",
      body: "body",
    }, { sharedRequested: false });
    const file = path.join(
      root,
      "_notes",
      "private",
      "alice",
      created.path,
    );
    writeFileSync(
      file,
      readFileSync(file, "utf-8") + "x".repeat(200_001),
      "utf-8",
    );

    await expect(service.resolveActiveNote("alice", created.stableId))
      .rejects.toBeInstanceOf(WorkspaceNoteUnavailableError);
    await expect(service.readForEditing("alice", created.stableId))
      .rejects.toBeInstanceOf(WorkspaceNoteUnavailableError);
    expect(await service.resolveExactReference(
      "alice",
      `Read ${created.path}.`,
    )).toBeNull();
  });

  it("enforces body hash conflicts and preserves title, path, visibility, and identity", async () => {
    const created = await service.createNote("alice", {
      path: "edit.md",
      title: "Original",
      body: "before",
    }, { sharedRequested: false });
    await expect(service.replaceBody(
      "alice",
      created.stableId,
      "after",
      "0".repeat(32),
    )).rejects.toBeInstanceOf(WorkspaceNoteConflictError);
    expect((await service.readForEditing("alice", created.stableId))?.body)
      .toBe("before");

    const updated = await service.replaceBody(
      "alice",
      created.stableId,
      "---\nid: still-body\n---\nafter",
      created.contentHash,
    );
    expect(updated).toMatchObject({
      stableId: created.stableId,
      path: created.path,
      title: created.title,
      visibility: created.visibility,
    });
    expect((await service.readForEditing("alice", created.stableId))?.body)
      .toBe("---\nid: still-body\n---\nafter");
  });

  it("replaces only the offset-selected duplicate and retains canonical metadata, version, and audit semantics", async () => {
    const originalBody = "First target remains. Second target changes.";
    const created = await service.createNote("alice", {
      path: "exact-range.md",
      title: "Exact Range",
      body: originalBody,
      visibility: "shared",
    }, { sharedRequested: true });
    await note.setNotePin(
      "codascope",
      "shared",
      { userId: "alice" },
      created.path,
      true,
    );
    const current = await service.readForEditing("alice", created.stableId);
    const selectionStart = originalBody.lastIndexOf("target");

    const result = await service.replaceExactRange("alice", {
      stableId: created.stableId,
      selectionStart,
      selectionEnd: selectionStart + "target".length,
      selectedText: "target",
      expectedHash: current!.contentHash,
      replacementMarkdown: "**result**",
    });

    expect(result).toMatchObject({
      stableId: created.stableId,
      scope: "codascope",
      visibility: "shared",
      path: created.path,
      title: created.title,
      body: "First target remains. Second **result** changes.",
    });
    expect(result.contentHash).not.toBe(current!.contentHash);
    const stored = await note.readNote(
      "codascope",
      "shared",
      { userId: "alice" },
      created.path,
    );
    expect(stored?.frontmatter).toMatchObject({
      id: created.stableId,
      owner: "alice",
      title: created.title,
      status: "draft",
      pinned: true,
      pinnedBy: "alice",
    });
    expect(stored?.contentHash).toBe(result.contentHash);

    const versions = await note.listVersions(
      "codascope",
      "shared",
      { userId: "alice" },
      created.path,
    );
    expect(versions).toHaveLength(1);
    const snapshot = await note.getVersion(
      "codascope",
      "shared",
      { userId: "alice" },
      created.path,
      versions[0].version,
    );
    expect(note.parseFrontmatter(snapshot!.content).body).toBe(originalBody);
    expect(audit.query({ noteId: created.stableId })).toEqual([
      expect.objectContaining({ event: "note.created", actor: "alice" }),
      expect.objectContaining({
        event: "note.updated",
        actor: "alice",
        metadata: { operation: "body_edit" },
      }),
    ]);
  });

  it("rejects stale hashes, selection mismatches, invalid ranges, and unavailable notes without publication", async () => {
    const originalBody = "Keep this content unchanged.";
    const created = await service.createNote("alice", {
      path: "range-failures.md",
      title: "Range Failures",
      body: originalBody,
    }, { sharedRequested: false });
    const start = originalBody.indexOf("this");
    const attempts: Array<{
      input: Parameters<CodaScopeWorkspaceNoteService["replaceExactRange"]>[1];
      error: typeof WorkspaceNoteConflictError | typeof WorkspaceNoteInvalidInputError;
    }> = [
      {
        input: {
          stableId: created.stableId,
          selectionStart: start,
          selectionEnd: start + "this".length,
          selectedText: "this",
          expectedHash: "0".repeat(32),
          replacementMarkdown: "that",
        },
        error: WorkspaceNoteConflictError,
      },
      {
        input: {
          stableId: created.stableId,
          selectionStart: start,
          selectionEnd: start + "this".length,
          selectedText: "that",
          expectedHash: created.contentHash,
          replacementMarkdown: "changed",
        },
        error: WorkspaceNoteInvalidInputError,
      },
      {
        input: {
          stableId: created.stableId,
          selectionStart: start + 4,
          selectionEnd: start,
          selectedText: "this",
          expectedHash: created.contentHash,
          replacementMarkdown: "changed",
        },
        error: WorkspaceNoteInvalidInputError,
      },
      {
        input: {
          stableId: created.stableId,
          selectionStart: -1,
          selectionEnd: 3,
          selectedText: "Kee",
          expectedHash: created.contentHash,
          replacementMarkdown: "changed",
        },
        error: WorkspaceNoteInvalidInputError,
      },
      {
        input: {
          stableId: created.stableId,
          selectionStart: start,
          selectionEnd: originalBody.length + 1,
          selectedText: originalBody.slice(start),
          expectedHash: created.contentHash,
          replacementMarkdown: "changed",
        },
        error: WorkspaceNoteInvalidInputError,
      },
    ];

    for (const attempt of attempts) {
      await expect(service.replaceExactRange("alice", attempt.input))
        .rejects.toBeInstanceOf(attempt.error);
      expect((await service.readForEditing("alice", created.stableId))?.body)
        .toBe(originalBody);
      expect(await note.listVersions(
        "codascope",
        "private",
        { userId: "alice" },
        created.path,
      )).toEqual([]);
      expect(audit.query({ noteId: created.stableId })).toEqual([
        expect.objectContaining({ event: "note.created" }),
      ]);
    }

    await expect(service.replaceExactRange("alice", {
      stableId: "unavailable-note",
      selectionStart: 0,
      selectionEnd: 4,
      selectedText: "Keep",
      expectedHash: created.contentHash,
      replacementMarkdown: "Lose",
    })).rejects.toBeInstanceOf(WorkspaceNoteUnavailableError);
    expect((await service.readForEditing("alice", created.stableId))?.body)
      .toBe(originalBody);
    expect(await note.listVersions(
      "codascope",
      "private",
      { userId: "alice" },
      created.path,
    )).toEqual([]);
    expect(audit.query({ noteId: created.stableId })).toHaveLength(1);
  });

  it("supports empty replacement and multiline Markdown replacement", async () => {
    const deletion = await service.createNote("alice", {
      path: "delete-range.md",
      title: "Delete Range",
      body: "Remove obsolete text now.",
    }, { sharedRequested: false });
    const deleteStart = "Remove obsolete text now.".indexOf("obsolete ");
    const deleted = await service.replaceExactRange("alice", {
      stableId: deletion.stableId,
      selectionStart: deleteStart,
      selectionEnd: deleteStart + "obsolete ".length,
      selectedText: "obsolete ",
      expectedHash: deletion.contentHash,
      replacementMarkdown: "",
    });
    expect(deleted.body).toBe("Remove text now.");

    const multiline = await service.createNote("alice", {
      path: "multiline-range.md",
      title: "Multiline Range",
      body: "Before\none line\nAfter",
    }, { sharedRequested: false });
    const multilineStart = "Before\none line\nAfter".indexOf("one line");
    const replaced = await service.replaceExactRange("alice", {
      stableId: multiline.stableId,
      selectionStart: multilineStart,
      selectionEnd: multilineStart + "one line".length,
      selectedText: "one line",
      expectedHash: multiline.contentHash,
      replacementMarkdown: "- first\n- second",
    });
    expect(replaced.body).toBe("Before\n- first\n- second\nAfter");
  });

  it("rejects split-surrogate boundaries without publication and accepts the complete pair", async () => {
    const originalBody = "A😀B";
    const created = await service.createNote("alice", {
      path: "utf16-range.md",
      title: "UTF-16 Range",
      body: originalBody,
    }, { sharedRequested: false });
    const beforeAudit = audit.query({ noteId: created.stableId });
    for (const split of [
      {
        selectionStart: 2,
        selectionEnd: 3,
        selectedText: originalBody.slice(2, 3),
      },
      {
        selectionStart: 1,
        selectionEnd: 2,
        selectedText: originalBody.slice(1, 2),
      },
    ]) {
      await expect(service.replaceExactRange("alice", {
        stableId: created.stableId,
        ...split,
        expectedHash: created.contentHash,
        replacementMarkdown: "changed",
      })).rejects.toBeInstanceOf(WorkspaceNoteInvalidInputError);
      expect((await service.readForEditing("alice", created.stableId))?.body)
        .toBe(originalBody);
      expect(await note.listVersions(
        "codascope",
        "private",
        { userId: "alice" },
        created.path,
      )).toEqual([]);
      expect(audit.query({ noteId: created.stableId })).toEqual(beforeAudit);
    }

    const result = await service.replaceExactRange("alice", {
      stableId: created.stableId,
      selectionStart: 1,
      selectionEnd: 3,
      selectedText: "😀",
      expectedHash: created.contentHash,
      replacementMarkdown: "🚀",
    });

    expect(result.body).toBe("A🚀B");
  });

  it("rejects oversized replacement Markdown before construction without publishing note or annotation state", async () => {
    const created = await service.createNote("alice", {
      path: "oversized-replacement.md",
      title: "Oversized Replacement",
      body: "Before target after.",
    }, { sharedRequested: false });
    const targetStart = "Before target after.".indexOf("target");
    const annotation = await annotations.createRangeAnnotation(
      "codascope",
      "private",
      { userId: "alice" },
      created.path,
      {
        from: targetStart,
        to: targetStart + "target".length,
        selectedText: "target",
        expectedHash: created.contentHash,
        author: "alice",
        body: "Keep this annotation unchanged.",
      },
    );
    if ("conflict" in annotation) throw new Error("unexpected conflict");
    const current = await service.readForEditing("alice", created.stableId);
    const selectedStart = current!.body.indexOf("target");
    const beforeContent = current!.body;
    const beforeVersions = await note.listVersions(
      "codascope",
      "private",
      { userId: "alice" },
      created.path,
    );
    const annotationFile = note.collectNoteBundle(
      "codascope",
      "private",
      { userId: "alice" },
      created.path,
    )!.annotationFile;
    const beforeSidecar = readFileSync(annotationFile, "utf-8");
    const beforeAudit = audit.query({ noteId: created.stableId });

    await expect(service.replaceExactRange("alice", {
      stableId: created.stableId,
      selectionStart: selectedStart,
      selectionEnd: selectedStart + "target".length,
      selectedText: "target",
      expectedHash: current!.contentHash,
      replacementMarkdown: "x".repeat(WORKSPACE_NOTE_MAX_BODY + 1),
    })).rejects.toBeInstanceOf(WorkspaceNoteInvalidInputError);

    expect((await service.readForEditing("alice", created.stableId))?.body)
      .toBe(beforeContent);
    expect(await note.listVersions(
      "codascope",
      "private",
      { userId: "alice" },
      created.path,
    )).toEqual(beforeVersions);
    expect(readFileSync(annotationFile, "utf-8")).toBe(beforeSidecar);
    expect(audit.query({ noteId: created.stableId })).toEqual(beforeAudit);
  });

  it("rejects a range crossing an annotation marker without changing note, sidecar, version, or audit state", async () => {
    const created = await service.createNote("alice", {
      path: "marker-conflict.md",
      title: "Marker Conflict",
      body: "Before target after.",
    }, { sharedRequested: false });
    const annotation = await annotations.createRangeAnnotation(
      "codascope",
      "private",
      { userId: "alice" },
      created.path,
      {
        from: "Before target after.".indexOf("target"),
        to: "Before target after.".indexOf("target") + "target".length,
        selectedText: "target",
        expectedHash: created.contentHash,
        author: "alice",
        body: "Keep this anchor.",
      },
    );
    if ("conflict" in annotation) throw new Error("unexpected conflict");
    const current = await service.readForEditing("alice", created.stableId);
    const selectionEnd = current!.body.indexOf("target") + "target".length;
    const beforeContent = current!.body;
    const beforeVersions = await note.listVersions(
      "codascope",
      "private",
      { userId: "alice" },
      created.path,
    );
    const annotationFile = note.collectNoteBundle(
      "codascope",
      "private",
      { userId: "alice" },
      created.path,
    )!.annotationFile;
    const beforeSidecar = readFileSync(annotationFile, "utf-8");
    const beforeAudit = audit.query({ noteId: created.stableId });

    await expect(service.replaceExactRange("alice", {
      stableId: created.stableId,
      selectionStart: 0,
      selectionEnd,
      selectedText: current!.body.slice(0, selectionEnd),
      expectedHash: current!.contentHash,
      replacementMarkdown: "Changed target",
    })).rejects.toBeInstanceOf(WorkspaceNoteInvalidInputError);

    expect((await service.readForEditing("alice", created.stableId))?.body)
      .toBe(beforeContent);
    expect(await note.listVersions(
      "codascope",
      "private",
      { userId: "alice" },
      created.path,
    )).toEqual(beforeVersions);
    expect(readFileSync(annotationFile, "utf-8")).toBe(beforeSidecar);
    expect(audit.query({ noteId: created.stableId })).toEqual(beforeAudit);
  });

  it("changes only the display title and preserves path, body, visibility, and identity", async () => {
    const created = await service.createNote("alice", {
      path: "fixed-path.md",
      title: "Before",
      body: "unchanged",
      visibility: "shared",
    }, { sharedRequested: true });
    const updated = await service.setTitle(
      "alice",
      created.stableId,
      "After",
      created.contentHash,
    );
    expect(updated).toMatchObject({
      stableId: created.stableId,
      path: "fixed-path.md",
      title: "After",
      visibility: "shared",
    });
    expect((await service.readForEditing("alice", created.stableId))?.body)
      .toBe("unchanged");
  });

  it("moves complete managed bundle state through the transfer service", async () => {
    const target = await service.createNote("alice", {
      path: "target.md",
      title: "Target",
      body: "target",
      visibility: "shared",
    }, { sharedRequested: true });
    const created = await service.createNote("alice", {
      path: "bundle.md",
      title: "Bundle",
      body: `before [[${target.stableId}]]`,
    }, { sharedRequested: false });
    const edited = await service.replaceBody(
      "alice",
      created.stableId,
      `body [[${target.stableId}]]`,
      created.contentHash,
    );
    note.writeNoteBundleCompanion(
      "codascope",
      "private",
      { userId: "alice" },
      created.path,
      "asset",
      "documents/doc/blob",
      Buffer.from("attachment"),
    );
    await annotations.createAnnotation(
      "codascope",
      "private",
      { userId: "alice" },
      created.path,
      {
        anchor: {
          blockId: "blk_body_0",
          sectionSlug: "root",
          anchorText: "body",
          lineNumber: 1,
        },
        author: "alice",
        body: "comment",
      },
    );
    prefs.star("alice", {
      noteId: created.stableId,
      scope: "codascope",
      visibility: "private",
      path: created.path,
      title: created.title,
    });

    const moved = await service.setVisibility(
      "alice",
      created.stableId,
      "shared",
      edited.contentHash,
    );
    expect(moved).toMatchObject({
      stableId: created.stableId,
      visibility: "shared",
      path: created.path,
    });
    expect(note.listNoteBundleCompanions(
      "codascope",
      "shared",
      { userId: "alice" },
      created.path,
      "asset",
    ).some((entry) => entry.relativePath === "documents/doc/blob")).toBe(true);
    expect(await annotations.listAnnotations(
      "codascope",
      "shared",
      { userId: "alice" },
      created.path,
    )).toHaveLength(1);
    expect(await note.listVersions(
      "codascope",
      "shared",
      { userId: "alice" },
      created.path,
    )).toHaveLength(1);
    expect(await links.getBacklinks(
      "codascope",
      "shared",
      { userId: "alice" },
      target.stableId,
    )).toEqual([
      expect.objectContaining({
        noteId: created.stableId,
        path: created.path,
      }),
    ]);
    expect(prefs.getStarred("alice")[0]).toMatchObject({
      noteId: created.stableId,
      visibility: "shared",
      path: created.path,
    });
    expect(audit.query({ noteId: created.stableId }).map((event) => event.event))
      .toContain("note.visibility_changed");
  });

  it("rejects visibility conflicts without moving the note", async () => {
    const created = await service.createNote("alice", {
      path: "stay.md",
      title: "Stay",
      body: "body",
    }, { sharedRequested: false });
    await expect(service.setVisibility(
      "alice",
      created.stableId,
      "shared",
      "f".repeat(32),
    )).rejects.toBeInstanceOf(WorkspaceNoteConflictError);
    expect(await service.resolveActiveNote("alice", created.stableId))
      .toMatchObject({ visibility: "private" });
  });

  it("archives recoverably and excludes the note from active resolution", async () => {
    const created = await service.createNote("alice", {
      path: "archive-me.md",
      title: "Archive",
      body: "body",
    }, { sharedRequested: false });
    await service.archiveNote(
      "alice",
      created.stableId,
      created.contentHash,
      "Done",
    );
    expect(await service.resolveActiveNote("alice", created.stableId)).toBeNull();
    expect((await note.listArchived(
      "codascope",
      "private",
      { userId: "alice" },
    ))[0]).toMatchObject({
      noteId: created.stableId,
      originalPath: created.path,
      reason: "Done",
    });
    expect(existsSync(path.join(
      root,
      "_notes",
      "_archive",
      "private",
      "alice",
      created.stableId,
    ))).toBe(true);
    expect("deleteNote" in service).toBe(false);
  });

  it("confirms archive success after the physical move when index refresh throws", async () => {
    const created = await service.createNote("alice", {
      path: "partial-failure.md",
      title: "Partial Failure",
      body: "body",
    }, { sharedRequested: false });
    vi.spyOn(note as any, "refreshIndex")
      .mockRejectedValueOnce(new Error("derived index failure"));

    const grant = new WorkspaceTurnNoteGrantHolder();
    grant.replace({
      create: null,
      readStableIds: [created.stableId],
      editRangeTarget: null,
      editBodyStableIds: [],
      editTitleStableIds: [],
      visibilityChanges: [],
      archiveStableIds: [created.stableId],
    });
    const actions = new WorkspaceMutationActionCollectorHolder();
    actions.current = new WorkspaceMutationActionCollector();
    const tools = buildWorkspaceNoteTools(
      "alice",
      service,
      grant,
      actions,
    );

    const result = await tools.archive_codascope_note.execute({
      stableId: created.stableId,
      expectedHash: created.contentHash,
    } as any, {} as any);

    expect(JSON.parse(String(result))).toMatchObject({
      ok: true,
      archived: true,
      note: { stableId: created.stableId },
    });
    expect(await service.resolveActiveNote("alice", created.stableId)).toBeNull();
    expect(await note.listArchived(
      "codascope",
      "private",
      { userId: "alice" },
    )).toContainEqual(expect.objectContaining({
      noteId: created.stableId,
      originalPath: created.path,
      originalVisibility: "private",
      archivedBy: "alice",
    }));
    expect(actions.current.drain()).toEqual([
      expect.objectContaining({
        type: "operation_completed",
        attributes: expect.objectContaining({
          stableId: created.stableId,
          operation: "archive_codascope_note",
        }),
      }),
    ]);
  });

  it("emits no receipt when archive fails before the physical move", async () => {
    const created = await service.createNote("alice", {
      path: "not-moved.md",
      title: "Not Moved",
      body: "body",
    }, { sharedRequested: false });
    vi.spyOn(bundle, "archiveNote")
      .mockRejectedValueOnce(new Error("pre-move failure"));
    const grant = new WorkspaceTurnNoteGrantHolder();
    grant.replace({
      create: null,
      readStableIds: [created.stableId],
      editRangeTarget: null,
      editBodyStableIds: [],
      editTitleStableIds: [],
      visibilityChanges: [],
      archiveStableIds: [created.stableId],
    });
    const actions = new WorkspaceMutationActionCollectorHolder();
    actions.current = new WorkspaceMutationActionCollector();
    const tools = buildWorkspaceNoteTools(
      "alice",
      service,
      grant,
      actions,
    );

    const result = await tools.archive_codascope_note.execute({
      stableId: created.stableId,
      expectedHash: created.contentHash,
    } as any, {} as any);

    expect(String(result)).toBe("The requested CodaScope note is unavailable.");
    expect(await service.resolveActiveNote("alice", created.stableId))
      .toMatchObject({ path: created.path });
    expect(await note.listArchived(
      "codascope",
      "private",
      { userId: "alice" },
    )).toEqual([]);
    expect(actions.current.drain()).toEqual([]);
  });
});
