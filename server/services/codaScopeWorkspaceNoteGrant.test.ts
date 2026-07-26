import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodaScopeNoteService } from "./codaScopeNoteService.js";
import { CodaScopeNoteAnnotationService } from "./codaScopeNoteAnnotationService.js";
import { CodaScopeNoteBundleService } from "./codaScopeNoteBundleService.js";
import { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";
import { CodaScopeNoteUserPrefsService } from "./codaScopeNoteUserPrefsService.js";
import { CodaScopeNoteLinkIndexService } from "./codaScopeNoteLinkIndexService.js";
import { CodaScopeNoteTransferService } from "./codaScopeNoteTransferService.js";
import { CodaScopeWorkspaceNoteService } from "./codaScopeWorkspaceNoteService.js";
import {
  EMPTY_WORKSPACE_TURN_NOTE_GRANT,
  WorkspaceTurnNoteGrantHolder,
  deriveWorkspaceTurnNoteGrant,
  validateWorkspaceTurnNoteGrant,
} from "./codaScopeWorkspaceNoteGrant.js";

describe("workspace note grants", () => {
  let root: string;
  let service: CodaScopeWorkspaceNoteService;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "codascope-note-grant-"));
    const note = new CodaScopeNoteService(root);
    const annotations = new CodaScopeNoteAnnotationService(note);
    const bundle = new CodaScopeNoteBundleService(note, annotations);
    const audit = new CodaScopeNoteAuditService(root);
    const prefs = new CodaScopeNoteUserPrefsService(root);
    const links = new CodaScopeNoteLinkIndexService(note);
    const transfer = new CodaScopeNoteTransferService(
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
    service.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  it("gives deictic current-note context precedence over a matching common title", async () => {
    const current = await create("current.md", "Current");
    const named = await create("this-note.md", "This Note");

    for (const message of ["Archive this note", "Archive this note."]) {
      const grant = await derive(message, current);
      expect(grant.archiveStableIds).toEqual([current.stableId]);
      expect(grant.archiveStableIds).not.toContain(named.stableId);
    }

    const precedence = await derive(
      `Archive this note; the other path is ${named.path}.`,
      current,
    );
    expect(precedence.archiveStableIds).toEqual([current.stableId]);
  });

  it("does not fall back from missing or stale current-note context", async () => {
    const current = await create("current.md", "Current");
    await create("this-note.md", "This Note");

    expect((await derive("Archive this note", null)).archiveStableIds).toEqual([]);
    for (const stale of [
      { ...current, title: "Stale title" },
      { ...current, contentHash: "f".repeat(32) },
    ]) {
      expect((await derive(
        "Archive this note.",
        stale,
      )).archiveStableIds).toEqual([]);
    }
  });

  it("resolves punctuated exact paths and only explicit title references", async () => {
    const current = await create("current.md", "Current");
    const target = await create("folder/target.md", "Target Note");

    expect((await derive(
      `Archive ${target.path}.`,
      current,
    )).archiveStableIds).toEqual([target.stableId]);
    expect((await derive(
      `Archive note ${target.stableId}.`,
      current,
    )).archiveStableIds).toEqual([target.stableId]);
    expect((await derive(
      'Archive note "Target Note".',
      current,
    )).archiveStableIds).toEqual([target.stableId]);
    expect((await derive(
      "Archive note titled Target Note.",
      current,
    )).archiveStableIds).toEqual([target.stableId]);
    expect((await derive(
      "Archive note named Target Note.",
      current,
    )).archiveStableIds).toEqual([target.stableId]);

    expect((await derive(
      "Archive Target Note.",
      current,
    )).archiveStableIds).toEqual([]);
  });

  it("fails closed for duplicate explicit titles and grammatical common words", async () => {
    const current = await create("current.md", "Current");
    await create("duplicates/one.md", "Duplicate");
    await create("duplicates/two.md", "Duplicate");
    for (const title of ["One", "Note", "Private", "Shared"]) {
      await create(`common/${title.toLocaleLowerCase()}.md`, title);
    }

    expect((await derive(
      'Archive note "Duplicate".',
      current,
    )).archiveStableIds).toEqual([]);
    for (const message of [
      "Archive One.",
      "Archive the note.",
      "Make the note private.",
      "Share the note.",
    ]) {
      expect(await derive(message, null)).toEqual(
        EMPTY_WORKSPACE_TURN_NOTE_GRANT,
      );
    }
    expect((await derive(
      "Archive note titled One.",
      current,
    )).archiveStableIds).toHaveLength(1);
  });

  it("keeps negated and hypothetical mutations unauthorized", async () => {
    const current = await create("current.md", "Current");
    for (const message of [
      "Do not archive this note.",
      "Hypothetically, archive this note.",
      'The example says "archive this note".',
      "Explain how you would archive this note.",
    ]) {
      expect(await derive(message, current)).toEqual(
        EMPTY_WORKSPACE_TURN_NOTE_GRANT,
      );
    }
  });

  it("derives bounded private/shared creation plans and rejects ambiguous plurals", async () => {
    expect((await derive("Create a note.", null)).create).toEqual({
      maxSuccesses: 1,
      visibility: "private",
    });
    expect((await derive("Create shared note.", null)).create).toEqual({
      maxSuccesses: 1,
      visibility: "shared",
    });
    expect((await derive("Create 3 shared notes.", null)).create).toEqual({
      maxSuccesses: 3,
      visibility: "shared",
    });
    expect((await derive("Create 30 notes.", null)).create).toEqual({
      maxSuccesses: 25,
      visibility: "private",
    });
    expect((await derive("Create notes.", null)).create).toBeNull();
    expect((await derive(
      "Create 2 private and shared notes.",
      null,
    )).create).toBeNull();
  });

  it("atomically consumes successful allowances and releases failed reservations", async () => {
    const current = await create("current.md", "Current");
    const grant = await derive("Archive this note.", current);
    const holder = new WorkspaceTurnNoteGrantHolder();
    holder.replace(grant);

    const first = holder.reserveMutation(
      "archive_codascope_note",
      current.stableId,
    );
    expect(first).not.toBeNull();
    expect(holder.reserveMutation(
      "archive_codascope_note",
      current.stableId,
    )).toBeNull();
    first?.release();
    const retry = holder.reserveMutation(
      "archive_codascope_note",
      current.stableId,
    );
    expect(retry).not.toBeNull();
    retry?.commit();
    expect(holder.reserveMutation(
      "archive_codascope_note",
      current.stableId,
    )).toBeNull();

    holder.clear();
    expect(holder.current).toBe(EMPTY_WORKSPACE_TURN_NOTE_GRANT);
  });

  it("strictly revalidates active stable IDs and rejects budget expansion fields", async () => {
    const current = await create("current.md", "Current");
    const candidate = {
      create: { maxSuccesses: 2, visibility: "private" },
      readStableIds: [current.stableId],
      editBodyStableIds: [current.stableId],
      editTitleStableIds: [],
      visibilityChanges: [],
      archiveStableIds: [],
    };
    await expect(validateWorkspaceTurnNoteGrant(
      candidate,
      "alice",
      service,
    )).resolves.toMatchObject(candidate);
    await expect(validateWorkspaceTurnNoteGrant(
      {
        ...candidate,
        create: { ...candidate.create, clientBudget: 25 },
      },
      "alice",
      service,
    )).rejects.toThrow("Invalid workspace note grant");
  });

  async function create(notePath: string, title: string) {
    return service.createNote("alice", {
      path: notePath,
      title,
      body: "body",
    }, { sharedRequested: false });
  }

  function derive(
    message: string,
    currentNote: Awaited<ReturnType<typeof create>> | null,
  ) {
    return deriveWorkspaceTurnNoteGrant({
      actorId: "alice",
      message,
      currentNote,
      noteService: service,
    });
  }
});
