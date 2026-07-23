/* ── CodaScope: Design Doc Service Tests ─────────────────────────────
   Unit tests for CodaScopeDesignDocService.
   Exercises CRUD, storage migration (flat → directory), version
   management, and archive/unarchive using a real temp filesystem.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";

/* ── Helpers ─────────────────────────────────────────────────────── */

function tmpRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "codascope-design-doc-svc-"));
}

/** Scaffold a minimal project + epic with designs directory. */
function scaffoldProject(
  root: string,
  projectId: string,
  epicId: string,
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
    JSON.stringify({ id: epicId, name: "Test Epic" }),
    "utf-8",
  );

  return projectDir;
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe("CodaScopeDesignDocService", () => {
  let root: string;
  let svc: CodaScopeDesignDocService;

  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(root, { recursive: true });
    svc = new CodaScopeDesignDocService(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── createDesignDoc ─────────────────────────────────────────────

  describe("createDesignDoc", () => {
    it("creates a doc with content.md in subdirectory layout", async () => {
      const projectId = "proj1";
      const epicId = "epic1";
      const projDir = scaffoldProject(root, projectId, epicId);

      const doc = await svc.createDesignDoc(projectId, epicId, {
        title: "API Design",
        content: "# API Design\n\nEndpoints and contracts.",
        createdBy: "agent",
      });

      expect(doc.id).toMatch(/^doc_/);
      expect(doc.epicId).toBe(epicId);
      expect(doc.title).toBe("API Design");
      expect(doc.createdBy).toBe("agent");
      expect(doc.wordCount).toBeGreaterThan(0);
      expect(doc.blockCount).toBeGreaterThan(0);
      expect(doc.annotationCount).toBe(0);
      expect(doc.directiveCount).toBe(0);
      expect(doc).not.toHaveProperty("template");

      // Verify content.md was created in subdirectory
      const contentPath = path.join(
        projDir, "epics", epicId, "designs", doc.id, "content.md",
      );
      expect(existsSync(contentPath)).toBe(true);
      expect(readFileSync(contentPath, "utf-8")).toBe("# API Design\n\nEndpoints and contracts.");
      const index = JSON.parse(readFileSync(
        path.join(projDir, "epics", epicId, "designs", "designs.json"),
        "utf-8",
      ));
      expect(index.docs[0]).not.toHaveProperty("template");
    });

    it("creates a doc with empty content when none provided", async () => {
      scaffoldProject(root, "proj2", "epic2");

      const doc = await svc.createDesignDoc("proj2", "epic2", {
        title: "Empty Doc",
      });

      expect(doc.wordCount).toBe(0);
      expect(doc.blockCount).toBe(0);
    });

    it("updates designs.json index", async () => {
      const projDir = scaffoldProject(root, "proj3", "epic3");

      await svc.createDesignDoc("proj3", "epic3", { title: "Doc A" });
      await svc.createDesignDoc("proj3", "epic3", { title: "Doc B" });

      const indexPath = path.join(projDir, "epics", "epic3", "designs", "designs.json");
      expect(existsSync(indexPath)).toBe(true);
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      expect(index.docs).toHaveLength(2);
    });

    it("throws when project not found", async () => {
      await expect(
        svc.createDesignDoc("nonexistent", "epic1", { title: "Test" }),
      ).rejects.toThrow("Project not found");
    });
  });

  // ── getDesignDoc ──────────────────────────────────────────────

  describe("getDesignDoc", () => {
    it("retrieves doc content correctly", async () => {
      scaffoldProject(root, "proj-get", "epic-get");
      const created = await svc.createDesignDoc("proj-get", "epic-get", {
        title: "My Doc",
        content: "Hello world",
      });

      const result = await svc.getDesignDoc("proj-get", "epic-get", created.id);
      expect(result).not.toBeNull();
      expect(result!.doc.title).toBe("My Doc");
      expect(result!.content).toBe("Hello world");
    });

    it("returns null for nonexistent doc", async () => {
      scaffoldProject(root, "proj-get2", "epic-get2");
      const result = await svc.getDesignDoc("proj-get2", "epic-get2", "nonexistent");
      expect(result).toBeNull();
    });

    it("returns null for nonexistent project", async () => {
      const result = await svc.getDesignDoc("nonexistent", "epic1", "doc1");
      expect(result).toBeNull();
    });

    it("keeps optional legacy template metadata readable through edits", async () => {
      const projectId = "proj-legacy-template";
      const epicId = "epic-legacy-template";
      const projDir = scaffoldProject(root, projectId, epicId);
      const docId = "legacy_template_doc";
      const designsDir = path.join(projDir, "epics", epicId, "designs");
      mkdirSync(path.join(designsDir, docId), { recursive: true });
      writeFileSync(path.join(designsDir, docId, "content.md"), "Legacy content.", "utf-8");
      writeFileSync(path.join(designsDir, "designs.json"), JSON.stringify({
        docs: [{
          id: docId,
          epicId,
          title: "Legacy Design",
          template: "legacy-api-spec-v1",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          createdBy: "legacy-import",
          wordCount: 2,
          blockCount: 1,
          annotationCount: 0,
          directiveCount: 0,
        }],
      }), "utf-8");

      const initial = await svc.getDesignDoc(projectId, epicId, docId);
      expect(initial?.doc.template).toBe("legacy-api-spec-v1");

      const updated = await svc.updateDesignDoc(projectId, epicId, docId, "Updated legacy content.");
      expect(updated).not.toBeNull();
      expect("conflict" in updated!).toBe(false);
      if (updated && !("conflict" in updated)) {
        expect(updated.doc.template).toBe("legacy-api-spec-v1");
      }
      expect((await svc.listDesignDocs(projectId, epicId))[0].template).toBe("legacy-api-spec-v1");
    });
  });

  // ── updateDesignDoc ───────────────────────────────────────────

  describe("updateDesignDoc", () => {
    it("updates content and recalculates word/block counts", async () => {
      scaffoldProject(root, "proj-update", "epic-update");
      const created = await svc.createDesignDoc("proj-update", "epic-update", {
        title: "Updatable",
        content: "Short.",
      });

      const updated = await svc.updateDesignDoc(
        "proj-update", "epic-update", created.id,
        "# Updated Title\n\nThis is a much longer document with more words.\n\n## Section Two\n\nMore content here.",
      );

      expect(updated).not.toBeNull();
      expect("conflict" in updated!).toBe(false);
      const result = updated as { doc: any; contentHash: string };
      expect(result.doc.wordCount).toBeGreaterThan(created.wordCount);
      expect(result.doc.blockCount).toBeGreaterThan(created.blockCount);
      expect(result.contentHash).toBeDefined();
      expect(typeof result.contentHash).toBe("string");

      // Verify content persisted
      const read = await svc.getDesignDoc("proj-update", "epic-update", created.id);
      expect(read!.content).toContain("Updated Title");
      expect(read!.contentHash).toBe(result.contentHash);
    });

    it("returns null for nonexistent doc", async () => {
      scaffoldProject(root, "proj-upd2", "epic-upd2");
      const result = await svc.updateDesignDoc("proj-upd2", "epic-upd2", "nonexistent", "content");
      expect(result).toBeNull();
    });
  });

  // ── Storage migration ─────────────────────────────────────────

  describe("storage migration (flat → subdirectory)", () => {
    it("migrates flat layout to subdirectory on first read", async () => {
      const projectId = "proj-migrate";
      const epicId = "epic-migrate";
      const projDir = scaffoldProject(root, projectId, epicId);

      // Create a doc in the index
      const docId = "legacy_doc";
      const designsDir = path.join(projDir, "epics", epicId, "designs");
      mkdirSync(designsDir, { recursive: true });

      // Write flat-layout file (the old format: <docId>.md)
      const flatPath = path.join(designsDir, `${docId}.md`);
      writeFileSync(flatPath, "Legacy content from flat layout.", "utf-8");

      // Write the index
      writeFileSync(
        path.join(designsDir, "designs.json"),
        JSON.stringify({
          docs: [{
            id: docId,
            epicId,
            title: "Legacy Doc",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: "user",
            wordCount: 5,
            blockCount: 1,
            annotationCount: 0,
            directiveCount: 0,
          }],
        }),
        "utf-8",
      );

      // Read the doc — should trigger migration
      const result = await svc.getDesignDoc(projectId, epicId, docId);
      expect(result).not.toBeNull();
      expect(result!.content).toBe("Legacy content from flat layout.");

      // The flat file should be gone
      expect(existsSync(flatPath)).toBe(false);

      // The new subdirectory layout should exist
      const newPath = path.join(designsDir, docId, "content.md");
      expect(existsSync(newPath)).toBe(true);
    });
  });

  // ── Archive / Unarchive ───────────────────────────────────────

  describe("archive / unarchive", () => {
    it("archives a doc by setting archivedAt", async () => {
      scaffoldProject(root, "proj-arch", "epic-arch");
      const doc = await svc.createDesignDoc("proj-arch", "epic-arch", { title: "Archivable" });

      const archived = await svc.archiveDesignDoc("proj-arch", "epic-arch", doc.id);
      expect(archived).toBe(true);

      // Verify archivedAt is set in the index
      const docs = await svc.listDesignDocs("proj-arch", "epic-arch");
      const found = docs.find((d) => d.id === doc.id);
      expect(found?.archivedAt).toBeTruthy();
    });

    it("unarchives a doc by removing archivedAt", async () => {
      scaffoldProject(root, "proj-unarch", "epic-unarch");
      const doc = await svc.createDesignDoc("proj-unarch", "epic-unarch", { title: "Unarchivable" });

      await svc.archiveDesignDoc("proj-unarch", "epic-unarch", doc.id);
      const unarchived = await svc.unarchiveDesignDoc("proj-unarch", "epic-unarch", doc.id);
      expect(unarchived).toBe(true);

      const docs = await svc.listDesignDocs("proj-unarch", "epic-unarch");
      const found = docs.find((d) => d.id === doc.id);
      expect(found?.archivedAt).toBeUndefined();
    });

    it("returns false when archiving nonexistent doc", async () => {
      scaffoldProject(root, "proj-arch2", "epic-arch2");
      const result = await svc.archiveDesignDoc("proj-arch2", "epic-arch2", "nonexistent");
      expect(result).toBe(false);
    });

    it("returns false when unarchiving a non-archived doc", async () => {
      scaffoldProject(root, "proj-arch3", "epic-arch3");
      const doc = await svc.createDesignDoc("proj-arch3", "epic-arch3", { title: "Not Archived" });
      const result = await svc.unarchiveDesignDoc("proj-arch3", "epic-arch3", doc.id);
      expect(result).toBe(false);
    });
  });

  // ── Version History ───────────────────────────────────────────

  describe("version history", () => {
    it("creates version snapshots of current content", async () => {
      scaffoldProject(root, "proj-ver", "epic-ver");
      const doc = await svc.createDesignDoc("proj-ver", "epic-ver", {
        title: "Versioned",
        content: "Version 1 content.",
      });

      const version = await svc.createVersion("proj-ver", "epic-ver", doc.id, "agent", "First version");
      expect(version.number).toBe(1);
      expect(version.author).toBe("agent");
      expect(version.summary).toBe("First version");
      expect(version.wordCount).toBe(3); // "Version 1 content."
    });

    it("lists versions in order", async () => {
      scaffoldProject(root, "proj-ver2", "epic-ver2");
      const doc = await svc.createDesignDoc("proj-ver2", "epic-ver2", {
        title: "Multi Version",
        content: "First.",
      });

      await svc.createVersion("proj-ver2", "epic-ver2", doc.id, "user", "v1");
      await svc.updateDesignDoc("proj-ver2", "epic-ver2", doc.id, "Second.");
      await svc.createVersion("proj-ver2", "epic-ver2", doc.id, "user", "v2");

      const versions = await svc.listDocVersions("proj-ver2", "epic-ver2", doc.id);
      expect(versions).toHaveLength(2);
      expect(versions[0].number).toBe(1);
      expect(versions[1].number).toBe(2);
    });

    it("retrieves specific version content", async () => {
      scaffoldProject(root, "proj-ver3", "epic-ver3");
      const doc = await svc.createDesignDoc("proj-ver3", "epic-ver3", {
        title: "Get Version",
        content: "Original content.",
      });

      await svc.createVersion("proj-ver3", "epic-ver3", doc.id, "user", "Snapshot");

      const result = await svc.getDocVersion("proj-ver3", "epic-ver3", doc.id, 1);
      expect(result).not.toBeNull();
      expect(result!.content).toBe("Original content.");
      expect(result!.version.summary).toBe("Snapshot");
    });

    it("prunes oldest versions when max exceeded", async () => {
      scaffoldProject(root, "proj-prune", "epic-prune");
      const doc = await svc.createDesignDoc("proj-prune", "epic-prune", {
        title: "Pruning Test",
        content: "Content.",
      });

      // Create 12 versions (max is 10) — oldest 2 should be pruned
      for (let i = 1; i <= 12; i++) {
        await svc.updateDesignDoc("proj-prune", "epic-prune", doc.id, `Content version ${i}.`);
        await svc.createVersion("proj-prune", "epic-prune", doc.id, "user", `v${i}`);
      }

      const versions = await svc.listDocVersions("proj-prune", "epic-prune", doc.id);
      expect(versions).toHaveLength(10);
      // First version should be v3 (v1 and v2 were pruned)
      expect(versions[0].number).toBe(3);
      expect(versions[9].number).toBe(12);
    });

    it("fails closed on a poisoned version index before pruning or touching sentinels", async () => {
      const projectId = "proj-poisoned";
      const epicId = "epic-poisoned";
      const projDir = scaffoldProject(root, projectId, epicId);
      const doc = await svc.createDesignDoc(projectId, epicId, {
        title: "Poisoned versions",
        content: "Current content must remain unchanged.",
      });
      const docDir = path.join(projDir, "epics", epicId, "designs", doc.id);
      const versionsDir = path.join(docDir, "versions");
      mkdirSync(versionsDir, { recursive: true });
      const sentinel = path.join(docDir, "sentinel.md");
      writeFileSync(sentinel, "sentinel-bytes", "utf-8");
      for (let version = 1; version <= 10; version++) {
        writeFileSync(path.join(versionsDir, `v${String(version).padStart(3, "0")}.md`), `version-${version}`, "utf-8");
      }
      const poisonedIndex = JSON.stringify({
        versions: [
          { number: "../../../sentinel", createdAt: "", author: "attacker", summary: "", wordCount: 0 },
          ...Array.from({ length: 10 }, (_, index) => ({
            number: index + 1,
            createdAt: "",
            author: "user",
            summary: "",
            wordCount: 1,
          })),
        ],
        maxVersions: 10,
      });
      const indexPath = path.join(versionsDir, "versions.json");
      writeFileSync(indexPath, poisonedIndex, "utf-8");
      const beforeEntries = readdirSync(versionsDir).sort();

      await expect(svc.createVersion(projectId, epicId, doc.id, "user", "trigger prune"))
        .rejects.toMatchObject({
          status: 500,
          code: "persistence_corrupt",
        });

      expect(readFileSync(sentinel, "utf-8")).toBe("sentinel-bytes");
      expect(readFileSync(indexPath, "utf-8")).toBe(poisonedIndex);
      expect(readFileSync(path.join(docDir, "content.md"), "utf-8"))
        .toBe("Current content must remain unchanged.");
      expect(readdirSync(versionsDir).sort()).toEqual(beforeEntries);
    });

    it.each([
      ["string", "1"],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["fraction", 1.5],
      ["zero", 0],
      ["negative", -1],
    ])("rejects a caller-supplied %s version number", async (_name, versionNum) => {
      await expect(svc.getDocVersion("missing", "missing", "missing", versionNum as number))
        .rejects.toMatchObject({ status: 400, code: "invalid_input" });
    });

    it("reverts to a previous version", async () => {
      scaffoldProject(root, "proj-revert", "epic-revert");
      const doc = await svc.createDesignDoc("proj-revert", "epic-revert", {
        title: "Revert Test",
        content: "Original content.",
      });

      await svc.createVersion("proj-revert", "epic-revert", doc.id, "user", "Before edit");
      await svc.updateDesignDoc("proj-revert", "epic-revert", doc.id, "Modified content.");
      await svc.createVersion("proj-revert", "epic-revert", doc.id, "user", "After edit");

      // Revert to version 1
      const result = await svc.revertToVersion("proj-revert", "epic-revert", doc.id, 1);
      expect(result).not.toBeNull();
      expect(result!.content).toBe("Original content.");

      // The revert itself should have created a new version
      const versions = await svc.listDocVersions("proj-revert", "epic-revert", doc.id);
      expect(versions).toHaveLength(3);
      expect(versions[2].summary).toContain("Reverted to version 1");

      // Current content should be the reverted content
      const current = await svc.getDesignDoc("proj-revert", "epic-revert", doc.id);
      expect(current!.content).toBe("Original content.");
    });

    it("returns null when reverting to nonexistent version", async () => {
      scaffoldProject(root, "proj-revert2", "epic-revert2");
      const doc = await svc.createDesignDoc("proj-revert2", "epic-revert2", {
        title: "No Revert",
        content: "Content.",
      });

      const result = await svc.revertToVersion("proj-revert2", "epic-revert2", doc.id, 99);
      expect(result).toBeNull();
    });
  });

  // ── listDesignDocs ────────────────────────────────────────────

  describe("listDesignDocs", () => {
    it("lists all docs for an epic", async () => {
      scaffoldProject(root, "proj-list", "epic-list");
      await svc.createDesignDoc("proj-list", "epic-list", { title: "Doc A" });
      await svc.createDesignDoc("proj-list", "epic-list", { title: "Doc B" });
      await svc.createDesignDoc("proj-list", "epic-list", { title: "Doc C" });

      const docs = await svc.listDesignDocs("proj-list", "epic-list");
      expect(docs).toHaveLength(3);
      expect(docs.map((d) => d.title)).toEqual(["Doc A", "Doc B", "Doc C"]);
    });

    it("returns empty array for project with no docs", async () => {
      scaffoldProject(root, "proj-empty", "epic-empty");
      const docs = await svc.listDesignDocs("proj-empty", "epic-empty");
      expect(docs).toEqual([]);
    });
  });

  // ── readDesignsIndex (bulk read helper) ───────────────────────

  describe("readDesignsIndex", () => {
    it("reads index directly from epic dir path", async () => {
      const projDir = scaffoldProject(root, "proj-bulk", "epic-bulk");
      await svc.createDesignDoc("proj-bulk", "epic-bulk", { title: "Bulk" });

      const epicDir = path.join(projDir, "epics", "epic-bulk");
      const docs = await svc.readDesignsIndex(epicDir);
      expect(docs).toHaveLength(1);
      expect(docs[0].title).toBe("Bulk");
    });

    it("returns empty array for nonexistent path", async () => {
      const docs = await svc.readDesignsIndex("/nonexistent/path");
      expect(docs).toEqual([]);
    });
  });
});
