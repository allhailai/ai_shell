import { describe, it, expect, afterEach } from "vitest";
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ZipArchive } from "archiver";
import { CodaScopeProjectService } from "./codaScopeProjectService.js";
import { CodaScopeEpicBundleService } from "./codaScopeEpicBundleService.js";

const roots: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codascope-epic-bundle-test-"));
  roots.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function project(root: string, slug: string, id: string): string {
  const projectDir = path.join(root, slug);
  mkdirSync(projectDir, { recursive: true });
  writeJson(path.join(projectDir, "project.json"), {
    id,
    name: slug,
    description: "",
    repositories: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  return projectDir;
}

async function writeExport(service: CodaScopeEpicBundleService, projectId: string, epicId: string, zipPath: string): Promise<void> {
  const bundle = service.createExport(projectId, epicId);
  if (!bundle) throw new Error("Expected export bundle");
  const output = createWriteStream(zipPath);
  const finished = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    bundle.archive.on("error", reject);
  });
  bundle.archive.pipe(output);
  await bundle.archive.finalize();
  await finished;
}

describe("CodaScopeEpicBundleService", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("exports and imports a forked epic with rebased IDs, no locks/chat, and scope warnings", async () => {
    const root = tmpDir();
    const sourceProjectId = "project-source";
    const targetProjectId = "project-target";
    const sourceProjectDir = project(root, "source", sourceProjectId);
    const targetProjectDir = project(root, "target", targetProjectId);
    mkdirSync(path.join(targetProjectDir, "wiki"), { recursive: true });
    writeFileSync(path.join(targetProjectDir, "wiki", "mapped-topic.md"), "# Mapped\n", "utf-8");

    const sourceEpicId = "epic_source123";
    const sourceEpicDir = path.join(sourceProjectDir, "epics", sourceEpicId);
    mkdirSync(sourceEpicDir, { recursive: true });
    writeJson(path.join(sourceEpicDir, "epic.json"), {
      id: sourceEpicId,
      projectId: sourceProjectId,
      title: "Portable Design",
      status: "designing",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      createdBy: "alexa",
      collaborators: ["alexa", "sam"],
      currentVersion: 2,
      conversationId: "conv_should_not_move",
    });
    writeJson(path.join(sourceProjectDir, "epics", "epics.json"), {
      epics: [{
        id: sourceEpicId,
        projectId: sourceProjectId,
        title: "Portable Design",
        status: "designing",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
        createdBy: "alexa",
        collaborators: ["alexa", "sam"],
        currentVersion: 2,
      }],
    });
    writeFileSync(path.join(sourceEpicDir, "definition.md"), "# Portable\n", "utf-8");
    writeJson(path.join(sourceEpicDir, "scope.json"), {
      entries: [
        { topicId: "mapped-topic", topicTitle: "Mapped", type: "existing-wiki", source: "user", included: true },
        { topicId: "missing-topic", topicTitle: "Missing", type: "existing-wiki", source: "user", included: true },
        { topicId: "new-topic", topicTitle: "New", type: "new", source: "user", included: true },
      ],
      lastScopedAt: null,
      lastScopedBy: null,
    });
    writeJson(path.join(sourceEpicDir, "designs", "designs.json"), {
      docs: [{ id: "doc_1", epicId: sourceEpicId, title: "Design", createdAt: "", updatedAt: "", createdBy: "alexa", wordCount: 1, blockCount: 1, annotationCount: 0, directiveCount: 0 }],
    });
    writeJson(path.join(sourceEpicDir, "annotations", "definition-annotations.json"), {
      annotations: [{ id: "ann_1", epicId: sourceEpicId, documentId: "definition" }],
    });
    writeFileSync(path.join(sourceEpicDir, "locks.json"), JSON.stringify({ locks: [{ lockedBy: "alexa" }] }), "utf-8");
    writeJson(path.join(sourceProjectDir, "conversations", "conversations.json"), {
      conversations: [{ id: "conv_should_not_move", epicId: sourceEpicId }],
    });

    const projectSvc = new CodaScopeProjectService(root);
    const bundleSvc = new CodaScopeEpicBundleService(projectSvc);
    const zipPath = path.join(root, "portable-epic.zip");
    await writeExport(bundleSvc, sourceProjectId, sourceEpicId, zipPath);

    const result = await bundleSvc.importEpic(targetProjectId, zipPath);
    expect(result.epic.id).not.toBe(sourceEpicId);
    expect(result.epic.projectId).toBe(targetProjectId);
    expect(result.epic).not.toHaveProperty("conversationId");
    expect(result.unresolvedScopeEntries).toEqual([{ topicId: "missing-topic", topicTitle: "Missing" }]);

    const targetEpicDir = path.join(targetProjectDir, "epics", result.epic.id);
    expect(readFileSync(path.join(targetEpicDir, "definition.md"), "utf-8")).toBe("# Portable\n");
    expect(existsSync(path.join(targetEpicDir, "locks.json"))).toBe(false);
    const targetMetadata = JSON.parse(readFileSync(path.join(targetEpicDir, "epic.json"), "utf-8"));
    expect(targetMetadata).toMatchObject({ id: result.epic.id, projectId: targetProjectId, conversationId: null });
    const annotations = JSON.parse(readFileSync(path.join(targetEpicDir, "annotations", "definition-annotations.json"), "utf-8"));
    expect(annotations.annotations[0].epicId).toBe(result.epic.id);
    const designs = JSON.parse(readFileSync(path.join(targetEpicDir, "designs", "designs.json"), "utf-8"));
    expect(designs.docs[0].epicId).toBe(result.epic.id);
    const targetIndex = JSON.parse(readFileSync(path.join(targetProjectDir, "epics", "epics.json"), "utf-8"));
    expect(targetIndex.epics).toContainEqual(expect.objectContaining({ id: result.epic.id, projectId: targetProjectId }));

    // Export/import only operates on a fork; it does not mutate the source.
    const sourceMetadata = JSON.parse(readFileSync(path.join(sourceEpicDir, "epic.json"), "utf-8"));
    expect(sourceMetadata).toMatchObject({ id: sourceEpicId, projectId: sourceProjectId, conversationId: "conv_should_not_move" });
    expect(existsSync(path.join(sourceEpicDir, "locks.json"))).toBe(true);
  });

  it("rejects an archive whose manifest does not match its epic metadata", async () => {
    const root = tmpDir();
    const sourceProjectId = "project-source";
    const targetProjectId = "project-target";
    const sourceProjectDir = project(root, "source", sourceProjectId);
    project(root, "target", targetProjectId);
    const sourceEpicId = "epic_source123";
    const sourceEpicDir = path.join(sourceProjectDir, "epics", sourceEpicId);
    mkdirSync(sourceEpicDir, { recursive: true });
    writeJson(path.join(sourceEpicDir, "epic.json"), {
      id: sourceEpicId,
      projectId: sourceProjectId,
      title: "Portable Design",
      status: "defining",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      createdBy: "alexa",
      collaborators: ["alexa"],
      currentVersion: 0,
    });

    const badZipPath = path.join(root, "bad-epic.zip");
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const output = createWriteStream(badZipPath);
    const finished = new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
    });
    archive.append(JSON.stringify({
      format: "codascope-epic",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      source: { projectId: sourceProjectId, epicId: "epic_other" },
      includes: { conversations: false, locks: false },
    }), { name: "codascope-epic-manifest.json" });
    archive.directory(sourceEpicDir, "epic");
    archive.pipe(output);
    await archive.finalize();
    await finished;

    const projectSvc = new CodaScopeProjectService(root);
    const bundleSvc = new CodaScopeEpicBundleService(projectSvc);
    await expect(bundleSvc.importEpic(targetProjectId, badZipPath)).rejects.toThrow("manifest and epic metadata do not match");
  });
});
