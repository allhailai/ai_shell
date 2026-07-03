/* ── CodaScope: Version Service Tests ────────────────────────────────
   Unit tests for CodaScopeVersionService.
   Exercises createVersion, listVersions, getVersion, diffVersions,
   and version status management using a real temp filesystem.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CodaScopeVersionService } from "./codaScopeVersionService.js";

/* ── Helpers ─────────────────────────────────────────────────────── */

function tmpRoot(): string {
  return path.join(
    process.cwd(),
    ".test-tmp",
    `version-svc-${crypto.randomBytes(4).toString("hex")}`,
  );
}

/** Scaffold a minimal project + epic directory the service can discover. */
function scaffoldProject(
  root: string,
  projectId: string,
  epicId: string,
  opts?: { definition?: string; scope?: string },
): string {
  const projectDir = path.join(root, `project-${projectId}`);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    path.join(projectDir, "project.json"),
    JSON.stringify({ id: projectId, name: "Test Project" }),
    "utf-8",
  );

  const epicDir = path.join(projectDir, "epics", epicId);
  mkdirSync(epicDir, { recursive: true });
  writeFileSync(
    path.join(epicDir, "epic.json"),
    JSON.stringify({ id: epicId, name: "Test Epic", currentVersion: 0 }),
    "utf-8",
  );

  writeFileSync(
    path.join(epicDir, "definition.md"),
    opts?.definition ?? "# Epic Definition\n\nInitial content.",
    "utf-8",
  );
  writeFileSync(
    path.join(epicDir, "scope.json"),
    opts?.scope ?? JSON.stringify({ entries: [] }),
    "utf-8",
  );

  return projectDir;
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe("CodaScopeVersionService", () => {
  let root: string;
  let svc: CodaScopeVersionService;

  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(root, { recursive: true });
    svc = new CodaScopeVersionService(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── createVersion ───────────────────────────────────────────────

  describe("createVersion", () => {
    it("creates a version snapshot with definition and scope", async () => {
      const projectId = "proj1";
      const epicId = "epic1";
      scaffoldProject(root, projectId, epicId, {
        definition: "# My Epic\n\nThis is the definition.",
      });

      const version = await svc.createVersion(projectId, epicId, {
        createdBy: "user",
        label: "Initial",
      });

      expect(version.version).toBe(1);
      expect(version.createdBy).toBe("user");
      expect(version.label).toBe("Initial");
      expect(version.status).toBe("draft");
      expect(version.definitionHash).toBeTruthy();
      expect(version.scopeHash).toBeTruthy();
    });

    it("increments version numbers sequentially", async () => {
      const projectId = "proj2";
      const epicId = "epic2";
      scaffoldProject(root, projectId, epicId);

      const v1 = await svc.createVersion(projectId, epicId, { createdBy: "user" });
      const v2 = await svc.createVersion(projectId, epicId, { createdBy: "user" });
      const v3 = await svc.createVersion(projectId, epicId, { createdBy: "user" });

      expect(v1.version).toBe(1);
      expect(v2.version).toBe(2);
      expect(v3.version).toBe(3);
    });

    it("marks previous draft versions as superseded", async () => {
      const projectId = "proj3";
      const epicId = "epic3";
      scaffoldProject(root, projectId, epicId);

      await svc.createVersion(projectId, epicId, { createdBy: "user" });
      await svc.createVersion(projectId, epicId, { createdBy: "user" });

      const versions = await svc.listVersions(projectId, epicId);
      expect(versions[0].status).toBe("superseded");
      expect(versions[1].status).toBe("draft");
    });

    it("copies design doc files into the snapshot", async () => {
      const projectId = "proj4";
      const epicId = "epic4";
      const projDir = scaffoldProject(root, projectId, epicId);

      // Add a design doc to the epic
      const designsDir = path.join(projDir, "epics", epicId, "designs");
      mkdirSync(designsDir, { recursive: true });
      writeFileSync(path.join(designsDir, "doc1.md"), "# Design Doc 1\n\nContent here.", "utf-8");

      const version = await svc.createVersion(projectId, epicId, { createdBy: "agent" });

      expect(version.designDocHashes).toHaveProperty("doc1");
      expect(version.designDocHashes["doc1"]).toBeTruthy();
    });

    it("throws when project not found", async () => {
      await expect(
        svc.createVersion("nonexistent", "epic1", { createdBy: "user" }),
      ).rejects.toThrow("Project not found");
    });

    it("throws when epic not found", async () => {
      scaffoldProject(root, "proj5", "epic5");
      await expect(
        svc.createVersion("proj5", "nonexistent-epic", { createdBy: "user" }),
      ).rejects.toThrow("Epic not found");
    });

    it("updates epic.json currentVersion", async () => {
      const projectId = "proj6";
      const epicId = "epic6";
      const projDir = scaffoldProject(root, projectId, epicId);

      await svc.createVersion(projectId, epicId, { createdBy: "user" });

      const epicMeta = JSON.parse(
        readFileSync(path.join(projDir, "epics", epicId, "epic.json"), "utf-8"),
      );
      expect(epicMeta.currentVersion).toBe(1);
    });
  });

  // ── listVersions ──────────────────────────────────────────────

  describe("listVersions", () => {
    it("returns versions in creation order", async () => {
      const projectId = "proj-list";
      const epicId = "epic-list";
      scaffoldProject(root, projectId, epicId);

      await svc.createVersion(projectId, epicId, { createdBy: "user", label: "v1" });
      await svc.createVersion(projectId, epicId, { createdBy: "user", label: "v2" });

      const versions = await svc.listVersions(projectId, epicId);
      expect(versions).toHaveLength(2);
      expect(versions[0].label).toBe("v1");
      expect(versions[1].label).toBe("v2");
    });

    it("returns empty array when no versions exist", async () => {
      scaffoldProject(root, "proj-empty", "epic-empty");
      const versions = await svc.listVersions("proj-empty", "epic-empty");
      expect(versions).toEqual([]);
    });

    it("returns empty array for nonexistent project", async () => {
      const versions = await svc.listVersions("nonexistent", "epic1");
      expect(versions).toEqual([]);
    });
  });

  // ── getVersion ────────────────────────────────────────────────

  describe("getVersion", () => {
    it("returns version content with definition, scope, and design docs", async () => {
      const projectId = "proj-get";
      const epicId = "epic-get";
      const projDir = scaffoldProject(root, projectId, epicId, {
        definition: "# Get Test\n\nDefinition content.",
        scope: JSON.stringify({ entries: [{ id: "t1", included: true }] }),
      });

      // Add design doc
      const designsDir = path.join(projDir, "epics", epicId, "designs");
      mkdirSync(designsDir, { recursive: true });
      writeFileSync(path.join(designsDir, "design1.md"), "Design content", "utf-8");

      await svc.createVersion(projectId, epicId, { createdBy: "user" });

      const result = await svc.getVersion(projectId, epicId, 1);
      expect(result).not.toBeNull();
      expect(result!.definition).toBe("# Get Test\n\nDefinition content.");
      expect(result!.scope).toContain("t1");
      expect(result!.designDocs).toHaveLength(1);
      expect(result!.designDocs[0].id).toBe("design1");
      expect(result!.designDocs[0].content).toBe("Design content");
    });

    it("returns null for nonexistent version", async () => {
      scaffoldProject(root, "proj-noversion", "epic-noversion");
      const result = await svc.getVersion("proj-noversion", "epic-noversion", 99);
      expect(result).toBeNull();
    });

    it("returns null for nonexistent project", async () => {
      const result = await svc.getVersion("nonexistent", "epic1", 1);
      expect(result).toBeNull();
    });
  });

  // ── diffVersions ──────────────────────────────────────────────

  describe("diffVersions", () => {
    it("detects changes between two versions", async () => {
      const projectId = "proj-diff";
      const epicId = "epic-diff";
      const projDir = scaffoldProject(root, projectId, epicId, {
        definition: "Line 1\nLine 2\nLine 3",
      });

      await svc.createVersion(projectId, epicId, { createdBy: "user" });

      // Modify definition for v2
      writeFileSync(
        path.join(projDir, "epics", epicId, "definition.md"),
        "Line 1\nLine 2 modified\nLine 3\nLine 4 added",
        "utf-8",
      );
      await svc.createVersion(projectId, epicId, { createdBy: "user" });

      const diff = await svc.diffVersions(projectId, epicId, 1, 2);
      expect(diff).not.toBeNull();
      expect(diff!.from).toBe(1);
      expect(diff!.to).toBe(2);
      expect(diff!.files.length).toBeGreaterThan(0);

      const defDiff = diff!.files.find((f) => f.filename === "definition.md");
      expect(defDiff).toBeDefined();
      expect(defDiff!.addedCount).toBeGreaterThan(0);
      expect(defDiff!.removedCount).toBeGreaterThan(0);
    });

    it("returns null when a version doesn't exist", async () => {
      scaffoldProject(root, "proj-diff2", "epic-diff2");
      const diff = await svc.diffVersions("proj-diff2", "epic-diff2", 1, 2);
      expect(diff).toBeNull();
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty definition file", async () => {
      const projectId = "proj-empty-def";
      const epicId = "epic-empty-def";
      scaffoldProject(root, projectId, epicId, { definition: "" });

      const version = await svc.createVersion(projectId, epicId, { createdBy: "user" });
      expect(version.version).toBe(1);

      const result = await svc.getVersion(projectId, epicId, 1);
      expect(result).not.toBeNull();
      expect(result!.definition).toBe("");
    });

    it("readVersionsIndex returns empty array for non-existent path", () => {
      const result = svc.readVersionsIndex("/nonexistent/path");
      expect(result).toEqual([]);
    });
  });
});
