import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CodaScopePersistence,
  CodaScopePersistenceError,
  type PersistenceContext,
  type StrictJsonReadOptions,
} from "./codaScopePersistence.js";
import { CodaScopeEpicService } from "./codaScopeEpicService.js";
import { CodaScopeAnnotationService } from "./codaScopeAnnotationService.js";
import { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";
import { CodaScopeVersionService } from "./codaScopeVersionService.js";

const roots: string[] = [];
const ALICE = { username: "alice", origin: "user" as const };

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "codascope-persistence-integration-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  const fs = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function scaffoldProject(root: string, projectId = "project-id"): string {
  const projectDir = path.join(root, "project");
  mkdirSync(projectDir, { recursive: true });
  writeJson(path.join(projectDir, "project.json"), { id: projectId, name: "Project" });
  return projectDir;
}

function epicRecord(projectId: string, epicId: string) {
  return {
    id: epicId,
    projectId,
    title: "Durable epic",
    status: "defining" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "alice",
    collaborators: ["alice"],
    currentVersion: 0,
  };
}

function scaffoldEpic(projectDir: string, projectId = "project-id", epicId = "epic-safe"): string {
  const epic = epicRecord(projectId, epicId);
  const epicDir = path.join(projectDir, "epics", epicId);
  mkdirSync(epicDir, { recursive: true });
  writeJson(path.join(projectDir, "epics", "epics.json"), { epics: [epic] });
  writeJson(path.join(epicDir, "epic.json"), { ...epic, conversationId: null });
  writeFileSync(path.join(epicDir, "definition.md"), "# Original\n", "utf-8");
  return epicDir;
}

function treeSnapshot(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const entryPath = path.join(directory, name);
      const relative = path.relative(root, entryPath);
      if (statSync(entryPath).isDirectory()) {
        snapshot[`${relative}/`] = "directory";
        visit(entryPath);
      } else {
        snapshot[relative] = readFileSync(entryPath).toString("base64");
      }
    }
  };
  visit(root);
  return snapshot;
}

class FailOncePersistence extends CodaScopePersistence {
  private failed = false;

  constructor(
    private readonly method: "writeJson" | "writeFile",
    private readonly storage: string,
  ) {
    super();
  }

  override async writeJson(filePath: string, value: unknown, context: PersistenceContext): Promise<void> {
    if (this.method === "writeJson" && context.storage === this.storage && !this.failed) {
      this.failed = true;
      throw new CodaScopePersistenceError(context);
    }
    await super.writeJson(filePath, value, context);
  }

  override async writeFile(filePath: string, data: string | Uint8Array, context: PersistenceContext): Promise<void> {
    if (this.method === "writeFile" && context.storage === this.storage && !this.failed) {
      this.failed = true;
      throw new CodaScopePersistenceError(context);
    }
    await super.writeFile(filePath, data, context);
  }
}

class CoordinateConcurrentMetadataReadsPersistence extends CodaScopePersistence {
  readonly mutationKeys = new Set<string>();
  private metadataReaders = 0;
  private releaseMetadataReaders: (() => void) | null = null;
  private readonly metadataReadersReady = new Promise<void>((resolve) => {
    this.releaseMetadataReaders = resolve;
  });

  override withMutation<T>(key: string, operation: () => Promise<T>): Promise<T> {
    this.mutationKeys.add(key);
    return super.withMutation(key, operation);
  }

  override async readJson<T>(filePath: string, options: StrictJsonReadOptions<T>): Promise<T> {
    const value = await super.readJson(filePath, options);
    if (path.basename(filePath) !== "epic.json" || this.mutationKeys.size < 2) return value;
    this.metadataReaders += 1;
    if (this.metadataReaders === 2) this.releaseMetadataReaders?.();
    await this.metadataReadersReady;
    return value;
  }
}

describe("epic persistence integration", () => {
  it.each(["create", "update", "delete", "archive", "restore"] as const)(
    "preserves corrupt index bytes and the entire epic tree during %s",
    async (operation) => {
      const root = tempRoot();
      const projectDir = scaffoldProject(root);
      const epicDir = scaffoldEpic(projectDir);
      const service = new CodaScopeEpicService(root);
      if (operation === "restore") {
        const archiveDir = path.join(projectDir, "epics", "_archive");
        mkdirSync(archiveDir, { recursive: true });
        const fs = await import("node:fs/promises");
        await fs.rename(epicDir, path.join(archiveDir, "epic-safe"));
      }
      const indexPath = path.join(projectDir, "epics", "epics.json");
      const corrupt = "{ definitely-not-json\n";
      writeFileSync(indexPath, corrupt, "utf-8");
      const before = treeSnapshot(projectDir);
      const request = operation === "create"
        ? service.createEpic("project-id", { title: "Never created" })
        : operation === "update"
          ? service.updateEpic("project-id", "epic-safe", { title: "Never updated" })
          : operation === "delete"
            ? service.deleteEpic("project-id", "epic-safe")
            : operation === "archive"
              ? service.archiveEpic("project-id", "epic-safe")
              : service.restoreEpic("project-id", "epic-safe");
      await expect(request).rejects.toMatchObject({ code: "persistence_corrupt", status: 500 });
      expect(readFileSync(indexPath, "utf-8")).toBe(corrupt);
      expect(treeSnapshot(projectDir)).toEqual(before);
    },
  );

  it("rejects a missing index when active epic directories already exist", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const fs = await import("node:fs/promises");
    await fs.rm(path.join(projectDir, "epics", "epics.json"));
    await expect(new CodaScopeEpicService(root).listEpics("project-id"))
      .rejects.toMatchObject({ code: "persistence_corrupt" });
  });

  it("preserves a missing required metadata state during mutation", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const epicDir = scaffoldEpic(projectDir);
    const fs = await import("node:fs/promises");
    await fs.rm(path.join(epicDir, "epic.json"));
    const before = treeSnapshot(projectDir);

    await expect(new CodaScopeEpicService(root).updateEpic("project-id", "epic-safe", { title: "not written" }))
      .rejects.toMatchObject({ code: "persistence_corrupt" });
    expect(treeSnapshot(projectDir)).toEqual(before);
  });

  it.each([
    ["index projectId", "index-project"],
    ["metadata projectId", "metadata-project"],
    ["metadata id", "metadata-id"],
  ] as const)("preserves poisoned %s identity during mutation", async (_name, poison) => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const epicDir = scaffoldEpic(projectDir);
    if (poison === "index-project") {
      const indexPath = path.join(projectDir, "epics", "epics.json");
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      index.epics[0].projectId = "different-project";
      writeJson(indexPath, index);
    } else {
      const metadataPath = path.join(epicDir, "epic.json");
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
      if (poison === "metadata-project") metadata.projectId = "different-project";
      else metadata.id = "different-epic";
      writeJson(metadataPath, metadata);
    }
    const before = treeSnapshot(projectDir);

    await expect(new CodaScopeEpicService(root).updateEpic("project-id", "epic-safe", { title: "not written" }))
      .rejects.toMatchObject({ code: "persistence_corrupt" });
    expect(treeSnapshot(projectDir)).toEqual(before);
  });

  it("serializes concurrent epic creates without losing index entries", async () => {
    const root = tempRoot();
    scaffoldProject(root);
    const service = new CodaScopeEpicService(root);
    const created = await Promise.all(Array.from({ length: 20 }, (_, index) => (
      service.createEpic("project-id", { title: `Epic ${index}` })
    )));
    expect(new Set(created.map((epic) => epic.id)).size).toBe(20);
    expect(await service.listEpics("project-id")).toHaveLength(20);
  });

  it("serializes concurrent epic updates without losing index entries", async () => {
    const root = tempRoot();
    scaffoldProject(root);
    const service = new CodaScopeEpicService(root);
    const created = await Promise.all(Array.from({ length: 12 }, (_, index) => (
      service.createEpic("project-id", { title: `Before ${index}` })
    )));

    await Promise.all(created.map((epic, index) => (
      service.updateEpic("project-id", epic.id, { title: `After ${index}` })
    )));

    const listed = await service.listEpics("project-id");
    expect(listed).toHaveLength(created.length);
    expect(new Set(listed.map((epic) => epic.id))).toEqual(new Set(created.map((epic) => epic.id)));
    expect(new Set(listed.map((epic) => epic.title))).toEqual(
      new Set(created.map((_, index) => `After ${index}`)),
    );
  });

  it("serializes concurrent updateEpic and createVersion on the same epic metadata key", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const epicDir = scaffoldEpic(projectDir);
    writeJson(path.join(epicDir, "scope.json"), { entries: [], lastScopedAt: null, lastScopedBy: null });
    const persistence = new CoordinateConcurrentMetadataReadsPersistence();
    const epicService = new CodaScopeEpicService(root, persistence);
    const versionService = new CodaScopeVersionService(root, persistence);

    const [updated, version] = await Promise.all([
      epicService.updateEpic("project-id", "epic-safe", { title: "Concurrent title" }),
      versionService.createVersion("project-id", "epic-safe", { createdBy: "alice" }),
    ]);

    expect(updated?.title).toBe("Concurrent title");
    expect(version.version).toBe(1);
    expect(persistence.mutationKeys.size).toBe(1);
    const metadata = JSON.parse(readFileSync(path.join(epicDir, "epic.json"), "utf-8"));
    expect(metadata.title).toBe("Concurrent title");
    expect(metadata.currentVersion).toBe(1);
  });

  it("rolls a newly published epic directory back when index publication fails", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const service = new CodaScopeEpicService(root, new FailOncePersistence("writeJson", "epic_index"));
    await expect(service.createEpic("project-id", { title: "Rollback" }))
      .rejects.toMatchObject({ code: "persistence_failed" });
    const epicsDir = path.join(projectDir, "epics");
    const entries = existsSync(epicsDir) ? readdirSync(epicsDir) : [];
    expect(entries.filter((entry) => entry.startsWith("epic_") || entry.startsWith("."))).toEqual([]);
  });

  it("does not recreate missing indexed definition content during mutation", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const epicDir = scaffoldEpic(projectDir);
    const definitionPath = path.join(epicDir, "definition.md");
    const fs = await import("node:fs/promises");
    await fs.rm(definitionPath);
    const before = treeSnapshot(projectDir);

    await expect(new CodaScopeEpicService(root).updateDefinition("project-id", "epic-safe", "replacement"))
      .rejects.toMatchObject({ code: "persistence_corrupt" });
    expect(treeSnapshot(projectDir)).toEqual(before);
    expect(existsSync(definitionPath)).toBe(false);
  });

  it("restores the original epic when delete index publication fails", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const before = treeSnapshot(projectDir);
    const service = new CodaScopeEpicService(root, new FailOncePersistence("writeJson", "epic_index"));

    await expect(service.deleteEpic("project-id", "epic-safe"))
      .rejects.toMatchObject({ code: "persistence_failed" });
    expect(treeSnapshot(projectDir)).toEqual(before);
    expect(readdirSync(path.join(projectDir, "epics")).filter((entry) => entry.includes(".delete."))).toEqual([]);
  });

  it("keeps the committed delete authoritative when tombstone cleanup fails", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const fs = await import("node:fs/promises");
    const service = new CodaScopeEpicService(root, new CodaScopePersistence(), {
      mkdir: (directory, options) => fs.mkdir(directory, options),
      rename: (source, target) => fs.rename(source, target),
      rm: async (target, options) => {
        if (target.includes(".delete.")) throw Object.assign(new Error("injected tombstone cleanup failure"), { code: "EIO" });
        await fs.rm(target, options);
      },
    });

    await expect(service.deleteEpic("project-id", "epic-safe"))
      .rejects.toMatchObject({ code: "persistence_failed" });
    expect(await new CodaScopeEpicService(root).listEpics("project-id")).toEqual([]);
    expect(existsSync(path.join(projectDir, "epics", "epic-safe"))).toBe(false);
    expect(readdirSync(path.join(projectDir, "epics")).filter((entry) => entry.includes(".delete."))).toHaveLength(1);
  });

  it.each(["archive", "delete", "restore"] as const)(
    "sanitizes %s lifecycle rename failures and preserves the prior tree",
    async (operation) => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const epicDir = scaffoldEpic(projectDir);
    const fs = await import("node:fs/promises");
    if (operation === "restore") {
      const archiveDir = path.join(projectDir, "epics", "_archive");
      mkdirSync(archiveDir, { recursive: true });
      await fs.rename(epicDir, path.join(archiveDir, "epic-safe"));
      writeJson(path.join(projectDir, "epics", "epics.json"), { epics: [] });
    }
    const before = treeSnapshot(projectDir);
    let failRename = true;
    const service = new CodaScopeEpicService(root, new CodaScopePersistence(), {
      mkdir: (directory, options) => fs.mkdir(directory, options),
      rename: async (source, target) => {
        if (failRename) {
          failRename = false;
          throw Object.assign(new Error("injected directory rename failure"), { code: "EIO" });
        }
        await fs.rename(source, target);
      },
      rm: (target, options) => fs.rm(target, options),
    });
    const request = operation === "archive"
      ? service.archiveEpic("project-id", "epic-safe")
      : operation === "delete"
        ? service.deleteEpic("project-id", "epic-safe")
        : service.restoreEpic("project-id", "epic-safe");
    const caught = await request.catch((error: unknown) => error);
    expect(caught).toMatchObject({
      code: "persistence_failed",
      message: "CodaScope could not persist the requested change. Retry after checking storage health.",
    });
    expect(String((caught as Error).message)).not.toContain("injected directory rename failure");
    expect(treeSnapshot(projectDir)).toEqual(before);
    },
  );

  it("sanitizes a lifecycle failure during rollback", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const fs = await import("node:fs/promises");
    let renameCount = 0;
    const service = new CodaScopeEpicService(root, new FailOncePersistence("writeJson", "epic_index"), {
      mkdir: (directory, options) => fs.mkdir(directory, options),
      rename: async (source, target) => {
        renameCount += 1;
        if (renameCount === 2) {
          throw Object.assign(new Error(`/private/tmp/injected rollback failure for ${target}`), { code: "EIO" });
        }
        await fs.rename(source, target);
      },
      rm: (target, options) => fs.rm(target, options),
    });

    const caught = await service.deleteEpic("project-id", "epic-safe").catch((error: unknown) => error);
    expect(caught).toMatchObject({
      code: "persistence_failed",
      message: "CodaScope could not persist the requested change. Retry after checking storage health.",
    });
    expect(JSON.stringify(caught)).not.toContain("/private/tmp");
    expect(String((caught as Error).message)).not.toContain("rollback failure");
  });
});

describe("annotation persistence integration", () => {
  it.each(["create", "update", "delete"] as const)("preserves corrupt discussions during %s", async (operation) => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const epicDir = scaffoldEpic(projectDir);
    const annotationsPath = path.join(epicDir, "annotations", "definition-annotations.json");
    mkdirSync(path.dirname(annotationsPath), { recursive: true });
    const corrupt = "{ corrupt-discussion";
    writeFileSync(annotationsPath, corrupt, "utf-8");
    const service = new CodaScopeAnnotationService(root);
    const request = operation === "create"
      ? service.createAnnotation("project-id", "epic-safe", "definition", ALICE, {
        anchor: { blockId: "b", sectionSlug: "root", anchorText: "text", lineNumber: 1 },
        body: "body",
      })
      : operation === "update"
        ? service.updateAnnotation("project-id", "epic-safe", "ann-existing", ALICE, { body: "changed" })
        : service.deleteAnnotation("project-id", "epic-safe", "ann-existing", ALICE);
    await expect(request).rejects.toMatchObject({ code: "persistence_corrupt" });
    expect(readFileSync(annotationsPath, "utf-8")).toBe(corrupt);
    expect(readdirSync(path.dirname(annotationsPath))).toEqual(["definition-annotations.json"]);
  });

  it("preserves every successful concurrent create and update", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const service = new CodaScopeAnnotationService(root);
    const annotations = await Promise.all(Array.from({ length: 20 }, (_, index) => (
      service.createAnnotation("project-id", "epic-safe", "definition", ALICE, {
        anchor: { blockId: `b${index}`, sectionSlug: "root", anchorText: `text${index}`, lineNumber: index + 1 },
        body: `body-${index}`,
      })
    )));
    await Promise.all(annotations.map((annotation, index) => (
      service.updateAnnotation("project-id", "epic-safe", annotation.id, ALICE, { body: `updated-${index}` })
    )));
    const stored = await service.listAnnotations("project-id", "epic-safe", "definition");
    expect(stored).toHaveLength(20);
    expect(new Set(stored.map((annotation) => annotation.body))).toEqual(
      new Set(Array.from({ length: 20 }, (_, index) => `updated-${index}`)),
    );
  });

  it("leaves the original discussion unchanged on an injected atomic write failure", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const epicDir = scaffoldEpic(projectDir);
    const normal = new CodaScopeAnnotationService(root);
    await normal.createAnnotation("project-id", "epic-safe", "definition", ALICE, {
      anchor: { blockId: "b", sectionSlug: "root", anchorText: "text", lineNumber: 1 },
      body: "original",
    });
    const annotationPath = path.join(epicDir, "annotations", "definition-annotations.json");
    const before = readFileSync(annotationPath);
    const failing = new CodaScopeAnnotationService(root, new FailOncePersistence("writeJson", "epic_annotations"));
    await expect(failing.createAnnotation("project-id", "epic-safe", "definition", ALICE, {
      anchor: { blockId: "b2", sectionSlug: "root", anchorText: "text2", lineNumber: 2 },
      body: "not committed",
    })).rejects.toMatchObject({ code: "persistence_failed" });
    expect(readFileSync(annotationPath)).toEqual(before);
  });
});

describe("version persistence integration", () => {
  it("fails closed on malformed design and epic version indexes before mutation", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const epicDir = scaffoldEpic(projectDir);
    const designService = new CodaScopeDesignDocService(root);
    const doc = await designService.createDesignDoc("project-id", "epic-safe", { title: "Doc", content: "content" });
    const designVersionsDir = path.join(epicDir, "designs", doc.id, "versions");
    mkdirSync(designVersionsDir, { recursive: true });
    writeFileSync(path.join(designVersionsDir, "versions.json"), "{ malformed-design", "utf-8");
    const designBefore = treeSnapshot(path.join(epicDir, "designs", doc.id));
    await expect(designService.createVersion("project-id", "epic-safe", doc.id, "alice", "fails"))
      .rejects.toMatchObject({ code: "persistence_corrupt" });
    expect(treeSnapshot(path.join(epicDir, "designs", doc.id))).toEqual(designBefore);

    const epicVersionsDir = path.join(epicDir, "versions");
    mkdirSync(epicVersionsDir, { recursive: true });
    writeFileSync(path.join(epicVersionsDir, "versions.json"), "{ malformed-epic", "utf-8");
    const epicBefore = treeSnapshot(epicDir);
    await expect(new CodaScopeVersionService(root).createVersion("project-id", "epic-safe", { createdBy: "alice" }))
      .rejects.toMatchObject({ code: "persistence_corrupt" });
    expect(treeSnapshot(epicDir)).toEqual(epicBefore);
  });

  it("preserves poisoned epic metadata identity before version mutation", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const epicDir = scaffoldEpic(projectDir);
    const metadataPath = path.join(epicDir, "epic.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    metadata.projectId = "different-project";
    writeJson(metadataPath, metadata);
    const before = treeSnapshot(projectDir);

    await expect(new CodaScopeVersionService(root).createVersion("project-id", "epic-safe", { createdBy: "alice" }))
      .rejects.toMatchObject({ code: "persistence_corrupt" });
    expect(treeSnapshot(projectDir)).toEqual(before);
  });

  it("does not recreate missing indexed design content during version mutation", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const service = new CodaScopeDesignDocService(root);
    const doc = await service.createDesignDoc("project-id", "epic-safe", { title: "Doc", content: "content" });
    const contentPath = path.join(projectDir, "epics", "epic-safe", "designs", doc.id, "content.md");
    const fs = await import("node:fs/promises");
    await fs.rm(contentPath);
    const before = treeSnapshot(projectDir);

    await expect(service.createVersion("project-id", "epic-safe", doc.id, "alice", "not written"))
      .rejects.toMatchObject({ code: "persistence_corrupt" });
    expect(treeSnapshot(projectDir)).toEqual(before);
    expect(existsSync(contentPath)).toBe(false);
  });

  it("preserves a design version index that references a missing snapshot", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const service = new CodaScopeDesignDocService(root);
    const doc = await service.createDesignDoc("project-id", "epic-safe", { title: "Doc", content: "content" });
    await service.createVersion("project-id", "epic-safe", doc.id, "alice", "v1");
    const versionsDir = path.join(projectDir, "epics", "epic-safe", "designs", doc.id, "versions");
    const fs = await import("node:fs/promises");
    await fs.rm(path.join(versionsDir, "v001.md"));
    const before = treeSnapshot(versionsDir);

    await expect(service.createVersion("project-id", "epic-safe", doc.id, "alice", "not written"))
      .rejects.toMatchObject({ code: "persistence_corrupt" });
    expect(treeSnapshot(versionsDir)).toEqual(before);
  });

  it("preserves an epic version index that references missing snapshot content", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const epicDir = scaffoldEpic(projectDir);
    const service = new CodaScopeVersionService(root);
    await service.createVersion("project-id", "epic-safe", { createdBy: "alice" });
    const versionsDir = path.join(epicDir, "versions");
    const fs = await import("node:fs/promises");
    await fs.rm(path.join(versionsDir, "v1", "definition.md"));
    const before = treeSnapshot(versionsDir);

    await expect(service.createVersion("project-id", "epic-safe", { createdBy: "alice" }))
      .rejects.toMatchObject({ code: "persistence_corrupt" });
    expect(treeSnapshot(versionsDir)).toEqual(before);
  });

  it("allocates unique monotonic design versions concurrently and prunes only after commit", async () => {
    const root = tempRoot();
    scaffoldProject(root);
    scaffoldEpic(path.join(root, "project"));
    const service = new CodaScopeDesignDocService(root);
    const doc = await service.createDesignDoc("project-id", "epic-safe", { title: "Doc", content: "content" });
    const created = await Promise.all(Array.from({ length: 15 }, (_, index) => (
      service.createVersion("project-id", "epic-safe", doc.id, "alice", `v${index}`)
    )));
    expect(created.map((version) => version.number).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    expect((await service.listDocVersions("project-id", "epic-safe", doc.id)).map((version) => version.number))
      .toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("does not prune old design snapshots when index publication fails", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const normal = new CodaScopeDesignDocService(root);
    const doc = await normal.createDesignDoc("project-id", "epic-safe", { title: "Doc", content: "content" });
    for (let index = 0; index < 10; index++) {
      await normal.createVersion("project-id", "epic-safe", doc.id, "alice", `v${index + 1}`);
    }
    const versionsDir = path.join(projectDir, "epics", "epic-safe", "designs", doc.id, "versions");
    const before = treeSnapshot(versionsDir);
    const failing = new CodaScopeDesignDocService(root, new FailOncePersistence("writeJson", "design_versions"));
    await expect(failing.createVersion("project-id", "epic-safe", doc.id, "alice", "fails"))
      .rejects.toMatchObject({ code: "persistence_failed" });
    expect(treeSnapshot(versionsDir)).toEqual(before);
  });

  it("publishes no design snapshot when snapshot writing fails", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const normal = new CodaScopeDesignDocService(root);
    const doc = await normal.createDesignDoc("project-id", "epic-safe", { title: "Doc", content: "content" });
    const failing = new CodaScopeDesignDocService(root, new FailOncePersistence("writeFile", "design_version_snapshot"));
    await expect(failing.createVersion("project-id", "epic-safe", doc.id, "alice", "fails"))
      .rejects.toMatchObject({ code: "persistence_failed" });
    expect(existsSync(path.join(projectDir, "epics", "epic-safe", "designs", doc.id, "versions"))).toBe(false);
  });

  it("allocates unique monotonic epic versions concurrently", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    writeJson(path.join(projectDir, "epics", "epic-safe", "scope.json"), { entries: [], lastScopedAt: null, lastScopedBy: null });
    const service = new CodaScopeVersionService(root);
    const created = await Promise.all(Array.from({ length: 12 }, (_, index) => (
      service.createVersion("project-id", "epic-safe", { createdBy: "alice", label: `v${index}` })
    )));
    expect(created.map((version) => version.version).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });

  it("does not publish a partial epic snapshot when staging writes fail", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const epicDir = scaffoldEpic(projectDir);
    const fs = await import("node:fs/promises");
    let failWrite = true;
    const service = new CodaScopeVersionService(root, new CodaScopePersistence(), {
      mkdir: (directory, options) => fs.mkdir(directory, options),
      writeFile: async (filePath, data, encoding) => {
        if (failWrite) {
          failWrite = false;
          throw Object.assign(new Error("injected snapshot write failure"), { code: "EIO" });
        }
        await fs.writeFile(filePath, data, encoding);
      },
      cp: (source, target, options) => fs.cp(source, target, options),
      rename: (source, target) => fs.rename(source, target),
      rm: (target, options) => fs.rm(target, options),
    });
    await expect(service.createVersion("project-id", "epic-safe", { createdBy: "alice" }))
      .rejects.toMatchObject({ code: "persistence_failed" });
    const versionsDir = path.join(epicDir, "versions");
    expect(existsSync(versionsDir) ? readdirSync(versionsDir) : []).toEqual([]);
  });

  it.each(["epic_versions", "epic_metadata"] as const)(
    "rolls back a published epic snapshot when %s publication fails",
    async (storage) => {
      const root = tempRoot();
      const projectDir = scaffoldProject(root);
      const epicDir = scaffoldEpic(projectDir);
      writeJson(path.join(epicDir, "scope.json"), { entries: [], lastScopedAt: null, lastScopedBy: null });
      const beforeMeta = readFileSync(path.join(epicDir, "epic.json"));
      const failing = new CodaScopeVersionService(root, new FailOncePersistence("writeJson", storage));
      await expect(failing.createVersion("project-id", "epic-safe", { createdBy: "alice" }))
        .rejects.toMatchObject({ code: "persistence_failed" });
      expect(readFileSync(path.join(epicDir, "epic.json"))).toEqual(beforeMeta);
      const versionsDir = path.join(epicDir, "versions");
      const entries = existsSync(versionsDir) ? readdirSync(versionsDir) : [];
      expect(entries).toEqual([]);
    },
  );
});
