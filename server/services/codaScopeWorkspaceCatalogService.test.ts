import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodaScopeActiveEntityResolver } from "./codaScopeActiveEntityResolver.js";
import { CodaScopeBuildStateService } from "./codaScopeBuildStateService.js";
import { CodaScopeCodeMapService } from "./codaScopeCodeMapService.js";
import { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";
import { CodaScopeWikiService } from "./codaScopeWikiService.js";
import { CodaScopeWikiStateService } from "./codaScopeWikiStateService.js";
import {
  CodaScopeWorkspaceCatalogService,
  WORKSPACE_PROJECT_REFERENCE_LIMIT,
  WORKSPACE_PROJECT_FILTER_MAX,
  WORKSPACE_SEARCH_MAX_LIMIT,
  WORKSPACE_SNIPPET_MAX_CHARS,
} from "./codaScopeWorkspaceCatalogService.js";

const roots: string[] = [];
const CREATED_AT = "2026-07-01T00:00:00.000Z";

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CodaScopeWorkspaceCatalogService project overviews", () => {
  it("returns active-only overviews with substantive wiki and separated build timestamps", async () => {
    vi.useFakeTimers();
    const fixture = makeCatalog();
    const secretRepoOne = path.join(fixture.root, "native", "repo-one-secret");
    const secretRepoTwo = path.join(fixture.root, "native", "repo-two-secret");
    const active = writeProject(fixture.root, "active-dir", {
      id: "project-active",
      name: "Active Project",
      description: "An active project",
      repositories: [
        { id: "repo-one", name: "Secret Repo One", path: secretRepoOne },
        { id: "repo-two", name: "Secret Repo Two", path: secretRepoTwo },
      ],
    });
    writeProject(fixture.root, "archived-dir", {
      id: "project-archived",
      name: "Archived Project",
      description: "Archived",
      repositories: [],
      archived: true,
    });
    writeWiki(active, "index", "# Active Project\n\nNavigation only.");
    writeWiki(active, "placeholder", "# Placeholder\n\nComing soon.");
    writeWiki(active, "runtime", "# Runtime\n\nRequests are serialized.");
    writeWikiState(active, {
      lastBuildAt: "2026-07-20T09:00:00.000Z",
      lastSyncAt: "2026-07-18T08:00:00.000Z",
    });

    vi.setSystemTime(new Date("2026-07-19T10:00:00.000Z"));
    fixture.buildSvc.registerProjectDir("project-active", active);
    const deep = fixture.buildSvc.startBuild(
      "project-active",
      "deep-run",
      "model",
      undefined,
      "deep-run",
    )!;
    vi.setSystemTime(new Date("2026-07-19T10:05:00.000Z"));
    fixture.buildSvc.completeBuild("project-active", deep, 1, {
      buildType: "deep-run",
      topicsRebuilt: 1,
    });

    vi.setSystemTime(new Date("2026-07-21T11:00:00.000Z"));
    const analyzeSuccess = fixture.buildSvc.startBuild(
      "project-active",
      "analyze",
      "model",
      undefined,
      "analyze",
    )!;
    vi.setSystemTime(new Date("2026-07-21T11:03:00.000Z"));
    fixture.buildSvc.completeBuild("project-active", analyzeSuccess, 1, {
      buildMode: "outline",
      topicsRebuilt: 1,
    });

    vi.setSystemTime(new Date("2026-07-22T12:00:00.000Z"));
    const analyzeFailure = fixture.buildSvc.startBuild(
      "project-active",
      "analyze",
      "model",
      undefined,
      "analyze",
    )!;
    vi.setSystemTime(new Date("2026-07-22T12:02:00.000Z"));
    fixture.buildSvc.failBuild(
      "project-active",
      analyzeFailure,
      `Could not read ${secretRepoOne}/src/index.ts`,
    );

    const projects = await fixture.catalog.listActiveProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual({
      projectId: "project-active",
      name: "Active Project",
      description: "An active project",
      repositoryCount: 2,
      hasWiki: true,
      substantiveWikiTopicCount: 1,
      currentBuildStatus: "error",
      lastWikiBuildAt: "2026-07-21T11:03:00.000Z",
      lastDeepRunAt: "2026-07-19T10:05:00.000Z",
      lastBuildAttemptAt: "2026-07-22T12:00:00.000Z",
      lastBuildAttemptStatus: "error",
      lastBuildError: expect.stringContaining("[redacted location]"),
    });
    const serialized = JSON.stringify(projects[0]);
    expect(serialized).not.toContain(secretRepoOne);
    expect(serialized).not.toContain(secretRepoTwo);
    expect(serialized).not.toContain("Secret Repo One");
    expect(serialized).not.toContain("Secret Repo Two");
    expect(await fixture.catalog.getWorkspaceStatus()).toEqual({
      activeProjectCount: 1,
      projectsWithWiki: 1,
      projectsBuilding: 0,
      lastWikiBuildAt: "2026-07-21T11:03:00.000Z",
      lastDeepRunAt: "2026-07-19T10:05:00.000Z",
    });

    await expect(fixture.catalog.getProjectOverview("project-archived"))
      .rejects.toMatchObject({ status: 404, code: "not_found" });

    const history = await fixture.catalog.getRelevantBuildHistory("project-active");
    expect(history.attempts[0]).toMatchObject({
      runId: analyzeFailure,
      buildType: "analyze",
      status: "error",
      error: expect.stringContaining("[redacted location]"),
    });
    expect(JSON.stringify(history)).not.toContain(secretRepoOne);
  });

  it("does not treat malformed wiki state as missing freshness", async () => {
    const fixture = makeCatalog();
    const projectDir = writeProject(fixture.root, "project", {
      id: "project",
      name: "Project",
      description: "",
      repositories: [],
    });
    writeFileSync(path.join(projectDir, "wiki-state.json"), "{bad json", "utf-8");

    await expect(fixture.catalog.getProjectOverview("project"))
      .rejects.toMatchObject({ code: "persistence_corrupt", status: 500 });
  });
});

describe("CodaScopeWorkspaceCatalogService project reference catalog", () => {
  it("returns only active bounded display fields in deterministic order", async () => {
    const fixture = makeCatalog();
    const repositoryLocation = path.join(
      fixture.root,
      "native",
      "repository-secret",
    );
    writeProject(fixture.root, "zeta", {
      id: "project-zeta",
      name: "Zeta",
      description: `Uses ${repositoryLocation}`,
      repositories: [{
        id: "secret-repository-id",
        name: "Secret Repository",
        path: repositoryLocation,
      }],
    });
    writeProject(fixture.root, "alpha", {
      id: "project-alpha",
      name: "Alpha",
      description: "First active project",
      repositories: [],
    });
    writeProject(fixture.root, "archived", {
      id: "project-archived",
      name: "Archived",
      description: "Must not be selectable",
      repositories: [],
      archived: true,
    });

    const result = await fixture.catalog.listActiveProjectReferences();

    expect(result).toEqual({
      projects: [
        {
          projectId: "project-alpha",
          name: "Alpha",
          description: "First active project",
        },
        {
          projectId: "project-zeta",
          name: "Zeta",
          description: "Uses [redacted location]",
        },
      ],
      limit: WORKSPACE_PROJECT_REFERENCE_LIMIT,
      truncated: false,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("project-archived");
    expect(serialized).not.toContain(repositoryLocation);
    expect(serialized).not.toContain("Secret Repository");
    expect(Object.keys(result.projects[0])).toEqual([
      "projectId",
      "name",
      "description",
    ]);
  });

  it("fails closed for duplicate, malformed, and oversized project records", async () => {
    const duplicate = makeCatalog();
    writeProject(duplicate.root, "one", {
      id: "ambiguous",
      name: "One",
      description: "",
      repositories: [],
    });
    writeProject(duplicate.root, "two", {
      id: "ambiguous",
      name: "Two",
      description: "",
      repositories: [],
    });
    await expect(duplicate.catalog.listActiveProjectReferences())
      .rejects.toMatchObject({ code: "persistence_corrupt" });

    const malformed = makeCatalog();
    const malformedDir = path.join(malformed.root, "malformed");
    mkdirSync(malformedDir, { recursive: true });
    writeFileSync(path.join(malformedDir, "project.json"), "{bad json", "utf-8");
    await expect(malformed.catalog.listActiveProjectReferences())
      .rejects.toMatchObject({ code: "persistence_corrupt" });

    const oversized = makeCatalog();
    writeProject(oversized.root, "oversized", {
      id: "oversized",
      name: "x".repeat(301),
      description: "",
      repositories: [],
    });
    await expect(oversized.catalog.listActiveProjectReferences())
      .rejects.toMatchObject({ code: "persistence_corrupt" });
  });

  it("applies an explicit deterministic truncation contract", async () => {
    const projects = Array.from(
      { length: WORKSPACE_PROJECT_REFERENCE_LIMIT + 2 },
      (_, index) => ({
        projectId: `project-${String(index).padStart(3, "0")}`,
        name: `Project ${String(
          WORKSPACE_PROJECT_REFERENCE_LIMIT + 2 - index,
        ).padStart(3, "0")}`,
        description: "",
        repositories: [],
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        projectDir: `/tmp/project-${index}`,
      }),
    );
    const resolver = {
      getRoot: () => "/tmp/catalog-root",
      listActiveProjects: vi.fn(async () => projects),
      resolveActiveProject: vi.fn(async (projectId: string) => (
        projects.find((project) => project.projectId === projectId) ?? null
      )),
    } as unknown as CodaScopeActiveEntityResolver;
    const catalog = new CodaScopeWorkspaceCatalogService(
      resolver,
      {} as CodaScopeWikiService,
      {} as CodaScopeWikiStateService,
      {} as CodaScopeBuildStateService,
      {} as CodaScopeCodeMapService,
    );

    const result = await catalog.listActiveProjectReferences();

    expect(result.projects).toHaveLength(WORKSPACE_PROJECT_REFERENCE_LIMIT);
    expect(result.truncated).toBe(true);
    expect(result.limit).toBe(WORKSPACE_PROJECT_REFERENCE_LIMIT);
    expect(result.projects).toEqual([...result.projects].sort((a, b) => (
      a.name.localeCompare(b.name)
      || a.projectId.localeCompare(b.projectId)
    )));
  });
});

describe("CodaScopeWorkspaceCatalogService wiki retrieval", () => {
  it("searches all active projects, ranks globally after per-project collection, and preserves provenance", async () => {
    const fixture = makeCatalog();
    const alpha = writeProject(fixture.root, "alpha-dir", {
      id: "project-alpha",
      name: "Alpha",
      description: "",
      repositories: [],
    });
    const beta = writeProject(fixture.root, "beta-dir", {
      id: "project-beta",
      name: "Beta",
      description: "",
      repositories: [],
    });
    const zeta = writeProject(fixture.root, "zeta-dir", {
      id: "project-zeta",
      name: "Zeta",
      description: "",
      repositories: [],
    });
    const archived = writeProject(fixture.root, "archived-dir", {
      id: "project-archived",
      name: "Archived",
      description: "",
      repositories: [],
      archived: true,
    });
    writeWiki(alpha, "alpha-notes", "# Alpha Notes\n\nThe shared contract differs here.");
    writeWiki(beta, "beta-notes", "# Beta Notes\n\nThe shared contract uses a queue.");
    writeWiki(zeta, "shared-contract", "# Shared Contract\n\nThe canonical result is attributed.");
    writeWiki(archived, "shared-contract", "# Shared Contract\n\nArchived result.");

    const result = await fixture.catalog.searchWorkspaceWikis("shared contract", {
      limit: 2,
      perProjectCandidates: 1,
    });
    expect(result.searchedProjectCount).toBe(3);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      projectId: "project-zeta",
      projectName: "Zeta",
      topicId: "shared-contract",
      topicTitle: "Shared Contract",
      topicUpdatedAt: expect.any(String),
      lastWikiBuildAt: null,
      lastDeepRunAt: null,
      lastBuildAttemptAt: null,
      lastBuildAttemptStatus: null,
      freshnessWarning: expect.any(String),
    });
    expect(result.results.every((entry) => entry.projectId !== "project-archived")).toBe(true);
    expect(result.results.every((entry) => entry.snippet.length <= WORKSPACE_SNIPPET_MAX_CHARS))
      .toBe(true);
    expect(result.truncated).toBe(true);

    const narrowed = await fixture.catalog.searchWorkspaceWikis("shared contract", {
      projectIds: ["project-beta", "project-beta"],
    });
    expect(narrowed.searchedProjectCount).toBe(1);
    expect(narrowed.results.map((entry) => entry.projectId)).toEqual(["project-beta"]);
  });

  it("validates explicit IDs, query bounds, and result bounds", async () => {
    const fixture = makeCatalog();
    writeProject(fixture.root, "project", {
      id: "project",
      name: "Project",
      description: "",
      repositories: [],
    });
    writeProject(fixture.root, "archived", {
      id: "archived",
      name: "Archived",
      description: "",
      repositories: [],
      archived: true,
    });

    await expect(fixture.catalog.searchWorkspaceWikis("x")).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(fixture.catalog.searchWorkspaceWikis("valid", {
      limit: WORKSPACE_SEARCH_MAX_LIMIT + 1,
    })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(fixture.catalog.searchWorkspaceWikis("valid", {
      projectIds: Array.from({ length: WORKSPACE_PROJECT_FILTER_MAX + 1 }, () => "project"),
    })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(fixture.catalog.searchWorkspaceWikis("valid", {
      projectIds: ["missing"],
    })).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(fixture.catalog.searchWorkspaceWikis("valid", {
      projectIds: ["archived"],
    })).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("bounds direct topic reads and treats system, missing, and archived reads as absence", async () => {
    const fixture = makeCatalog();
    const repositoryLocation = path.join(fixture.root, "native", "wiki-repository-secret");
    const projectDir = writeProject(fixture.root, "project", {
      id: "project",
      name: "Project",
      description: "",
      repositories: [{ id: "repo", name: "Repository", path: repositoryLocation }],
    });
    const archivedDir = writeProject(fixture.root, "archived", {
      id: "archived",
      name: "Archived",
      description: "",
      repositories: [],
      archived: true,
    });
    const content = `# Long Topic\n\nNative locations ${projectDir} and ${repositoryLocation}. ${"bounded ".repeat(100)}`;
    writeWiki(projectDir, "long-topic", content);
    writeWiki(projectDir, "index", "# Index\n\nSystem.");
    writeWiki(archivedDir, "long-topic", content);

    const read = await fixture.catalog.readProjectWikiTopic("project", "long-topic", 40);
    expect(read.content).toHaveLength(40);
    expect(read.charCount).toBeLessThan(content.length);
    expect(read.truncated).toBe(true);
    expect(JSON.stringify(read)).not.toContain(projectDir);
    expect(JSON.stringify(read)).not.toContain(repositoryLocation);
    const search = await fixture.catalog.searchProjectWiki("project", "native locations");
    expect(JSON.stringify(search)).not.toContain(projectDir);
    expect(JSON.stringify(search)).not.toContain(repositoryLocation);

    await expect(fixture.catalog.readProjectWikiTopic("project", "index"))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(fixture.catalog.readProjectWikiTopic("project", "missing"))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(fixture.catalog.readProjectWikiTopic("archived", "long-topic"))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});

describe("CodaScopeWorkspaceCatalogService code maps", () => {
  it("bounds code-map reads and removes configured native locations from all DTO values", async () => {
    const fixture = makeCatalog();
    const repositoryLocation = path.join(fixture.root, "native", "repository-secret");
    const projectDir = writeProject(fixture.root, "project", {
      id: "project",
      name: "Project",
      description: "",
      repositories: [{ id: "repo", name: "Repository", path: repositoryLocation }],
    });
    writeFileSync(
      path.join(projectDir, "code_map_core.md"),
      `# Map\n\nProject: ${projectDir}\nRepository: ${repositoryLocation}\n${"detail ".repeat(100)}`,
      "utf-8",
    );
    writeJson(path.join(projectDir, "code_map_core.meta.json"), {
      repoId: "repo",
      repoSlug: "core",
      generatedAt: "2026-07-20T00:00:00.000Z",
      gitHead: null,
      totalFiles: 1,
      languages: ["TypeScript"],
    });

    const listing = await fixture.catalog.listProjectCodeMaps("project");
    expect(listing).toEqual([{
      projectId: "project",
      projectName: "Project",
      codeMapId: "core",
      generatedAt: "2026-07-20T00:00:00.000Z",
    }]);
    const read = await fixture.catalog.readProjectCodeMap("project", "core", 120);
    expect(read.content.length).toBeLessThanOrEqual(120);
    expect(read.truncated).toBe(true);
    const serialized = JSON.stringify({ listing, read });
    expect(serialized).not.toContain(projectDir);
    expect(serialized).not.toContain(repositoryLocation);
    expect(Object.keys(read)).not.toContain("projectPath");
    expect(Object.keys(read)).not.toContain("repositoryPath");
  });

  it("excludes archived projects from code-map listing and direct reads", async () => {
    const fixture = makeCatalog();
    const archivedDir = writeProject(fixture.root, "archived", {
      id: "archived",
      name: "Archived",
      description: "",
      repositories: [],
      archived: true,
    });
    writeFileSync(path.join(archivedDir, "code_map_core.md"), "# Archived map", "utf-8");

    await expect(fixture.catalog.listProjectCodeMaps("archived"))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(fixture.catalog.readProjectCodeMap("archived", "core"))
      .rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});

function makeCatalog(): {
  root: string;
  buildSvc: CodaScopeBuildStateService;
  catalog: CodaScopeWorkspaceCatalogService;
} {
  const root = mkdtempSync(path.join(os.tmpdir(), "codascope-workspace-catalog-"));
  roots.push(root);
  const designSvc = new CodaScopeDesignDocService(root);
  const resolver = new CodaScopeActiveEntityResolver(root, designSvc);
  const buildSvc = new CodaScopeBuildStateService(root);
  const catalog = new CodaScopeWorkspaceCatalogService(
    resolver,
    new CodaScopeWikiService(root),
    new CodaScopeWikiStateService(root),
    buildSvc,
    new CodaScopeCodeMapService(root),
  );
  return { root, buildSvc, catalog };
}

function writeProject(
  root: string,
  directory: string,
  input: {
    id: string;
    name: string;
    description: string;
    repositories: Array<{ id: string; name: string; path: string }>;
    archived?: boolean;
  },
): string {
  const projectDir = path.join(root, directory);
  mkdirSync(path.join(projectDir, "wiki"), { recursive: true });
  writeJson(path.join(projectDir, "project.json"), {
    ...input,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
  return projectDir;
}

function writeWiki(projectDir: string, topicId: string, content: string): void {
  writeFileSync(path.join(projectDir, "wiki", `${topicId}.md`), content, "utf-8");
}

function writeWikiState(
  projectDir: string,
  timestamps: { lastBuildAt: string | null; lastSyncAt?: string },
): void {
  writeJson(path.join(projectDir, "wiki-state.json"), {
    version: 1,
    lastBuildAt: timestamps.lastBuildAt,
    lastBuildMode: timestamps.lastBuildAt ? "full" : null,
    gitHeads: {},
    topics: {},
    ...(timestamps.lastSyncAt ? {
      lastSyncAt: timestamps.lastSyncAt,
      lastSyncGitHeads: {},
      lastSyncRunId: "sync-run",
    } : {}),
  });
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}
