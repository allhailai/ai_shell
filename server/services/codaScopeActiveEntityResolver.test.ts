import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodaScopeActiveEntityResolver } from "./codaScopeActiveEntityResolver.js";
import { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";

const roots: string[] = [];
const NOW = "2026-07-25T12:00:00.000Z";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CodaScopeActiveEntityResolver", () => {
  it("enumerates only active projects and revalidates archived direct IDs", async () => {
    const root = tempRoot();
    writeProject(root, "active-dir", projectMetadata("project-active", "Active"));
    writeProject(root, "archived-dir", {
      ...projectMetadata("project-archived", "Archived"),
      archived: true,
    });
    const resolver = makeResolver(root);

    expect((await resolver.listActiveProjects()).map((project) => project.projectId))
      .toEqual(["project-active"]);
    expect(await resolver.resolveActiveProject("project-archived")).toBeNull();

    const activePath = path.join(root, "active-dir", "project.json");
    writeJson(activePath, {
      ...projectMetadata("project-active", "Active"),
      archived: true,
    });
    expect(await resolver.resolveActiveProject("project-active")).toBeNull();
  });

  it("fails closed for malformed project metadata and duplicate IDs", async () => {
    const corruptRoot = tempRoot();
    const corruptDir = path.join(corruptRoot, "corrupt");
    mkdirSync(corruptDir, { recursive: true });
    writeFileSync(path.join(corruptDir, "project.json"), "{bad json", "utf-8");
    await expect(makeResolver(corruptRoot).listActiveProjects()).rejects.toMatchObject({
      code: "persistence_corrupt",
      status: 500,
    });

    const duplicateRoot = tempRoot();
    writeProject(duplicateRoot, "one", projectMetadata("duplicate-id", "One"));
    writeProject(duplicateRoot, "two", projectMetadata("duplicate-id", "Two"));
    await expect(makeResolver(duplicateRoot).listActiveProjects()).rejects.toMatchObject({
      code: "persistence_corrupt",
      status: 500,
    });
  });

  it("resolves epics only from the authoritative active index", async () => {
    const root = tempRoot();
    const projectDir = writeProject(root, "project", projectMetadata("project", "Project"));
    writeEpic(projectDir, "project", "epic-active", "designing");
    const archivedDir = path.join(projectDir, "epics", "_archive", "epic-archived");
    mkdirSync(archivedDir, { recursive: true });
    writeJson(path.join(archivedDir, "epic.json"), {
      ...epicMetadata("project", "epic-archived", "archived"),
      conversationId: null,
    });
    writeJson(path.join(projectDir, "epics", "epics.json"), {
      epics: [epicMetadata("project", "epic-active", "designing")],
    });

    const resolver = makeResolver(root);
    expect((await resolver.resolveActiveEpic("project", "epic-active"))?.epic.id)
      .toBe("epic-active");
    expect(await resolver.resolveActiveEpic("project", "epic-archived")).toBeNull();
    expect(await resolver.resolveActiveEpic("missing", "epic-active")).toBeNull();
  });

  it("rejects archived designs exactly like absence", async () => {
    const root = tempRoot();
    const projectDir = writeProject(root, "project", projectMetadata("project", "Project"));
    writeEpic(projectDir, "project", "epic-active", "designing");
    writeJson(path.join(projectDir, "epics", "epics.json"), {
      epics: [epicMetadata("project", "epic-active", "designing")],
    });
    const designsDir = path.join(projectDir, "epics", "epic-active", "designs");
    mkdirSync(path.join(designsDir, "doc-active"), { recursive: true });
    mkdirSync(path.join(designsDir, "doc-archived"), { recursive: true });
    writeFileSync(path.join(designsDir, "doc-active", "content.md"), "Active", "utf-8");
    writeFileSync(path.join(designsDir, "doc-archived", "content.md"), "Archived", "utf-8");
    writeJson(path.join(designsDir, "designs.json"), {
      docs: [
        designMetadata("epic-active", "doc-active"),
        { ...designMetadata("epic-active", "doc-archived"), archivedAt: NOW },
      ],
    });

    const resolver = makeResolver(root);
    expect((await resolver.resolveActiveDesign("project", "epic-active", "doc-active"))?.document.id)
      .toBe("doc-active");
    expect(await resolver.resolveActiveDesign("project", "epic-active", "doc-archived"))
      .toBeNull();
  });

  it("fails closed for a corrupt authoritative epic index", async () => {
    const root = tempRoot();
    const projectDir = writeProject(root, "project", projectMetadata("project", "Project"));
    writeEpic(projectDir, "project", "epic-active", "designing");
    writeJson(path.join(projectDir, "epics", "epics.json"), {
      epics: [
        epicMetadata("project", "epic-active", "designing"),
        epicMetadata("project", "epic-active", "designing"),
      ],
    });

    await expect(makeResolver(root).resolveActiveEpic("project", "epic-active"))
      .rejects.toMatchObject({ code: "persistence_corrupt" });
  });
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "codascope-active-resolver-"));
  roots.push(root);
  return root;
}

function makeResolver(root: string): CodaScopeActiveEntityResolver {
  return new CodaScopeActiveEntityResolver(root, new CodaScopeDesignDocService(root));
}

function writeProject(
  root: string,
  directory: string,
  metadata: Record<string, unknown>,
): string {
  const projectDir = path.join(root, directory);
  mkdirSync(path.join(projectDir, "wiki"), { recursive: true });
  writeJson(path.join(projectDir, "project.json"), metadata);
  return projectDir;
}

function projectMetadata(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    description: `${name} description`,
    repositories: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function writeEpic(
  projectDir: string,
  projectId: string,
  epicId: string,
  status: "designing" | "archived",
): void {
  const epicDir = path.join(projectDir, "epics", epicId);
  mkdirSync(epicDir, { recursive: true });
  writeJson(path.join(epicDir, "epic.json"), {
    ...epicMetadata(projectId, epicId, status),
    conversationId: null,
  });
}

function epicMetadata(
  projectId: string,
  id: string,
  status: "designing" | "archived",
): Record<string, unknown> {
  return {
    id,
    projectId,
    title: id,
    status,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: "tester",
    collaborators: ["tester"],
    currentVersion: 0,
  };
}

function designMetadata(epicId: string, id: string): Record<string, unknown> {
  return {
    id,
    epicId,
    title: id,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: "tester",
    wordCount: 1,
    blockCount: 1,
    annotationCount: 0,
    directiveCount: 0,
  };
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}
