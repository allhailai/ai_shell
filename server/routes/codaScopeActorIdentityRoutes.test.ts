import { describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";
import { registerArtifactRoutes } from "./codaScopeArtifactRoutes.js";
import { registerEpicRoutes } from "./codaScopeEpicRoutes.js";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";

type RegisteredRoute = { method: string; path: string; handlers: Array<RequestHandler | undefined> };

function registerRoutes(register: (ctx: CodaScopeRouteContext) => void, services: Record<string, unknown>): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const app = new Proxy({}, {
    get: (_target, method) => (path: string, ...handlers: Array<RequestHandler | undefined>) => {
      routes.push({ method: String(method), path, handlers });
    },
  });
  const context = {
    app,
    authService: { getUser: vi.fn() },
    secretService: {},
    httpError: (message: string) => new Error(message),
    repoRoot: "/tmp",
    ensureServices: async () => services,
    wrap: (handler: RequestHandler) => handler,
    param: (req: { params?: Record<string, string | string[]> }, name: string) => {
      const value = req.params?.[name];
      return Array.isArray(value) ? value[0] ?? "" : value ?? "";
    },
    principal: () => ({ username: "alice", isAdmin: false }),
    upload: { single: () => undefined },
  } as unknown as CodaScopeRouteContext;
  register(context);
  return routes;
}

function handler(routes: RegisteredRoute[], method: string, path: string): RequestHandler {
  const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
  expect(route).toBeDefined();
  return route!.handlers.at(-1)!;
}

describe("CodaScope route audit identities", () => {
  it("derives epic, design document, and version creators from the principal", async () => {
    const createEpic = vi.fn(async () => ({ id: "epic" }));
    const createDesignDoc = vi.fn(async () => ({ id: "doc" }));
    const createVersion = vi.fn(async () => ({ number: 1 }));
    const routes = registerRoutes(registerEpicRoutes, {
      epicSvc: { createEpic },
      designDocSvc: { createDesignDoc },
      versionSvc: { createVersion },
    });
    const response = { status: () => ({ json: vi.fn() }) };

    await handler(routes, "post", "/api/codascope/projects/:id/epics")(
      { params: { id: "proj" }, body: { title: "Epic", createdBy: "mallory" } } as never, response as never, (() => undefined) as never,
    );
    await handler(routes, "post", "/api/codascope/projects/:id/epics/:epicId/designs")(
      { params: { id: "proj", epicId: "epic" }, body: { title: "Doc", content: "Complete design.", template: "api-spec", createdBy: "mallory" } } as never, response as never, (() => undefined) as never,
    );
    await handler(routes, "post", "/api/codascope/projects/:id/epics/:epicId/versions")(
      { params: { id: "proj", epicId: "epic" }, body: { label: "v1", createdBy: "mallory" } } as never, response as never, (() => undefined) as never,
    );

    expect(createEpic).toHaveBeenCalledWith("proj", { title: "Epic", createdBy: "alice" });
    expect(createDesignDoc).toHaveBeenCalledWith("proj", "epic", { title: "Doc", content: "Complete design.", createdBy: "alice" });
    expect(createVersion).toHaveBeenCalledWith("proj", "epic", { label: "v1", note: undefined, createdBy: "alice" });
  });

  it("derives artifact creators from the principal", async () => {
    const createArtifact = vi.fn(async () => ({ id: "artifact" }));
    const routes = registerRoutes(registerArtifactRoutes, { artifactSvc: { createArtifact } });
    const response = { status: () => ({ json: vi.fn() }) };

    await handler(routes, "post", "/api/codascope/projects/:id/epics/:epicId/artifacts")(
      { params: { id: "proj", epicId: "epic" }, body: { title: "Artifact", createdBy: "mallory" } } as never,
      response as never,
      (() => undefined) as never,
    );

    expect(createArtifact).toHaveBeenCalledWith("proj", "epic", { title: "Artifact", createdBy: "alice" });
  });

  it("derives lock ownership from the principal for acquire, heartbeat, and release", async () => {
    const acquireLock = vi.fn(async () => ({ documentId: "definition", lockedBy: "alice" }));
    const heartbeatLock = vi.fn(async () => ({ documentId: "definition", lockedBy: "alice" }));
    const releaseLock = vi.fn(async () => true);
    const routes = registerRoutes(registerEpicRoutes, { epicSvc: { acquireLock, heartbeatLock, releaseLock } });
    const response = { json: vi.fn() };

    await handler(routes, "post", "/api/codascope/projects/:id/epics/:epicId/lock")(
      { params: { id: "proj", epicId: "epic" }, body: { documentId: "definition", lockedBy: "mallory" } } as never,
      response as never,
      (() => undefined) as never,
    );
    await handler(routes, "patch", "/api/codascope/projects/:id/epics/:epicId/lock/heartbeat")(
      { params: { id: "proj", epicId: "epic" }, body: { documentId: "definition", lockedBy: "mallory" } } as never,
      response as never,
      (() => undefined) as never,
    );
    await handler(routes, "delete", "/api/codascope/projects/:id/epics/:epicId/lock")(
      { params: { id: "proj", epicId: "epic" }, query: { documentId: "definition" } } as never,
      response as never,
      (() => undefined) as never,
    );

    expect(acquireLock).toHaveBeenCalledWith("proj", "epic", { documentId: "definition", lockedBy: "alice" });
    expect(heartbeatLock).toHaveBeenCalledWith("proj", "epic", "definition", "alice");
    expect(releaseLock).toHaveBeenCalledWith("proj", "epic", "definition", "alice");
  });
});
