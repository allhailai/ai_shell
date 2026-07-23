import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RequestHandler } from "express";
import { registerBuildRoutes } from "./codaScopeBuildRoutes";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext";
import { CodaScopeBuildStateService } from "../services/codaScopeBuildStateService";

type RegisteredRoute = { method: string; path: string; handlers: RequestHandler[] };
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function registerServices(ensureServices: () => Promise<Record<string, unknown>>): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const app = new Proxy({}, {
    get: (_target, method) => (path: string, ...handlers: RequestHandler[]) => {
      routes.push({ method: String(method), path, handlers });
    },
  });
  registerBuildRoutes({
    app,
    httpError: (message: string, status: number, code: string) => Object.assign(new Error(message), { status, code }),
    ensureServices,
    wrap: (handler: RequestHandler) => handler,
    param: (req: { params?: Record<string, string> }, name: string) => req.params?.[name] ?? "",
  } as unknown as CodaScopeRouteContext);
  return routes;
}

function register(buildState: Record<string, unknown> | null): RegisteredRoute[] {
  return registerServices(async () => ({
    buildSvc: {
      registerProjectDir: vi.fn(),
      getBuildStateByRunId: vi.fn(() => buildState),
      getBuildOutputPath: vi.fn(() => "/tmp/codascope-missing-build-output.log"),
    },
    projectSvc: { getProjectDir: vi.fn(() => null) },
  }));
}

function streamRoute(routes: RegisteredRoute[]): RequestHandler {
  return routes.find((candidate) =>
    candidate.method === "get"
    && candidate.path === "/api/codascope/projects/:id/build-log/:runId/stream"
  )!.handlers.at(-1)!;
}

function response() {
  const res = {
    writableEnded: false,
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(() => { res.writableEnded = true; }),
    on: vi.fn(),
  };
  return res;
}

describe("build log SSE terminal state", () => {
  it("emits an error terminal for a missing run instead of ambiguous EOF", async () => {
    const res = response();
    streamRoute(register(null))(
      { params: { id: "project", runId: "run-1" } } as never,
      res as never,
      vi.fn(),
    );

    await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
    expect(res.write).toHaveBeenCalledWith(
      "event: error\ndata: {\"error\":\"Build run not found.\"}\n\n",
    );
  });

  it.each([
    ["complete", "event: done", null],
    ["error", "event: error", "Persisted build failure"],
  ])("emits one terminal for a persisted %s run", async (status, frame, error) => {
    const res = response();
    streamRoute(register({
      runId: "run-1",
      status,
      summary: status === "complete" ? "Finished" : null,
      error,
      pipelineSteps: [],
    }))(
      { params: { id: "project", runId: "run-1" } } as never,
      res as never,
      vi.fn(),
    );

    await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write.mock.calls[0][0]).toContain(frame);
  });

  it("repairs and terminates a scoped building run after service restart", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "codascope-build-route-restart-"));
    tempRoots.push(root);
    const projectDir = path.join(root, "project");
    mkdirSync(projectDir);

    const original = new CodaScopeBuildStateService(root);
    original.registerProjectDir("project", projectDir);
    const runId = original.startBuild(
      "project",
      "research",
      "model",
      "research::epic",
    )!;

    const restarted = new CodaScopeBuildStateService(root);
    const routes = registerServices(async () => ({
      buildSvc: restarted,
      projectSvc: { getProjectDir: vi.fn(() => projectDir) },
    }));
    const res = response();
    streamRoute(routes)(
      { params: { id: "project", runId } } as never,
      res as never,
      vi.fn(),
    );

    await vi.waitFor(() => expect(res.end).toHaveBeenCalledTimes(1));
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith(
      "event: error\ndata: {\"error\":\"Build was interrupted by server restart.\"}\n\n",
    );
    expect(restarted.getBuildStateByRunId("project", runId)).toMatchObject({
      scope: "research::epic",
      status: "error",
    });
  });
});
