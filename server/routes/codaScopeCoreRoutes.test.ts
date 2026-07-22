import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerCoreRoutes } from "./codaScopeCoreRoutes.js";
import {
  isInsideInstallDirectory,
  shutdownCodaScopeServices,
  type CodaScopePrincipal,
  type CodaScopeRouteContext,
} from "./codaScopeServiceContext.js";
import type { SecretService } from "../services/secretService.js";

type RegisteredRoute = { method: string; path: string; handlers: Array<RequestHandler | undefined> };
const temporaryRoots: string[] = [];

afterEach(async () => {
  await shutdownCodaScopeServices();
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("isInsideInstallDirectory", () => {
  it("rejects the AIShell checkout and paths below it while allowing external project storage", () => {
    const install = "/opt/aishell";
    expect(isInsideInstallDirectory(install, install)).toBe(true);
    expect(isInsideInstallDirectory("/opt/aishell/codascope_projects", install)).toBe(true);
    expect(isInsideInstallDirectory("/var/lib/aishell/projects", install)).toBe(false);
    expect(isInsideInstallDirectory("/opt/aishell-backup/projects", install)).toBe(false);
  });
});

describe("CodaScope core route contracts", () => {
  it("returns the projects-root path only to administrators", async () => {
    const secrets = fakeSecretService("/private/codascope-projects");
    const adminRoutes = registeredRoutes({ secretService: secrets.service, principal: { username: "admin", isAdmin: true } });
    const userRoutes = registeredRoutes({ secretService: secrets.service, principal: { username: "alice", isAdmin: false } });
    const adminJson = vi.fn();
    const userJson = vi.fn();

    await handler(adminRoutes, "get", "/api/codascope/config")({} as never, { json: adminJson } as never, vi.fn());
    await handler(userRoutes, "get", "/api/codascope/config")({} as never, { json: userJson } as never, vi.fn());

    expect(adminJson).toHaveBeenCalledWith({ configured: true, projectsRoot: "/private/codascope-projects" });
    expect(userJson).toHaveBeenCalledWith({ configured: true });
  });

  it("allows admin configuration, rejects ordinary users, and keeps invalid input at 400", async () => {
    const root = tempRoot();
    const target = path.join(root, "projects");
    const secrets = fakeSecretService(null);
    const adminRoutes = registeredRoutes({ secretService: secrets.service, principal: { username: "admin", isAdmin: true } });
    const userRoutes = registeredRoutes({ secretService: secrets.service, principal: { username: "alice", isAdmin: false } });
    const putAdmin = handler(adminRoutes, "put", "/api/codascope/config");
    const putUser = handler(userRoutes, "put", "/api/codascope/config");

    await expect(putUser(
      { body: { projectsRoot: target } } as never,
      {} as never,
      vi.fn(),
    )).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(putUser(
      { body: { projectsRoot: "" } } as never,
      {} as never,
      vi.fn(),
    )).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(putAdmin(
      { body: { projectsRoot: "" } } as never,
      {} as never,
      vi.fn(),
    )).rejects.toMatchObject({ status: 400, code: "invalid_input" });

    const json = vi.fn();
    await putAdmin(
      { body: { projectsRoot: target } } as never,
      { json } as never,
      vi.fn(),
    );
    expect(json).toHaveBeenCalledWith({ configured: true, projectsRoot: target });
    expect(secrets.getValue()).toBe(target);
    expect(existsSync(target)).toBe(true);
  });

  it("routes ordinary export and import through the portable bundle service", async () => {
    const finalize = vi.fn(async () => undefined);
    const pipe = vi.fn();
    const on = vi.fn();
    const createExport = vi.fn(async () => ({
      filename: "codascope_project_shared.zip",
      archive: { finalize, pipe, on },
    }));
    const importProject = vi.fn(async () => ({
      project: { id: "imported", name: "Imported", repositories: [] },
      needsRepoMapping: false,
      unmappedRepos: [],
    }));
    const routes = registeredRoutes({ services: { projectBundleSvc: { createExport, importProject } } });

    const setHeader = vi.fn();
    await handler(routes, "get", "/api/codascope/projects/:id/export")(
      { params: { id: "project" } } as never,
      { setHeader, headersSent: false, status: vi.fn(), destroy: vi.fn() } as never,
      vi.fn(),
    );
    expect(createExport).toHaveBeenCalledWith("project");
    expect(setHeader).toHaveBeenCalledWith("Content-Disposition", "attachment; filename=\"codascope_project_shared.zip\"");
    expect(pipe).toHaveBeenCalledOnce();
    expect(finalize).toHaveBeenCalledOnce();

    const upload = path.join(tempRoot(), "upload.zip");
    writeFileSync(upload, "test upload");
    const json = vi.fn();
    await handler(routes, "post", "/api/codascope/projects/import")(
      { file: { path: upload } } as never,
      { status: vi.fn(() => ({ json })) } as never,
      vi.fn(),
    );
    expect(importProject).toHaveBeenCalledWith(upload);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ needsRepoMapping: false }));
    expect(existsSync(upload)).toBe(false);
  });
});

function registeredRoutes({
  principal = { username: "alice", isAdmin: false },
  secretService = fakeSecretService(null).service,
  services = {},
}: {
  principal?: CodaScopePrincipal;
  secretService?: SecretService;
  services?: Record<string, unknown>;
} = {}): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const app = new Proxy({}, {
    get: (_target, method) => (routePath: string, ...handlers: Array<RequestHandler | undefined>) => {
      routes.push({ method: String(method), path: routePath, handlers });
    },
  });
  const httpError = (message: string, status: number, code: string) => Object.assign(new Error(message), { status, code });
  const context = {
    app,
    secretService,
    authService: { getUser: vi.fn() },
    httpError,
    repoRoot: "/opt/aishell-install",
    ensureServices: async () => services,
    wrap: (routeHandler: RequestHandler) => routeHandler,
    param: (req: { params?: Record<string, string | string[]> }, name: string) => {
      const value = req.params?.[name];
      return Array.isArray(value) ? value[0] ?? "" : value ?? "";
    },
    principal: () => principal,
    upload: { single: () => undefined },
  } as unknown as CodaScopeRouteContext;
  registerCoreRoutes(context);
  return routes;
}

function handler(routes: RegisteredRoute[], method: string, routePath: string): RequestHandler {
  const registration = routes.find((candidate) => candidate.method === method && candidate.path === routePath);
  expect(registration).toBeDefined();
  return registration!.handlers.at(-1)!;
}

function fakeSecretService(initialValue: string | null): { service: SecretService; getValue: () => string | null } {
  let value = initialValue;
  const service = {
    getAppSecret: vi.fn(async (_appId: string, key: string) => key === "codascope_projects_root" ? value : null),
    setAppSecret: vi.fn(async (_appId: string, key: string, next: string) => {
      if (key === "codascope_projects_root") value = next;
    }),
    deleteAppSecret: vi.fn(async () => { value = null; }),
  } as unknown as SecretService;
  return { service, getValue: () => value };
}

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "codascope-core-routes-test-"));
  temporaryRoots.push(root);
  return root;
}
