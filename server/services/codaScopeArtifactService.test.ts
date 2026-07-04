/* ── CodaScope: Artifact Service Tests ───────────────────────────────
   Unit tests for CodaScopeArtifactService.
   Exercises CRUD, section extraction from HTML with data-section-id
   markers, section hide/unhide/reorder + recompose, spec hash
   staleness detection, and preview HTML injection.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CodaScopeArtifactService } from "./codaScopeArtifactService.js";

/* ── Helpers ─────────────────────────────────────────────────────── */

function tmpRoot(): string {
  return path.join(
    process.cwd(),
    ".test-tmp",
    `artifact-svc-${crypto.randomBytes(4).toString("hex")}`,
  );
}

/** Scaffold a minimal project + epic directory. */
function scaffoldProject(root: string, projectId: string, epicId: string): string {
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

/** Write a mock built index.html with sections. */
function writeMockHtml(projectDir: string, epicId: string, artifactId: string, html: string): void {
  const buildsDir = path.join(projectDir, "epics", epicId, "artifacts", artifactId, "builds");
  mkdirSync(buildsDir, { recursive: true });
  writeFileSync(path.join(buildsDir, "index.html"), html, "utf-8");
}

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
<main>
<section id="hero" data-section-id="hero">
<h1>Hero Section</h1>
<p>Welcome to the artifact.</p>
</section>
<section id="data_matrix" data-section-id="data_matrix">
<h2>Data Matrix</h2>
<table><tr><td>Cell 1</td></tr></table>
</section>
<section id="conclusion" data-section-id="conclusion">
<h2>Conclusion</h2>
<p>Final thoughts.</p>
</section>
</main>
</body>
</html>`;

/* ── Tests ────────────────────────────────────────────────────────── */

describe("CodaScopeArtifactService", () => {
  let root: string;
  let svc: CodaScopeArtifactService;

  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(root, { recursive: true });
    svc = new CodaScopeArtifactService(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── createArtifact ────────────────────────────────────────────

  describe("createArtifact", () => {
    it("creates an artifact with correct defaults", async () => {
      scaffoldProject(root, "proj1", "epic1");

      const artifact = await svc.createArtifact("proj1", "epic1", {
        title: "API Architecture",
        body: "Visualize the REST API structure.",
      });

      expect(artifact.id).toMatch(/^art_/);
      expect(artifact.epicId).toBe("epic1");
      expect(artifact.title).toBe("API Architecture");
      expect(artifact.body).toBe("Visualize the REST API structure.");
      expect(artifact.status).toBe("draft");
      expect(artifact.modelId).toBeNull();
      expect(artifact.sources).toEqual([]);
      expect(artifact.autoDiscoverContext).toBe(true);
      expect(artifact.lastBuilt).toBeNull();
      expect(artifact.buildSpecHash).toBeNull();
      expect(artifact.currentSpecHash).toBeTruthy();
      expect(artifact.createdBy).toBe("user");
    });

    it("creates artifact directory and spec.md file", async () => {
      const projDir = scaffoldProject(root, "proj2", "epic2");

      const artifact = await svc.createArtifact("proj2", "epic2", {
        title: "Test Artifact",
        body: "Test body.",
        createdBy: "agent",
      });

      const specPath = path.join(projDir, "epics", "epic2", "artifacts", artifact.id, "spec.md");
      expect(existsSync(specPath)).toBe(true);
      const specContent = readFileSync(specPath, "utf-8");
      expect(specContent).toContain("title: \"Test Artifact\"");
      expect(specContent).toContain("Test body.");
    });

    it("updates artifacts.json index", async () => {
      const projDir = scaffoldProject(root, "proj3", "epic3");

      await svc.createArtifact("proj3", "epic3", { title: "Art A" });
      await svc.createArtifact("proj3", "epic3", { title: "Art B" });

      const indexPath = path.join(projDir, "epics", "epic3", "artifacts", "artifacts.json");
      expect(existsSync(indexPath)).toBe(true);
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      expect(index.artifacts).toHaveLength(2);
    });

    it("throws when project not found", async () => {
      await expect(
        svc.createArtifact("nonexistent", "epic1", { title: "Test" }),
      ).rejects.toThrow("Project not found");
    });
  });

  // ── getArtifact ──────────────────────────────────────────────

  describe("getArtifact", () => {
    it("retrieves a created artifact", async () => {
      scaffoldProject(root, "proj-get", "epic-get");
      const created = await svc.createArtifact("proj-get", "epic-get", {
        title: "My Art",
        body: "Description here.",
      });

      const result = await svc.getArtifact("proj-get", "epic-get", created.id);
      expect(result).not.toBeNull();
      expect(result!.title).toBe("My Art");
      expect(result!.body).toBe("Description here.");
    });

    it("returns null for nonexistent artifact", async () => {
      scaffoldProject(root, "proj-get2", "epic-get2");
      const result = await svc.getArtifact("proj-get2", "epic-get2", "nonexistent");
      expect(result).toBeNull();
    });

    it("returns null for nonexistent project", async () => {
      const result = await svc.getArtifact("nonexistent", "epic1", "art1");
      expect(result).toBeNull();
    });
  });

  // ── listArtifacts ─────────────────────────────────────────────

  describe("listArtifacts", () => {
    it("lists all artifacts for an epic", async () => {
      scaffoldProject(root, "proj-list", "epic-list");
      await svc.createArtifact("proj-list", "epic-list", { title: "Art A" });
      await svc.createArtifact("proj-list", "epic-list", { title: "Art B" });
      await svc.createArtifact("proj-list", "epic-list", { title: "Art C" });

      const list = await svc.listArtifacts("proj-list", "epic-list");
      expect(list).toHaveLength(3);
      expect(list.map((a) => a.title)).toEqual(["Art A", "Art B", "Art C"]);
    });

    it("returns empty array for project with no artifacts", async () => {
      scaffoldProject(root, "proj-empty", "epic-empty");
      const list = await svc.listArtifacts("proj-empty", "epic-empty");
      expect(list).toEqual([]);
    });
  });

  // ── updateArtifact ────────────────────────────────────────────

  describe("updateArtifact", () => {
    it("updates artifact fields", async () => {
      scaffoldProject(root, "proj-upd", "epic-upd");
      const created = await svc.createArtifact("proj-upd", "epic-upd", {
        title: "Original",
        body: "Original body.",
      });

      const updated = await svc.updateArtifact("proj-upd", "epic-upd", created.id, {
        title: "Updated Title",
        body: "Updated body.",
        modelId: "claude-sonnet",
      });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe("Updated Title");
      expect(updated!.body).toBe("Updated body.");
      expect(updated!.modelId).toBe("claude-sonnet");
    });

    it("returns null for nonexistent artifact", async () => {
      scaffoldProject(root, "proj-upd2", "epic-upd2");
      const result = await svc.updateArtifact("proj-upd2", "epic-upd2", "nonexistent", { title: "Test" });
      expect(result).toBeNull();
    });
  });

  // ── deleteArtifact ────────────────────────────────────────────

  describe("deleteArtifact", () => {
    it("deletes an artifact and its directory", async () => {
      const projDir = scaffoldProject(root, "proj-del", "epic-del");
      const created = await svc.createArtifact("proj-del", "epic-del", { title: "Deletable" });

      const artDir = path.join(projDir, "epics", "epic-del", "artifacts", created.id);
      expect(existsSync(artDir)).toBe(true);

      const deleted = await svc.deleteArtifact("proj-del", "epic-del", created.id);
      expect(deleted).toBe(true);

      expect(existsSync(artDir)).toBe(false);

      const list = await svc.listArtifacts("proj-del", "epic-del");
      expect(list).toHaveLength(0);
    });

    it("returns false for nonexistent artifact", async () => {
      scaffoldProject(root, "proj-del2", "epic-del2");
      const result = await svc.deleteArtifact("proj-del2", "epic-del2", "nonexistent");
      expect(result).toBe(false);
    });
  });

  // ── Section extraction ────────────────────────────────────────

  describe("section extraction", () => {
    it("extracts sections from HTML with data-section-id markers", async () => {
      const projDir = scaffoldProject(root, "proj-sec", "epic-sec");
      const artifact = await svc.createArtifact("proj-sec", "epic-sec", { title: "Sections" });

      writeMockHtml(projDir, "epic-sec", artifact.id, SAMPLE_HTML);

      const result = await svc.extractSections("proj-sec", "epic-sec", artifact.id);
      expect(result.sections).toHaveLength(3);
      expect(result.sections[0].id).toBe("hero");
      expect(result.sections[0].title).toBe("Hero Section");
      expect(result.sections[1].id).toBe("data_matrix");
      expect(result.sections[1].title).toBe("Data Matrix");
      expect(result.sections[2].id).toBe("conclusion");
      expect(result.sections[2].title).toBe("Conclusion");
    });

    it("persists section fragments to .sections/ directory", async () => {
      const projDir = scaffoldProject(root, "proj-frag", "epic-frag");
      const artifact = await svc.createArtifact("proj-frag", "epic-frag", { title: "Fragments" });

      writeMockHtml(projDir, "epic-frag", artifact.id, SAMPLE_HTML);
      await svc.extractSections("proj-frag", "epic-frag", artifact.id);

      const sectionsDir = path.join(projDir, "epics", "epic-frag", "artifacts", artifact.id, "builds", ".sections");
      expect(existsSync(path.join(sectionsDir, "hero.html"))).toBe(true);
      expect(existsSync(path.join(sectionsDir, "data_matrix.html"))).toBe(true);
      expect(existsSync(path.join(sectionsDir, "conclusion.html"))).toBe(true);
    });

    it("returns empty sections for artifact without HTML", async () => {
      scaffoldProject(root, "proj-nosec", "epic-nosec");
      const artifact = await svc.createArtifact("proj-nosec", "epic-nosec", { title: "No HTML" });

      const result = await svc.extractSections("proj-nosec", "epic-nosec", artifact.id);
      expect(result.sections).toHaveLength(0);
    });

    it("handles hidden sections", async () => {
      const projDir = scaffoldProject(root, "proj-hidden", "epic-hidden");
      const artifact = await svc.createArtifact("proj-hidden", "epic-hidden", { title: "Hidden" });

      const htmlWithHidden = `<body>
<section id="visible" data-section-id="visible"><h1>Visible</h1></section>
<section id="hidden" data-hidden="true" data-section-id="hidden"><h2>Hidden</h2></section>
</body>`;

      writeMockHtml(projDir, "epic-hidden", artifact.id, htmlWithHidden);
      const result = await svc.extractSections("proj-hidden", "epic-hidden", artifact.id);

      expect(result.sections).toHaveLength(2);
      expect(result.sections[0].hidden).toBeFalsy();
      expect(result.sections[1].hidden).toBe(true);
      expect(result.hiddenSectionIds).toContain("hidden");
    });
  });

  // ── Section hide/unhide ───────────────────────────────────────

  describe("section hide/unhide", () => {
    it("hides a section and updates HTML", async () => {
      const projDir = scaffoldProject(root, "proj-hide", "epic-hide");
      const artifact = await svc.createArtifact("proj-hide", "epic-hide", { title: "Hide Test" });

      writeMockHtml(projDir, "epic-hide", artifact.id, SAMPLE_HTML);
      await svc.extractSections("proj-hide", "epic-hide", artifact.id);

      const result = await svc.hideSection("proj-hide", "epic-hide", artifact.id, "data_matrix");
      expect(result.hiddenSectionIds).toContain("data_matrix");

      const section = result.sections.find((s) => s.id === "data_matrix");
      expect(section?.hidden).toBe(true);

      // Verify HTML was updated
      const htmlPath = path.join(projDir, "epics", "epic-hide", "artifacts", artifact.id, "builds", "index.html");
      const html = readFileSync(htmlPath, "utf-8");
      expect(html).toContain('data-hidden="true"');
    });

    it("unhides a section", async () => {
      const projDir = scaffoldProject(root, "proj-unhide", "epic-unhide");
      const artifact = await svc.createArtifact("proj-unhide", "epic-unhide", { title: "Unhide Test" });

      writeMockHtml(projDir, "epic-unhide", artifact.id, SAMPLE_HTML);
      await svc.extractSections("proj-unhide", "epic-unhide", artifact.id);

      await svc.hideSection("proj-unhide", "epic-unhide", artifact.id, "hero");
      const result = await svc.unhideSection("proj-unhide", "epic-unhide", artifact.id, "hero");

      expect(result.hiddenSectionIds).not.toContain("hero");
      const section = result.sections.find((s) => s.id === "hero");
      expect(section?.hidden).toBe(false);
    });
  });

  // ── Section reorder ──────────────────────────────────────────

  describe("section reorder", () => {
    it("reorders sections and recomposes HTML", async () => {
      const projDir = scaffoldProject(root, "proj-reorder", "epic-reorder");
      const artifact = await svc.createArtifact("proj-reorder", "epic-reorder", { title: "Reorder Test" });

      writeMockHtml(projDir, "epic-reorder", artifact.id, SAMPLE_HTML);
      await svc.extractSections("proj-reorder", "epic-reorder", artifact.id);

      const result = await svc.reorderSections("proj-reorder", "epic-reorder", artifact.id, [
        "conclusion", "hero", "data_matrix",
      ]);

      expect(result.sections.map((s) => s.id)).toEqual(["conclusion", "hero", "data_matrix"]);

      // Verify HTML section order
      const htmlPath = path.join(projDir, "epics", "epic-reorder", "artifacts", artifact.id, "builds", "index.html");
      const html = readFileSync(htmlPath, "utf-8");
      const conclusionIdx = html.indexOf('id="conclusion"');
      const heroIdx = html.indexOf('id="hero"');
      const matrixIdx = html.indexOf('id="data_matrix"');
      expect(conclusionIdx).toBeLessThan(heroIdx);
      expect(heroIdx).toBeLessThan(matrixIdx);
    });
  });

  // ── Spec hash staleness ──────────────────────────────────────

  describe("spec hash staleness", () => {
    it("detects staleness when spec body changes after build hash set", async () => {
      scaffoldProject(root, "proj-stale", "epic-stale");
      const artifact = await svc.createArtifact("proj-stale", "epic-stale", {
        title: "Stale Test",
        body: "Original body.",
      });

      expect(svc.isStale(artifact)).toBe(false); // no build hash yet

      // Simulate a build by setting buildSpecHash
      const afterBuild = { ...artifact, buildSpecHash: artifact.currentSpecHash };
      expect(svc.isStale(afterBuild)).toBe(false); // hashes match

      // Simulate spec change
      const afterEdit = { ...afterBuild, currentSpecHash: "different_hash" };
      expect(svc.isStale(afterEdit)).toBe(true);
    });

    it("marks artifact as stale when body is updated after build", async () => {
      scaffoldProject(root, "proj-stale2", "epic-stale2");
      const artifact = await svc.createArtifact("proj-stale2", "epic-stale2", {
        title: "Staleness",
        body: "v1 body.",
      });

      // Simulate build hash being set
      const projDir = path.join(root, `project-proj-stale2`);
      const indexPath = path.join(projDir, "epics", "epic-stale2", "artifacts", "artifacts.json");
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      index.artifacts[0].buildSpecHash = index.artifacts[0].currentSpecHash;
      index.artifacts[0].status = "built";
      writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");

      // Update the spec body
      const updated = await svc.updateArtifact("proj-stale2", "epic-stale2", artifact.id, {
        body: "v2 body — changed!",
      });

      expect(updated!.status).toBe("stale");
      expect(updated!.currentSpecHash).not.toBe(updated!.buildSpecHash);
    });
  });

  // ── Preview HTML ─────────────────────────────────────────────

  describe("preview HTML", () => {
    it("injects annotation script into preview HTML", async () => {
      const projDir = scaffoldProject(root, "proj-preview", "epic-preview");
      const artifact = await svc.createArtifact("proj-preview", "epic-preview", { title: "Preview" });

      writeMockHtml(projDir, "epic-preview", artifact.id, SAMPLE_HTML);

      const preview = await svc.getPreviewHtml("proj-preview", "epic-preview", artifact.id);
      expect(preview).not.toBeNull();
      expect(preview).toContain("enter-annotation-mode");
      expect(preview).toContain("annotation-selected");
      expect(preview).toContain("__codascope-overlay");
    });

    it("returns null for artifact without built HTML", async () => {
      scaffoldProject(root, "proj-nopreview", "epic-nopreview");
      const artifact = await svc.createArtifact("proj-nopreview", "epic-nopreview", { title: "No Preview" });

      const preview = await svc.getPreviewHtml("proj-nopreview", "epic-nopreview", artifact.id);
      expect(preview).toBeNull();
    });
  });

  // ── buildArtifact (agent stub) ────────────────────────────────

  describe("buildArtifact", () => {
    it("throws when agent service not configured", async () => {
      scaffoldProject(root, "proj-build", "epic-build");
      const artifact = await svc.createArtifact("proj-build", "epic-build", { title: "Build Test" });

      await expect(
        svc.buildArtifact("proj-build", "epic-build", artifact.id),
      ).rejects.toThrow("Agent service not configured");
    });
  });
});
