import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodaScopeBuildStateService } from "./codaScopeBuildStateService";

const tempRoots: string[] = [];

afterEach(() => {
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
