import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
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
import {
  CodaScopeDirectiveError,
  CodaScopeDirectiveService,
} from "./codaScopeDirectiveService.js";
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

async function scaffoldDirectiveDesign(
  root: string,
  content = "Original content.",
): Promise<{
  projectDir: string;
  epicDir: string;
  designService: CodaScopeDesignDocService;
  directiveService: CodaScopeDirectiveService;
  documentId: string;
  directiveId: string;
}> {
  const projectDir = scaffoldProject(root);
  const epicDir = scaffoldEpic(projectDir);
  const designService = new CodaScopeDesignDocService(root);
  const doc = await designService.createDesignDoc(
    "project-id",
    "epic-safe",
    { title: "Directive design", content, createdBy: "alice" },
  );
  const directiveService = new CodaScopeDirectiveService(root);
  const directive = await directiveService.createDirective(
    "project-id",
    "epic-safe",
    doc.id,
    {
      type: "insert",
      afterLine: 1,
      instruction: "Insert generated content",
      author: "alice",
    },
  );
  await directiveService.updateDirective(
    "project-id",
    "epic-safe",
    directive.id,
    doc.id,
    { generatedContent: "Generated content." },
  );
  return {
    projectDir,
    epicDir,
    designService,
    directiveService,
    documentId: doc.id,
    directiveId: directive.id,
  };
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

type AppliedDirectiveFixture = {
  kind: "design" | "definition";
  projectDir: string;
  epicDir: string;
  documentId: string;
  directiveId: string;
  documentPath: string;
  sidecarPath: string;
  metadataPaths: string[];
  versionsDir: string;
  designService: CodaScopeDesignDocService;
  directiveService: CodaScopeDirectiveService;
};

async function scaffoldAppliedDirective(
  root: string,
  kind: AppliedDirectiveFixture["kind"],
): Promise<AppliedDirectiveFixture> {
  if (kind === "design") {
    const setup = await scaffoldDirectiveDesign(root);
    await setup.directiveService.applyDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      setup.directiveId,
      "apply-author",
    );
    const documentDir = path.join(setup.epicDir, "designs", setup.documentId);
    return {
      kind,
      projectDir: setup.projectDir,
      epicDir: setup.epicDir,
      documentId: setup.documentId,
      directiveId: setup.directiveId,
      documentPath: path.join(documentDir, "content.md"),
      sidecarPath: path.join(
        setup.epicDir,
        "directives",
        `${setup.documentId}-directives.json`,
      ),
      metadataPaths: [
        path.join(setup.epicDir, "designs", "designs.json"),
        path.join(setup.epicDir, "epic.json"),
      ],
      versionsDir: path.join(documentDir, "versions"),
      designService: setup.designService,
      directiveService: setup.directiveService,
    };
  }

  const projectDir = scaffoldProject(root);
  const epicDir = scaffoldEpic(projectDir);
  const designService = new CodaScopeDesignDocService(root);
  const directiveService = new CodaScopeDirectiveService(root);
  const directive = await directiveService.createDirective(
    "project-id",
    "epic-safe",
    "definition",
    {
      type: "insert",
      afterLine: 1,
      instruction: "Insert generated definition",
      author: "alice",
    },
  );
  await directiveService.executeDirective(
    "project-id",
    "epic-safe",
    "definition",
    directive.id,
    "Generated definition.",
  );
  await directiveService.applyDirective(
    "project-id",
    "epic-safe",
    "definition",
    directive.id,
    "apply-author",
  );
  return {
    kind,
    projectDir,
    epicDir,
    documentId: "definition",
    directiveId: directive.id,
    documentPath: path.join(epicDir, "definition.md"),
    sidecarPath: path.join(epicDir, "directives", "definition-directives.json"),
    metadataPaths: [
      path.join(projectDir, "epics", "epics.json"),
      path.join(epicDir, "epic.json"),
    ],
    versionsDir: path.join(epicDir, "versions"),
    designService,
    directiveService,
  };
}

function appliedDirectiveSnapshot(fixture: AppliedDirectiveFixture) {
  return {
    document: readFileSync(fixture.documentPath),
    sidecar: readFileSync(fixture.sidecarPath),
    metadata: fixture.metadataPaths.map((filePath) => readFileSync(filePath)),
    versionIndex: existsSync(path.join(fixture.versionsDir, "versions.json"))
      ? readFileSync(path.join(fixture.versionsDir, "versions.json"))
      : null,
    versionSnapshots: existsSync(fixture.versionsDir)
      ? treeSnapshot(fixture.versionsDir)
      : null,
    completeProject: treeSnapshot(fixture.projectDir),
  };
}

function forbiddenAppliedOperation(
  fixture: AppliedDirectiveFixture,
  operation: "execute" | "reject" | "delete" | "update" | "apply",
): Promise<unknown> {
  if (operation === "execute") {
    return fixture.directiveService.executeDirective(
      "project-id",
      "epic-safe",
      fixture.documentId,
      fixture.directiveId,
      "Regenerated content.",
    );
  }
  if (operation === "reject") {
    return fixture.directiveService.rejectDirective(
      "project-id",
      "epic-safe",
      fixture.documentId,
      fixture.directiveId,
    );
  }
  if (operation === "delete") {
    return fixture.directiveService.deleteDirective(
      "project-id",
      "epic-safe",
      fixture.directiveId,
      fixture.documentId,
    );
  }
  if (operation === "update") {
    return fixture.directiveService.updateDirective(
      "project-id",
      "epic-safe",
      fixture.directiveId,
      fixture.documentId,
      { instruction: "Mutated after apply" },
    );
  }
  return fixture.directiveService.applyDirective(
    "project-id",
    "epic-safe",
    fixture.documentId,
    fixture.directiveId,
    "apply-again-author",
  );
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

class BarrierDesignContentPersistence extends CodaScopePersistence {
  private blockNextContentWrite = true;
  private releaseBlockedWrite: (() => void) | null = null;
  private readonly blockedWriteReleased = new Promise<void>((resolve) => {
    this.releaseBlockedWrite = resolve;
  });
  private signalBlockedWrite: (() => void) | null = null;
  readonly blockedWriteReached = new Promise<void>((resolve) => {
    this.signalBlockedWrite = resolve;
  });

  release(): void {
    this.releaseBlockedWrite?.();
  }

  override async writeFile(
    filePath: string,
    data: string | Uint8Array,
    context: PersistenceContext,
  ): Promise<void> {
    if (context.storage === "design_content" && this.blockNextContentWrite) {
      this.blockNextContentWrite = false;
      this.signalBlockedWrite?.();
      await this.blockedWriteReleased;
    }
    await super.writeFile(filePath, data, context);
  }
}

class RecordingMutationOrderPersistence extends CodaScopePersistence {
  private readonly activeKeys = new AsyncLocalStorage<readonly string[]>();
  readonly acquisitions: string[][] = [];

  override withMutation<T>(key: string, operation: () => Promise<T>): Promise<T> {
    return super.withMutation(key, () => {
      const keys = [...(this.activeKeys.getStore() ?? []), key];
      this.acquisitions.push(keys);
      return this.activeKeys.run(keys, operation);
    });
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

describe("directive document transaction integration", () => {
  it.each([
    ["design", "execute"],
    ["design", "reject"],
    ["design", "delete"],
    ["design", "update"],
    ["design", "apply"],
    ["definition", "execute"],
    ["definition", "reject"],
    ["definition", "delete"],
    ["definition", "update"],
    ["definition", "apply"],
  ] as const)(
    "rejects %s applied directive %s without changing any persisted byte",
    async (kind, operation) => {
      const root = tempRoot();
      const fixture = await scaffoldAppliedDirective(root, kind);
      const before = appliedDirectiveSnapshot(fixture);

      const error = await forbiddenAppliedOperation(fixture, operation)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(CodaScopeDirectiveError);
      expect(error).toMatchObject({ status: 409, code: "conflict" });

      expect(appliedDirectiveSnapshot(fixture)).toEqual(before);
    },
  );

  it("keeps undo intact after every forbidden applied transition and permits deletion afterward", async () => {
    const root = tempRoot();
    const fixture = await scaffoldAppliedDirective(root, "design");
    const applied = appliedDirectiveSnapshot(fixture);

    for (const operation of ["execute", "reject", "delete", "update", "apply"] as const) {
      await expect(forbiddenAppliedOperation(fixture, operation))
        .rejects.toMatchObject({ status: 409, code: "conflict" });
      expect(appliedDirectiveSnapshot(fixture)).toEqual(applied);
    }

    const versionsBeforeUndo = await fixture.designService.listDocVersions(
      "project-id",
      "epic-safe",
      fixture.documentId,
    );
    expect(versionsBeforeUndo).toHaveLength(1);
    const undone = await fixture.directiveService.undoDirective(
      "project-id",
      "epic-safe",
      fixture.documentId,
      fixture.directiveId,
      "principal-alice",
    );

    expect(readFileSync(fixture.documentPath, "utf-8")).toBe("Original content.");
    expect(undone).toMatchObject({
      status: "pending",
      generatedContent: "Generated content.",
      preApplySnapshot: undefined,
      appliedContentHash: undefined,
      linePositionAdjustments: undefined,
      appliedAt: undefined,
    });
    const persistedUndone = JSON.parse(readFileSync(fixture.sidecarPath, "utf-8"))
      .directives[0];
    expect(persistedUndone).not.toHaveProperty("preApplySnapshot");
    expect(persistedUndone).not.toHaveProperty("appliedContentHash");
    expect(persistedUndone).not.toHaveProperty("linePositionAdjustments");
    expect(persistedUndone).not.toHaveProperty("appliedAt");
    const versionsAfterUndo = await fixture.designService.listDocVersions(
      "project-id",
      "epic-safe",
      fixture.documentId,
    );
    expect(versionsAfterUndo).toHaveLength(2);
    expect(versionsAfterUndo.at(-1)?.author).toBe("principal-alice");
    expect((await fixture.designService.getDocVersion(
      "project-id",
      "epic-safe",
      fixture.documentId,
      versionsAfterUndo.at(-1)!.number,
    ))?.content).toBe("Original content.\nGenerated content.");

    await expect(fixture.directiveService.deleteDirective(
      "project-id",
      "epic-safe",
      fixture.directiveId,
      fixture.documentId,
    )).resolves.toBe(true);
    await expect(fixture.directiveService.listDirectives(
      "project-id",
      "epic-safe",
      fixture.documentId,
    )).resolves.toEqual([]);
  });

  it("serializes apply behind a concurrent design edit and transforms the committed content", async () => {
    const root = tempRoot();
    const setup = await scaffoldDirectiveDesign(root, "Original.");
    const persistence = new BarrierDesignContentPersistence();
    const designService = new CodaScopeDesignDocService(root, persistence);
    const directiveService = new CodaScopeDirectiveService(
      root,
      persistence,
      designService,
      new CodaScopeEpicService(root, persistence),
    );

    const concurrentEdit = designService.updateDesignDocWithVersion(
      "project-id",
      "epic-safe",
      setup.documentId,
      "Original.\nConcurrent edit.",
      { author: "bob", summary: "Concurrent edit" },
    );
    await persistence.blockedWriteReached;
    const apply = directiveService.applyDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      setup.directiveId,
      "alice",
    );
    persistence.release();

    const [editResult, applyResult] = await Promise.all([concurrentEdit, apply]);
    expect(editResult && "conflict" in editResult).toBe(false);
    expect(applyResult?.newContent).toBe("Original.\nGenerated content.\nConcurrent edit.");
    expect((await designService.getDesignDoc(
      "project-id",
      "epic-safe",
      setup.documentId,
    ))?.content).toBe("Original.\nGenerated content.\nConcurrent edit.");
    const versions = await designService.listDocVersions(
      "project-id",
      "epic-safe",
      setup.documentId,
    );
    expect(versions).toHaveLength(2);
    expect(versions[1].author).toBe("alice");
    expect((await designService.getDocVersion(
      "project-id",
      "epic-safe",
      setup.documentId,
      versions[1].number,
    ))?.content).toBe("Original.\nConcurrent edit.");
  });

  it("uses document-before-sidecar lock ordering for design and definition mutations", async () => {
    const designRoot = tempRoot();
    const designSetup = await scaffoldDirectiveDesign(designRoot);
    const designPersistence = new RecordingMutationOrderPersistence();
    const designService = new CodaScopeDirectiveService(
      designRoot,
      designPersistence,
      new CodaScopeDesignDocService(designRoot, designPersistence),
      new CodaScopeEpicService(designRoot, designPersistence),
    );
    await designService.applyDirective(
      "project-id",
      "epic-safe",
      designSetup.documentId,
      designSetup.directiveId,
      "alice",
    );
    expect(designPersistence.acquisitions.find((keys) => keys.length === 3))
      .toEqual([
        expect.stringMatching(/^design-index:/),
        expect.stringMatching(/^design-versions:/),
        expect.stringMatching(/^epic-directives:/),
      ]);

    const definitionRoot = tempRoot();
    const definitionProjectDir = scaffoldProject(definitionRoot);
    scaffoldEpic(definitionProjectDir);
    const normal = new CodaScopeDirectiveService(definitionRoot);
    const definitionDirective = await normal.createDirective(
      "project-id",
      "epic-safe",
      "definition",
      {
        type: "insert",
        afterLine: 1,
        instruction: "Definition insert",
        author: "alice",
      },
    );
    await normal.updateDirective(
      "project-id",
      "epic-safe",
      definitionDirective.id,
      "definition",
      { generatedContent: "Generated definition." },
    );
    const definitionPersistence = new RecordingMutationOrderPersistence();
    const definitionService = new CodaScopeDirectiveService(
      definitionRoot,
      definitionPersistence,
      new CodaScopeDesignDocService(definitionRoot, definitionPersistence),
      new CodaScopeEpicService(definitionRoot, definitionPersistence),
    );
    await definitionService.applyDirective(
      "project-id",
      "epic-safe",
      "definition",
      definitionDirective.id,
      "alice",
    );
    expect(definitionPersistence.acquisitions.find((keys) => keys.length === 2))
      .toEqual([
        expect.stringMatching(/^epic-storage:/),
        expect.stringMatching(/^epic-directives:/),
      ]);
  });

  it.each([
    ["content publication", "writeFile", "design_content"],
    ["design index publication", "writeJson", "design_index"],
    ["version snapshot publication", "writeFile", "design_version_snapshot"],
    ["version index publication", "writeJson", "design_versions"],
  ] as const)(
    "leaves apply pending with no ghost version when %s fails",
    async (_name, method, storage) => {
      const root = tempRoot();
      const setup = await scaffoldDirectiveDesign(root);
      const docDir = path.join(
        setup.epicDir,
        "designs",
        setup.documentId,
      );
      const sidecarPath = path.join(
        setup.epicDir,
        "directives",
        `${setup.documentId}-directives.json`,
      );
      const beforeDoc = treeSnapshot(docDir);
      const beforeSidecar = readFileSync(sidecarPath);
      const persistence = new FailOncePersistence(method, storage);
      const designService = new CodaScopeDesignDocService(root, persistence);
      const service = new CodaScopeDirectiveService(
        root,
        persistence,
        designService,
        new CodaScopeEpicService(root, persistence),
      );

      await expect(service.applyDirective(
        "project-id",
        "epic-safe",
        setup.documentId,
        setup.directiveId,
        "alice",
      )).rejects.toMatchObject({ code: "persistence_failed" });

      expect(treeSnapshot(docDir)).toEqual(beforeDoc);
      expect(readFileSync(sidecarPath)).toEqual(beforeSidecar);
      expect(await setup.designService.listDocVersions(
        "project-id",
        "epic-safe",
        setup.documentId,
      )).toEqual([]);
      const storedDirective = (await setup.directiveService.listDirectives(
        "project-id",
        "epic-safe",
        setup.documentId,
      ))[0];
      expect(storedDirective.status).toBe("pending");
      expect(storedDirective).not.toHaveProperty("preApplySnapshot");
      expect(storedDirective).not.toHaveProperty("appliedContentHash");
    },
  );

  it("rolls document, index, version, and sidecar back when sidecar publication fails", async () => {
    const root = tempRoot();
    const setup = await scaffoldDirectiveDesign(root);
    const docDir = path.join(setup.epicDir, "designs", setup.documentId);
    const sidecarPath = path.join(
      setup.epicDir,
      "directives",
      `${setup.documentId}-directives.json`,
    );
    const beforeDoc = treeSnapshot(docDir);
    const beforeSidecar = readFileSync(sidecarPath);
    const persistence = new FailOncePersistence("writeJson", "epic_directives");
    const designService = new CodaScopeDesignDocService(root, persistence);
    const service = new CodaScopeDirectiveService(
      root,
      persistence,
      designService,
      new CodaScopeEpicService(root, persistence),
    );

    await expect(service.applyDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      setup.directiveId,
      "alice",
    )).rejects.toMatchObject({
      code: "persistence_failed",
      context: { storage: "epic_directives" },
    });

    expect(treeSnapshot(docDir)).toEqual(beforeDoc);
    expect(readFileSync(sidecarPath)).toEqual(beforeSidecar);
    expect(await setup.designService.listDocVersions(
      "project-id",
      "epic-safe",
      setup.documentId,
    )).toEqual([]);
  });

  it("rolls an entire batch back when its single sidecar publication fails", async () => {
    const root = tempRoot();
    const setup = await scaffoldDirectiveDesign(root, "Line 1\nLine 2\nLine 3");
    const second = await setup.directiveService.createDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      {
        type: "insert",
        afterLine: 3,
        instruction: "Second batch insert",
        author: "alice",
      },
    );
    await setup.directiveService.updateDirective(
      "project-id",
      "epic-safe",
      second.id,
      setup.documentId,
      { generatedContent: "SECOND" },
    );
    const before = treeSnapshot(setup.projectDir);
    const persistence = new FailOncePersistence("writeJson", "epic_directives");
    const service = new CodaScopeDirectiveService(
      root,
      persistence,
      new CodaScopeDesignDocService(root, persistence),
      new CodaScopeEpicService(root, persistence),
    );

    await expect(service.executeBatchDirectives(
      "project-id",
      "epic-safe",
      setup.documentId,
      "alice",
    )).rejects.toMatchObject({ code: "persistence_failed" });
    expect(treeSnapshot(setup.projectDir)).toEqual(before);
    expect(await setup.designService.listDocVersions(
      "project-id",
      "epic-safe",
      setup.documentId,
    )).toEqual([]);
  });

  it("rejects undo after a later design edit without changing any state", async () => {
    const root = tempRoot();
    const setup = await scaffoldDirectiveDesign(root);
    await setup.directiveService.applyDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      setup.directiveId,
      "alice",
    );
    await setup.designService.updateDesignDocWithVersion(
      "project-id",
      "epic-safe",
      setup.documentId,
      "Later legitimate edit.",
      { author: "bob", summary: "Later edit" },
    );
    const before = treeSnapshot(setup.projectDir);

    await expect(setup.directiveService.undoDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      setup.directiveId,
      "alice",
    )).rejects.toMatchObject({ code: "conflict", status: 409 });
    expect(treeSnapshot(setup.projectDir)).toEqual(before);
  });

  it("fails closed when a legacy applied directive has no applied-content hash", async () => {
    const root = tempRoot();
    const setup = await scaffoldDirectiveDesign(root);
    await setup.directiveService.applyDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      setup.directiveId,
      "alice",
    );
    const sidecarPath = path.join(
      setup.epicDir,
      "directives",
      `${setup.documentId}-directives.json`,
    );
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf-8"));
    delete sidecar.directives[0].appliedContentHash;
    writeJson(sidecarPath, sidecar);
    const before = treeSnapshot(setup.projectDir);

    await expect(setup.directiveService.undoDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      setup.directiveId,
      "alice",
    )).rejects.toMatchObject({ code: "conflict", status: 409 });
    expect(treeSnapshot(setup.projectDir)).toEqual(before);
  });

  it("restores the exact predecessor and peer positions on successful undo", async () => {
    const root = tempRoot();
    const setup = await scaffoldDirectiveDesign(root, "Line 1\nLine 2\nLine 3");
    const peer = await setup.directiveService.createDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      {
        type: "insert",
        afterLine: 3,
        instruction: "Peer directive",
        author: "alice",
      },
    );
    await setup.directiveService.applyDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      setup.directiveId,
      "alice",
    );
    expect((await setup.directiveService.listDirectives(
      "project-id",
      "epic-safe",
      setup.documentId,
    )).find((directive) => directive.id === peer.id)?.afterLine).toBe(4);

    const undone = await setup.directiveService.undoDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      setup.directiveId,
      "alice",
    );

    expect(undone).toMatchObject({
      status: "pending",
      preApplySnapshot: undefined,
      appliedContentHash: undefined,
    });
    expect((await setup.designService.getDesignDoc(
      "project-id",
      "epic-safe",
      setup.documentId,
    ))?.content).toBe("Line 1\nLine 2\nLine 3");
    expect((await setup.directiveService.listDirectives(
      "project-id",
      "epic-safe",
      setup.documentId,
    )).find((directive) => directive.id === peer.id)?.afterLine).toBe(3);
    expect(await setup.designService.listDocVersions(
      "project-id",
      "epic-safe",
      setup.documentId,
    )).toHaveLength(2);
  });

  it("creates one batch version and enforces hash-ordered individual undo", async () => {
    const root = tempRoot();
    const setup = await scaffoldDirectiveDesign(root, "Line 1\nLine 2\nLine 3\nLine 4");
    const second = await setup.directiveService.createDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      {
        type: "insert",
        afterLine: 3,
        instruction: "Second insert",
        author: "alice",
      },
    );
    await setup.directiveService.updateDirective(
      "project-id",
      "epic-safe",
      second.id,
      setup.documentId,
      { generatedContent: "SECOND" },
    );

    const batch = await setup.directiveService.executeBatchDirectives(
      "project-id",
      "epic-safe",
      setup.documentId,
      "alice",
    );
    expect(batch?.applied.map((directive) => directive.id))
      .toEqual([setup.directiveId, second.id]);
    expect(await setup.designService.listDocVersions(
      "project-id",
      "epic-safe",
      setup.documentId,
    )).toHaveLength(1);

    await expect(setup.directiveService.undoDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      setup.directiveId,
      "alice",
    )).rejects.toMatchObject({ code: "conflict" });
    await setup.directiveService.undoDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      second.id,
      "alice",
    );
    expect((await setup.designService.getDesignDoc(
      "project-id",
      "epic-safe",
      setup.documentId,
    ))?.content).toContain("Generated content.");
    expect((await setup.designService.getDesignDoc(
      "project-id",
      "epic-safe",
      setup.documentId,
    ))?.content).not.toContain("SECOND");
    await setup.directiveService.undoDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      setup.directiveId,
      "alice",
    );
    expect((await setup.designService.getDesignDoc(
      "project-id",
      "epic-safe",
      setup.documentId,
    ))?.content).toBe("Line 1\nLine 2\nLine 3\nLine 4");
    expect(await setup.designService.listDocVersions(
      "project-id",
      "epic-safe",
      setup.documentId,
    )).toHaveLength(3);
  });

  it("serializes directive CRUD behind apply without losing either sidecar mutation", async () => {
    const root = tempRoot();
    const setup = await scaffoldDirectiveDesign(root);
    const persistence = new BarrierDesignContentPersistence();
    const designService = new CodaScopeDesignDocService(root, persistence);
    const service = new CodaScopeDirectiveService(
      root,
      persistence,
      designService,
      new CodaScopeEpicService(root, persistence),
    );
    const apply = service.applyDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      setup.directiveId,
      "alice",
    );
    await persistence.blockedWriteReached;
    const create = service.createDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      {
        type: "insert",
        afterLine: 2,
        instruction: "Concurrent CRUD",
        author: "bob",
      },
    );
    persistence.release();
    const [, created] = await Promise.all([apply, create]);

    const directives = await service.listDirectives(
      "project-id",
      "epic-safe",
      setup.documentId,
    );
    expect(directives).toHaveLength(2);
    expect(directives.find((directive) => directive.id === setup.directiveId)?.status)
      .toBe("applied");
    expect(directives.find((directive) => directive.id === created.id)?.author).toBe("bob");
  });

  it("serializes concurrent directive creates without losing records", async () => {
    const root = tempRoot();
    const setup = await scaffoldDirectiveDesign(root);
    await Promise.all(Array.from({ length: 20 }, (_, index) => (
      setup.directiveService.createDirective(
        "project-id",
        "epic-safe",
        setup.documentId,
        {
          type: "insert",
          afterLine: index,
          instruction: `Concurrent ${index}`,
          author: "alice",
        },
      )
    )));
    expect(await setup.directiveService.listDirectives(
      "project-id",
      "epic-safe",
      setup.documentId,
    )).toHaveLength(21);
  });

  it("preserves malformed directive bytes and fails closed on mutation", async () => {
    const root = tempRoot();
    const setup = await scaffoldDirectiveDesign(root);
    const sidecarPath = path.join(
      setup.epicDir,
      "directives",
      `${setup.documentId}-directives.json`,
    );
    const corrupt = "{ malformed-directives";
    writeFileSync(sidecarPath, corrupt, "utf-8");
    const beforeDoc = treeSnapshot(path.join(setup.epicDir, "designs", setup.documentId));

    await expect(setup.directiveService.createDirective(
      "project-id",
      "epic-safe",
      setup.documentId,
      {
        type: "insert",
        afterLine: 1,
        instruction: "Must not overwrite corruption",
        author: "alice",
      },
    )).rejects.toMatchObject({ code: "persistence_corrupt" });
    expect(readFileSync(sidecarPath, "utf-8")).toBe(corrupt);
    expect(treeSnapshot(path.join(setup.epicDir, "designs", setup.documentId))).toEqual(beforeDoc);
  });

  it("rolls definition content and epic metadata back when directive publication fails", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    const epicDir = scaffoldEpic(projectDir);
    const normal = new CodaScopeDirectiveService(root);
    const directive = await normal.createDirective(
      "project-id",
      "epic-safe",
      "definition",
      {
        type: "insert",
        afterLine: 1,
        instruction: "Definition insert",
        author: "alice",
      },
    );
    await normal.updateDirective(
      "project-id",
      "epic-safe",
      directive.id,
      "definition",
      { generatedContent: "Generated definition." },
    );
    const before = treeSnapshot(projectDir);
    const persistence = new FailOncePersistence("writeJson", "epic_directives");
    const service = new CodaScopeDirectiveService(
      root,
      persistence,
      new CodaScopeDesignDocService(root, persistence),
      new CodaScopeEpicService(root, persistence),
    );

    await expect(service.applyDirective(
      "project-id",
      "epic-safe",
      "definition",
      directive.id,
      "alice",
    )).rejects.toMatchObject({ code: "persistence_failed" });
    expect(treeSnapshot(projectDir)).toEqual(before);
    expect(readFileSync(path.join(epicDir, "definition.md"), "utf-8")).toBe("# Original\n");
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

  it("publishes one snapshot when two edits start from the same expected hash", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const normal = new CodaScopeDesignDocService(root);
    const doc = await normal.createDesignDoc(
      "project-id",
      "epic-safe",
      { title: "Doc", content: "Initial content." },
    );
    for (let index = 1; index <= 10; index++) {
      await normal.createVersion("project-id", "epic-safe", doc.id, "seed", `seed-${index}`);
    }
    const observed = await normal.getDesignDoc("project-id", "epic-safe", doc.id);
    expect(observed).not.toBeNull();

    const barrier = new BarrierDesignContentPersistence();
    const service = new CodaScopeDesignDocService(root, barrier);
    const first = service.updateDesignDocWithVersion(
      "project-id",
      "epic-safe",
      doc.id,
      "First committed edit.",
      { author: "alice", summary: "first", expectedHash: observed!.contentHash },
    );
    await barrier.blockedWriteReached;
    const second = service.updateDesignDocWithVersion(
      "project-id",
      "epic-safe",
      doc.id,
      "Conflicting edit.",
      { author: "bob", summary: "second", expectedHash: observed!.contentHash },
    );
    barrier.release();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).not.toBeNull();
    expect(firstResult && "conflict" in firstResult).toBe(false);
    expect(secondResult).toMatchObject({ conflict: true });
    const versions = await service.listDocVersions("project-id", "epic-safe", doc.id);
    expect(versions.map((version) => version.number))
      .toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(versions.at(-1)).toMatchObject({ number: 11, author: "alice", summary: "first" });
    expect((await service.getDocVersion("project-id", "epic-safe", doc.id, 11))?.content)
      .toBe("Initial content.");
    expect((await service.getDesignDoc("project-id", "epic-safe", doc.id))?.content)
      .toBe("First committed edit.");
  });

  it("preserves every committed intermediate state across serialized agent-style edits", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const normal = new CodaScopeDesignDocService(root);
    const doc = await normal.createDesignDoc(
      "project-id",
      "epic-safe",
      { title: "Doc", content: "Initial content." },
    );

    const barrier = new BarrierDesignContentPersistence();
    const service = new CodaScopeDesignDocService(root, barrier);
    const first = service.updateDesignDocWithVersion(
      "project-id",
      "epic-safe",
      doc.id,
      "First agent edit.",
      { author: "agent", summary: "first agent edit" },
    );
    await barrier.blockedWriteReached;
    const second = service.updateDesignDocWithVersion(
      "project-id",
      "epic-safe",
      doc.id,
      "Second agent edit.",
      { author: "agent", summary: "second agent edit" },
    );
    barrier.release();
    const results = await Promise.all([first, second]);

    expect(results.every((result) => result && !("conflict" in result))).toBe(true);
    const versions = await service.listDocVersions("project-id", "epic-safe", doc.id);
    expect(versions.map((version) => version.number)).toEqual([1, 2]);
    expect((await service.getDocVersion("project-id", "epic-safe", doc.id, 1))?.content)
      .toBe("Initial content.");
    expect((await service.getDocVersion("project-id", "epic-safe", doc.id, 2))?.content)
      .toBe("First agent edit.");
    expect((await service.getDesignDoc("project-id", "epic-safe", doc.id))?.content)
      .toBe("Second agent edit.");
  });

  it.each([
    ["content publication", "writeFile", "design_content"],
    ["design index publication", "writeJson", "design_index"],
  ] as const)(
    "rolls back a prepared snapshot when %s fails without pruning history",
    async (_failure, method, storage) => {
      const root = tempRoot();
      const projectDir = scaffoldProject(root);
      scaffoldEpic(projectDir);
      const normal = new CodaScopeDesignDocService(root);
      const doc = await normal.createDesignDoc(
        "project-id",
        "epic-safe",
        { title: "Doc", content: "Original content." },
      );
      for (let index = 1; index <= 10; index++) {
        await normal.createVersion("project-id", "epic-safe", doc.id, "alice", `v${index}`);
      }
      const docDir = path.join(projectDir, "epics", "epic-safe", "designs", doc.id);
      const before = treeSnapshot(docDir);
      const failing = new CodaScopeDesignDocService(
        root,
        new FailOncePersistence(method, storage),
      );

      await expect(failing.updateDesignDocWithVersion(
        "project-id",
        "epic-safe",
        doc.id,
        "Uncommitted content.",
        { author: "alice", summary: "must roll back" },
      )).rejects.toMatchObject({ code: "persistence_failed" });
      expect(treeSnapshot(docDir)).toEqual(before);
      expect((await normal.listDocVersions("project-id", "epic-safe", doc.id)).map((version) => version.number))
        .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    },
  );

  it.each([
    ["content publication", "writeFile", "design_content"],
    ["design index publication", "writeJson", "design_index"],
  ] as const)(
    "does not create a phantom version when directive batch %s fails and restores original content",
    async (_failure, method, storage) => {
      const root = tempRoot();
      const projectDir = scaffoldProject(root);
      scaffoldEpic(projectDir);
      const normal = new CodaScopeDesignDocService(root);
      const doc = await normal.createDesignDoc(
        "project-id",
        "epic-safe",
        { title: "Doc", content: "Original content." },
      );
      for (let index = 1; index <= 10; index++) {
        await normal.createVersion("project-id", "epic-safe", doc.id, "seed", `seed-${index}`);
      }
      const directives = new CodaScopeDirectiveService(root);
      const directive = await directives.createDirective(
        "project-id",
        "epic-safe",
        doc.id,
        {
          type: "insert",
          afterLine: 1,
          instruction: "Insert generated content",
          author: "alice",
        },
      );
      await directives.updateDirective(
        "project-id",
        "epic-safe",
        directive.id,
        doc.id,
        { generatedContent: "Generated content." },
      );
      const docDir = path.join(projectDir, "epics", "epic-safe", "designs", doc.id);
      const sidecarPath = path.join(
        projectDir,
        "epics",
        "epic-safe",
        "directives",
        `${doc.id}-directives.json`,
      );
      const before = treeSnapshot(docDir);
      const beforeSidecar = readFileSync(sidecarPath);
      const failingPersistence = new FailOncePersistence(method, storage);
      const failing = new CodaScopeDesignDocService(root, failingPersistence);
      const failingDirectives = new CodaScopeDirectiveService(
        root,
        failingPersistence,
        failing,
        new CodaScopeEpicService(root, failingPersistence),
      );

      await expect(failingDirectives.executeBatchDirectives(
        "project-id",
        "epic-safe",
        doc.id,
        "alice",
      )).rejects.toMatchObject({
        code: "persistence_failed",
        context: { storage },
      });
      expect(treeSnapshot(docDir)).toEqual(before);
      expect(readFileSync(sidecarPath)).toEqual(beforeSidecar);
      expect((await normal.getDesignDoc("project-id", "epic-safe", doc.id))?.content)
        .toBe("Original content.");
      expect((await normal.listDocVersions("project-id", "epic-safe", doc.id)).map((version) => version.number))
        .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    },
  );

  it("revert creates one undoable snapshot under design-then-version lock order", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const persistence = new RecordingMutationOrderPersistence();
    const service = new CodaScopeDesignDocService(root, persistence);
    const doc = await service.createDesignDoc(
      "project-id",
      "epic-safe",
      { title: "Doc", content: "Initial content." },
    );
    await service.updateDesignDocWithVersion(
      "project-id",
      "epic-safe",
      doc.id,
      "Modified content.",
      { author: "alice", summary: "modify" },
    );
    const before = await service.listDocVersions("project-id", "epic-safe", doc.id);
    persistence.acquisitions.length = 0;

    const reverted = await service.revertToVersion(
      "project-id",
      "epic-safe",
      doc.id,
      1,
      "alice",
    );

    expect(reverted?.content).toBe("Initial content.");
    const after = await service.listDocVersions("project-id", "epic-safe", doc.id);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)?.author).toBe("alice");
    expect((await service.getDocVersion("project-id", "epic-safe", doc.id, after.at(-1)!.number))?.content)
      .toBe("Modified content.");
    const nestedAcquisitions = persistence.acquisitions.filter((keys) => keys.length === 2);
    expect(nestedAcquisitions).toHaveLength(1);
    expect(nestedAcquisitions[0][0]).toMatch(/^design-index:/);
    expect(nestedAcquisitions[0][1]).toMatch(/^design-versions:/);
  });

  it("creates exactly one recoverable pre-delete snapshot", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const service = new CodaScopeDesignDocService(root);
    const original = "# Design\n\n```ts\nconst value = 1;\n```\n\nAfter.";
    const doc = await service.createDesignDoc(
      "project-id",
      "epic-safe",
      { title: "Doc", content: original },
    );

    const result = await service.applyResizeMetadata(
      "project-id",
      "epic-safe",
      doc.id,
      { type: "delete-codeblock", index: 0 },
      { author: "alice", summary: "Delete codeblock" },
    );

    expect(result?.content).not.toContain("const value");
    const versions = await service.listDocVersions("project-id", "epic-safe", doc.id);
    expect(versions).toHaveLength(1);
    expect((await service.getDocVersion("project-id", "epic-safe", doc.id, 1))?.content)
      .toBe(original);
  });

  it("rolls back a destructive edit snapshot when content publication fails", async () => {
    const root = tempRoot();
    const projectDir = scaffoldProject(root);
    scaffoldEpic(projectDir);
    const normal = new CodaScopeDesignDocService(root);
    const original = "# Design\n\n```ts\nconst value = 1;\n```\n\nAfter.";
    const doc = await normal.createDesignDoc(
      "project-id",
      "epic-safe",
      { title: "Doc", content: original },
    );
    const docDir = path.join(projectDir, "epics", "epic-safe", "designs", doc.id);
    const before = treeSnapshot(docDir);
    const failing = new CodaScopeDesignDocService(
      root,
      new FailOncePersistence("writeFile", "design_content"),
    );

    await expect(failing.applyResizeMetadata(
      "project-id",
      "epic-safe",
      doc.id,
      { type: "delete-codeblock", index: 0 },
      { author: "alice", summary: "Delete codeblock" },
    )).rejects.toMatchObject({ code: "persistence_failed" });
    expect(treeSnapshot(docDir)).toEqual(before);
    expect(await normal.listDocVersions("project-id", "epic-safe", doc.id)).toEqual([]);
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
