/* ── CodaScope: Artifact Version Service Tests ───────────────────────
   Unit tests for CodaScopeArtifactVersionService.
   Exercises snapshot creation, version listing, revert to specific
   version, and revert to latest.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CodaScopeArtifactVersionService } from "./codaScopeArtifactVersionService.js";

/* ── Helpers ─────────────────────────────────────────────────────── */

function tmpRoot(): string {
  return path.join(
    process.cwd(),
    ".test-tmp",
    `art-ver-svc-${crypto.randomBytes(4).toString("hex")}`,
  );
}

function scaffoldProject(root: string, projectId: string, epicId: string, artifactId: string): string {
  const projectDir = path.join(root, `project-${projectId}`);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    path.join(projectDir, "project.json"),
    JSON.stringify({ id: projectId, name: "Test Project" }),
    "utf-8",
  );

  const epicDir = path.join(projectDir, "epics", epicId);
  mkdirSync(epicDir, { recursive: true });

  return projectDir;
}

function writeHtml(projectDir: string, epicId: string, artifactId: string, html: string): void {
  const buildsDir = path.join(projectDir, "epics", epicId, "artifacts", artifactId, "builds");
  mkdirSync(buildsDir, { recursive: true });
  writeFileSync(path.join(buildsDir, "index.html"), html, "utf-8");
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe("CodaScopeArtifactVersionService", () => {
  let root: string;
  let svc: CodaScopeArtifactVersionService;
  const projectId = "proj1";
  const epicId = "epic1";
  const artifactId = "art1";

  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(root, { recursive: true });
    svc = new CodaScopeArtifactVersionService(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── snapshotCurrentBuild ──────────────────────────────────────

  describe("snapshotCurrentBuild", () => {
    it("creates a version snapshot of the current HTML", async () => {
      const projDir = scaffoldProject(root, projectId, epicId, artifactId);
      writeHtml(projDir, epicId, artifactId, "<h1>Version 1</h1>");

      const version = await svc.snapshotCurrentBuild(projectId, epicId, artifactId);
      expect(version).not.toBeNull();
      expect(version!.version).toBe(1);
      expect(version!.dirName).toMatch(/^v001_/);
      expect(version!.sizeBytes).toBeGreaterThan(0);
      expect(version!.timestamp).toBeTruthy();
    });

    it("increments version numbers", async () => {
      const projDir = scaffoldProject(root, projectId, epicId, artifactId);
      writeHtml(projDir, epicId, artifactId, "<h1>Build 1</h1>");

      const v1 = await svc.snapshotCurrentBuild(projectId, epicId, artifactId);
      expect(v1!.version).toBe(1);

      writeHtml(projDir, epicId, artifactId, "<h1>Build 2</h1>");
      const v2 = await svc.snapshotCurrentBuild(projectId, epicId, artifactId);
      expect(v2!.version).toBe(2);

      writeHtml(projDir, epicId, artifactId, "<h1>Build 3</h1>");
      const v3 = await svc.snapshotCurrentBuild(projectId, epicId, artifactId);
      expect(v3!.version).toBe(3);
    });

    it("returns null when no index.html exists", async () => {
      scaffoldProject(root, projectId, epicId, artifactId);
      const version = await svc.snapshotCurrentBuild(projectId, epicId, artifactId);
      expect(version).toBeNull();
    });

    it("returns null for nonexistent project", async () => {
      const version = await svc.snapshotCurrentBuild("nonexistent", epicId, artifactId);
      expect(version).toBeNull();
    });
  });

  // ── listVersions ─────────────────────────────────────────────

  describe("listVersions", () => {
    it("lists all version snapshots in order", async () => {
      const projDir = scaffoldProject(root, projectId, epicId, artifactId);

      writeHtml(projDir, epicId, artifactId, "<h1>V1</h1>");
      await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      writeHtml(projDir, epicId, artifactId, "<h1>V2</h1>");
      await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      const versions = await svc.listVersions(projectId, epicId, artifactId);
      expect(versions).toHaveLength(2);
      expect(versions[0].version).toBe(1);
      expect(versions[1].version).toBe(2);
    });

    it("returns empty array when no versions exist", async () => {
      scaffoldProject(root, projectId, epicId, artifactId);
      const versions = await svc.listVersions(projectId, epicId, artifactId);
      expect(versions).toEqual([]);
    });

    it("marks the latest version as current by default", async () => {
      const projDir = scaffoldProject(root, projectId, epicId, artifactId);

      writeHtml(projDir, epicId, artifactId, "<h1>V1</h1>");
      await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      writeHtml(projDir, epicId, artifactId, "<h1>V2</h1>");
      await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      const versions = await svc.listVersions(projectId, epicId, artifactId);
      expect(versions[0].isCurrent).toBe(false);
      expect(versions[1].isCurrent).toBe(true);
    });
  });

  // ── revertToVersion ──────────────────────────────────────────

  describe("revertToVersion", () => {
    it("reverts to a specific version", async () => {
      const projDir = scaffoldProject(root, projectId, epicId, artifactId);

      // Create v1
      writeHtml(projDir, epicId, artifactId, "<h1>Original</h1>");
      const v1 = await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      // Overwrite with new content
      writeHtml(projDir, epicId, artifactId, "<h1>Modified</h1>");

      // Revert to v1
      const success = await svc.revertToVersion(projectId, epicId, artifactId, v1!.dirName);
      expect(success).toBe(true);

      // Verify content was restored
      const htmlPath = path.join(projDir, "epics", epicId, "artifacts", artifactId, "builds", "index.html");
      const content = readFileSync(htmlPath, "utf-8");
      expect(content).toBe("<h1>Original</h1>");
    });

    it("does NOT create a new version when reverting", async () => {
      const projDir = scaffoldProject(root, projectId, epicId, artifactId);

      writeHtml(projDir, epicId, artifactId, "<h1>V1</h1>");
      const v1 = await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      writeHtml(projDir, epicId, artifactId, "<h1>V2</h1>");
      await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      // Revert to v1 — should NOT create v3
      await svc.revertToVersion(projectId, epicId, artifactId, v1!.dirName);

      const versions = await svc.listVersions(projectId, epicId, artifactId);
      expect(versions).toHaveLength(2);
      expect(versions[0].version).toBe(1);
      expect(versions[1].version).toBe(2);
    });

    it("marks the reverted version as current", async () => {
      const projDir = scaffoldProject(root, projectId, epicId, artifactId);

      writeHtml(projDir, epicId, artifactId, "<h1>V1</h1>");
      const v1 = await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      writeHtml(projDir, epicId, artifactId, "<h1>V2</h1>");
      await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      // Revert to v1
      await svc.revertToVersion(projectId, epicId, artifactId, v1!.dirName);

      const versions = await svc.listVersions(projectId, epicId, artifactId);
      const currentVersion = versions.find((v) => v.isCurrent);
      expect(currentVersion).toBeDefined();
      expect(currentVersion!.version).toBe(1);
    });

    it("switching between versions does not grow version list", async () => {
      const projDir = scaffoldProject(root, projectId, epicId, artifactId);

      writeHtml(projDir, epicId, artifactId, "<h1>V1</h1>");
      const v1 = await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      writeHtml(projDir, epicId, artifactId, "<h1>V2</h1>");
      const v2 = await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      // Switch back and forth several times
      await svc.revertToVersion(projectId, epicId, artifactId, v1!.dirName);
      await svc.revertToVersion(projectId, epicId, artifactId, v2!.dirName);
      await svc.revertToVersion(projectId, epicId, artifactId, v1!.dirName);
      await svc.revertToVersion(projectId, epicId, artifactId, v2!.dirName);

      // Should still only have 2 versions
      const versions = await svc.listVersions(projectId, epicId, artifactId);
      expect(versions).toHaveLength(2);
    });

    it("returns false for nonexistent version directory", async () => {
      scaffoldProject(root, projectId, epicId, artifactId);
      const success = await svc.revertToVersion(projectId, epicId, artifactId, "v999_nonexistent");
      expect(success).toBe(false);
    });
  });

  // ── revertToLatest ───────────────────────────────────────────

  describe("revertToLatest", () => {
    it("reverts to the most recent version snapshot", async () => {
      const projDir = scaffoldProject(root, projectId, epicId, artifactId);

      // Build v1
      writeHtml(projDir, epicId, artifactId, "<h1>V1</h1>");
      await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      // Build v2
      writeHtml(projDir, epicId, artifactId, "<h1>V2</h1>");
      await svc.snapshotCurrentBuild(projectId, epicId, artifactId);

      // Corrupt current build
      writeHtml(projDir, epicId, artifactId, "<h1>Broken</h1>");

      // Revert to latest (v2)
      const success = await svc.revertToLatest(projectId, epicId, artifactId);
      expect(success).toBe(true);

      const htmlPath = path.join(projDir, "epics", epicId, "artifacts", artifactId, "builds", "index.html");
      const content = readFileSync(htmlPath, "utf-8");
      expect(content).toBe("<h1>V2</h1>");
    });

    it("returns false when no versions exist", async () => {
      scaffoldProject(root, projectId, epicId, artifactId);
      const success = await svc.revertToLatest(projectId, epicId, artifactId);
      expect(success).toBe(false);
    });
  });
});
