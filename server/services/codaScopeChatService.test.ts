/* ── CodaScope: Chat Service Tests ────────────────────────────────────
   Unit tests for CodaScopeChatService.
   Exercises conversation CRUD, auto-titling, auto-summary,
   atomic writes (temp-file → rename), stale streaming detection,
   mutation queue serialization, and index management.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
  readdirSync,
  mkdtempSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { CodaScopeChatService } from "./codaScopeChatService.js";

/* ── Helpers ─────────────────────────────────────────────────────── */

function tmpRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "codascope-chat-svc-"));
}

/** Scaffold a minimal project directory. */
function scaffoldProject(root: string, projectId: string): string {
  const projectDir = path.join(root, `project-${projectId}`);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    path.join(projectDir, "project.json"),
    JSON.stringify({ id: projectId, name: "Test Project" }),
    "utf-8",
  );
  return projectDir;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function conversationIndexPath(projectDir: string): string {
  return path.join(projectDir, "conversations", "conversations.json");
}

function conversationDirectory(projectDir: string): string {
  return path.join(projectDir, "conversations");
}

function conversationDataFiles(projectDir: string): string[] {
  return readdirSync(conversationDirectory(projectDir))
    .filter((file) => file.endsWith(".json") && file !== "conversations.json")
    .sort();
}

async function expectPersistenceCorrupt(
  operation: Promise<unknown>,
  storage: "conversation_index" | "conversation",
  projectId: string,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    name: "CodaScopePersistenceCorruptError",
    code: "persistence_corrupt",
    message: "Persisted CodaScope data is corrupt. Repair or restore it and retry.",
    context: { storage, projectId },
  });
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe("CodaScopeChatService", () => {
  let root: string;
  let svc: CodaScopeChatService;

  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(root, { recursive: true });
    svc = new CodaScopeChatService(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── Create ────────────────────────────────────────────────────

  describe("createConversation", () => {
    it("creates a conversation with default title", async () => {
      scaffoldProject(root, "proj1");
      const conv = await svc.createConversation("proj1", "alice");

      expect(conv.id).toMatch(/^conv_/);
      expect(conv.title).toBe("New conversation");
      expect(conv.projectId).toBe("proj1");
      expect(conv.ownerId).toBe("alice");
      expect(conv.messages).toEqual([]);
      expect(conv.version).toBe(2);
    });

    it("creates a conversation with custom title and model", async () => {
      scaffoldProject(root, "proj2");
      const conv = await svc.createConversation("proj2", "alice", {
        title: "Auth Discussion",
        modelId: "gpt-4",
      });

      expect(conv.title).toBe("Auth Discussion");
      expect(conv.defaultModelId).toBe("gpt-4");
    });

    it("creates an epic-scoped conversation", async () => {
      scaffoldProject(root, "proj3");
      const conv = await svc.createConversation("proj3", "alice", {
        title: "Epic: Auth Flow",
        epicId: "epic_abc",
      });

      expect(conv.epicId).toBe("epic_abc");
    });

    it("creates the conversation file on disk", async () => {
      const projDir = scaffoldProject(root, "proj4");
      const conv = await svc.createConversation("proj4", "alice", { title: "Persistent" });

      // Check that conversation file exists
      const convDir = path.join(projDir, "conversations");
      expect(existsSync(convDir)).toBe(true);
      const files = readdirSync(convDir).filter((f) => f.endsWith(".json") && f !== "conversations.json");
      expect(files.length).toBeGreaterThanOrEqual(1);
    });

    it("updates the index", async () => {
      const projDir = scaffoldProject(root, "proj5");
      await svc.createConversation("proj5", "alice", { title: "Conv A" });
      await svc.createConversation("proj5", "alice", { title: "Conv B" });

      const indexPath = path.join(projDir, "conversations", "conversations.json");
      expect(existsSync(indexPath)).toBe(true);
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      expect(index.conversations).toHaveLength(2);
    });

    it("throws when project not found", async () => {
      await expect(
        svc.createConversation("nonexistent", "alice"),
      ).rejects.toThrow("Project not found");
    });
  });

  // ── Read ──────────────────────────────────────────────────────

  describe("readConversation", () => {
    it("reads a created conversation with full messages", async () => {
      scaffoldProject(root, "proj-read");
      const created = await svc.createConversation("proj-read", "alice", { title: "Readable" });

      const read = await svc.readConversation("proj-read", created.id, "alice");
      expect(read).not.toBeNull();
      expect(read!.id).toBe(created.id);
      expect(read!.title).toBe("Readable");
    });

    it("returns null for nonexistent conversation", async () => {
      scaffoldProject(root, "proj-read2");
      const result = await svc.readConversation("proj-read2", "nonexistent", "alice");
      expect(result).toBeNull();
    });

    it("returns null for nonexistent project", async () => {
      const result = await svc.readConversation("nonexistent", "conv1", "alice");
      expect(result).toBeNull();
    });
  });

  // ── List ──────────────────────────────────────────────────────

  describe("listConversations", () => {
    it("lists all conversations sorted by updatedAt desc", async () => {
      scaffoldProject(root, "proj-list");
      const a = await svc.createConversation("proj-list", "alice", { title: "First" });
      await new Promise((r) => setTimeout(r, 10));
      const b = await svc.createConversation("proj-list", "alice", { title: "Second" });

      const list = await svc.listConversations("proj-list", "alice");
      expect(list).toHaveLength(2);
      // Second created should be first (more recent)
      expect(list[0].title).toBe("Second");
      expect(list[1].title).toBe("First");
    });

    it("returns empty array for project with no conversations", async () => {
      scaffoldProject(root, "proj-empty");
      const list = await svc.listConversations("proj-empty", "alice");
      expect(list).toEqual([]);
    });

    it("returns empty array for nonexistent project", async () => {
      const list = await svc.listConversations("nonexistent", "alice");
      expect(list).toEqual([]);
    });
  });

  // ── Owner custody ─────────────────────────────────────────────

  describe("owner custody", () => {
    it("does not let a second user list, read, update, append, overwrite, or delete another user's conversation", async () => {
      scaffoldProject(root, "proj-owner");
      const aliceConversation = await svc.createConversation("proj-owner", "alice", { title: "Alice private" });
      const bobConversation = await svc.createConversation("proj-owner", "bob", { title: "Bob private" });

      expect((await svc.listConversations("proj-owner", "alice")).map((conversation) => conversation.id))
        .toEqual([aliceConversation.id]);
      expect((await svc.listConversations("proj-owner", "bob")).map((conversation) => conversation.id))
        .toEqual([bobConversation.id]);
      expect(await svc.readConversation("proj-owner", aliceConversation.id, "bob")).toBeNull();
      expect(await svc.updateConversation("proj-owner", aliceConversation.id, "bob", { title: "Forged" })).toBeNull();
      expect(await svc.appendMessage("proj-owner", aliceConversation.id, "bob", {
        role: "user",
        content: "Forged message",
      })).toBeNull();
      expect(await svc.completeAssistantMessage(
        "proj-owner",
        aliceConversation.id,
        "bob",
        "assistant-forged",
        { content: "Forged completion" },
      )).toBeNull();
      expect(await svc.recordAssistantMessageError(
        "proj-owner",
        aliceConversation.id,
        "bob",
        {
          id: "assistant-forged",
          content: "Forged error",
          modelId: "model",
        },
        { appendIfMissing: true },
      )).toBeNull();
      expect(await svc.writeConversation("proj-owner", "bob", {
        ...aliceConversation,
        title: "Forged overwrite",
      })).toBeNull();
      expect(await svc.deleteConversation("proj-owner", aliceConversation.id, "bob")).toBe(false);

      const unchanged = await svc.readConversation("proj-owner", aliceConversation.id, "alice");
      expect(unchanged).toMatchObject({ title: "Alice private", messages: [] });
    });

    it("keeps dedicated epic conversations per user", async () => {
      scaffoldProject(root, "proj-owner-epic");
      const alice = await svc.getOrCreateEpicConversation("proj-owner-epic", "epic_auth", "Auth", "alice");
      const bob = await svc.getOrCreateEpicConversation("proj-owner-epic", "epic_auth", "Auth", "bob");

      expect(alice.id).not.toBe(bob.id);
      expect(await svc.readConversation("proj-owner-epic", alice.id, "bob")).toBeNull();
    });

    it("hides ownerless legacy conversations until an administrator migration assigns a validated owner", async () => {
      const projectDir = scaffoldProject(root, "proj-legacy");
      const conversationDir = path.join(projectDir, "conversations");
      const createdAt = "2026-01-01T00:00:00.000Z";
      mkdirSync(conversationDir, { recursive: true });
      writeFileSync(path.join(conversationDir, "legacy.json"), JSON.stringify({
        version: 1,
        id: "conv_legacy",
        projectId: "proj-legacy",
        title: "Legacy private title",
        summary: "Legacy private summary",
        createdAt,
        updatedAt: createdAt,
        defaultModelId: null,
        messages: [{
          id: "msg_legacy",
          role: "user",
          content: "Legacy private content",
          createdAt,
          modelId: null,
          status: "complete",
        }],
      }), "utf-8");
      writeFileSync(path.join(conversationDir, "conversations.json"), JSON.stringify({
        version: 1,
        conversations: [{
          id: "conv_legacy",
          file: "conversations/legacy.json",
          title: "Legacy private title",
          summary: "Legacy private summary",
          modelId: null,
          createdAt,
          updatedAt: createdAt,
          messageCount: 1,
        }],
      }), "utf-8");

      expect(await svc.listConversations("proj-legacy", "alice")).toEqual([]);
      expect(await svc.readConversation("proj-legacy", "conv_legacy", "alice")).toBeNull();
      expect(await svc.listLegacyConversations("proj-legacy")).toMatchObject([
        { id: "conv_legacy", title: "Legacy private title" },
      ]);

      const migrated = await svc.assignLegacyConversationOwner("proj-legacy", "conv_legacy", "bob");
      expect(migrated?.ownerId).toBe("bob");
      expect(await svc.listLegacyConversations("proj-legacy")).toEqual([]);
      expect(await svc.readConversation("proj-legacy", "conv_legacy", "alice")).toBeNull();
      expect((await svc.readConversation("proj-legacy", "conv_legacy", "bob"))?.messages[0]?.content)
        .toBe("Legacy private content");
    });
  });

  // ── Update ────────────────────────────────────────────────────

  describe("updateConversation", () => {
    it("updates title and summary", async () => {
      scaffoldProject(root, "proj-upd");
      const conv = await svc.createConversation("proj-upd", "alice", { title: "Old" });

      const updated = await svc.updateConversation("proj-upd", conv.id, "alice", {
        title: "New Title",
        summary: "A brief summary.",
      });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe("New Title");
      expect(updated!.summary).toBe("A brief summary.");
    });

    it("returns null for nonexistent conversation", async () => {
      scaffoldProject(root, "proj-upd2");
      const result = await svc.updateConversation("proj-upd2", "nonexistent", "alice", { title: "X" });
      expect(result).toBeNull();
    });

    it("syncs index after update", async () => {
      scaffoldProject(root, "proj-upd3");
      const conv = await svc.createConversation("proj-upd3", "alice", { title: "Before" });
      await svc.updateConversation("proj-upd3", conv.id, "alice", { title: "After" });

      const list = await svc.listConversations("proj-upd3", "alice");
      expect(list[0].title).toBe("After");
    });
  });

  // ── Delete ────────────────────────────────────────────────────

  describe("deleteConversation", () => {
    it("deletes a conversation and removes from index", async () => {
      scaffoldProject(root, "proj-del");
      const conv = await svc.createConversation("proj-del", "alice", { title: "Deletable" });

      const result = await svc.deleteConversation("proj-del", conv.id, "alice");
      expect(result).toBe(true);

      const list = await svc.listConversations("proj-del", "alice");
      expect(list).toHaveLength(0);
    });

    it("returns false for nonexistent conversation", async () => {
      scaffoldProject(root, "proj-del2");
      const result = await svc.deleteConversation("proj-del2", "nonexistent", "alice");
      expect(result).toBe(false);
    });

    it("deletes the conversation file from disk", async () => {
      const projDir = scaffoldProject(root, "proj-del3");
      const conv = await svc.createConversation("proj-del3", "alice", { title: "File Delete" });

      await svc.deleteConversation("proj-del3", conv.id, "alice");

      // Conversation file should be gone
      const convDir = path.join(projDir, "conversations");
      const files = readdirSync(convDir).filter((f) => f !== "conversations.json");
      expect(files).toHaveLength(0);
    });
  });

  // ── Append Message ────────────────────────────────────────────

  describe("appendMessage", () => {
    it("appends a user message", async () => {
      scaffoldProject(root, "proj-msg");
      const conv = await svc.createConversation("proj-msg", "alice");

      const updated = await svc.appendMessage("proj-msg", conv.id, "alice", {
        role: "user",
        content: "How does auth work?",
      });

      expect(updated).not.toBeNull();
      expect(updated!.messages).toHaveLength(1);
      expect(updated!.messages[0].role).toBe("user");
      expect(updated!.messages[0].content).toBe("How does auth work?");
      expect(updated!.messages[0].status).toBe("complete");
    });

    it("auto-titles from first user message", async () => {
      scaffoldProject(root, "proj-autotitle");
      const conv = await svc.createConversation("proj-autotitle", "alice");
      expect(conv.title).toBe("New conversation");

      const updated = await svc.appendMessage("proj-autotitle", conv.id, "alice", {
        role: "user",
        content: "Explain the authentication flow in detail",
      });

      expect(updated!.title).toBe("Explain the authentication flow in detail");
    });

    it("does not re-title on subsequent user messages", async () => {
      scaffoldProject(root, "proj-notitle");
      const conv = await svc.createConversation("proj-notitle", "alice");

      const after1 = await svc.appendMessage("proj-notitle", conv.id, "alice", {
        role: "user",
        content: "First question",
      });
      expect(after1!.title).toBe("First question");

      const after2 = await svc.appendMessage("proj-notitle", conv.id, "alice", {
        role: "user",
        content: "Second question which is different",
      });
      expect(after2!.title).toBe("First question"); // unchanged
    });

    it("auto-summarizes from first assistant response", async () => {
      scaffoldProject(root, "proj-autosum");
      const conv = await svc.createConversation("proj-autosum", "alice");

      await svc.appendMessage("proj-autosum", conv.id, "alice", {
        role: "user",
        content: "Question",
      });

      const updated = await svc.appendMessage("proj-autosum", conv.id, "alice", {
        role: "assistant",
        content: "The auth flow uses **JWT tokens** with refresh capability and session management.",
        modelId: "claude-3",
      });

      expect(updated!.summary).toBeTruthy();
      expect(updated!.summary.length).toBeGreaterThan(0);
    });

    it("message gets normalized with defaults", async () => {
      scaffoldProject(root, "proj-norm");
      const conv = await svc.createConversation("proj-norm", "alice");

      const updated = await svc.appendMessage("proj-norm", conv.id, "alice", {
        content: "Minimal message",
      });

      const msg = updated!.messages[0];
      expect(msg.id).toMatch(/^msg_/);
      expect(msg.role).toBe("assistant"); // default
      expect(msg.status).toBe("complete"); // default
      expect(msg.createdAt).toBeDefined();
    });

    it("returns null for nonexistent conversation", async () => {
      scaffoldProject(root, "proj-msg2");
      const result = await svc.appendMessage("proj-msg2", "nonexistent", "alice", {
        role: "user",
        content: "Hi",
      });
      expect(result).toBeNull();
    });
  });

  // ── Assistant Message Transitions ─────────────────────────────

  describe("assistant message transitions", () => {
    it("re-reads under the mutation queue so a concurrent append survives completion", async () => {
      scaffoldProject(root, "proj-assistant-complete-race");
      const conv = await svc.createConversation("proj-assistant-complete-race", "alice");
      await svc.appendMessage("proj-assistant-complete-race", conv.id, "alice", {
        id: "user-1",
        role: "user",
        content: "First question",
        status: "complete",
      });
      await svc.appendMessage("proj-assistant-complete-race", conv.id, "alice", {
        id: "assistant-1",
        role: "assistant",
        content: "",
        status: "streaming",
      });

      const entered = deferred();
      const release = deferred();
      const blocker = (svc as unknown as {
        withMutation: <T>(projectId: string, operation: () => Promise<T>) => Promise<T>;
      }).withMutation("proj-assistant-complete-race", async () => {
        entered.resolve();
        await release.promise;
      });
      await entered.promise;

      const concurrentAppend = svc.appendMessage("proj-assistant-complete-race", conv.id, "alice", {
        id: "user-2",
        role: "user",
        content: "Concurrent question",
        status: "complete",
      });
      let completionSettled = false;
      const completion = svc.completeAssistantMessage(
        "proj-assistant-complete-race",
        conv.id,
        "alice",
        "assistant-1",
        {
          content: "Finished answer",
          metadata: { actions: [{ type: "operation_completed" }] },
        },
      ).finally(() => {
        completionSettled = true;
      });

      await Promise.resolve();
      expect(completionSettled).toBe(false);
      release.resolve();
      await Promise.all([blocker, concurrentAppend, completion]);

      const final = await svc.readConversation("proj-assistant-complete-race", conv.id, "alice");
      expect(final?.messages.map((message) => message.id)).toEqual([
        "user-1",
        "assistant-1",
        "user-2",
      ]);
      expect(final?.messages.find((message) => message.id === "assistant-1")).toMatchObject({
        content: "Finished answer",
        status: "complete",
        metadata: { actions: [{ type: "operation_completed" }] },
      });
    });

    it("re-reads under the mutation queue so a concurrent append survives an error transition", async () => {
      scaffoldProject(root, "proj-assistant-error-race");
      const conv = await svc.createConversation("proj-assistant-error-race", "alice");
      await svc.appendMessage("proj-assistant-error-race", conv.id, "alice", {
        id: "assistant-1",
        role: "assistant",
        content: "",
        status: "streaming",
        metadata: {
          actions: [{ type: "operation_completed" }],
          traceId: "keep-me",
        },
      });

      const entered = deferred();
      const release = deferred();
      const blocker = (svc as unknown as {
        withMutation: <T>(projectId: string, operation: () => Promise<T>) => Promise<T>;
      }).withMutation("proj-assistant-error-race", async () => {
        entered.resolve();
        await release.promise;
      });
      await entered.promise;

      const concurrentAppend = svc.appendMessage("proj-assistant-error-race", conv.id, "alice", {
        id: "user-2",
        role: "user",
        content: "Concurrent question",
        status: "complete",
      });
      const transition = svc.recordAssistantMessageError(
        "proj-assistant-error-race",
        conv.id,
        "alice",
        {
          id: "assistant-1",
          content: "Partial answer",
          modelId: "model",
        },
      );

      release.resolve();
      await Promise.all([blocker, concurrentAppend, transition]);

      const final = await svc.readConversation("proj-assistant-error-race", conv.id, "alice");
      expect(final?.messages.map((message) => message.id)).toEqual([
        "assistant-1",
        "user-2",
      ]);
      expect(final?.messages[0]).toMatchObject({
        content: "Partial answer",
        status: "error",
        metadata: { traceId: "keep-me" },
      });
      expect(final?.messages[0]?.metadata).not.toHaveProperty("actions");
    });

    it.each([
      ["missing ID", "missing", "assistant", "streaming"],
      ["wrong role", "target", "user", "streaming"],
      ["wrong status", "target", "assistant", "complete"],
    ] as const)("fails closed for a %s without appending a completed replacement", async (
      _label,
      requestedId,
      role,
      status,
    ) => {
      const projectId = `proj-assistant-exact-${role}-${status}`;
      scaffoldProject(root, projectId);
      const conv = await svc.createConversation(projectId, "alice");
      await svc.appendMessage(projectId, conv.id, "alice", {
        id: "target",
        role,
        content: "Original",
        status,
      });

      const result = await svc.completeAssistantMessage(
        projectId,
        conv.id,
        "alice",
        requestedId,
        { content: "Must not be appended" },
      );
      const final = await svc.readConversation(projectId, conv.id, "alice");

      expect(result).toBeNull();
      expect(final?.messages).toHaveLength(1);
      expect(final?.messages[0]).toMatchObject({
        id: "target",
        role,
        content: "Original",
        status,
      });
    });

    it("atomically rewrites an existing stable-ID completion as error", async () => {
      scaffoldProject(root, "proj-assistant-error-update");
      const conv = await svc.createConversation("proj-assistant-error-update", "alice");
      await svc.appendMessage("proj-assistant-error-update", conv.id, "alice", {
        id: "assistant-stable",
        role: "assistant",
        content: "Generated answer",
        status: "complete",
        metadata: { actions: [{ type: "operation_completed" }] },
      });

      const updated = await svc.recordAssistantMessageError(
        "proj-assistant-error-update",
        conv.id,
        "alice",
        {
          id: "assistant-stable",
          content: "Generated answer",
          modelId: "model",
        },
        { appendIfMissing: true },
      );

      expect(updated?.messages.filter((message) => message.id === "assistant-stable")).toHaveLength(1);
      expect(updated?.messages.find((message) => message.id === "assistant-stable")).toMatchObject({
        content: "Generated answer",
        status: "error",
      });
      expect(updated?.messages.find((message) => message.id === "assistant-stable")?.metadata?.actions)
        .toBeUndefined();
    });

    it("atomically appends one stable-ID error when no completion committed", async () => {
      scaffoldProject(root, "proj-assistant-error-append");
      const conv = await svc.createConversation("proj-assistant-error-append", "alice");

      const updated = await svc.recordAssistantMessageError(
        "proj-assistant-error-append",
        conv.id,
        "alice",
        {
          id: "assistant-stable",
          content: "Error: completion failed",
          modelId: "model",
        },
        { appendIfMissing: true },
      );

      expect(updated?.messages).toHaveLength(1);
      expect(updated?.messages[0]).toMatchObject({
        id: "assistant-stable",
        role: "assistant",
        content: "Error: completion failed",
        status: "error",
      });
    });

    it("preserves a concurrent message beside a backwards-compatible stable-ID completion", async () => {
      scaffoldProject(root, "proj-assistant-backcompat-race");
      const conv = await svc.createConversation("proj-assistant-backcompat-race", "alice");

      const entered = deferred();
      const release = deferred();
      const blocker = (svc as unknown as {
        withMutation: <T>(projectId: string, operation: () => Promise<T>) => Promise<T>;
      }).withMutation("proj-assistant-backcompat-race", async () => {
        entered.resolve();
        await release.promise;
      });
      await entered.promise;

      const concurrentAppend = svc.appendMessage("proj-assistant-backcompat-race", conv.id, "alice", {
        id: "user-concurrent",
        role: "user",
        content: "Concurrent question",
        status: "complete",
      });
      const assistantCompletion = svc.appendMessage("proj-assistant-backcompat-race", conv.id, "alice", {
        id: "assistant-stable",
        role: "assistant",
        content: "",
        modelId: "model",
        status: "complete",
      });

      release.resolve();
      await Promise.all([blocker, concurrentAppend, assistantCompletion]);

      const final = await svc.readConversation("proj-assistant-backcompat-race", conv.id, "alice");
      expect(final?.messages.map((message) => message.id)).toEqual([
        "user-concurrent",
        "assistant-stable",
      ]);
      expect(final?.messages.at(-1)).toMatchObject({
        content: "",
        status: "complete",
      });
    });
  });

  // ── Stale Streaming Detection ─────────────────────────────────

  describe("stale streaming detection", () => {
    it("marks stale streaming messages as error", async () => {
      scaffoldProject(root, "proj-stale");
      const conv = await svc.createConversation("proj-stale", "alice");

      // Append a message that appears to be streaming from >10 min ago
      const staleTime = new Date(Date.now() - 11 * 60 * 1000).toISOString();
      const updated = await svc.appendMessage("proj-stale", conv.id, "alice", {
        role: "assistant",
        content: "Partial response...",
        status: "streaming",
        createdAt: staleTime,
        updatedAt: staleTime,
      });

      const msg = updated!.messages[0];
      expect(msg.status).toBe("error");
      expect(msg.content).toContain("[Response was interrupted before completion.]");
    });

    it("preserves recent streaming messages", async () => {
      scaffoldProject(root, "proj-fresh");
      const conv = await svc.createConversation("proj-fresh", "alice");

      const updated = await svc.appendMessage("proj-fresh", conv.id, "alice", {
        role: "assistant",
        content: "Currently streaming...",
        status: "streaming",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const msg = updated!.messages[0];
      expect(msg.status).toBe("streaming");
    });

    it("detects stale messages on read", async () => {
      const projDir = scaffoldProject(root, "proj-stale-read");
      const conv = await svc.createConversation("proj-stale-read", "alice");

      // Append a normal message first
      await svc.appendMessage("proj-stale-read", conv.id, "alice", {
        role: "user",
        content: "Question",
      });

      // Manually write a stale streaming message to the file
      const read = await svc.readConversation("proj-stale-read", conv.id, "alice");
      expect(read).not.toBeNull();

      // Write a stale message
      const staleTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const next = {
        ...read!,
        messages: [
          ...read!.messages,
          {
            id: "msg_stale_test",
            role: "assistant" as const,
            content: "Partial output from agent...",
            createdAt: staleTime,
            updatedAt: staleTime,
            modelId: null,
            status: "streaming" as const,
            context: null,
            metadata: {},
          },
        ],
      };

      await svc.writeConversation("proj-stale-read", "alice", next);

      // Re-read — stale detection should fire during normalization
      const reread = await svc.readConversation("proj-stale-read", conv.id, "alice");
      const staleMsg = reread!.messages.find((m) => m.id === "msg_stale_test");
      expect(staleMsg).toBeDefined();
      expect(staleMsg!.status).toBe("error");
    });
  });

  // ── writeConversation (full atomic write) ─────────────────────

  describe("writeConversation", () => {
    it("writes a full conversation atomically", async () => {
      scaffoldProject(root, "proj-write");
      const conv = await svc.createConversation("proj-write", "alice");

      const updated = {
        ...conv,
        messages: [
          {
            id: "msg_1",
            role: "user" as const,
            content: "Hello",
            createdAt: new Date().toISOString(),
            updatedAt: null,
            modelId: null,
            status: "complete" as const,
            context: null,
            metadata: {},
          },
        ],
      };

      const result = await svc.writeConversation("proj-write", "alice", updated);
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(1);
    });

    it("returns null for nonexistent conversation", async () => {
      scaffoldProject(root, "proj-write2");
      const result = await svc.writeConversation("proj-write2", "alice", {
        version: 1,
        id: "nonexistent",
        projectId: "proj-write2",
        title: "Ghost",
        summary: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        defaultModelId: null,
        messages: [],
      });
      expect(result).toBeNull();
    });

    it("leaves no temp files on successful write", async () => {
      const projDir = scaffoldProject(root, "proj-clean");
      const conv = await svc.createConversation("proj-clean", "alice");

      await svc.writeConversation("proj-clean", "alice", {
        ...conv,
        title: "Updated",
      });

      const convDir = path.join(projDir, "conversations");
      const tmpFiles = readdirSync(convDir).filter((f) => f.includes(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  // ── Epic Conversations ────────────────────────────────────────

  describe("epic conversations", () => {
    it("getConversationForEpic returns null when none exists", async () => {
      scaffoldProject(root, "proj-epic");
      const result = await svc.getConversationForEpic("proj-epic", "epic_123", "alice");
      expect(result).toBeNull();
    });

    it("getOrCreateEpicConversation creates on first call", async () => {
      scaffoldProject(root, "proj-epic2");
      const conv = await svc.getOrCreateEpicConversation("proj-epic2", "epic_abc", "Auth Flow", "alice");
      expect(conv.epicId).toBe("epic_abc");
      expect(conv.title).toBe("Epic: Auth Flow");
    });

    it("getOrCreateEpicConversation returns existing on second call", async () => {
      scaffoldProject(root, "proj-epic3");
      const first = await svc.getOrCreateEpicConversation("proj-epic3", "epic_def", "Payment", "alice");
      const second = await svc.getOrCreateEpicConversation("proj-epic3", "epic_def", "Payment", "alice");
      expect(second.id).toBe(first.id);
    });
  });

  // ── Mutation Queue ────────────────────────────────────────────

  describe("mutation queue", () => {
    it("serializes concurrent writes to the same project", async () => {
      scaffoldProject(root, "proj-queue");
      const conv = await svc.createConversation("proj-queue", "alice", { title: "Queue Test" });

      // Fire 5 concurrent appends
      const promises = Array.from({ length: 5 }, (_, i) =>
        svc.appendMessage("proj-queue", conv.id, "alice", {
          role: "user",
          content: `Message ${i}`,
        }),
      );

      const results = await Promise.all(promises);

      // All should succeed (no corruption)
      for (const result of results) {
        expect(result).not.toBeNull();
      }

      // Final conversation should have all messages
      const final = await svc.readConversation("proj-queue", conv.id, "alice");
      expect(final!.messages).toHaveLength(5);
    });

    it("independent projects don't block each other", async () => {
      scaffoldProject(root, "proj-q1");
      scaffoldProject(root, "proj-q2");

      const conv1 = await svc.createConversation("proj-q1", "alice");
      const conv2 = await svc.createConversation("proj-q2", "alice");

      const [r1, r2] = await Promise.all([
        svc.appendMessage("proj-q1", conv1.id, "alice", { role: "user", content: "A" }),
        svc.appendMessage("proj-q2", conv2.id, "alice", { role: "user", content: "B" }),
      ]);

      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
    });
  });

  // ── Index Management ──────────────────────────────────────────

  describe("index management", () => {
    it("caps index at 100 conversations", async () => {
      scaffoldProject(root, "proj-cap");

      // Create 102 conversations
      for (let i = 0; i < 102; i++) {
        await svc.createConversation("proj-cap", "alice", { title: `Conv ${i}` });
      }

      const list = await svc.listConversations("proj-cap", "alice");
      expect(list.length).toBeLessThanOrEqual(100);
    });

    it("fails closed on a syntax-corrupt authoritative index without publishing, then recovers its queue after repair", async () => {
      const projectId = "proj-corrupt";
      const projectDir = scaffoldProject(root, projectId);
      const first = await svc.createConversation(projectId, "alice", { title: "First" });
      const second = await svc.createConversation(projectId, "alice", { title: "Second" });
      const indexPath = conversationIndexPath(projectDir);
      const validIndexBytes = readFileSync(indexPath, "utf-8");
      const originalFiles = conversationDataFiles(projectDir);
      const originalFileBytes = new Map(
        originalFiles.map((file) => [
          file,
          readFileSync(path.join(conversationDirectory(projectDir), file), "utf-8"),
        ]),
      );

      const corruptBytes = "NOT VALID JSON{{{";
      writeFileSync(indexPath, corruptBytes, "utf-8");
      const corruptInventory = readdirSync(conversationDirectory(projectDir)).sort();

      await expectPersistenceCorrupt(
        svc.listConversations(projectId, "alice"),
        "conversation_index",
        projectId,
      );
      await expectPersistenceCorrupt(
        svc.createConversation(projectId, "alice", { title: "Must not publish" }),
        "conversation_index",
        projectId,
      );
      await expectPersistenceCorrupt(
        svc.appendMessage(projectId, first.id, "alice", {
          role: "user",
          content: "Must not publish",
        }),
        "conversation_index",
        projectId,
      );

      expect(readFileSync(indexPath, "utf-8")).toBe(corruptBytes);
      expect(readdirSync(conversationDirectory(projectDir)).sort()).toEqual(corruptInventory);
      for (const [file, bytes] of originalFileBytes) {
        expect(readFileSync(path.join(conversationDirectory(projectDir), file), "utf-8")).toBe(bytes);
      }
      expect(conversationDataFiles(projectDir)).toEqual(originalFiles);
      expect(corruptInventory.some((file) => file.includes(".tmp.") || file.endsWith(".tmp"))).toBe(false);

      // Repair is deliberately external to the failed operation. A rejected
      // queue entry must not poison the next project mutation.
      writeFileSync(indexPath, validIndexBytes, "utf-8");
      const recovered = await svc.createConversation(projectId, "alice", { title: "Recovered" });
      const recoveredIds = (await svc.listConversations(projectId, "alice"))
        .map((conversation) => conversation.id);
      expect(recoveredIds).toEqual(expect.arrayContaining([first.id, second.id, recovered.id]));
      expect(recoveredIds).toHaveLength(3);
    });

    it.each([
      ["invalid root", () => []],
      ["missing conversations", (index: any) => ({ version: index.version })],
      ["non-array conversations", (index: any) => ({ ...index, conversations: {} })],
      ["unsupported version", (index: any) => ({ ...index, version: 99 })],
      ["structurally invalid record", (index: any) => ({
        ...index,
        conversations: [index.conversations[0], null],
      })],
      ["unsafe record ID", (index: any) => ({
        ...index,
        conversations: [
          { ...index.conversations[0], id: "../unsafe" },
          ...index.conversations.slice(1),
        ],
      })],
      ["unsafe file reference", (index: any) => ({
        ...index,
        conversations: [
          { ...index.conversations[0], file: "conversations/../unsafe.json" },
          ...index.conversations.slice(1),
        ],
      })],
      ["duplicate conversation ID", (index: any) => ({
        ...index,
        conversations: [
          index.conversations[0],
          { ...index.conversations[1], id: index.conversations[0].id },
        ],
      })],
      ["duplicate file reference", (index: any) => ({
        ...index,
        conversations: [
          index.conversations[0],
          { ...index.conversations[1], file: index.conversations[0].file },
        ],
      })],
    ] as Array<[string, (index: any) => unknown]>)(
      "rejects %s without retaining the valid subset",
      async (label, corrupt) => {
        const projectId = `proj-structural-${label.replaceAll(" ", "-")}`;
        const projectDir = scaffoldProject(root, projectId);
        await svc.createConversation(projectId, "alice", { title: "First" });
        await svc.createConversation(projectId, "alice", { title: "Second" });
        const indexPath = conversationIndexPath(projectDir);
        const index = JSON.parse(readFileSync(indexPath, "utf-8"));
        const corruptBytes = `${JSON.stringify(corrupt(structuredClone(index)), null, 2)}\n`;
        writeFileSync(indexPath, corruptBytes, "utf-8");

        await expectPersistenceCorrupt(
          svc.listConversations(projectId, "alice"),
          "conversation_index",
          projectId,
        );
        expect(readFileSync(indexPath, "utf-8")).toBe(corruptBytes);
      },
    );

    it("treats a missing index with conversation files as corruption", async () => {
      const projectId = "proj-missing-index-initialized";
      const projectDir = scaffoldProject(root, projectId);
      await svc.createConversation(projectId, "alice", { title: "Indexed" });
      const indexPath = conversationIndexPath(projectDir);
      rmSync(indexPath);
      const inventory = readdirSync(conversationDirectory(projectDir)).sort();

      await expectPersistenceCorrupt(
        svc.listConversations(projectId, "alice"),
        "conversation_index",
        projectId,
      );
      await expectPersistenceCorrupt(
        svc.createConversation(projectId, "alice", { title: "Must not strand existing data" }),
        "conversation_index",
        projectId,
      );
      expect(existsSync(indexPath)).toBe(false);
      expect(readdirSync(conversationDirectory(projectDir)).sort()).toEqual(inventory);
    });

    it("allows a genuinely uninitialized store and ignores expected image directories", async () => {
      const projectId = "proj-uninitialized";
      const projectDir = scaffoldProject(root, projectId);
      const conversationsDir = conversationDirectory(projectDir);
      mkdirSync(path.join(conversationsDir, "conv_actor_images", "images"), { recursive: true });

      await expect(svc.listConversations(projectId, "alice")).resolves.toEqual([]);
      const created = await svc.createConversation(projectId, "alice", { title: "Initialized" });
      expect(await svc.readConversation(projectId, created.id, "alice")).toMatchObject({
        id: created.id,
        title: "Initialized",
      });
      expect(existsSync(path.join(conversationsDir, "conv_actor_images", "images"))).toBe(true);
    });
  });

  describe("indexed conversation corruption", () => {
    it.each([
      ["missing file", "missing"],
      ["malformed JSON", "malformed"],
      ["invalid root shape", "invalid-root"],
      ["identity mismatch", "identity"],
      ["custody mismatch", "custody"],
    ] as const)(
      "fails closed for an authorized actor on %s while unauthorized actors still receive generic absence",
      async (_label, mode) => {
        const projectId = `proj-file-corrupt-${mode}`;
        const projectDir = scaffoldProject(root, projectId);
        const conversation = await svc.createConversation(projectId, "alice", { title: "Private" });
        const indexPath = conversationIndexPath(projectDir);
        const indexBytes = readFileSync(indexPath, "utf-8");
        const index = JSON.parse(indexBytes);
        const record = index.conversations.find((candidate: { id: string }) =>
          candidate.id === conversation.id
        );
        const filePath = path.join(projectDir, record.file);

        if (mode === "missing") {
          rmSync(filePath);
        } else if (mode === "malformed") {
          writeFileSync(filePath, "NOT VALID JSON{{{", "utf-8");
        } else if (mode === "invalid-root") {
          writeFileSync(filePath, "[]\n", "utf-8");
        } else {
          const stored = JSON.parse(readFileSync(filePath, "utf-8"));
          if (mode === "identity") stored.projectId = "another-project";
          if (mode === "custody") stored.ownerId = "bob";
          writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, "utf-8");
        }

        const inventory = readdirSync(conversationDirectory(projectDir)).sort();
        const corruptFileBytes = existsSync(filePath) ? readFileSync(filePath, "utf-8") : null;

        await expect(svc.readConversation(projectId, conversation.id, "bob")).resolves.toBeNull();
        await expect(svc.appendMessage(projectId, conversation.id, "bob", {
          role: "user",
          content: "Must remain unauthorized",
        })).resolves.toBeNull();

        await expectPersistenceCorrupt(
          svc.readConversation(projectId, conversation.id, "alice"),
          "conversation",
          projectId,
        );
        await expectPersistenceCorrupt(
          svc.appendMessage(projectId, conversation.id, "alice", {
            role: "user",
            content: "Must not publish",
          }),
          "conversation",
          projectId,
        );

        expect(readFileSync(indexPath, "utf-8")).toBe(indexBytes);
        expect(readdirSync(conversationDirectory(projectDir)).sort()).toEqual(inventory);
        if (corruptFileBytes === null) {
          expect(existsSync(filePath)).toBe(false);
        } else {
          expect(readFileSync(filePath, "utf-8")).toBe(corruptFileBytes);
        }
      },
    );
  });
});
