import { describe, expect, it, vi } from "vitest";
import type { Express, RequestHandler } from "express";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import { registerNoteRoutes } from "./codaScopeNoteRoutes.js";

type RouteRegistration = { method: string; path: string; handlers: RequestHandler[] };

interface RouteOptions {
  highlightColors?: string | null;
  services?: Record<string, unknown>;
  principal?: { username: string; isAdmin: boolean };
}

function registeredRoutes({
  highlightColors = null,
  services = {},
  principal = { username: "alice", isAdmin: false },
}: RouteOptions = {}): RouteRegistration[] {
  const routes: RouteRegistration[] = [];
  const app = new Proxy({}, {
    get: (_target, method) => (path: string, ...handlers: RequestHandler[]) => {
      routes.push({ method: String(method), path, handlers });
      return app;
    },
  }) as Express;
  const context = {
    app,
    secretService: { getAppSecret: async () => highlightColors },
    httpError: (message: string) => new Error(message),
    ensureServices: async () => services,
    wrap: (handler: RequestHandler) => handler,
    param: (req: { params?: Record<string, string | string[]> }, name: string) => {
      const value = req.params?.[name];
      return Array.isArray(value) ? value[0] ?? "" : value ?? "";
    },
    principal: () => principal,
    upload: { single: () => undefined },
  } as unknown as CodaScopeRouteContext;

  registerNoteRoutes(context);
  return routes;
}

describe("CodaScope note route registration", () => {
  it("registers document archiving before the wildcard note archive route", () => {
    const routes = registeredRoutes();
    const documentArchive = routes.findIndex((route) => route.method === "post" && route.path === "/api/codascope/notes/:scope/:visibility/note/*path/documents/:documentId/archive");
    const noteArchive = routes.findIndex((route) => route.method === "post" && route.path === "/api/codascope/notes/:scope/:visibility/note/*path/archive");

    expect(documentArchive).toBeGreaterThanOrEqual(0);
    expect(noteArchive).toBeGreaterThan(documentArchive);
  });

  it("returns an empty highlight palette when custom colors are unset", async () => {
    const route = registeredRoutes().find((candidate) => candidate.method === "get" && candidate.path === "/api/codascope/settings/highlight-colors");
    const json = vi.fn();

    expect(route).toBeDefined();
    await route!.handlers.at(-1)!({} as never, { json } as never, (() => undefined) as never);

    expect(json).toHaveBeenCalledWith({ colors: [] });
  });

  it("binds an export download to the authenticated export owner", async () => {
    const getExportFile = vi.fn(() => "/tmp/export.zip");
    const route = registeredRoutes({ services: { noteExportSvc: { getExportFile } } })
      .find((candidate) => candidate.method === "get" && candidate.path === "/api/codascope/notes/export/:id");
    const download = vi.fn();

    expect(route).toBeDefined();
    await route!.handlers.at(-1)!({ params: { id: "export-123" } } as never, { download } as never, (() => undefined) as never);

    expect(getExportFile).toHaveBeenCalledWith("export-123", "alice");
    expect(download).toHaveBeenCalledWith("/tmp/export.zip", "codascope-notes-export.zip");
  });

  it("rejects note-audit queries from non-administrators before reading events", async () => {
    const query = vi.fn();
    const route = registeredRoutes({ services: { noteAuditSvc: { query } } })
      .find((candidate) => candidate.method === "get" && candidate.path === "/api/codascope/audit/notes");

    expect(route).toBeDefined();
    await expect(route!.handlers.at(-1)!({ query: {} } as never, {} as never, (() => undefined) as never))
      .rejects.toThrow("Administrator access is required");
    expect(query).not.toHaveBeenCalled();
  });

  it("validates audit limits before querying the audit log", async () => {
    const query = vi.fn();
    const route = registeredRoutes({
      services: { noteAuditSvc: { query } },
      principal: { username: "admin", isAdmin: true },
    }).find((candidate) => candidate.method === "get" && candidate.path === "/api/codascope/audit/notes");

    expect(route).toBeDefined();
    await expect(route!.handlers.at(-1)!({ query: { limit: "1001" } } as never, {} as never, (() => undefined) as never))
      .rejects.toThrow("limit must be between 1 and 1000");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a forged reaction array and an invalid annotation status transition", async () => {
    const annotation = { id: "ann-1", author: "alice", status: "resolved", archivedAt: undefined };
    const listAnnotations = vi.fn(async () => [annotation]);
    const updateAnnotation = vi.fn();
    const route = registeredRoutes({
      services: { noteAnnotationSvc: { listAnnotations, updateAnnotation } },
    }).find((candidate) => candidate.method === "patch" && candidate.path === "/api/codascope/notes/:scope/:visibility/note/*path/annotations/:annotationId");
    const baseRequest = {
      params: { scope: "codascope", visibility: "shared", path: "status.md/annotations/ann-1", annotationId: "ann-1" },
      query: {},
    };

    expect(route).toBeDefined();
    await expect(route!.handlers.at(-1)!({ ...baseRequest, body: { reactions: [{ emoji: "ack", user: "victim" }] } } as never, {} as never, (() => undefined) as never))
      .rejects.toThrow("Replacing annotation reactions is not supported");
    await expect(route!.handlers.at(-1)!({ ...baseRequest, body: { status: "wontfix" } } as never, {} as never, (() => undefined) as never))
      .rejects.toThrow("status transition is not allowed");
    expect(updateAnnotation).not.toHaveBeenCalled();
  });
});
