import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodaScopeBuildStateService } from "./codaScopeBuildStateService";

const tempRoots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("build state lookup by run ID", () => {
  it("finds scoped reconnect runs without crossing project custody", () => {
    const root = mkdtempSync(path.join(tmpdir(), "codascope-build-state-"));
    tempRoots.push(root);
    const projectA = path.join(root, "project-a");
    const projectB = path.join(root, "project-b");
    mkdirSync(projectA);
    mkdirSync(projectB);

    const service = new CodaScopeBuildStateService(root);
    service.registerProjectDir("project-a", projectA);
    service.registerProjectDir("project-b", projectB);
    const runId = service.startBuild("project-a", "research", "model", "research::epic")!;

    expect(service.getBuildStateByRunId("project-a", runId)).toMatchObject({
      runId,
      scope: "research::epic",
      status: "building",
    });
    expect(service.getBuildStateByRunId("project-b", runId)).toBeNull();

    service.completeBuild("project-a", runId, undefined, undefined, "research::epic");
    const restarted = new CodaScopeBuildStateService(root);
    restarted.registerProjectDir("project-a", projectA);
    expect(restarted.getBuildStateByRunId("project-a", runId)).toMatchObject({
      runId,
      scope: "research::epic",
      status: "complete",
    });
  });

  it("repairs a scoped persisted building run when a restarted instance reads it by run ID", () => {
    const root = mkdtempSync(path.join(tmpdir(), "codascope-build-state-restart-"));
    tempRoots.push(root);
    const projectDir = path.join(root, "project-a");
    mkdirSync(projectDir);

    const original = new CodaScopeBuildStateService(root);
    original.registerProjectDir("project-a", projectDir);
    const runId = original.startBuild(
      "project-a",
      "research",
      "model",
      "research::epic",
    )!;

    const restarted = new CodaScopeBuildStateService(root);
    restarted.registerProjectDir("project-a", projectDir);
    const repaired = restarted.getBuildStateByRunId("project-a", runId);

    expect(repaired).toMatchObject({
      runId,
      scope: "research::epic",
      status: "error",
      error: "Build was interrupted by server restart.",
    });
    expect(repaired?.completedAt).toEqual(expect.any(String));
    expect(repaired?.summary).toMatch(/^Interrupted after /);

    const persisted = JSON.parse(readFileSync(
      path.join(projectDir, "build-logs", `${runId}.json`),
      "utf-8",
    ));
    expect(persisted).toMatchObject({
      runId,
      scope: "research::epic",
      status: "error",
      completedAt: repaired?.completedAt,
      summary: repaired?.summary,
      error: "Build was interrupted by server restart.",
    });
    expect(persisted.durationMs).toEqual(expect.any(Number));
  });
});

describe("workspace Analyze and Deep Run history", () => {
  it("persists Analyze classification from start through failure", () => {
    const { service, projectDir } = makeService();
    const runId = service.startBuild(
      "project",
      "analyze",
      "model",
      undefined,
      "analyze",
    )!;

    expect(JSON.parse(readFileSync(
      path.join(projectDir, "build-logs", `${runId}.json`),
      "utf-8",
    ))).toMatchObject({
      runId,
      status: "building",
      buildType: "analyze",
    });

    service.failBuild("project", runId, "analysis failed");
    expect(service.readWorkspaceBuildHistory("project")).toMatchObject({
      latestAttempt: {
        runId,
        buildType: "analyze",
        status: "error",
        error: "analysis failed",
      },
    });
  });

  it("persists Deep Run classification from start through failure", () => {
    const { service, projectDir } = makeService();
    const runId = service.startBuild(
      "project",
      "deep-run",
      "model",
      undefined,
      "deep-run",
    )!;
    service.failBuild("project", runId, "deep run failed");

    const persisted = JSON.parse(readFileSync(
      path.join(projectDir, "build-logs", `${runId}.json`),
      "utf-8",
    ));
    expect(persisted).toMatchObject({
      runId,
      status: "error",
      buildType: "deep-run",
      error: "deep run failed",
    });
    expect(service.readWorkspaceBuildHistory("project").attempts[0])
      .toMatchObject({ runId, buildType: "deep-run", status: "error" });
  });

  it("keeps successful wiki, successful Deep Run, and latest-attempt timestamps separate", () => {
    vi.useFakeTimers();
    const { service } = makeService();

    vi.setSystemTime(new Date("2026-07-20T10:00:00.000Z"));
    const deepRunId = service.startBuild(
      "project",
      "deep-run",
      "model",
      undefined,
      "deep-run",
    )!;
    vi.setSystemTime(new Date("2026-07-20T10:05:00.000Z"));
    service.completeBuild("project", deepRunId, 4, {
      buildType: "deep-run",
      topicsRebuilt: 4,
    });

    vi.setSystemTime(new Date("2026-07-21T11:00:00.000Z"));
    const wikiRunId = service.startBuild(
      "project",
      "do_build_wiki_page",
      "model",
      undefined,
      undefined,
      true,
    )!;
    vi.setSystemTime(new Date("2026-07-21T11:01:00.000Z"));
    service.completeBuild("project", wikiRunId, 5);

    vi.setSystemTime(new Date("2026-07-22T12:00:00.000Z"));
    const analyzeId = service.startBuild(
      "project",
      "analyze",
      "model",
      undefined,
      "analyze",
    )!;
    vi.setSystemTime(new Date("2026-07-22T12:02:00.000Z"));
    service.failBuild("project", analyzeId, "latest failure");

    const history = service.readWorkspaceBuildHistory("project");
    expect(history.latestAttempt).toMatchObject({
      runId: analyzeId,
      startedAt: "2026-07-22T12:00:00.000Z",
      status: "error",
    });
    expect(history.lastSuccessfulWikiBuildAt).toBe("2026-07-21T11:01:00.000Z");
    expect(history.lastSuccessfulDeepRunAt).toBe("2026-07-20T10:05:00.000Z");
    expect(history.attempts.map((attempt) => attempt.runId)).toEqual([analyzeId, deepRunId]);
  });

  it("retains Deep Run classification while repairing interrupted restart state", () => {
    const { root, projectDir, service } = makeService();
    const runId = service.startBuild(
      "project",
      "deep-run",
      "model",
      undefined,
      "deep-run",
    )!;

    const restarted = new CodaScopeBuildStateService(root);
    restarted.registerProjectDir("project", projectDir);
    const history = restarted.readWorkspaceBuildHistory("project");
    expect(history.latestAttempt).toMatchObject({
      runId,
      buildType: "deep-run",
      status: "error",
      error: "Build was interrupted by server restart.",
    });
    expect(JSON.parse(readFileSync(
      path.join(projectDir, "build-logs", `${runId}.json`),
      "utf-8",
    ))).toMatchObject({
      buildType: "deep-run",
      status: "error",
      error: "Build was interrupted by server restart.",
    });
  });

  it("classifies exact legacy fields conservatively", () => {
    const { service, projectDir } = makeService();
    const logsDir = path.join(projectDir, "build-logs");
    mkdirSync(logsDir, { recursive: true });
    writeBuildLog(logsDir, "legacy-analyze", {
      runId: "legacy-analyze",
      command: "analyze",
      modelId: "model",
      status: "error",
      startedAt: "2026-07-19T10:00:00.000Z",
      completedAt: "2026-07-19T10:01:00.000Z",
      summary: "failed",
      error: "legacy failure",
      pageCount: null,
      durationMs: 60_000,
    });
    writeBuildLog(logsDir, "legacy-deep", {
      runId: "legacy-deep",
      command: "deep-run",
      modelId: "model",
      status: "complete",
      startedAt: "2026-07-18T10:00:00.000Z",
      completedAt: "2026-07-18T10:02:00.000Z",
      summary: "complete",
      error: null,
      pageCount: 3,
      durationMs: 120_000,
    });

    expect(service.readWorkspaceBuildHistory("project").attempts).toEqual([
      expect.objectContaining({ runId: "legacy-analyze", buildType: "analyze" }),
      expect.objectContaining({ runId: "legacy-deep", buildType: "deep-run" }),
    ]);
  });

  it("excludes scoped and generic runs from project Analyze/Deep Run history", () => {
    const { service } = makeService();
    const generic = service.startBuild("project", "custom-skill", "model")!;
    service.failBuild("project", generic, "generic failure");
    const genericAnalyze = service.startBuild(
      "project",
      "analyze",
      "model",
      undefined,
      undefined,
      true,
    )!;
    service.failBuild("project", genericAnalyze, "generic analyze skill failure");
    const research = service.startBuild("project", "research", "model", "research::epic")!;
    service.failBuild("project", research, "research failure", "research::epic");
    const deepen = service.startBuild("project", "epic-deepen", "model", "epic-deepen::epic")!;
    service.completeBuild("project", deepen, 1, { buildMode: "epic-deepen" }, "epic-deepen::epic");

    expect(service.readWorkspaceBuildHistory("project")).toMatchObject({
      attempts: [],
      latestAttempt: null,
      lastSuccessfulDeepRunAt: null,
    });
  });

  it("fails closed for malformed relevant metadata", () => {
    const { service, projectDir } = makeService();
    const logsDir = path.join(projectDir, "build-logs");
    mkdirSync(logsDir, { recursive: true });
    writeBuildLog(logsDir, "broken", {
      runId: "broken",
      command: "analyze",
      modelId: "model",
      startedAt: "2026-07-18T10:00:00.000Z",
      completedAt: null,
      summary: null,
      error: null,
    });

    expect(() => service.readWorkspaceBuildHistory("project"))
      .toThrow("Persisted CodaScope data is corrupt");
  });
});

function makeService(): {
  root: string;
  projectDir: string;
  service: CodaScopeBuildStateService;
} {
  const root = mkdtempSync(path.join(tmpdir(), "codascope-workspace-build-state-"));
  tempRoots.push(root);
  const projectDir = path.join(root, "project");
  mkdirSync(projectDir);
  const service = new CodaScopeBuildStateService(root);
  service.registerProjectDir("project", projectDir);
  return { root, projectDir, service };
}

function writeBuildLog(
  logsDir: string,
  runId: string,
  value: Record<string, unknown>,
): void {
  writeFileSync(
    path.join(logsDir, `${runId}.json`),
    JSON.stringify(value, null, 2),
    "utf-8",
  );
}
