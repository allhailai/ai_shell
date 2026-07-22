import { afterEach, describe, expect, it } from "vitest";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerEpicRoutes } from "./codaScopeEpicRoutes.js";
import {
  createRouteContext,
  type CodaScopeServices,
  type HttpErrorFn,
} from "./codaScopeServiceContext.js";
import { CodaScopeEpicService } from "../services/codaScopeEpicService.js";

const roots: string[] = [];

function httpError(message: string, status: number, code: string): Error {
  return Object.assign(new Error(message), { status, code });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function routeHarness(): { app: Express; deletes: Map<string, RequestHandler> } {
  const deletes = new Map<string, RequestHandler>();
  const register = (method: string) => (routePath: string, ...handlers: RequestHandler[]) => {
    if (method === "delete") deletes.set(routePath, handlers[handlers.length - 1]);
  };
  const app = {
    get: register("get"),
    post: register("post"),
    put: register("put"),
    patch: register("patch"),
    delete: register("delete"),
  } as unknown as Express;
  return { app, deletes };
}

describe("CodaScope path validation through Express", () => {
  it.each(["..%2F..", "a%5Cb", "a%252Fb"])(
    "maps decoded hostile epic parameter %s to 400 invalid_input",
    async (encodedEpicId) => {
      const root = mkdtempSync(path.join(os.tmpdir(), "codascope-path-route-test-"));
      roots.push(root);
      const projectDir = path.join(root, "project");
      const epicDir = path.join(projectDir, "epics", "epic-safe");
      mkdirSync(epicDir, { recursive: true });
      writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({ id: "project-id", name: "Project" }));
      writeFileSync(path.join(root, "root.sentinel"), "root-sentinel");
      writeFileSync(path.join(projectDir, "project.sentinel"), "project-sentinel");
      writeFileSync(path.join(epicDir, "definition.md"), "epic-content");

      const { app, deletes } = routeHarness();
      const context = createRouteContext(app, {
        secretService: {} as never,
        authService: {} as never,
        authMiddleware: {},
        httpError: httpError as HttpErrorFn,
        repoRoot: "/not-used-by-this-test",
      });
      const epicSvc = new CodaScopeEpicService(root);
      context.ensureServices = async () => ({ epicSvc } as unknown as CodaScopeServices);
      registerEpicRoutes(context);
      const handler = deletes.get("/api/codascope/projects/:id/epics/:epicId");
      expect(handler).toBeDefined();
      const req = {
        params: { id: "project-id", epicId: decodeURIComponent(encodedEpicId) },
      } as unknown as Request;
      const res = {} as Response;
      const error = await new Promise<Error & { status?: number; code?: string }>((resolve, reject) => {
        const next: NextFunction = (caught?: unknown) => {
          if (caught instanceof Error) resolve(caught as Error & { status?: number; code?: string });
          else reject(new Error("Expected route wrapper to receive an error"));
        };
        handler!(req, res, next);
      });
      expect(error).toMatchObject({ status: 400, code: "invalid_input", message: "Invalid epic ID." });
      expect(readFileSync(path.join(root, "root.sentinel"), "utf-8")).toBe("root-sentinel");
      expect(readFileSync(path.join(projectDir, "project.sentinel"), "utf-8")).toBe("project-sentinel");
      expect(readFileSync(path.join(epicDir, "definition.md"), "utf-8")).toBe("epic-content");
    },
  );
});
