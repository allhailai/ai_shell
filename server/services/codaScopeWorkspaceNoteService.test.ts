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
