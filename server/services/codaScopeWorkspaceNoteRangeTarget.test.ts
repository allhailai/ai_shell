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
  canonicalizeWorkspaceNoteRangeTarget,
} from "./codaScopeWorkspaceNoteRangeTarget.js";
import {
  deriveWorkspaceTurnNoteGrant,
  WorkspaceTurnNoteGrantHolder,
} from "./codaScopeWorkspaceNoteGrant.js";
import {
  WorkspaceMutationActionCollectorHolder,
} from "./codaScopeWorkspaceMutationActions.js";
import { buildWorkspaceNoteTools } from "./tools/codaScopeWorkspaceNoteTools.js";

describe("workspace note range target canonicalization", () => {
  let root: string;
  let service: CodaScopeWorkspaceNoteService;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "codascope-range-target-"));
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

  it("binds exact offsets, text, lines, identity, and hash to the actor's current note", async () => {
    const note = await create("planning/one.md", "One");
    const target = targetFor(note);
    await expect(canonicalizeWorkspaceNoteRangeTarget({
      actorId: "alice",
      currentNote: note,
      target,
      noteService: service,
    })).resolves.toEqual(target);
  });

  it("rejects a different current note, stale hash, selected-text mismatch, and forged display identity", async () => {
    const note = await create("one.md", "One");
    const other = await create("other.md", "Other");
    const target = targetFor(note);
    for (const [currentNote, candidate] of [
      [other, target],
      [note, { ...target, expectedHash: "f".repeat(32) }],
      [note, { ...target, selectedText: "xxxxx", selectionEnd: target.selectionStart + 5 }],
      [note, { ...target, title: "Forged" }],
    ] as const) {
      await expect(canonicalizeWorkspaceNoteRangeTarget({
        actorId: "alice",
        currentNote,
        target: candidate,
        noteService: service,
      })).rejects.toThrow("invalid or stale");
    }
  });

  it("rejects another actor's private-note identity without exposing it", async () => {
    const note = await create("private.md", "Private");
    await expect(canonicalizeWorkspaceNoteRangeTarget({
      actorId: "mallory",
      currentNote: note,
      target: targetFor(note),
      noteService: service,
    })).rejects.toThrow("invalid or stale");
  });

  it("rejects UTF-16 offsets that split a surrogate pair before persistence", async () => {
    const note = await service.createNote("alice", {
      path: "unicode.md",
      title: "Unicode",
      body: "A😀B",
    }, { sharedRequested: false });
    await expect(canonicalizeWorkspaceNoteRangeTarget({
      actorId: "alice",
      currentNote: note,
      target: {
        kind: "note-range",
        stableId: note.stableId,
        scope: "codascope",
        visibility: note.visibility,
        path: note.path,
        title: note.title,
        selectionStart: 1,
        selectionEnd: 2,
        selectedText: "A😀B".slice(1, 2),
        startLine: 1,
        endLine: 1,
        expectedHash: note.contentHash,
      },
      noteService: service,
    })).rejects.toThrow("invalid or stale");
  });

  it("replaces exactly the authorized range through the scoped tool", async () => {
    const note = await create("tool.md", "Tool");
    const target = targetFor(note);
    const tools = await toolsFor(note, target);
    expect(JSON.parse(String(
      await tools.replace_codascope_note_range.execute({
        replacementMarkdown: "BRAVO",
      } as never, {} as never),
    ))).toMatchObject({ ok: true, note: { stableId: note.stableId } });
    expect((await service.readForEditing("alice", note.stableId))?.body)
      .toBe("alpha\nBRAVO\nomega");
  });

  it("fails stale tool execution without searching for text or mutating", async () => {
    const note = await create("stale-tool.md", "Stale Tool");
    const target = targetFor(note);
    const tools = await toolsFor(note, target);
    await service.replaceBody(
      "alice",
      note.stableId,
      "prefix bravo suffix",
      note.contentHash,
    );
    const current = await service.readForEditing("alice", note.stableId);

    expect(JSON.parse(String(
      await tools.replace_codascope_note_range.execute({
        replacementMarkdown: "MUTATED",
      } as never, {} as never),
    ))).toMatchObject({ ok: false, error: "conflict" });
    expect((await service.readForEditing("alice", note.stableId))?.body)
      .toBe(current?.body);
  });

  async function create(notePath: string, title: string) {
    return service.createNote("alice", {
      path: notePath,
      title,
      body: "alpha\nbravo\nomega",
    }, { sharedRequested: false });
  }

  function targetFor(note: Awaited<ReturnType<typeof create>>) {
    return {
      kind: "note-range" as const,
      stableId: note.stableId,
      scope: "codascope" as const,
      visibility: note.visibility,
      path: note.path,
      title: note.title,
      selectionStart: 6,
      selectionEnd: 11,
      selectedText: "bravo",
      startLine: 2,
      endLine: 2,
      expectedHash: note.contentHash,
    };
  }

  async function toolsFor(
    note: Awaited<ReturnType<typeof create>>,
    target: ReturnType<typeof targetFor>,
  ) {
    const grant = await deriveWorkspaceTurnNoteGrant({
      actorId: "alice",
      message: "Do that",
      currentNote: note,
      noteRangeTarget: target,
      noteService: service,
    });
    const holder = new WorkspaceTurnNoteGrantHolder();
    holder.replace(grant);
    return buildWorkspaceNoteTools(
      "alice",
      service,
      holder,
      new WorkspaceMutationActionCollectorHolder(),
    );
  }
});
