import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_WORKSPACE_TURN_NOTE_GRANT,
  WorkspaceTurnNoteGrantHolder,
  deriveWorkspaceTurnNoteGrant,
  validateWorkspaceTurnNoteGrant,
} from "./codaScopeWorkspaceNoteGrant.js";

const current = {
  stableId: "note-1",
  scope: "codascope" as const,
  visibility: "private" as const,
  path: "notes/one.md",
  title: "One",
  contentHash: "a".repeat(32),
};

function noteService(options: {
  exact?: typeof current | null;
  current?: typeof current | null;
} = {}) {
  return {
    resolveExactReference: vi.fn(async () => options.exact ?? null),
    resolveCurrentContext: vi.fn(async () => options.current ?? current),
    resolveActiveNote: vi.fn(async (_actor: string, stableId: string) =>
      stableId === current.stableId ? current : null),
  };
}

describe("workspace note grants", () => {
  it("derives distinct explicit operations bound to current-note stable ID", async () => {
    const service = noteService();
    const cases = [
      ["Please edit this note's body.", "editBodyStableIds"],
      ["Please rename this note to Two.", "editTitleStableIds"],
      ["Make this note shared.", "visibilityChanges"],
      ["Archive this note.", "archiveStableIds"],
      ["Read this note.", "readStableIds"],
    ] as const;
    for (const [message, field] of cases) {
      const grant = await deriveWorkspaceTurnNoteGrant({
        actorId: "alice",
        message,
        currentNote: current,
        noteService: service as any,
      });
      expect(grant[field]).toHaveLength(1);
      expect(grant.readStableIds).toEqual(["note-1"]);
    }
  });

  it("distinguishes default-private and explicitly shared creation", async () => {
    const service = noteService();
    const privateGrant = await deriveWorkspaceTurnNoteGrant({
      actorId: "alice",
      message: "Create a note called One.",
      noteService: service as any,
    });
    const sharedGrant = await deriveWorkspaceTurnNoteGrant({
      actorId: "alice",
      message: "Create a shared CodaScope note called One.",
      noteService: service as any,
    });
    expect(privateGrant.create).toEqual({
      allowed: true,
      sharedRequested: false,
    });
    expect(sharedGrant.create).toEqual({
      allowed: true,
      sharedRequested: true,
    });
  });

  it("fails closed for negated, hypothetical, quoted, explanatory, and ambiguous language", async () => {
    const service = noteService({ current: null });
    for (const message of [
      "Do not archive this note.",
      "Hypothetically, archive this note.",
      'The example says "create a shared note".',
      "Explain how you would edit this note.",
      "Archive the meeting note.",
    ]) {
      expect(await deriveWorkspaceTurnNoteGrant({
        actorId: "alice",
        message,
        currentNote: current,
        noteService: service as any,
      })).toEqual(EMPTY_WORKSPACE_TURN_NOTE_GRANT);
    }
  });

  it("binds an exact active-note reference when the resolver finds one unique target", async () => {
    const service = noteService({ exact: current });
    const grant = await deriveWorkspaceTurnNoteGrant({
      actorId: "alice",
      message: "Archive notes/one.md.",
      noteService: service as any,
    });
    expect(grant.archiveStableIds).toEqual(["note-1"]);
  });

  it("strictly revalidates every active stable ID and clears holders between runs", async () => {
    const service = noteService();
    const candidate = {
      create: null,
      readStableIds: ["note-1"],
      editBodyStableIds: ["note-1"],
      editTitleStableIds: [],
      visibilityChanges: [],
      archiveStableIds: [],
    };
    const validated = await validateWorkspaceTurnNoteGrant(
      candidate,
      "alice",
      service as any,
    );
    const holder = new WorkspaceTurnNoteGrantHolder();
    holder.replace(validated);
    expect(holder.current.editBodyStableIds).toEqual(["note-1"]);
    holder.clear();
    expect(holder.current).toBe(EMPTY_WORKSPACE_TURN_NOTE_GRANT);

    service.resolveActiveNote.mockResolvedValueOnce(null);
    await expect(validateWorkspaceTurnNoteGrant(
      candidate,
      "bob",
      service as any,
    )).rejects.toThrow("Invalid workspace note grant");
    await expect(validateWorkspaceTurnNoteGrant(
      { ...candidate, actorId: "mallory" },
      "alice",
      service as any,
    )).rejects.toThrow("Invalid workspace note grant");
  });
});
