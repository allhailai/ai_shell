import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CodaScopeWikiStateService,
  type TopicDepthMetrics,
} from "./codaScopeWikiStateService.js";

const roots: string[] = [];
const BUILT_AT = "2026-07-01T00:00:00.000Z";

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("CodaScopeWikiStateService workspace compatibility", () => {
  it("accepts complete current records and recognized legacy records", async () => {
    const { projectDir, service } = fixture();
    writeState(projectDir, {
      index: {
        depth: "outline",
        builtAt: BUILT_AT,
      },
      "platform-architecture": {
        depth: "developed",
        builtAt: BUILT_AT,
      },
      current: {
        depth: "deep",
        builtAt: BUILT_AT,
        deps: ["src/current.ts"],
        metrics: metrics(),
      },
    });

    const state = await service.getWorkspaceWikiState(projectDir);

    expect(state?.topics.index).toEqual({
      depth: "outline",
      builtAt: BUILT_AT,
    });
    expect(state?.topics.current).toMatchObject({
      deps: ["src/current.ts"],
      metrics: metrics(),
    });
    expect(service.getAffectedTopics(
      state!,
      ["src/platform/architecture/service.ts"],
    )).toContain("platform-architecture");
  });

  it.each([
    ["dependencies only", { deps: [] }],
    ["metrics only", { metrics: metrics() }],
    ["invalid dependencies", { deps: null, metrics: metrics() }],
    ["invalid metrics", { deps: [], metrics: {} }],
  ])("rejects partially populated or malformed %s records", async (
    _label,
    enrichment,
  ) => {
    const { projectDir, service } = fixture();
    writeState(projectDir, {
      invalid: {
        depth: "outline",
        builtAt: BUILT_AT,
        ...enrichment,
      },
    });

    await expect(service.getWorkspaceWikiState(projectDir))
      .rejects.toMatchObject({
        code: "persistence_corrupt",
        status: 500,
      });
  });
});

function fixture(): {
  projectDir: string;
  service: CodaScopeWikiStateService;
} {
  const root = mkdtempSync(path.join(os.tmpdir(), "codascope-wiki-state-"));
  roots.push(root);
  const projectDir = path.join(root, "project");
  mkdirSync(projectDir, { recursive: true });
  return {
    projectDir,
    service: new CodaScopeWikiStateService(root),
  };
}

function writeState(
  projectDir: string,
  topics: Record<string, Record<string, unknown>>,
): void {
  writeFileSync(path.join(projectDir, "wiki-state.json"), JSON.stringify({
    version: 1,
    lastBuildAt: BUILT_AT,
    lastBuildMode: "outline",
    gitHeads: {},
    topics,
  }), "utf-8");
}

function metrics(): TopicDepthMetrics {
  return {
    wordCount: 1,
    codeExampleCount: 0,
    fileRefCount: 0,
    fileRefsWithLineNumbers: 0,
    diagramCount: 0,
    crossRefCount: 0,
    hasEdgeCases: false,
    hasPerformanceNotes: false,
    hasTestingStrategy: false,
    hasHistoricalContext: false,
  };
}
