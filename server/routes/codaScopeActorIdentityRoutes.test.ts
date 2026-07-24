import { describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";
import { registerAnnotationRoutes } from "./codaScopeAnnotationRoutes.js";
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

  it("routes manual saves through the combined versioned edit boundary with the observed hash", async () => {
    const updateDesignDocWithVersion = vi.fn(async () => ({
      doc: { id: "doc", title: "Design" },
      contentHash: "new-hash",
    }));
    const routes = registerRoutes(registerEpicRoutes, {
      designDocSvc: { updateDesignDocWithVersion },
    });
    const response = { json: vi.fn() };

    await handler(routes, "put", "/api/codascope/projects/:id/epics/:epicId/designs/:docId")(
      {
        params: { id: "proj", epicId: "epic", docId: "doc" },
        body: { content: "Updated design.", expectedHash: "observed-hash" },
      } as never,
      response as never,
      (() => undefined) as never,
    );

    expect(updateDesignDocWithVersion).toHaveBeenCalledWith(
      "proj",
      "epic",
      "doc",
      "Updated design.",
      {
        author: "alice",
        summary: "Manual save",
        expectedHash: "observed-hash",
      },
    );
  });

  it("derives design revert snapshot authorship from the principal", async () => {
    const revertToVersion = vi.fn(async () => ({
      content: "Restored design.",
      revertVersion: { number: 2, author: "alice" },
    }));
    const routes = registerRoutes(registerEpicRoutes, {
      designDocSvc: { revertToVersion },
    });
    const response = { json: vi.fn() };

    await handler(
      routes,
      "post",
      "/api/codascope/projects/:id/epics/:epicId/designs/:docId/revert/:num",
    )(
      {
        params: { id: "proj", epicId: "epic", docId: "doc", num: "1" },
        body: { author: "mallory" },
      } as never,
      response as never,
      (() => undefined) as never,
    );

    expect(revertToVersion).toHaveBeenCalledWith(
      "proj",
      "epic",
      "doc",
      1,
      "alice",
    );
  });

  it("versions destructive resize mutations but leaves cosmetic resizes unversioned", async () => {
    const applyResizeMetadata = vi.fn(async () => ({
      doc: { id: "doc", title: "Design" },
      content: "Updated design.",
      contentHash: "new-hash",
    }));
    const routes = registerRoutes(registerEpicRoutes, {
      designDocSvc: { applyResizeMetadata },
    });
    const response = { json: vi.fn() };
    const resizeHandler = handler(
      routes,
      "patch",
      "/api/codascope/projects/:id/epics/:epicId/designs/:docId/resize",
    );

    await resizeHandler(
      {
        params: { id: "proj", epicId: "epic", docId: "doc" },
        body: { type: "delete-image", index: 0 },
      } as never,
      response as never,
      (() => undefined) as never,
    );
    await resizeHandler(
      {
        params: { id: "proj", epicId: "epic", docId: "doc" },
        body: { type: "mermaid", index: 0, height: 480 },
      } as never,
      response as never,
      (() => undefined) as never,
    );

    expect(applyResizeMetadata).toHaveBeenNthCalledWith(
      1,
      "proj",
      "epic",
      "doc",
      { type: "delete-image", index: 0 },
      { author: "alice", summary: "Delete image" },
    );
    expect(applyResizeMetadata).toHaveBeenNthCalledWith(
      2,
      "proj",
      "epic",
      "doc",
      { type: "mermaid", index: 0, height: 480 },
    );
  });

  it("routes directive document mutations through the bounded service API with principal authorship", async () => {
    const getDesignDoc = vi.fn();
    const updateDesignDocWithVersion = vi.fn();
    const getDefinition = vi.fn();
    const updateDefinition = vi.fn();
    const applyDirective = vi.fn(async (
      _projectId: string,
      _epicId: string,
      _docId: string,
      dirId: string,
    ) => ({ directive: { id: dirId }, newContent: "Applied." }));
    const undoDirective = vi.fn(async (
      _projectId: string,
      _epicId: string,
      _docId: string,
      dirId: string,
    ) => ({ id: dirId }));
    const executeBatchDirectives = vi.fn(async () => ({
      applied: [],
      newContent: "Batched.",
    }));
    const createDirective = vi.fn(async () => ({ id: "created-directive" }));
    const routes = registerRoutes(registerAnnotationRoutes, {
      designDocSvc: { getDesignDoc, updateDesignDocWithVersion },
      epicSvc: { getDefinition, updateDefinition },
      directiveSvc: {
        createDirective,
        applyDirective,
        undoDirective,
        executeBatchDirectives,
      },
    });
    const json = vi.fn();
    const response = { json, status: vi.fn(() => ({ json })) };
    const params = { id: "proj", epicId: "epic", docId: "doc", dirId: "directive-1" };

    await handler(
      routes,
      "post",
      "/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives",
    )({
      params,
      body: {
        type: "insert",
        afterLine: 1,
        instruction: "Create directive",
        author: "mallory",
      },
    } as never, response as never, (() => undefined) as never);
    await handler(
      routes,
      "post",
      "/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/apply",
    )({ params } as never, response as never, (() => undefined) as never);
    await handler(
      routes,
      "post",
      "/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/undo",
    )({ params } as never, response as never, (() => undefined) as never);
    await handler(
      routes,
      "post",
      "/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/batch",
    )({ params } as never, response as never, (() => undefined) as never);

    expect(createDirective).toHaveBeenCalledWith("proj", "epic", "doc", {
      type: "insert",
      afterLine: 1,
      startLine: undefined,
      endLine: undefined,
      blockId: undefined,
      anchorText: undefined,
      instruction: "Create directive",
      author: "alice",
    });
    expect(applyDirective).toHaveBeenCalledWith("proj", "epic", "doc", "directive-1", "alice");
    expect(undoDirective).toHaveBeenCalledWith("proj", "epic", "doc", "directive-1", "alice");
    expect(executeBatchDirectives).toHaveBeenCalledWith("proj", "epic", "doc", "alice");
    expect(getDesignDoc).not.toHaveBeenCalled();
    expect(updateDesignDocWithVersion).not.toHaveBeenCalled();
    expect(getDefinition).not.toHaveBeenCalled();
    expect(updateDefinition).not.toHaveBeenCalled();
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
