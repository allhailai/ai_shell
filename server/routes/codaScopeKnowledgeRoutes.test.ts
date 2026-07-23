import { describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";

const orchestrators = vi.hoisted(() => ({
  research: vi.fn(async () => ({ plan: null })),
  curation: vi.fn(async () => undefined),
}));

vi.mock("../services/codaScopeResearchOrchestrator.js", () => ({
  runResearchPipeline: orchestrators.research,
}));
vi.mock("../services/codaScopeCurationOrchestrator.js", () => ({
  runCurationPipeline: orchestrators.curation,
}));

import { registerKnowledgeRoutes } from "./codaScopeKnowledgeRoutes.js";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";

type RegisteredRoute = { method: string; path: string; handlers: Array<RequestHandler | undefined> };

function register(): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const app = new Proxy({}, {
    get: (_target, method) => (routePath: string, ...handlers: Array<RequestHandler | undefined>) => {
      routes.push({ method: String(method), path: routePath, handlers });
    },
  });
  const buildSvc = {
    registerProjectDir: vi.fn(),
    startBuild: vi.fn(() => "run"),
    isCancelled: vi.fn(() => false),
    addPipelineStep: vi.fn(),
    appendOutput: vi.fn(),
    completeBuild: vi.fn(),
    failBuild: vi.fn(),
  };
  const services = {
    buildSvc,
    projectSvc: { getProjectDir: () => "/tmp/project" },
    agentSvc: {},
    epicSvc: {},
    wikiSvc: {},
    epicKnowledgeSvc: {},
    curationSvc: {},
    codeMapSvc: {},
    contentSvc: {},
  };
  registerKnowledgeRoutes({
    app,
    authService: {},
    secretService: {},
    httpError: (message: string, status: number, code: string) => Object.assign(new Error(message), { status, code }),
    repoRoot: "/tmp",
    ensureServices: async () => services,
    wrap: (handler: RequestHandler) => handler,
    param: (req: { params?: Record<string, string | string[]> }, name: string) => {
      const value = req.params?.[name];
      return Array.isArray(value) ? value[0] ?? "" : value ?? "";
    },
    principal: () => ({ username: "alice", isAdmin: false }),
    upload: { single: () => undefined },
  } as unknown as CodaScopeRouteContext);
  return routes;
}

function route(routes: RegisteredRoute[], path: string): RequestHandler {
  const found = routes.find((candidate) => candidate.method === "post" && candidate.path === path);
  expect(found).toBeDefined();
  return found!.handlers.at(-1)!;
}

function request(body: Record<string, unknown>) {
  return {
    params: { id: "project", epicId: "epic" },
    body,
    on: vi.fn(),
  };
}

function response() {
  return {
    headersSent: false,
    writableEnded: false,
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    status: vi.fn(() => ({ json: vi.fn() })),
  };
}

describe("CodaScope knowledge route actor propagation", () => {
  it("passes the authenticated principal into the research orchestrator", async () => {
    orchestrators.research.mockClear();
    const handler = route(register(), "/api/codascope/projects/:id/epics/:epicId/knowledge/research");
    await handler(request({ modelId: "model", topics: ["security"] }) as never, response() as never, vi.fn());

    expect(orchestrators.research).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project", epicId: "epic", actorId: "alice" }),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("passes the authenticated principal into the curation orchestrator", async () => {
    orchestrators.curation.mockClear();
    const handler = route(register(), "/api/codascope/projects/:id/epics/:epicId/curation/run");
    await handler(request({ modelId: "model" }) as never, response() as never, vi.fn());

    expect(orchestrators.curation).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project", epicId: "epic", actorId: "alice" }),
      expect.any(Object),
      expect.any(Object),
    );
  });
});
