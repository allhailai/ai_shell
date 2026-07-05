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
      const conv = await svc.createConversation("proj1");

      expect(conv.id).toMatch(/^conv_/);
      expect(conv.title).toBe("New conversation");
      expect(conv.projectId).toBe("proj1");
      expect(conv.messages).toEqual([]);
      expect(conv.version).toBe(1);
    });

    it("creates a conversation with custom title and model", async () => {
      scaffoldProject(root, "proj2");
      const conv = await svc.createConversation("proj2", {
        title: "Auth Discussion",
        modelId: "gpt-4",
      });

      expect(conv.title).toBe("Auth Discussion");
      expect(conv.defaultModelId).toBe("gpt-4");
    });

    it("creates an epic-scoped conversation", async () => {
      scaffoldProject(root, "proj3");
      const conv = await svc.createConversation("proj3", {
        title: "Epic: Auth Flow",
        epicId: "epic_abc",
      });

      expect(conv.epicId).toBe("epic_abc");
    });

    it("creates the conversation file on disk", async () => {
      const projDir = scaffoldProject(root, "proj4");
      const conv = await svc.createConversation("proj4", { title: "Persistent" });

      // Check that conversation file exists
      const convDir = path.join(projDir, "conversations");
      expect(existsSync(convDir)).toBe(true);
      const files = readdirSync(convDir).filter((f) => f.endsWith(".json") && f !== "conversations.json");
      expect(files.length).toBeGreaterThanOrEqual(1);
    });

    it("updates the index", async () => {
      const projDir = scaffoldProject(root, "proj5");
      await svc.createConversation("proj5", { title: "Conv A" });
      await svc.createConversation("proj5", { title: "Conv B" });

      const indexPath = path.join(projDir, "conversations", "conversations.json");
      expect(existsSync(indexPath)).toBe(true);
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      expect(index.conversations).toHaveLength(2);
    });

    it("throws when project not found", async () => {
      await expect(
        svc.createConversation("nonexistent"),
      ).rejects.toThrow("Project not found");
    });
  });

  // ── Read ──────────────────────────────────────────────────────

  describe("readConversation", () => {
    it("reads a created conversation with full messages", async () => {
      scaffoldProject(root, "proj-read");
      const created = await svc.createConversation("proj-read", { title: "Readable" });

      const read = await svc.readConversation("proj-read", created.id);
      expect(read).not.toBeNull();
      expect(read!.id).toBe(created.id);
      expect(read!.title).toBe("Readable");
    });

    it("returns null for nonexistent conversation", async () => {
      scaffoldProject(root, "proj-read2");
      const result = await svc.readConversation("proj-read2", "nonexistent");
      expect(result).toBeNull();
    });

    it("returns null for nonexistent project", async () => {
      const result = await svc.readConversation("nonexistent", "conv1");
      expect(result).toBeNull();
    });
  });

  // ── List ──────────────────────────────────────────────────────

  describe("listConversations", () => {
    it("lists all conversations sorted by updatedAt desc", async () => {
      scaffoldProject(root, "proj-list");
      const a = await svc.createConversation("proj-list", { title: "First" });
      await new Promise((r) => setTimeout(r, 10));
      const b = await svc.createConversation("proj-list", { title: "Second" });

      const list = await svc.listConversations("proj-list");
      expect(list).toHaveLength(2);
      // Second created should be first (more recent)
      expect(list[0].title).toBe("Second");
      expect(list[1].title).toBe("First");
    });

    it("returns empty array for project with no conversations", async () => {
      scaffoldProject(root, "proj-empty");
      const list = await svc.listConversations("proj-empty");
      expect(list).toEqual([]);
    });

    it("returns empty array for nonexistent project", async () => {
      const list = await svc.listConversations("nonexistent");
      expect(list).toEqual([]);
    });
  });

  // ── Update ────────────────────────────────────────────────────

  describe("updateConversation", () => {
    it("updates title and summary", async () => {
      scaffoldProject(root, "proj-upd");
      const conv = await svc.createConversation("proj-upd", { title: "Old" });

      const updated = await svc.updateConversation("proj-upd", conv.id, {
        title: "New Title",
        summary: "A brief summary.",
      });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe("New Title");
      expect(updated!.summary).toBe("A brief summary.");
    });

    it("returns null for nonexistent conversation", async () => {
      scaffoldProject(root, "proj-upd2");
      const result = await svc.updateConversation("proj-upd2", "nonexistent", { title: "X" });
      expect(result).toBeNull();
    });

    it("syncs index after update", async () => {
      scaffoldProject(root, "proj-upd3");
      const conv = await svc.createConversation("proj-upd3", { title: "Before" });
      await svc.updateConversation("proj-upd3", conv.id, { title: "After" });

      const list = await svc.listConversations("proj-upd3");
      expect(list[0].title).toBe("After");
    });
  });

  // ── Delete ────────────────────────────────────────────────────

  describe("deleteConversation", () => {
    it("deletes a conversation and removes from index", async () => {
      scaffoldProject(root, "proj-del");
      const conv = await svc.createConversation("proj-del", { title: "Deletable" });

      const result = await svc.deleteConversation("proj-del", conv.id);
      expect(result).toBe(true);

      const list = await svc.listConversations("proj-del");
      expect(list).toHaveLength(0);
    });

    it("returns false for nonexistent conversation", async () => {
      scaffoldProject(root, "proj-del2");
      const result = await svc.deleteConversation("proj-del2", "nonexistent");
      expect(result).toBe(false);
    });

    it("deletes the conversation file from disk", async () => {
      const projDir = scaffoldProject(root, "proj-del3");
      const conv = await svc.createConversation("proj-del3", { title: "File Delete" });

      await svc.deleteConversation("proj-del3", conv.id);

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
      const conv = await svc.createConversation("proj-msg");

      const updated = await svc.appendMessage("proj-msg", conv.id, {
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
      const conv = await svc.createConversation("proj-autotitle");
      expect(conv.title).toBe("New conversation");

      const updated = await svc.appendMessage("proj-autotitle", conv.id, {
        role: "user",
        content: "Explain the authentication flow in detail",
      });

      expect(updated!.title).toBe("Explain the authentication flow in detail");
    });

    it("does not re-title on subsequent user messages", async () => {
      scaffoldProject(root, "proj-notitle");
      const conv = await svc.createConversation("proj-notitle");

      const after1 = await svc.appendMessage("proj-notitle", conv.id, {
        role: "user",
        content: "First question",
      });
      expect(after1!.title).toBe("First question");

      const after2 = await svc.appendMessage("proj-notitle", conv.id, {
        role: "user",
        content: "Second question which is different",
      });
      expect(after2!.title).toBe("First question"); // unchanged
    });

    it("auto-summarizes from first assistant response", async () => {
      scaffoldProject(root, "proj-autosum");
      const conv = await svc.createConversation("proj-autosum");

      await svc.appendMessage("proj-autosum", conv.id, {
        role: "user",
        content: "Question",
      });

      const updated = await svc.appendMessage("proj-autosum", conv.id, {
        role: "assistant",
        content: "The auth flow uses **JWT tokens** with refresh capability and session management.",
        modelId: "claude-3",
      });

      expect(updated!.summary).toBeTruthy();
      expect(updated!.summary.length).toBeGreaterThan(0);
    });

    it("message gets normalized with defaults", async () => {
      scaffoldProject(root, "proj-norm");
      const conv = await svc.createConversation("proj-norm");

      const updated = await svc.appendMessage("proj-norm", conv.id, {
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
      const result = await svc.appendMessage("proj-msg2", "nonexistent", {
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
      const conv = await svc.createConversation("proj-stale");

      // Append a message that appears to be streaming from >10 min ago
      const staleTime = new Date(Date.now() - 11 * 60 * 1000).toISOString();
      const updated = await svc.appendMessage("proj-stale", conv.id, {
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
      const conv = await svc.createConversation("proj-fresh");

      const updated = await svc.appendMessage("proj-fresh", conv.id, {
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
      const conv = await svc.createConversation("proj-stale-read");

      // Append a normal message first
      await svc.appendMessage("proj-stale-read", conv.id, {
        role: "user",
        content: "Question",
      });

      // Manually write a stale streaming message to the file
      const read = await svc.readConversation("proj-stale-read", conv.id);
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

      await svc.writeConversation("proj-stale-read", next);

      // Re-read — stale detection should fire during normalization
      const reread = await svc.readConversation("proj-stale-read", conv.id);
      const staleMsg = reread!.messages.find((m) => m.id === "msg_stale_test");
      expect(staleMsg).toBeDefined();
      expect(staleMsg!.status).toBe("error");
    });
  });

  // ── writeConversation (full atomic write) ─────────────────────

  describe("writeConversation", () => {
    it("writes a full conversation atomically", async () => {
      scaffoldProject(root, "proj-write");
      const conv = await svc.createConversation("proj-write");

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

      const result = await svc.writeConversation("proj-write", updated);
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(1);
    });

    it("returns null for nonexistent conversation", async () => {
      scaffoldProject(root, "proj-write2");
      const result = await svc.writeConversation("proj-write2", {
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
      const conv = await svc.createConversation("proj-clean");

      await svc.writeConversation("proj-clean", {
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
      const result = await svc.getConversationForEpic("proj-epic", "epic_123");
      expect(result).toBeNull();
    });

    it("getOrCreateEpicConversation creates on first call", async () => {
      scaffoldProject(root, "proj-epic2");
      const conv = await svc.getOrCreateEpicConversation("proj-epic2", "epic_abc", "Auth Flow");
      expect(conv.epicId).toBe("epic_abc");
      expect(conv.title).toBe("Epic: Auth Flow");
    });

    it("getOrCreateEpicConversation returns existing on second call", async () => {
      scaffoldProject(root, "proj-epic3");
      const first = await svc.getOrCreateEpicConversation("proj-epic3", "epic_def", "Payment");
      const second = await svc.getOrCreateEpicConversation("proj-epic3", "epic_def", "Payment");
      expect(second.id).toBe(first.id);
    });
  });

  // ── Mutation Queue ────────────────────────────────────────────

  describe("mutation queue", () => {
    it("serializes concurrent writes to the same project", async () => {
      scaffoldProject(root, "proj-queue");
      const conv = await svc.createConversation("proj-queue", { title: "Queue Test" });

      // Fire 5 concurrent appends
      const promises = Array.from({ length: 5 }, (_, i) =>
        svc.appendMessage("proj-queue", conv.id, {
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
      const final = await svc.readConversation("proj-queue", conv.id);
      expect(final!.messages).toHaveLength(5);
    });

    it("independent projects don't block each other", async () => {
      scaffoldProject(root, "proj-q1");
      scaffoldProject(root, "proj-q2");

      const conv1 = await svc.createConversation("proj-q1");
      const conv2 = await svc.createConversation("proj-q2");

      const [r1, r2] = await Promise.all([
        svc.appendMessage("proj-q1", conv1.id, { role: "user", content: "A" }),
        svc.appendMessage("proj-q2", conv2.id, { role: "user", content: "B" }),
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
        await svc.createConversation("proj-cap", { title: `Conv ${i}` });
      }

      const list = await svc.listConversations("proj-cap");
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
      const list = await svc.listConversations("proj-corrupt");
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

      const list = await svc.listConversations("proj-malformed");
      // Only the valid record should survive normalization
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe("conv_abc");
    });
  });
});
