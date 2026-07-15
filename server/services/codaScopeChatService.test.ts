/* ── CodaScope: Chat Service Tests ────────────────────────────────────
   Unit tests for CodaScopeChatService.
   Exercises conversation CRUD, auto-titling, auto-summary,
   atomic writes (temp-file → rename), stale streaming detection,
   mutation queue serialization, and index management.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CodaScopeChatService } from "./codaScopeChatService.js";

/* ── Helpers ─────────────────────────────────────────────────────── */

function tmpRoot(): string {
  return path.join(
    process.cwd(),
    ".test-tmp",
    `chat-svc-${crypto.randomBytes(4).toString("hex")}`,
  );
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

    it("handles corrupted index gracefully", async () => {
      const projDir = scaffoldProject(root, "proj-corrupt");

      // Write corrupted index
      const convDir = path.join(projDir, "conversations");
      mkdirSync(convDir, { recursive: true });
      writeFileSync(
        path.join(convDir, "conversations.json"),
        "NOT VALID JSON{{{",
        "utf-8",
      );

      // Should return empty list, not crash
      const list = await svc.listConversations("proj-corrupt", "alice");
      expect(list).toEqual([]);
    });

    it("normalizes malformed index records", async () => {
      const projDir = scaffoldProject(root, "proj-malformed");

      // Write index with missing fields
      const convDir = path.join(projDir, "conversations");
      mkdirSync(convDir, { recursive: true });
      writeFileSync(
        path.join(convDir, "conversations.json"),
        JSON.stringify({
          version: 1,
          conversations: [
            { id: "conv_abc", file: "conversations/test.json" },
            { id: "", file: "" }, // invalid — should be filtered out
          ],
        }),
        "utf-8",
      );

      const list = await svc.listConversations("proj-malformed", "alice");
      // The syntactically valid record is ownerless, so ordinary users must
      // not receive its title or infer its existence.
      expect(list).toEqual([]);
    });
  });
});
