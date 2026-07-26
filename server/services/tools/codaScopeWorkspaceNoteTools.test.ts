import { describe, expect, it, vi } from "vitest";
import { buildWorkspaceNoteTools } from "./codaScopeWorkspaceNoteTools.js";
import { WorkspaceTurnNoteGrantHolder } from "../codaScopeWorkspaceNoteGrant.js";
import {
  WorkspaceMutationActionCollector,
  WorkspaceMutationActionCollectorHolder,
} from "../codaScopeWorkspaceMutationActions.js";

const baseNote = {
  stableId: "note-1",
  scope: "codascope" as const,
  visibility: "private" as const,
  path: "one.md",
  title: "One",
  contentHash: "a".repeat(32),
};

function setup() {
  const service = {
    readForEditing: vi.fn(async () => ({ ...baseNote, body: "body" })),
    createNote: vi.fn(async (_actor, input) => ({
      ...baseNote,
      stableId: input.path === "two.md" ? "note-2" : "note-1",
      path: input.path,
      title: input.title,
      visibility: input.visibility ?? "private",
    })),
    replaceBody: vi.fn(async () => baseNote),
    setTitle: vi.fn(async () => ({ ...baseNote, title: "Renamed" })),
    setVisibility: vi.fn(async () => ({ ...baseNote, visibility: "shared" })),
    archiveNote: vi.fn(async () => baseNote),
  };
  const grant = new WorkspaceTurnNoteGrantHolder();
  grant.replace({
    create: { allowed: true, sharedRequested: false },
    readStableIds: ["note-1"],
    editBodyStableIds: ["note-1"],
    editTitleStableIds: ["note-1"],
    visibilityChanges: [{ stableId: "note-1", visibility: "shared" }],
    archiveStableIds: ["note-1"],
  });
  const actions = new WorkspaceMutationActionCollectorHolder();
  actions.current = new WorkspaceMutationActionCollector();
  const tools = buildWorkspaceNoteTools(
    "alice",
    service as any,
    grant,
    actions,
  );
  return { service, grant, actions, tools };
}

describe("workspace CodaScope note tools", () => {
  it("exposes the exact dedicated allowlist with strict authority-free schemas", () => {
    const { tools } = setup();
    expect(Object.keys(tools)).toEqual([
      "read_codascope_note",
      "create_codascope_note",
      "edit_codascope_note",
      "set_codascope_note_title",
      "set_codascope_note_visibility",
      "archive_codascope_note",
    ]);
    for (const tool of Object.values(tools)) {
      const schema = tool.inputSchema as Record<string, any>;
      expect(schema.additionalProperties).toBe(false);
      for (const forbidden of [
        "scope",
        "projectId",
        "epicId",
        "actorId",
        "ownerId",
        "userId",
        "includeArchived",
        "permanent",
      ]) {
        expect(schema.properties).not.toHaveProperty(forbidden);
      }
    }
    expect(tools).not.toHaveProperty("create_note");
    expect(tools).not.toHaveProperty("edit_note");
    expect(tools).not.toHaveProperty("delete_note");
    expect(tools).not.toHaveProperty("restore_note");
  });

  it("rejects runtime unknown fields even when schema validation is bypassed", async () => {
    const { tools, service } = setup();
    const result = await tools.edit_codascope_note.execute({
      stableId: "note-1",
      body: "next",
      expectedHash: "a".repeat(32),
      actorId: "mallory",
    } as any, {} as any);
    expect(result).toBe("The CodaScope note operation input is invalid.");
    expect(service.replaceBody).not.toHaveBeenCalled();
  });

  it("defaults creation private and refuses shared creation without an explicit shared grant", async () => {
    const { tools, service, actions } = setup();
    const denied = await tools.create_codascope_note.execute({
      path: "shared.md",
      title: "Shared",
      body: "body",
      visibility: "shared",
    } as any, {} as any);
    expect(String(denied)).toContain("not authorized");
    expect(service.createNote).not.toHaveBeenCalled();

    const created = await tools.create_codascope_note.execute({
      path: "one.md",
      title: "One",
      body: "body",
    } as any, {} as any);
    expect(JSON.parse(String(created))).toMatchObject({
      ok: true,
      note: { visibility: "private", stableId: "note-1" },
    });
    expect(service.createNote).toHaveBeenCalledWith(
      "alice",
      expect.objectContaining({ visibility: "private" }),
      { sharedRequested: false },
    );
    expect(actions.current.drain()).toEqual([{
      type: "note_created",
      attributes: {
        stableId: "note-1",
        scope: "codascope",
        visibility: "private",
        path: "one.md",
        title: "One",
        contentHash: "a".repeat(32),
      },
      description: 'Created CodaScope note "One".',
    }]);
  });

  it("requires operation-specific stable-ID grants and forwards required hashes", async () => {
    const { tools, service, grant } = setup();
    grant.replace({
      ...grant.current,
      editBodyStableIds: [],
    });
    expect(String(await tools.edit_codascope_note.execute({
      stableId: "note-1",
      body: "next",
      expectedHash: "a".repeat(32),
    } as any, {} as any))).toContain("not authorized");
    expect(service.replaceBody).not.toHaveBeenCalled();

    grant.replace({
      ...grant.current,
      editBodyStableIds: ["note-1"],
    });
    await tools.edit_codascope_note.execute({
      stableId: "note-1",
      body: "next",
      expectedHash: "a".repeat(32),
    } as any, {} as any);
    expect(service.replaceBody).toHaveBeenCalledWith(
      "alice",
      "note-1",
      "next",
      "a".repeat(32),
    );
  });

  it("deduplicates repeated created-note delivery by stable ID and preserves distinct order", async () => {
    const { tools, actions } = setup();
    await tools.create_codascope_note.execute({
      path: "one.md",
      title: "One",
      body: "",
    } as any, {} as any);
    await tools.create_codascope_note.execute({
      path: "one.md",
      title: "One",
      body: "",
    } as any, {} as any);
    await tools.create_codascope_note.execute({
      path: "two.md",
      title: "Two",
      body: "",
    } as any, {} as any);
    expect(actions.current.drain().map((action) => action.attributes.stableId))
      .toEqual(["note-1", "note-2"]);
  });
});
