/* ── CodaScope: Epic Service Tests ────────────────────────────────────
   Unit tests for CodaScopeEpicService.
   Exercises CRUD, health computation, scope management, cascade delete,
   archive/restore, and lock delegation using a real temp filesystem.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CodaScopeEpicService } from "./codaScopeEpicService.js";

/* ── Helpers ─────────────────────────────────────────────────────── */

function tmpRoot(): string {
  return path.join(
    process.cwd(),
    ".test-tmp",
    `epic-svc-${crypto.randomBytes(4).toString("hex")}`,
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

describe("CodaScopeEpicService", () => {
  let root: string;
  let svc: CodaScopeEpicService;

  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(root, { recursive: true });
    svc = new CodaScopeEpicService(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── Epic CRUD ──────────────────────────────────────────────────

  describe("createEpic", () => {
    it("creates an epic with default values", async () => {
      scaffoldProject(root, "proj1");
      const epic = await svc.createEpic("proj1", { title: "Auth System" });

      expect(epic.id).toMatch(/^epic_/);
      expect(epic.title).toBe("Auth System");
      expect(epic.status).toBe("defining");
      expect(epic.createdBy).toBe("user");
      expect(epic.collaborators).toEqual(["user"]);
      expect(epic.currentVersion).toBe(0);
    });

    it("creates an epic with custom values", async () => {
      scaffoldProject(root, "proj2");
      const epic = await svc.createEpic("proj2", {
        title: "Payment Flow",
        createdBy: "agent",
        status: "curating",
      });

      expect(epic.status).toBe("curating");
      expect(epic.createdBy).toBe("agent");
      expect(epic.collaborators).toEqual(["agent"]);
    });

    it("creates on-disk directory structure", async () => {
      const projDir = scaffoldProject(root, "proj3");
      const epic = await svc.createEpic("proj3", { title: "Storage" });

      const epicDir = path.join(projDir, "epics", epic.id);
      expect(existsSync(epicDir)).toBe(true);
      expect(existsSync(path.join(epicDir, "epic.json"))).toBe(true);
      expect(existsSync(path.join(epicDir, "definition.md"))).toBe(true);
    });

    it("updates the epics index", async () => {
      const projDir = scaffoldProject(root, "proj4");
      await svc.createEpic("proj4", { title: "Epic A" });
      await svc.createEpic("proj4", { title: "Epic B" });

      const indexPath = path.join(projDir, "epics", "epics.json");
      expect(existsSync(indexPath)).toBe(true);
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      expect(index.epics).toHaveLength(2);
    });

    it("throws when project not found", async () => {
      await expect(
        svc.createEpic("nonexistent", { title: "Test" }),
      ).rejects.toThrow("Project not found");
    });
  });

  describe("getEpic", () => {
    it("returns full epic detail", async () => {
      scaffoldProject(root, "proj-get");
      const created = await svc.createEpic("proj-get", { title: "My Epic" });

      const detail = await svc.getEpic("proj-get", created.id);
      expect(detail).not.toBeNull();
      expect(detail!.title).toBe("My Epic");
      expect(detail!.definition).toBe("");
      expect(detail!.scope).toBeNull();
      expect(detail!.designDocs).toEqual([]);
      expect(detail!.versions).toEqual([]);
    });

    it("returns null for nonexistent epic", async () => {
      scaffoldProject(root, "proj-get2");
      const result = await svc.getEpic("proj-get2", "nonexistent");
      expect(result).toBeNull();
    });

    it("returns null for nonexistent project", async () => {
      const result = await svc.getEpic("nonexistent", "epic1");
      expect(result).toBeNull();
    });
  });

  describe("listEpics", () => {
    it("lists all epics with computed health", async () => {
      scaffoldProject(root, "proj-list");
      await svc.createEpic("proj-list", { title: "Epic A" });
      await svc.createEpic("proj-list", { title: "Epic B" });
      await svc.createEpic("proj-list", { title: "Epic C" });

      const epics = await svc.listEpics("proj-list");
      expect(epics).toHaveLength(3);
      // Each should have a health field
      for (const e of epics) {
        expect(e.health).toBeDefined();
        expect(e.health.health).toBeDefined();
        expect(e.health.reason).toBeDefined();
      }
    });

    it("returns empty array for project with no epics", async () => {
      scaffoldProject(root, "proj-empty");
      const epics = await svc.listEpics("proj-empty");
      expect(epics).toEqual([]);
    });

    it("returns empty array for nonexistent project", async () => {
      const epics = await svc.listEpics("nonexistent");
      expect(epics).toEqual([]);
    });
  });

  describe("updateEpic", () => {
    it("updates title and status", async () => {
      scaffoldProject(root, "proj-upd");
      const created = await svc.createEpic("proj-upd", { title: "Old Title" });

      const updated = await svc.updateEpic("proj-upd", created.id, {
        title: "New Title",
        status: "curating",
      });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe("New Title");
      expect(updated!.status).toBe("curating");
    });

    it("updates collaborators", async () => {
      scaffoldProject(root, "proj-upd2");
      const created = await svc.createEpic("proj-upd2", { title: "Collab" });

      const updated = await svc.updateEpic("proj-upd2", created.id, {
        collaborators: ["user", "agent", "reviewer"],
      });

      expect(updated!.collaborators).toEqual(["user", "agent", "reviewer"]);
    });

    it("returns null for nonexistent epic", async () => {
      scaffoldProject(root, "proj-upd3");
      const result = await svc.updateEpic("proj-upd3", "nonexistent", { title: "X" });
      expect(result).toBeNull();
    });

    it("syncs index after update", async () => {
      const projDir = scaffoldProject(root, "proj-upd4");
      const created = await svc.createEpic("proj-upd4", { title: "Before" });
      await svc.updateEpic("proj-upd4", created.id, { title: "After" });

      const indexPath = path.join(projDir, "epics", "epics.json");
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      const entry = index.epics.find((e: any) => e.id === created.id);
      expect(entry.title).toBe("After");
    });
  });

  describe("deleteEpic", () => {
    it("removes epic directory and index entry", async () => {
      const projDir = scaffoldProject(root, "proj-del");
      const epic = await svc.createEpic("proj-del", { title: "Deletable" });

      const epicDir = path.join(projDir, "epics", epic.id);
      expect(existsSync(epicDir)).toBe(true);

      const result = await svc.deleteEpic("proj-del", epic.id);
      expect(result).toBe(true);
      expect(existsSync(epicDir)).toBe(false);

      const epics = await svc.listEpics("proj-del");
      expect(epics).toHaveLength(0);
    });

    it("returns false for nonexistent epic", async () => {
      scaffoldProject(root, "proj-del2");
      const result = await svc.deleteEpic("proj-del2", "nonexistent");
      expect(result).toBe(false);
    });

    it("returns false for nonexistent project", async () => {
      const result = await svc.deleteEpic("nonexistent", "epic1");
      expect(result).toBe(false);
    });
  });

  // ── Archive / Restore ─────────────────────────────────────────

  describe("archive / restore", () => {
    it("archives an epic by moving to _archive directory", async () => {
      const projDir = scaffoldProject(root, "proj-arch");
      const epic = await svc.createEpic("proj-arch", { title: "Archivable" });

      const result = await svc.archiveEpic("proj-arch", epic.id);
      expect(result).toBe(true);

      // Should be in _archive
      const archivedDir = path.join(projDir, "epics", "_archive", epic.id);
      expect(existsSync(archivedDir)).toBe(true);

      // Should NOT be in active epics
      const activeDir = path.join(projDir, "epics", epic.id);
      expect(existsSync(activeDir)).toBe(false);

      // Index should be empty
      const epics = await svc.listEpics("proj-arch");
      expect(epics).toHaveLength(0);
    });

    it("restores an archived epic back to active", async () => {
      scaffoldProject(root, "proj-restore");
      const epic = await svc.createEpic("proj-restore", { title: "Restorable" });

      await svc.archiveEpic("proj-restore", epic.id);
      const restored = await svc.restoreEpic("proj-restore", epic.id);

      expect(restored).not.toBeNull();
      expect(restored!.title).toBe("Restorable");
      expect(restored!.status).toBe("defining"); // Reset from "archived"

      const epics = await svc.listEpics("proj-restore");
      expect(epics).toHaveLength(1);
    });

    it("lists archived epics", async () => {
      scaffoldProject(root, "proj-arch-list");
      const a = await svc.createEpic("proj-arch-list", { title: "Archived A" });
      const b = await svc.createEpic("proj-arch-list", { title: "Archived B" });

      await svc.archiveEpic("proj-arch-list", a.id);
      await svc.archiveEpic("proj-arch-list", b.id);

      const archived = await svc.listArchivedEpics("proj-arch-list");
      expect(archived).toHaveLength(2);
    });

    it("returns false when archiving nonexistent epic", async () => {
      scaffoldProject(root, "proj-arch2");
      const result = await svc.archiveEpic("proj-arch2", "nonexistent");
      expect(result).toBe(false);
    });

    it("returns null when restoring nonexistent archived epic", async () => {
      scaffoldProject(root, "proj-restore2");
      const result = await svc.restoreEpic("proj-restore2", "nonexistent");
      expect(result).toBeNull();
    });
  });

  // ── Definition (Markdown I/O) ─────────────────────────────────

  describe("definition", () => {
    it("reads and writes definition content", async () => {
      scaffoldProject(root, "proj-def");
      const epic = await svc.createEpic("proj-def", { title: "Def Test" });

      // Initially empty
      const initial = await svc.getDefinition("proj-def", epic.id);
      expect(initial).toBe("");

      // Update definition
      const content = "# Auth System\n\nBuild a secure auth flow.";
      const result = await svc.updateDefinition("proj-def", epic.id, content);
      expect(result).toBe(true);

      // Read back
      const updated = await svc.getDefinition("proj-def", epic.id);
      expect(updated).toBe(content);
    });

    it("touches updatedAt on definition change", async () => {
      scaffoldProject(root, "proj-def2");
      const epic = await svc.createEpic("proj-def2", { title: "Timestamp" });
      const originalUpdatedAt = epic.updatedAt;

      // Wait a tick to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));

      await svc.updateDefinition("proj-def2", epic.id, "Updated content.");

      const detail = await svc.getEpic("proj-def2", epic.id);
      expect(detail!.updatedAt).not.toBe(originalUpdatedAt);
    });

    it("returns null for nonexistent epic", async () => {
      scaffoldProject(root, "proj-def3");
      const result = await svc.getDefinition("proj-def3", "nonexistent");
      expect(result).toBeNull();
    });

    it("returns false when updating nonexistent epic", async () => {
      scaffoldProject(root, "proj-def4");
      const result = await svc.updateDefinition("proj-def4", "nonexistent", "Content");
      expect(result).toBe(false);
    });
  });

  // ── Health Computation ────────────────────────────────────────

  describe("computeHealth", () => {
    it("returns 'active' for recently updated epic", () => {
      const health = svc.computeHealth({
        id: "e1",
        projectId: "p1",
        title: "Test",
        status: "defining",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: "user",
        collaborators: ["user"],
        currentVersion: 0,
      });

      expect(health.health).toBe("active");
      expect(health.reason).toBe("Recently updated");
    });

    it("returns 'hot' for multi-collaborator recent activity", () => {
      const health = svc.computeHealth({
        id: "e2",
        projectId: "p1",
        title: "Test",
        status: "defining",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), // just now
        createdBy: "user",
        collaborators: ["user", "agent"],
        currentVersion: 0,
      });

      expect(health.health).toBe("hot");
    });

    it("returns 'stale' for 7+ days without edits", () => {
      const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const health = svc.computeHealth({
        id: "e3",
        projectId: "p1",
        title: "Test",
        status: "defining",
        createdAt: staleDate,
        updatedAt: staleDate,
        createdBy: "user",
        collaborators: ["user"],
        currentVersion: 0,
      });

      expect(health.health).toBe("stale");
    });

    it("returns 'blocked' for >5 open annotations and >3 days inactive", () => {
      const oldDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
      const health = svc.computeHealth(
        {
          id: "e4",
          projectId: "p1",
          title: "Test",
          status: "defining",
          createdAt: oldDate,
          updatedAt: oldDate,
          createdBy: "user",
          collaborators: ["user"],
          currentVersion: 0,
        },
        8, // 8 open annotations
      );

      expect(health.health).toBe("blocked");
    });
  });

  // ── Scope Management ──────────────────────────────────────────

  describe("scope", () => {
    it("initially returns null scope", async () => {
      scaffoldProject(root, "proj-scope");
      const epic = await svc.createEpic("proj-scope", { title: "Scoped" });

      const scope = await svc.getScope("proj-scope", epic.id);
      expect(scope).toBeNull();
    });

    it("sets and retrieves a full scope", async () => {
      scaffoldProject(root, "proj-scope2");
      const epic = await svc.createEpic("proj-scope2", { title: "Scoped" });

      const scope = {
        entries: [
          {
            topicId: "auth-flow",
            topicTitle: "Auth Flow",
            type: "existing-wiki" as const,
            included: true,
            source: "agent" as const,
            targetDepth: "developed" as const,
          },
        ],
        lastScopedAt: new Date().toISOString(),
        lastScopedBy: "agent" as const,
      };

      const result = await svc.setScope("proj-scope2", epic.id, scope);
      expect(result).toBe(true);

      const retrieved = await svc.getScope("proj-scope2", epic.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.entries).toHaveLength(1);
      expect(retrieved!.entries[0].topicId).toBe("auth-flow");
    });

    it("adds a scope entry", async () => {
      scaffoldProject(root, "proj-scope3");
      const epic = await svc.createEpic("proj-scope3", { title: "Add Entry" });

      const entry = {
        topicId: "data-model",
        topicTitle: "Data Model",
        type: "existing-wiki" as const,
        included: true,
        source: "user" as const,
        targetDepth: "outline" as const,
      };

      const added = await svc.addScopeEntry("proj-scope3", epic.id, entry);
      expect(added).toBe(true);

      const scope = await svc.getScope("proj-scope3", epic.id);
      expect(scope!.entries).toHaveLength(1);
    });

    it("prevents duplicate scope entries", async () => {
      scaffoldProject(root, "proj-scope4");
      const epic = await svc.createEpic("proj-scope4", { title: "Dedup" });

      const entry = {
        topicId: "api-design",
        topicTitle: "API Design",
        type: "new" as const,
        included: true,
        source: "agent" as const,
        targetDepth: "stub" as const,
      };

      await svc.addScopeEntry("proj-scope4", epic.id, entry);
      const secondAdd = await svc.addScopeEntry("proj-scope4", epic.id, entry);
      expect(secondAdd).toBe(false);

      const scope = await svc.getScope("proj-scope4", epic.id);
      expect(scope!.entries).toHaveLength(1);
    });

    it("removes a scope entry", async () => {
      scaffoldProject(root, "proj-scope5");
      const epic = await svc.createEpic("proj-scope5", { title: "Remove" });

      await svc.addScopeEntry("proj-scope5", epic.id, {
        topicId: "removable",
        topicTitle: "Removable",
        type: "new" as const,
        included: true,
        source: "user" as const,
        targetDepth: "stub" as const,
      });

      const removed = await svc.removeScopeEntry("proj-scope5", epic.id, "removable");
      expect(removed).toBe(true);

      const scope = await svc.getScope("proj-scope5", epic.id);
      expect(scope!.entries).toHaveLength(0);
    });

    it("returns false when removing nonexistent entry", async () => {
      scaffoldProject(root, "proj-scope6");
      const epic = await svc.createEpic("proj-scope6", { title: "No Remove" });

      const result = await svc.removeScopeEntry("proj-scope6", epic.id, "nonexistent");
      expect(result).toBe(false);
    });

    it("updates a scope entry", async () => {
      scaffoldProject(root, "proj-scope7");
      const epic = await svc.createEpic("proj-scope7", { title: "Update Entry" });

      await svc.addScopeEntry("proj-scope7", epic.id, {
        topicId: "updatable",
        topicTitle: "Updatable",
        type: "existing-wiki" as const,
        included: true,
        source: "user" as const,
        targetDepth: "stub" as const,
      });

      const updated = await svc.updateScopeEntry("proj-scope7", epic.id, "updatable", {
        targetDepth: "comprehensive" as const,
        included: false,
      });

      expect(updated).not.toBeNull();
      expect(updated!.targetDepth).toBe("comprehensive");
      expect(updated!.included).toBe(false);
    });

    it("applies a scope diff with additions and removals", async () => {
      scaffoldProject(root, "proj-scope8");
      const epic = await svc.createEpic("proj-scope8", { title: "Diff" });

      // Set initial scope with one entry
      await svc.addScopeEntry("proj-scope8", epic.id, {
        topicId: "existing-topic",
        topicTitle: "Existing Topic",
        type: "existing-wiki" as const,
        included: true,
        source: "user" as const,
        targetDepth: "stub" as const,
      });

      const fullDiff = {
        added: [
          {
            topicId: "new-topic",
            topicTitle: "New Topic",
            type: "new" as const,
            included: true,
            source: "agent" as const,
            targetDepth: "outline" as const,
          },
        ],
        removed: ["existing-topic"],
        changed: [],
        unchanged: [],
      };

      const result = await svc.applyScopeDiff(
        "proj-scope8",
        epic.id,
        {
          addedTopicIds: ["new-topic"],
          removedTopicIds: ["existing-topic"],
          changedTopicIds: [],
        },
        fullDiff,
      );

      expect(result).not.toBeNull();
      expect(result!.entries).toHaveLength(1);
      expect(result!.entries[0].topicId).toBe("new-topic");
      expect(result!.lastScopedBy).toBe("agent");
    });
  });

  // ── Lock Delegation ──────────────────────────────────────────

  describe("lock delegation", () => {
    it("acquires and releases a lock via the delegated lock service", async () => {
      const projDir = scaffoldProject(root, "proj-lock");
      const epic = await svc.createEpic("proj-lock", { title: "Locked" });

      // Acquire
      const lock = await svc.acquireLock("proj-lock", epic.id, {
        documentId: "definition",
        lockedBy: "user",
      });
      expect("error" in lock).toBe(false);
      expect((lock as any).lockedBy).toBe("user");

      // Check status
      const status = await svc.getLockStatus("proj-lock", epic.id);
      expect(status).toHaveLength(1);

      // Release
      const released = await svc.releaseLock("proj-lock", epic.id, "definition", "user");
      expect(released).toBe(true);

      // Status should be empty
      const after = await svc.getLockStatus("proj-lock", epic.id);
      expect(after).toHaveLength(0);
    });

    it("denies lock when held by another user", async () => {
      scaffoldProject(root, "proj-lock2");
      const epic = await svc.createEpic("proj-lock2", { title: "Contested" });

      await svc.acquireLock("proj-lock2", epic.id, {
        documentId: "definition",
        lockedBy: "user-a",
      });

      const denied = await svc.acquireLock("proj-lock2", epic.id, {
        documentId: "definition",
        lockedBy: "user-b",
      });

      expect("error" in denied).toBe(true);
    });

    it("does not let another user release a held lock", async () => {
      scaffoldProject(root, "proj-lock-release");
      const epic = await svc.createEpic("proj-lock-release", { title: "Release boundary" });
      await svc.acquireLock("proj-lock-release", epic.id, {
        documentId: "definition",
        lockedBy: "user-a",
      });

      expect(await svc.releaseLock("proj-lock-release", epic.id, "definition", "user-b")).toBe(false);
      expect(await svc.getLockStatus("proj-lock-release", epic.id)).toMatchObject([
        { documentId: "definition", lockedBy: "user-a" },
      ]);
    });

    it("heartbeat refreshes lock TTL", async () => {
      scaffoldProject(root, "proj-lock3");
      const epic = await svc.createEpic("proj-lock3", { title: "Heartbeat" });

      await svc.acquireLock("proj-lock3", epic.id, {
        documentId: "definition",
        lockedBy: "user",
      });

      const refreshed = await svc.heartbeatLock("proj-lock3", epic.id, "definition", "user");
      expect(refreshed).not.toBeNull();
      expect(refreshed!.lockedBy).toBe("user");
    });

    it("heartbeat returns null for nonexistent lock", async () => {
      scaffoldProject(root, "proj-lock4");
      const epic = await svc.createEpic("proj-lock4", { title: "No Lock" });

      const result = await svc.heartbeatLock("proj-lock4", epic.id, "definition", "user");
      expect(result).toBeNull();
    });

    it("detects human lock (not agent)", async () => {
      scaffoldProject(root, "proj-lock5");
      const epic = await svc.createEpic("proj-lock5", { title: "Human Lock" });

      // Human lock
      await svc.acquireLock("proj-lock5", epic.id, {
        documentId: "definition",
        lockedBy: "user",
      });

      const humanLock = await svc.isDocumentLockedByHuman("proj-lock5", epic.id, "definition");
      expect(humanLock).not.toBeNull();
    });

    it("agent locks are transparent to isDocumentLockedByHuman", async () => {
      scaffoldProject(root, "proj-lock6");
      const epic = await svc.createEpic("proj-lock6", { title: "Agent Lock" });

      await svc.acquireLock("proj-lock6", epic.id, {
        documentId: "definition",
        lockedBy: "agent_chat",
      });

      const humanLock = await svc.isDocumentLockedByHuman("proj-lock6", epic.id, "definition");
      expect(humanLock).toBeNull();
    });
  });

  // ── Cascade Delete ────────────────────────────────────────────

  describe("cascade delete", () => {
    it("deletes epic and all nested data", async () => {
      const projDir = scaffoldProject(root, "proj-cascade");
      const epic = await svc.createEpic("proj-cascade", { title: "With Data" });

      // Write definition content
      await svc.updateDefinition("proj-cascade", epic.id, "# Test\n\nSome content.");

      // Add scope
      await svc.addScopeEntry("proj-cascade", epic.id, {
        topicId: "topic-a",
        topicTitle: "Topic A",
        type: "new" as const,
        included: true,
        source: "user" as const,
        targetDepth: "stub" as const,
      });

      // Write a lock file
      await svc.acquireLock("proj-cascade", epic.id, {
        documentId: "definition",
        lockedBy: "user",
      });

      const epicDir = path.join(projDir, "epics", epic.id);
      expect(existsSync(epicDir)).toBe(true);

      // Delete
      const deleted = await svc.deleteEpic("proj-cascade", epic.id);
      expect(deleted).toBe(true);

      // Everything is gone
      expect(existsSync(epicDir)).toBe(false);

      // Index is clean
      const epics = await svc.listEpics("proj-cascade");
      expect(epics).toHaveLength(0);
    });
  });
});
