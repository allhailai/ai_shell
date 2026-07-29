import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodaScopePersistence } from "./codaScopePersistence.js";
import {
  CodaScopeWorkspaceConversationService,
  createWorkspaceMessageContext,
} from "./codaScopeWorkspaceConversationService.js";

const roots: string[] = [];
const noteRangeTarget = {
  kind: "note-range",
  stableId: "note-1",
  scope: "codascope",
  visibility: "private",
  path: "one.md",
  title: "One",
  selectionStart: 0,
  selectionEnd: 4,
  selectedText: "body",
  startLine: 1,
  endLine: 1,
  expectedHash: "a".repeat(32),
};

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "workspace-conversations-"));
  roots.push(root);
  return root;
}

function actorFiles(
  service: CodaScopeWorkspaceConversationService,
  actorId: string,
): string[] {
  return readdirSync(service.getActorStorageDirectory(actorId))
    .filter((entry) => entry.endsWith(".json"))
    .sort();
}

function actorIndex(
  service: CodaScopeWorkspaceConversationService,
  actorId: string,
): { path: string; value: any } {
  const indexPath = path.join(
    service.getActorStorageDirectory(actorId),
    "conversations.json",
  );
  return {
    path: indexPath,
    value: JSON.parse(readFileSync(indexPath, "utf-8")),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CodaScopeWorkspaceConversationService", () => {
  it("creates, lists, reads, updates, and deletes explicit workspace conversations", async () => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    const created = await service.createConversation("alice", {
      title: "Workspace review",
      modelId: "model",
    });

    expect(created).toMatchObject({
      scope: { kind: "workspace" },
      ownerId: "alice",
      title: "Workspace review",
      defaultModelId: "model",
    });
    expect(await service.listConversations("alice")).toEqual([
      expect.objectContaining({
        id: created.id,
        scope: { kind: "workspace" },
      }),
    ]);
    expect(await service.readConversation("alice", created.id)).toMatchObject({
      id: created.id,
      ownerId: "alice",
    });
    expect(await service.updateConversation("alice", created.id, {
      title: "Renamed",
    })).toMatchObject({ title: "Renamed" });
    expect(await service.deleteConversation("alice", created.id)).toBe(true);
    expect(await service.readConversation("alice", created.id)).toBeNull();
  });

  it("hashes actor directories, retains owner IDs in records, and isolates actors", async () => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    const alice = await service.createConversation("alice");
    const bob = await service.createConversation("bob");
    const aliceDir = service.getActorStorageDirectory("alice");

    expect(path.basename(aliceDir)).toMatch(/^[a-f0-9]{64}$/);
    expect(aliceDir).not.toContain(`${path.sep}alice${path.sep}`);
    expect(readFileSync(path.join(aliceDir, "conversations.json"), "utf-8"))
      .toContain('"ownerId": "alice"');
    expect(readFileSync(path.join(aliceDir, `${alice.id}.json`), "utf-8"))
      .toContain('"ownerId": "alice"');
    expect(await service.readConversation("bob", alice.id)).toBeNull();
    expect(await service.updateConversation("bob", alice.id, { title: "forged" }))
      .toBeNull();
    expect(await service.deleteConversation("bob", alice.id)).toBe(false);
    expect((await service.listConversations("bob")).map((item) => item.id))
      .toEqual([bob.id]);
  });

  it("preserves stable assistant placeholder identity through completion and error", async () => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    const conversation = await service.createConversation("alice");
    const context = createWorkspaceMessageContext({
      explicitlyReferencedProjectIds: ["alpha"],
      currentView: { view: "notes", identity: "note-1" },
      currentNote: {
        stableId: "note-1",
        scope: "codascope",
        path: "planning/roadmap.md",
        title: "Roadmap",
        visibility: "shared",
        contentHash: "hash",
      },
    });
    await service.appendMessage("alice", conversation.id, {
      id: "assistant-stable",
      role: "assistant",
      content: "",
      modelId: "model",
      status: "streaming",
      context,
    });
    const completed = await service.completeAssistantMessage(
      "alice",
      conversation.id,
      "assistant-stable",
      {
        content: "Answer",
        retrievedSources: [{
          kind: "project_wiki",
          retrieval: "direct",
          projectId: "alpha",
          projectName: "Alpha",
          topicId: "roadmap",
          topicTitle: "Roadmap",
          topicUpdatedAt: "2026-07-25T00:00:00.000Z",
          lastWikiBuildAt: "2026-07-25T01:00:00.000Z",
        }],
      },
    );
    expect(completed?.messages.at(-1)).toMatchObject({
      id: "assistant-stable",
      status: "complete",
      content: "Answer",
      context: {
        assistantScope: { kind: "workspace" },
        retrievedSources: [expect.objectContaining({
          kind: "project_wiki",
          topicId: "roadmap",
        })],
      },
    });

    const compensated = await service.recordAssistantMessageError(
      "alice",
      conversation.id,
      "assistant-stable",
      "Terminal publication failed.",
    );
    expect(compensated?.messages.at(-1)).toMatchObject({
      id: "assistant-stable",
      status: "error",
      content: "Terminal publication failed.",
      context: { retrievedSources: [] },
    });
  });

  it("rejects malformed indexes, orphan records, malformed records, and index/record disagreement", async () => {
    const root = temporaryRoot();
    const service = new CodaScopeWorkspaceConversationService(root);
    const actorDir = service.getActorStorageDirectory("alice");
    mkdirSync(actorDir, { recursive: true });

    writeFileSync(path.join(actorDir, "conversations.json"), "{broken", "utf-8");
    await expect(service.listConversations("alice")).rejects.toMatchObject({
      code: "persistence_corrupt",
      context: { storage: "workspace_conversation_index" },
    });

    rmSync(path.join(actorDir, "conversations.json"));
    writeFileSync(path.join(actorDir, "orphan.json"), "{}", "utf-8");
    await expect(service.listConversations("alice")).rejects.toMatchObject({
      code: "persistence_corrupt",
      context: { storage: "workspace_conversation_index" },
    });

    rmSync(actorDir, { recursive: true, force: true });
    const created = await service.createConversation("alice");
    writeFileSync(
      path.join(actorDir, `${created.id}.json`),
      JSON.stringify({ id: created.id }),
      "utf-8",
    );
    await expect(service.readConversation("alice", created.id)).rejects.toMatchObject({
      code: "persistence_corrupt",
      context: { storage: "workspace_conversation" },
    });

    const index = JSON.parse(
      readFileSync(path.join(actorDir, "conversations.json"), "utf-8"),
    );
    index.conversations[0].messageCount = 1;
    writeFileSync(
      path.join(actorDir, "conversations.json"),
      JSON.stringify(index),
      "utf-8",
    );
    await expect(service.readConversation("alice", created.id)).rejects.toMatchObject({
      code: "persistence_corrupt",
    });
  });

  it("fails list, read, and mutation paths when a valid index has an unindexed record", async () => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    const created = await service.createConversation("alice");
    const actorDir = service.getActorStorageDirectory("alice");
    writeFileSync(
      path.join(actorDir, "conv_unindexed.json"),
      JSON.stringify({ id: "conv_unindexed" }),
      "utf-8",
    );

    await expect(service.listConversations("alice")).rejects.toMatchObject({
      code: "persistence_corrupt",
    });
    await expect(service.readConversation("alice", created.id)).rejects.toMatchObject({
      code: "persistence_corrupt",
    });
    await expect(service.updateConversation("alice", created.id, {
      title: "Must not publish",
    })).rejects.toMatchObject({ code: "persistence_corrupt" });
  });

  it("rejects an index that references a missing conversation record", async () => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    const created = await service.createConversation("alice");
    rmSync(path.join(
      service.getActorStorageDirectory("alice"),
      `${created.id}.json`,
    ));

    await expect(service.listConversations("alice")).rejects.toMatchObject({
      code: "persistence_corrupt",
    });
  });

  it.each([
    ["title", "Different title"],
    ["summary", "Different summary"],
    ["modelId", "different-model"],
    ["createdAt", "2025-01-01T00:00:00.000Z"],
    ["updatedAt", "2025-01-02T00:00:00.000Z"],
    ["messageCount", 1],
  ])("rejects index/record %s disagreement", async (field, value) => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    await service.createConversation("alice", {
      title: "Canonical title",
      modelId: "canonical-model",
    });
    const index = actorIndex(service, "alice");
    index.value.conversations[0][field] = value;
    writeFileSync(index.path, JSON.stringify(index.value), "utf-8");

    await expect(service.listConversations("alice")).rejects.toMatchObject({
      code: "persistence_corrupt",
    });
  });

  it.each([
    "bad%2Frecord.json",
    ".json",
    "unexpected-storage-entry.txt",
  ])("rejects malformed or unsafe storage filename %s", async (filename) => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    await service.createConversation("alice");
    writeFileSync(
      path.join(service.getActorStorageDirectory("alice"), filename),
      "{}",
      "utf-8",
    );

    await expect(service.listConversations("alice")).rejects.toMatchObject({
      code: "persistence_corrupt",
    });
  });

  it("ignores valid conversation asset directories and atomic-write artifacts", async () => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    const created = await service.createConversation("alice");
    const actorDir = service.getActorStorageDirectory("alice");
    const imagesDir = path.join(actorDir, created.id, "images");
    mkdirSync(imagesDir, { recursive: true });
    writeFileSync(path.join(imagesDir, "image.png"), "image", "utf-8");
    writeFileSync(
      path.join(
        actorDir,
        ".conversations.json.tmp.123.00000000-0000-4000-8000-000000000000",
      ),
      "{}",
      "utf-8",
    );
    writeFileSync(
      path.join(
        actorDir,
        `.${created.id}.json.bak.123.00000000-0000-4000-8000-000000000000`,
      ),
      "{}",
      "utf-8",
    );

    expect(await service.listConversations("alice")).toEqual([
      expect.objectContaining({ id: created.id }),
    ]);
    expect(await service.readConversation("alice", created.id)).toMatchObject({
      id: created.id,
    });
  });

  it("returns generic absence for index owner or scope mismatch before record validation", async () => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    const actorDir = service.getActorStorageDirectory("alice");
    mkdirSync(actorDir, { recursive: true });
    writeFileSync(path.join(actorDir, "conversations.json"), JSON.stringify({
      version: 1,
      scope: { kind: "project", projectId: "project" },
      ownerId: "mallory",
      conversations: [{ malformed: true }],
    }), "utf-8");
    writeFileSync(path.join(actorDir, "bad%2Frecord.json"), "{broken", "utf-8");

    expect(await service.readConversation("alice", "conv_missing")).toBeNull();
    expect(await service.listConversations("alice")).toEqual([]);
  });

  it("rolls back a conversation record when index publication fails", async () => {
    const persistence = new CodaScopePersistence();
    const service = new CodaScopeWorkspaceConversationService(
      temporaryRoot(),
      persistence,
    );
    const created = await service.createConversation("alice", { title: "Before" });
    const original = persistence.writeJson.bind(persistence);
    let failIndex = true;
    vi.spyOn(persistence, "writeJson").mockImplementation(async (
      filePath,
      value,
      context,
    ) => {
      if (failIndex && filePath.endsWith("conversations.json")) {
        failIndex = false;
        throw new Error("injected index failure");
      }
      await original(filePath, value, context);
    });

    await expect(service.updateConversation("alice", created.id, {
      title: "After",
    })).rejects.toThrow("injected index failure");
    expect(await service.readConversation("alice", created.id)).toMatchObject({
      title: "Before",
    });
    expect(actorFiles(service, "alice")).toHaveLength(2);
  });

  it("coordinates same-actor mutations while unrelated actors progress independently", async () => {
    const persistence = new CodaScopePersistence();
    const service = new CodaScopeWorkspaceConversationService(
      temporaryRoot(),
      persistence,
    );
    const original = persistence.writeJson.bind(persistence);
    let releaseAlice!: () => void;
    const aliceGate = new Promise<void>((resolve) => {
      releaseAlice = resolve;
    });
    let markAliceBlocked!: () => void;
    const aliceStarted = new Promise<void>((resolve) => {
      markAliceBlocked = resolve;
    });
    let aliceBlocked = false;
    const aliceDir = service.getActorStorageDirectory("alice");
    vi.spyOn(persistence, "writeJson").mockImplementation(async (
      filePath,
      value,
      context,
    ) => {
      if (!aliceBlocked
        && filePath.startsWith(aliceDir)
        && !filePath.endsWith("conversations.json")) {
        aliceBlocked = true;
        markAliceBlocked();
        await aliceGate;
      }
      await original(filePath, value, context);
    });

    const aliceCreate = service.createConversation("alice");
    await aliceStarted;
    const bob = await Promise.race([
      service.createConversation("bob"),
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error("independent actor was blocked")),
        250,
      )),
    ]);
    expect(bob.ownerId).toBe("bob");
    releaseAlice();
    await aliceCreate;
  });

  it("serializes same-actor message mutations without losing either append", async () => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    const created = await service.createConversation("alice");
    await Promise.all([
      service.appendMessage("alice", created.id, {
        id: "message-a",
        role: "user",
        content: "A",
        status: "complete",
      }),
      service.appendMessage("alice", created.id, {
        id: "message-b",
        role: "user",
        content: "B",
        status: "complete",
      }),
    ]);

    expect((await service.readConversation("alice", created.id))?.messages.map(
      (message) => message.id,
    )).toEqual(["message-a", "message-b"]);
  });

  it("rejects overlapping runs for one actor/conversation without crossing actors", () => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    expect(service.tryBeginConversationRun("alice", "conv")).toBe(true);
    expect(service.tryBeginConversationRun("alice", "conv")).toBe(false);
    expect(service.tryBeginConversationRun("bob", "conv")).toBe(true);
    service.endConversationRun("alice", "conv");
    expect(service.tryBeginConversationRun("alice", "conv")).toBe(true);
  });

  it("strictly bounds context and rejects client-owned scope or retrieved sources", () => {
    expect(createWorkspaceMessageContext({
      assistantScope: { kind: "workspace" },
      explicitlyReferencedProjectIds: ["beta", "alpha", "alpha"],
      currentView: { view: "workspace" },
    }).explicitlyReferencedProjectIds).toEqual(["alpha", "beta"]);
    expect(() => createWorkspaceMessageContext({
      assistantScope: { kind: "project", projectId: "forged" },
    })).toThrow();
    expect(() => createWorkspaceMessageContext({
      retrievedSources: [],
    })).toThrow();
    expect(() => createWorkspaceMessageContext({
      currentNote: {
        stableId: "note",
        scope: "project",
        path: "note.md",
        title: "Note",
        visibility: "shared",
      },
    })).toThrow();
  });

  it("persists and reloads one canonical user note-range target unchanged", async () => {
    const root = temporaryRoot();
    const service = new CodaScopeWorkspaceConversationService(root);
    const conversation = await service.createConversation("alice");
    await service.appendMessage("alice", conversation.id, {
      id: "selection-user",
      role: "user",
      content: "Do that",
      status: "complete",
      metadata: { noteRangeTarget },
    });

    const reloaded = new CodaScopeWorkspaceConversationService(root);
    expect((await reloaded.readConversation(
      "alice",
      conversation.id,
    ))?.messages.at(-1)).toMatchObject({
      role: "user",
      metadata: { noteRangeTarget },
    });
  });

  it("keeps legacy messages without targets compatible and rejects targets on non-user messages", async () => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    const conversation = await service.createConversation("alice");
    await service.appendMessage("alice", conversation.id, {
      id: "legacy-user",
      role: "user",
      content: "Legacy",
      status: "complete",
    });
    expect((await service.readConversation(
      "alice",
      conversation.id,
    ))?.messages.at(-1)?.metadata).toEqual({});
    await expect(service.appendMessage("alice", conversation.id, {
      id: "forged-assistant-target",
      role: "assistant",
      content: "No",
      status: "complete",
      metadata: { noteRangeTarget },
    })).rejects.toThrow("Invalid workspace note range target metadata");
  });

  it("fails closed when persisted note-range target metadata is malformed", async () => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    const conversation = await service.createConversation("alice");
    await service.appendMessage("alice", conversation.id, {
      id: "selection-user",
      role: "user",
      content: "Do that",
      status: "complete",
      metadata: { noteRangeTarget },
    });
    const recordPath = path.join(
      service.getActorStorageDirectory("alice"),
      `${conversation.id}.json`,
    );
    const record = JSON.parse(readFileSync(recordPath, "utf-8"));
    record.messages[0].metadata.noteRangeTarget.ownerId = "mallory";
    writeFileSync(recordPath, JSON.stringify(record, null, 2));

    await expect(service.readConversation("alice", conversation.id))
      .rejects.toMatchObject({ code: "persistence_corrupt" });
  });

  it("keeps storage outside project directories", async () => {
    const root = temporaryRoot();
    const service = new CodaScopeWorkspaceConversationService(root);
    const projectDir = path.join(root, "project-alpha");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
      id: "alpha",
    }));
    await service.createConversation("alice");

    expect(existsSync(path.join(root, "_workspace", "conversations"))).toBe(true);
    expect(existsSync(path.join(projectDir, "conversations"))).toBe(false);
  });

  it("durably preserves canonical trusted mutation actions on completion and error", async () => {
    const root = temporaryRoot();
    const service = new CodaScopeWorkspaceConversationService(root);
    const conversation = await service.createConversation("alice");
    const action = {
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
    };
    await service.appendMessage("alice", conversation.id, {
      id: "assistant-action",
      role: "assistant",
      content: "",
      status: "streaming",
    });
    await service.completeAssistantMessage(
      "alice",
      conversation.id,
      "assistant-action",
      { content: "Created.", retrievedSources: [], actions: [action] },
    );
    await service.recordAssistantMessageError(
      "alice",
      conversation.id,
      "assistant-action",
      "Generation failed after creation.",
      [action],
    );

    const reloaded = new CodaScopeWorkspaceConversationService(root);
    expect((await reloaded.readConversation(
      "alice",
      conversation.id,
    ))?.messages.at(-1)).toMatchObject({
      id: "assistant-action",
      status: "error",
      metadata: { actions: [action] },
    });
  });

  it("fails closed when persisted note_created metadata is malformed", async () => {
    const service = new CodaScopeWorkspaceConversationService(temporaryRoot());
    const conversation = await service.createConversation("alice");
    await service.appendMessage("alice", conversation.id, {
      id: "assistant-action",
      role: "assistant",
      content: "Forged",
      status: "complete",
      metadata: {
        actions: [{
          type: "note_created",
          attributes: {
            stableId: "note-1",
            scope: "project",
            visibility: "private",
            path: "/absolute.md",
            title: "Forged",
            contentHash: "not-a-hash",
          },
          description: "Forged",
        }],
      },
    }).catch(() => undefined);

    // Inject malformed persisted metadata to exercise strict reload rather
    // than the equally strict append boundary.
    const recordPath = path.join(
      service.getActorStorageDirectory("alice"),
      `${conversation.id}.json`,
    );
    const record = JSON.parse(readFileSync(recordPath, "utf-8"));
    record.messages.push({
      id: "malformed-action",
      role: "assistant",
      content: "Forged",
      createdAt: new Date().toISOString(),
      updatedAt: null,
      modelId: null,
      status: "complete",
      context: createWorkspaceMessageContext({}),
      metadata: {
        actions: [{
          type: "note_created",
          attributes: {
            stableId: "note-1",
            scope: "project",
            visibility: "private",
            path: "/absolute.md",
            title: "Forged",
            contentHash: "not-a-hash",
          },
          description: "Forged",
        }],
      },
    });
    writeFileSync(recordPath, JSON.stringify(record, null, 2));
    await expect(service.readConversation("alice", conversation.id))
      .rejects.toThrow();
  });
});
