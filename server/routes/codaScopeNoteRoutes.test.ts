import { describe, expect, it, vi } from "vitest";
import type { Express, RequestHandler } from "express";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import { registerNoteRoutes } from "./codaScopeNoteRoutes.js";

type RouteRegistration = { method: string; path: string; handlers: RequestHandler[] };

function registeredRoutes(highlightColors: string | null = null): RouteRegistration[] {
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
    ensureServices: async () => ({}),
    wrap: (handler: RequestHandler) => handler,
    param: () => "",
    principal: () => ({ username: "alice", isAdmin: false }),
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
});
