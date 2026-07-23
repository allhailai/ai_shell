import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";

const pipelines = vi.hoisted(() => ({
  analyze: vi.fn(),
  deep: vi.fn(),
}));

vi.mock("../services/codaScopeBuildOrchestrator.js", () => ({
  runAnalyzePipeline: pipelines.analyze,
}));

vi.mock("../services/codaScopeDeepRunOrchestrator.js", () => ({
  runDeepRunPipeline: pipelines.deep,
}));

import { registerBuildRoutes } from "./codaScopeBuildRoutes";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext";

type RegisteredRoute = { method: string; path: string; handlers: RequestHandler[] };

function setup(cancelled = false) {
  const routes: RegisteredRoute[] = [];
  const app = new Proxy({}, {
    get: (_target, method) => (path: string, ...handlers: RequestHandler[]) => {
      routes.push({ method: String(method), path, handlers });
    },
  });
  const buildSvc = {
    registerProjectDir: vi.fn(),
    startBuild: vi.fn(() => "run-1"),
    clearCancellation: vi.fn(),
    isCancelled: vi.fn(() => cancelled),
    addPipelineStep: vi.fn(),
    appendOutput: vi.fn(),
    failBuild: vi.fn(),
    getBuildState: vi.fn(() => ({})),
  };
  registerBuildRoutes({
    app,
    httpError: (message: string, status: number, code: string) => Object.assign(new Error(message), { status, code }),
    ensureServices: async () => ({
      buildSvc,
      projectSvc: {
        validateRepositories: vi.fn(async () => ({ valid: true })),
        getProject: vi.fn(async () => ({ id: "project", repositories: [] })),
        getProjectDir: vi.fn(() => "/tmp/project"),
      },
    }),
    wrap: (handler: RequestHandler) => handler,
    param: (req: { params?: Record<string, string> }, name: string) => req.params?.[name] ?? "",
  } as unknown as CodaScopeRouteContext);
  return { routes, buildSvc };
}

function analyzeRoute(routes: RegisteredRoute[]): RequestHandler {
  return routes.find((candidate) =>
    candidate.method === "post"
    && candidate.path === "/api/codascope/projects/:id/analyze"
  )!.handlers.at(-1)!;
}

function deepRunRoute(routes: RegisteredRoute[]): RequestHandler {
  return routes.find((candidate) =>
    candidate.method === "post"
    && candidate.path === "/api/codascope/projects/:id/deep-run"
  )!.handlers.at(-1)!;
}

function response() {
  const res = {
    writableEnded: false,
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(() => { res.writableEnded = true; }),
    on: vi.fn(),
    status: vi.fn(() => ({ json: vi.fn() })),
  };
  return res;
}

function terminalFrames(res: ReturnType<typeof response>): string[] {
  return res.write.mock.calls
    .map(([frame]) => String(frame))
    .filter((frame) => /^event: (done|error|cancelled)\n/.test(frame));
}

describe("analyze SSE route terminal ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores a late failure after one done terminal", async () => {
    pipelines.analyze.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.sendEvent("done", { runId: "run-1" });
      callbacks.sendEvent("error", { error: "late" });
      throw new Error("late thrown failure");
    });
    const { routes, buildSvc } = setup();
    const res = response();
    analyzeRoute(routes)({ params: { id: "project" }, body: { modelId: "model" } } as never, res as never, vi.fn());

    await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
    expect(terminalFrames(res)).toEqual([
      "event: done\ndata: {\"runId\":\"run-1\"}\n\n",
    ]);
    expect(buildSvc.failBuild).not.toHaveBeenCalled();
    expect(pipelines.analyze).toHaveBeenCalledTimes(1);
    expect(pipelines.deep).not.toHaveBeenCalled();
  });

  it("converts a thrown post-header exception into one error terminal", async () => {
    pipelines.analyze.mockRejectedValueOnce(new Error("pipeline exploded"));
    const { routes, buildSvc } = setup();
    const res = response();
    analyzeRoute(routes)({ params: { id: "project" }, body: { modelId: "model" } } as never, res as never, vi.fn());

    await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
    expect(terminalFrames(res)).toEqual([
      "event: error\ndata: {\"error\":\"pipeline exploded\"}\n\n",
    ]);
    expect(buildSvc.failBuild).toHaveBeenCalledTimes(1);
  });

  it("turns cancellation into one cancelled terminal, never done", async () => {
    pipelines.analyze.mockResolvedValueOnce(undefined);
    const { routes, buildSvc } = setup(true);
    const res = response();
    analyzeRoute(routes)({ params: { id: "project" }, body: { modelId: "model" } } as never, res as never, vi.fn());

    await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
    expect(terminalFrames(res)).toEqual([
      "event: cancelled\ndata: {\"runId\":\"run-1\"}\n\n",
    ]);
    expect(buildSvc.failBuild).toHaveBeenCalledTimes(1);
  });
});

describe("Deep Run SSE route terminal ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches to the Deep Run owner and ignores a late failure after done", async () => {
    pipelines.deep.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.sendEvent("done", { runId: "run-1" });
      callbacks.sendEvent("error", { error: "late" });
      throw new Error("late thrown failure");
    });
    const { routes, buildSvc } = setup();
    const res = response();
    deepRunRoute(routes)({ params: { id: "project" }, body: { modelId: "model" } } as never, res as never, vi.fn());

    await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
    expect(terminalFrames(res)).toEqual([
      "event: done\ndata: {\"runId\":\"run-1\"}\n\n",
    ]);
    expect(buildSvc.failBuild).not.toHaveBeenCalled();
    expect(pipelines.deep).toHaveBeenCalledTimes(1);
    expect(pipelines.analyze).not.toHaveBeenCalled();
  });

  it("persists a thrown post-header failure and emits one error terminal", async () => {
    pipelines.deep.mockRejectedValueOnce(new Error("deep pipeline exploded"));
    const { routes, buildSvc } = setup();
    const res = response();
    deepRunRoute(routes)({ params: { id: "project" }, body: { modelId: "model" } } as never, res as never, vi.fn());

    await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
    expect(terminalFrames(res)).toEqual([
      "event: error\ndata: {\"error\":\"deep pipeline exploded\"}\n\n",
    ]);
    expect(buildSvc.failBuild).toHaveBeenCalledWith(
      "project",
      "run-1",
      "deep pipeline exploded",
    );
  });

  it("persists cancellation and emits one cancelled terminal, never done", async () => {
    pipelines.deep.mockResolvedValueOnce(undefined);
    const { routes, buildSvc } = setup(true);
    const res = response();
    deepRunRoute(routes)({ params: { id: "project" }, body: { modelId: "model" } } as never, res as never, vi.fn());

    await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
    expect(terminalFrames(res)).toEqual([
      "event: cancelled\ndata: {\"runId\":\"run-1\"}\n\n",
    ]);
    expect(buildSvc.failBuild).toHaveBeenCalledWith(
      "project",
      "run-1",
      "Deep Run cancelled.",
    );
  });
});
