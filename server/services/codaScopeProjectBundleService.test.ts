import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  createWriteStream,
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
import { ZipArchive } from "archiver";
import { CodaScopeProjectService } from "./codaScopeProjectService.js";
import {
  CodaScopeProjectBundleService,
  PROJECT_BUNDLE_FORMAT,
  PROJECT_BUNDLE_MANIFEST,
  PROJECT_BUNDLE_VERSION,
  type ProjectBundleManifest,
} from "./codaScopeProjectBundleService.js";
import { openValidatedZipFile, PROJECT_ARCHIVE_LIMITS, readZipEntry } from "./codaScopeZipArchiveService.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "codascope-project-bundle-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CodaScope portable project bundles", () => {
  it("exports only shared allowlisted artifacts with sanitized metadata and repository paths", async () => {
    const fixture = await createCustodyFixture();
    const bundleSvc = new CodaScopeProjectBundleService(fixture.projectSvc);
    const bundle = await bundleSvc.createExport(fixture.project.id);
    expect(bundle).not.toBeNull();

    const zipPath = path.join(fixture.root, "portable.zip");
    await writeArchive(zipPath, bundle!.archive);
    const archive = await openValidatedZipFile(zipPath, PROJECT_ARCHIVE_LIMITS);
    const names = [...archive.entries.keys()].sort();

    expect(names).toContain(PROJECT_BUNDLE_MANIFEST);
    expect(names).toContain("project/project.json");
    expect(names).toContain("project/wiki/architecture.md");
    expect(names).toContain("project/code_map_core.md");
    expect(names).toContain("project/_notes/shared/team.md");
    expect(names).toContain("project/_notes/shared/team.assets/documents/shared/blob");
    expect(names).toContain("project/epics/epic_shared/definition.md");
    expect(names).not.toContain("project/epics/epic_shared/locks.json");
    expect(names.every((name) => !name.includes("conversations"))).toBe(true);
    expect(names.every((name) => !name.includes("private"))).toBe(true);
    expect(names.every((name) => !name.includes("_user-prefs"))).toBe(true);
    expect(names.every((name) => !name.includes("_exports"))).toBe(true);
    expect(names.every((name) => !name.includes("build-logs"))).toBe(true);
    expect(names.every((name) => !name.includes("alice") && !name.includes("bob"))).toBe(true);
    expect(names).not.toContain("project/secrets.json");

    const manifest = JSON.parse((await readZipEntry(archive.entries.get(PROJECT_BUNDLE_MANIFEST)!, 1024 * 1024)).toString("utf-8"));
    expect(manifest).toMatchObject({
      format: PROJECT_BUNDLE_FORMAT,
      formatVersion: PROJECT_BUNDLE_VERSION,
      source: { projectId: fixture.project.id },
      includes: {
        sharedArtifacts: true,
        conversations: false,
        privateNotes: false,
        userPreferences: false,
        actorOwnedExports: false,
        repositoryPaths: false,
      },
    });
    expect(manifest.entries.map((entry: { path: string }) => entry.path).sort())
      .toEqual(names.filter((name) => name !== PROJECT_BUNDLE_MANIFEST));

    const exportedProject = JSON.parse((await readZipEntry(archive.entries.get("project/project.json")!, 1024 * 1024)).toString("utf-8"));
    expect(exportedProject.repositories).toEqual([{ id: fixture.repoId, name: "core", path: "" }]);
    const exportedWiki = (await readZipEntry(archive.entries.get("project/wiki/architecture.md")!, 1024 * 1024)).toString("utf-8");
    expect(exportedWiki).not.toContain(fixture.repositoryPath);
    expect(exportedWiki).toContain("[local-path-removed]");

    const epicIndex = JSON.parse((await readZipEntry(archive.entries.get("project/epics/epics.json")!, 1024 * 1024)).toString("utf-8"));
    expect(epicIndex.epics[0].conversationId).toBeNull();
  });

  it("imports a valid bundle atomically with fresh IDs and repository remapping required", async () => {
    const fixture = await createCustodyFixture();
    const bundleSvc = new CodaScopeProjectBundleService(fixture.projectSvc);
    const bundle = await bundleSvc.createExport(fixture.project.id);
    const zipPath = path.join(fixture.root, "round-trip.zip");
    await writeArchive(zipPath, bundle!.archive);

    const result = await bundleSvc.importProject(zipPath);
    expect(result.project.id).not.toBe(fixture.project.id);
    expect(result.project.name).toBe("Portable Project (imported)");
    expect(result.needsRepoMapping).toBe(true);
    expect(result.unmappedRepos).toEqual([{ id: fixture.repoId, name: "core", path: "" }]);

    const importedDir = fixture.projectSvc.getProjectDir(result.project.id);
    expect(importedDir).not.toBeNull();
    const importedProject = JSON.parse(readFileSync(path.join(importedDir!, "project.json"), "utf-8"));
    expect(importedProject.repositories[0].path).toBe("");
    expect(readFileSync(path.join(importedDir!, "wiki", "architecture.md"), "utf-8"))
      .not.toContain(fixture.repositoryPath);
    const importedEpic = JSON.parse(readFileSync(path.join(importedDir!, "epics", "epic_shared", "epic.json"), "utf-8"));
    expect(importedEpic.projectId).toBe(result.project.id);
    expect(importedEpic.conversationId).toBeNull();
    expect(existsSync(path.join(importedDir!, "conversations"))).toBe(false);
    expect(existsSync(path.join(importedDir!, "_notes", "private"))).toBe(false);
  });

  it("rejects legacy raw exports and unknown versions without installing a partial project", async () => {
    const root = tempRoot();
    const projectSvc = new CodaScopeProjectService(path.join(root, "projects"));
    await projectSvc.ensureRootExists();
    const bundleSvc = new CodaScopeProjectBundleService(projectSvc);
    const before = visibleProjectDirectories(projectSvc.getRoot());

    const legacyPath = path.join(root, "legacy.zip");
    await writeZip(legacyPath, [{ name: "project.json", content: Buffer.from("{}") }]);
    await expect(bundleSvc.importProject(legacyPath)).rejects.toThrow("Legacy raw project exports are not accepted");

    const unknownPath = path.join(root, "unknown.zip");
    const projectContent = portableProjectJson("source");
    const manifest = { ...validManifest("source", projectContent), formatVersion: 99 };
    await writeZip(unknownPath, [
      { name: PROJECT_BUNDLE_MANIFEST, content: Buffer.from(JSON.stringify(manifest)) },
      { name: "project/project.json", content: projectContent },
    ]);
    await expect(bundleSvc.importProject(unknownPath)).rejects.toThrow("Unsupported project bundle version: 99");
    expect(visibleProjectDirectories(projectSvc.getRoot())).toEqual(before);
  });

  it("rejects unexpected entries and configured limit violations before installation", async () => {
    const root = tempRoot();
    const projectSvc = new CodaScopeProjectService(path.join(root, "projects"));
    await projectSvc.ensureRootExists();
    const projectContent = portableProjectJson("source");
    const manifest = validManifest("source", projectContent);
    const unexpectedPath = path.join(root, "unexpected.zip");
    await writeZip(unexpectedPath, [
      { name: PROJECT_BUNDLE_MANIFEST, content: Buffer.from(JSON.stringify(manifest)) },
      { name: "project/project.json", content: projectContent },
      { name: "private-data.json", content: Buffer.from("{\"owner\":\"alice\"}") },
    ]);

    const bundleSvc = new CodaScopeProjectBundleService(projectSvc);
    await expect(bundleSvc.importProject(unexpectedPath)).rejects.toThrow("Unexpected project bundle entry");
    expect(visibleProjectDirectories(projectSvc.getRoot())).toEqual([]);

    const tinyLimits = { ...PROJECT_ARCHIVE_LIMITS, maxEntryCount: 2 };
    const limitedSvc = new CodaScopeProjectBundleService(projectSvc, tinyLimits);
    await expect(limitedSvc.importProject(unexpectedPath)).rejects.toThrow("more than 2 entries");
    expect(visibleProjectDirectories(projectSvc.getRoot())).toEqual([]);

    const traversalPath = path.join(root, "traversal.zip");
    writeFileSync(traversalPath, storedZip("../project/project.json", projectContent));
    await expect(bundleSvc.importProject(traversalPath)).rejects.toThrow("Unsafe ZIP entry path");
    expect(visibleProjectDirectories(projectSvc.getRoot())).toEqual([]);
  });

  it.each([
    {
      name: "epic index ID",
      entryPath: "project/epics/epics.json",
      metadata: { epics: [{ id: "../..", projectId: "source-project", title: "Unsafe epic" }] },
      message: "Invalid imported epic ID.",
    },
    {
      name: "project skill ID",
      entryPath: "project/skills/safe-skill/skill.json",
      metadata: { id: "../..", name: "Unsafe skill" },
      message: "Invalid imported skill ID.",
    },
    {
      name: "note document ID",
      entryPath: "project/_notes/shared/team.assets/documents/index.json",
      metadata: { version: 1, documents: [{ id: "../..", storedPath: "documents/../../blob" }] },
      message: "Invalid imported document ID.",
    },
    {
      name: "design version number",
      entryPath: "project/epics/epic-safe/designs/doc-safe/versions/versions.json",
      metadata: { versions: [{ number: "../../../import-sentinel" }], maxVersions: 10 },
      message: "Invalid imported design version number.",
    },
    {
      name: "duplicate design version number",
      entryPath: "project/epics/epic-safe/designs/doc-safe/versions/versions.json",
      metadata: { versions: [{ number: 1 }, { number: 1 }], maxVersions: 10 },
      message: "Invalid imported design version number.",
    },
    {
      name: "epic version number",
      entryPath: "project/epics/epic-safe/versions/versions.json",
      metadata: { versions: [{ version: "../../../import-sentinel" }] },
      message: "Invalid imported epic version number.",
    },
  ])("rejects unsafe imported $name without partial installation", async ({ entryPath, metadata, message }) => {
    const root = tempRoot();
    const projectsRoot = path.join(root, "projects");
    const projectSvc = new CodaScopeProjectService(projectsRoot);
    await projectSvc.ensureRootExists();
    writeFileSync(path.join(root, "import.sentinel"), "import-sentinel");

    const projectContent = portableProjectJson("source-project");
    const unsafeContent = Buffer.from(JSON.stringify(metadata));
    const manifest: ProjectBundleManifest = {
      ...validManifest("source-project", projectContent),
      entries: [
        {
          path: "project/project.json",
          size: projectContent.length,
          sha256: createHash("sha256").update(projectContent).digest("hex"),
        },
        {
          path: entryPath,
          size: unsafeContent.length,
          sha256: createHash("sha256").update(unsafeContent).digest("hex"),
        },
      ],
    };
    const zipPath = path.join(root, "unsafe-identifiers.zip");
    await writeZip(zipPath, [
      { name: PROJECT_BUNDLE_MANIFEST, content: Buffer.from(JSON.stringify(manifest)) },
      { name: "project/project.json", content: projectContent },
      { name: entryPath, content: unsafeContent },
    ]);

    const bundleSvc = new CodaScopeProjectBundleService(projectSvc);
    await expect(bundleSvc.importProject(zipPath)).rejects.toMatchObject({
      status: 400,
      code: "invalid_input",
      message,
    });
    expect(visibleProjectDirectories(projectsRoot)).toEqual([]);
    expect(readFileSync(path.join(root, "import.sentinel"), "utf-8")).toBe("import-sentinel");
  });
});

async function createCustodyFixture() {
  const root = tempRoot();
  const projectsRoot = path.join(root, "projects");
  const projectSvc = new CodaScopeProjectService(projectsRoot);
  const project = await projectSvc.createProject("Portable Project", "Shared bundle fixture");
  const repositoryPath = path.join(root, "source-repositories", "core");
  const repository = await projectSvc.addRepository(project.id, { name: "core", path: repositoryPath });
  const projectDir = projectSvc.getProjectDir(project.id)!;

  writeText(path.join(projectDir, "wiki", "architecture.md"), `Read ${repositoryPath}/src/index.ts`);
  writeText(path.join(projectDir, "code_map_core.md"), `Repository: ${repositoryPath}`);
  writeText(path.join(projectDir, "wiki-state.json"), JSON.stringify({ version: 1, topics: {} }));
  writeText(path.join(projectDir, "_notes", "shared", "team.md"), "# Shared note");
  writeText(path.join(projectDir, "_notes", "shared", "team.assets", "documents", "shared", "blob"), "shared document");

  writeText(path.join(projectDir, "epics", "epics.json"), JSON.stringify({
    epics: [{ id: "epic_shared", projectId: project.id, title: "Shared epic", conversationId: "conv_alice" }],
  }));
  writeText(path.join(projectDir, "epics", "epic_shared", "epic.json"), JSON.stringify({
    id: "epic_shared",
    projectId: project.id,
    title: "Shared epic",
    status: "defining",
    collaborators: [],
    conversationId: "conv_alice",
  }));
  writeText(path.join(projectDir, "epics", "epic_shared", "definition.md"), "# Shared epic");
  writeText(path.join(projectDir, "epics", "epic_shared", "locks.json"), JSON.stringify({ locks: [{ lockedBy: "alice" }] }));

  for (const actor of ["alice", "bob"]) {
    writeText(path.join(projectDir, "conversations", `${actor}.json`), JSON.stringify({ ownerId: actor, messages: ["private"] }));
    writeText(path.join(projectDir, "conversations", `${actor}-images`, "private.png"), "private image");
    writeText(path.join(projectDir, "_notes", "private", actor, "private.md"), `# ${actor} private note`);
    writeText(path.join(projectDir, "_notes", "private", actor, "private.assets", "documents", actor, "blob"), "private document");
    writeText(path.join(projectDir, "_notes", "_user-prefs", actor, "starred.json"), JSON.stringify({ items: [actor] }));
  }
  writeText(path.join(projectDir, "_exports", "alice-export.zip"), "actor-owned export");
  writeText(path.join(projectDir, "build-logs", "run.log"), "operational output");
  writeText(path.join(projectDir, "secrets.json"), JSON.stringify({ token: "do-not-export" }));

  return { root, projectSvc, project, projectDir, repositoryPath, repoId: repository!.id };
}

function validManifest(projectId: string, projectContent: Buffer): ProjectBundleManifest {
  return {
    format: PROJECT_BUNDLE_FORMAT,
    formatVersion: PROJECT_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    source: { projectId },
    includes: {
      sharedArtifacts: true,
      conversations: false,
      conversationImages: false,
      privateNotes: false,
      userPreferences: false,
      actorOwnedExports: false,
      buildLogs: false,
      activeLocks: false,
      repositoryPaths: false,
    },
    entries: [{
      path: "project/project.json",
      size: projectContent.length,
      sha256: createHash("sha256").update(projectContent).digest("hex"),
    }],
  };
}

function portableProjectJson(id: string): Buffer {
  return Buffer.from(JSON.stringify({
    id,
    name: "Imported",
    description: "Portable",
    repositories: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

function writeText(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function visibleProjectDirectories(projectsRoot: string): string[] {
  return readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

async function writeArchive(zipPath: string, archive: ZipArchive): Promise<void> {
  const output = createWriteStream(zipPath);
  const complete = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  await archive.finalize();
  await complete;
}

async function writeZip(zipPath: string, entries: Array<{ name: string; content: Buffer }>): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  for (const entry of entries) archive.append(entry.content, { name: entry.name });
  await writeArchive(zipPath, archive);
}

/** Minimal stored ZIP writer used to preserve an intentionally unsafe name. */
function storedZip(name: string, content: Buffer): Buffer {
  const filename = Buffer.from(name, "utf-8");
  const checksum = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(filename.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(filename.length, 28);

  const localRecord = Buffer.concat([local, filename, content]);
  const centralRecord = Buffer.concat([central, filename]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralRecord.length, 12);
  end.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, end]);
}

function crc32(content: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
