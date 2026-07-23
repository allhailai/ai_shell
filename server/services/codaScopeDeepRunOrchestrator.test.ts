import { describe, expect, it, vi } from "vitest";
import { runDeepRunPipeline } from "./codaScopeDeepRunOrchestrator.js";

function setup(cancelled: boolean) {
  const events: Array<{ event: string; data: unknown }> = [];
  const buildSvc = {
    isCancelled: vi.fn(() => cancelled),
    failBuild: vi.fn(),
    clearCancellation: vi.fn(),
    completeBuild: vi.fn(),
    getBuildState: vi.fn(() => ({ summary: "Persisted summary" })),
  };
  const services = {
    agentSvc: { send: vi.fn() },
    projectSvc: {
      getProject: vi.fn(async () => ({ id: "project", name: "Project", repositories: [] })),
      getProjectDir: vi.fn(() => "/tmp/project"),
    },
    wikiSvc: {
      listTopics: vi.fn(async () => []),
    },
    buildSvc,
    codeMapSvc: {},
    wikiStateSvc: {},
  };
  const callbacks = {
    sendEvent: (event: string, data: unknown) => events.push({ event, data }),
    sendMessage: vi.fn(),
    isAborted: () => true,
  };
  return { buildSvc, services, callbacks, events };
}

describe("Deep Run persistence outcomes", () => {
  it("persists completion before emitting done", async () => {
    const { buildSvc, services, callbacks, events } = setup(false);

    await runDeepRunPipeline(
      { projectId: "project", modelId: "model" },
      callbacks,
      services as never,
      "run-1",
    );

    expect(buildSvc.completeBuild).toHaveBeenCalledWith(
      "project",
      "run-1",
      0,
      {
        buildType: "deep-run",
        topicsRebuilt: 0,
        syncGitHeads: {},
      },
    );
    expect(buildSvc.failBuild).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({
      event: "done",
      data: { runId: "run-1", buildSummary: "Persisted summary" },
    });
  });

  it("persists cancellation and clears it before emitting cancelled", async () => {
    const { buildSvc, services, callbacks, events } = setup(true);

    await runDeepRunPipeline(
      { projectId: "project", modelId: "model" },
      callbacks,
      services as never,
      "run-1",
    );

    expect(buildSvc.failBuild).toHaveBeenCalledWith(
      "project",
      "run-1",
      "Deep Run cancelled by user",
    );
    expect(buildSvc.clearCancellation).toHaveBeenCalledWith("project");
    expect(buildSvc.completeBuild).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({
      event: "cancelled",
      data: { runId: "run-1" },
    });
  });
});
