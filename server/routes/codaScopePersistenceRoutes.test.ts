import { describe, expect, it, vi } from "vitest";
import type { Express, NextFunction, Request, Response } from "express";
import { createRouteContext, type HttpErrorFn } from "./codaScopeServiceContext.js";
import {
  CodaScopePersistenceCorruptError,
  CodaScopePersistenceError,
} from "../services/codaScopePersistence.js";

const httpError: HttpErrorFn = (message, status, code) => Object.assign(new Error(message), { status, code });

async function mappedError(error: Error): Promise<Error & { status?: number; code?: string }> {
  const context = createRouteContext({} as Express, {
    secretService: {} as never,
    authService: {} as never,
    authMiddleware: {},
    httpError,
    repoRoot: "/not-used",
  });
  const handler = context.wrap(async () => { throw error; });
  return new Promise((resolve, reject) => {
    const next: NextFunction = (caught?: unknown) => {
      if (caught instanceof Error) resolve(caught as Error & { status?: number; code?: string });
      else reject(new Error("Expected a mapped route error"));
    };
    handler({} as Request, {} as Response, next);
  });
}

describe("CodaScope persistence route boundary", () => {
  it.each([
    [
      new CodaScopePersistenceCorruptError({
        storage: "epic_index",
        projectId: "project-safe",
        path: "/private/tmp/secret-project/epics.json",
      }),
      "persistence_corrupt",
      "Persisted CodaScope data is corrupt. Repair or restore it and retry.",
    ],
    [
      new CodaScopePersistenceError({ storage: "epic_annotations", epicId: "epic-safe" }),
      "persistence_failed",
      "CodaScope could not persist the requested change. Retry after checking storage health.",
    ],
  ])("maps a typed persistence error to a stable sanitized 500 response", async (source, code, message) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = await mappedError(source);
    expect(error).toMatchObject({ status: 500, code, message });
    const response = JSON.stringify({ error: error.message, code: error.code });
    expect(response).toBe(JSON.stringify({ error: message, code }));
    expect(response).not.toMatch(/\/(?:Users|tmp|private|opt)\//);
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/\/(?:Users|tmp|private|opt)\//);
    consoleError.mockRestore();
  });
});
