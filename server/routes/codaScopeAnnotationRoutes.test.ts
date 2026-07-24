import { describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerAnnotationRoutes } from "./codaScopeAnnotationRoutes.js";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import { CodaScopeAnnotationError, CodaScopeAnnotationService } from "../services/codaScopeAnnotationService.js";
import { CodaScopeDirectiveError } from "../services/codaScopeDirectiveService.js";

type RegisteredRoute = { method: string; path: string; handlers: Array<RequestHandler | undefined> };

function register(services: Record<string, unknown>): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const app = new Proxy({}, {
    get: (_target, method) => (routePath: string, ...handlers: Array<RequestHandler | undefined>) => {
      routes.push({ method: String(method), path: routePath, handlers });
    },
  });
  registerAnnotationRoutes({
    app,
    authService: { getUser: vi.fn() },
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

function route(routes: RegisteredRoute[], method: string, routePath: string): RequestHandler {
  const found = routes.find((candidate) => candidate.method === method && candidate.path === routePath);
  expect(found).toBeDefined();
  return found!.handlers.at(-1)!;
}

function response() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { json, status };
}

const params = { id: "project", epicId: "epic", docId: "doc", annId: "ann" };
const block = { blockId: "block", sectionSlug: "section", lineStart: 2, lineEnd: 2, content: "Target" };

describe("CodaScope epic annotation routes", () => {
  it("delegates list reconciliation to the document-coordinated service operation", async () => {
    const listCurrentDocumentAnnotations = vi.fn(async () => [{ id: "ann" }]);
    const routes = register({ annotationSvc: { listCurrentDocumentAnnotations } });
    const handler = route(routes, "get", "/api/codascope/projects/:id/epics/:epicId/docs/:docId/annotations");
    const res = response();

    await handler({ params } as never, res as never, (() => undefined) as never);

    expect(listCurrentDocumentAnnotations).toHaveBeenCalledWith("project", "epic", "doc");
    expect(res.json).toHaveBeenCalledWith({ annotations: [{ id: "ann" }] });

    listCurrentDocumentAnnotations.mockResolvedValueOnce(null as never);
    await expect(handler(
      { params } as never,
      response() as never,
      (() => undefined) as never,
    )).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("derives creation identity from the principal and rejects client-authored identity", async () => {
    const createAnnotationForCurrentDocument = vi.fn(async () => ({ id: "ann" }));
    const routes = register({
      annotationSvc: { createAnnotationForCurrentDocument },
    });
    const handler = route(routes, "post", "/api/codascope/projects/:id/epics/:epicId/docs/:docId/annotations");

    await expect(handler(
      { params, body: { anchor: { ...block, anchorText: "Target", lineNumber: 2 }, body: "Comment", author: "mallory" } } as never,
      response() as never,
      (() => undefined) as never,
    )).rejects.toMatchObject({ status: 400, code: "invalid_input" });
    expect(createAnnotationForCurrentDocument).not.toHaveBeenCalled();

    await handler(
      { params, body: { anchor: { blockId: "block", sectionSlug: "forged", anchorText: "forged", lineNumber: 999 }, body: "Comment" } } as never,
      response() as never,
      (() => undefined) as never,
    );
    expect(createAnnotationForCurrentDocument).toHaveBeenCalledWith(
      "project",
      "epic",
      "doc",
      { username: "alice", origin: "user" },
      expect.objectContaining({
        body: "Comment",
        targetBlockId: "block",
      }),
    );
  });

  it("restricts PATCH fields, maps invalid transitions, and hides unauthorized body edits", async () => {
    const updateAnnotation = vi.fn();
    const routes = register({ annotationSvc: { updateAnnotation } });
    const handler = route(routes, "patch", "/api/codascope/projects/:id/epics/:epicId/annotations/:annId");

    await expect(handler(
      { params, body: { reactions: [{ emoji: "👍", user: "mallory" }] } } as never,
      response() as never,
      (() => undefined) as never,
    )).rejects.toMatchObject({ status: 400, code: "invalid_input" });

    updateAnnotation.mockResolvedValueOnce(null);
    await expect(handler(
      { params, body: { body: "Forged edit" } } as never,
      response() as never,
      (() => undefined) as never,
    )).rejects.toMatchObject({ status: 404, code: "not_found", message: "Annotation not found." });
    expect(updateAnnotation).toHaveBeenLastCalledWith(
      "project", "epic", "ann", { username: "alice", origin: "user" }, { body: "Forged edit", status: undefined },
    );

    updateAnnotation.mockRejectedValueOnce(new CodaScopeAnnotationError("invalid_status_transition", "not allowed"));
    await expect(handler(
      { params, body: { status: "resolved" } } as never,
      response() as never,
      (() => undefined) as never,
    )).rejects.toMatchObject({ status: 400, code: "invalid_status_transition" });
  });

  it("binds reaction and delete operations to the principal", async () => {
    const addReaction = vi.fn(async () => ({ id: "ann" }));
    const removeReaction = vi.fn(async () => ({ id: "ann" }));
    const deleteAnnotation = vi.fn(async () => true);
    const routes = register({ annotationSvc: { addReaction, removeReaction, deleteAnnotation } });
    const add = route(routes, "post", "/api/codascope/projects/:id/epics/:epicId/annotations/:annId/reactions");
    const remove = route(routes, "delete", "/api/codascope/projects/:id/epics/:epicId/annotations/:annId/reactions");
    const removeAnnotation = route(routes, "delete", "/api/codascope/projects/:id/epics/:epicId/annotations/:annId");

    await expect(add(
      { params, body: { emoji: "👍", username: "mallory" } } as never,
      response() as never,
      (() => undefined) as never,
    )).rejects.toMatchObject({ status: 400, code: "invalid_input" });
    await add({ params, body: { emoji: "👍" } } as never, response() as never, (() => undefined) as never);
    await remove({ params, body: { emoji: "👍" } } as never, response() as never, (() => undefined) as never);
    await removeAnnotation({ params, body: {} } as never, response() as never, (() => undefined) as never);

    expect(addReaction).toHaveBeenCalledWith("project", "epic", "ann", { username: "alice", origin: "user" }, "👍");
    expect(removeReaction).toHaveBeenCalledWith("project", "epic", "ann", { username: "alice", origin: "user" }, "👍");
    expect(deleteAnnotation).toHaveBeenCalledWith("project", "epic", "ann", { username: "alice", origin: "user" });
  });

  it("rejects stale reattachment hashes and passes only an exact current block", async () => {
    const reattachAnnotation = vi.fn(async () => ({ id: "ann" }));
    const services = {
      annotationSvc: { computeBlockIds: () => [block], reattachAnnotation },
      designDocSvc: { getDesignDoc: async () => ({ content: "Target", contentHash: "current-hash" }) },
      epicSvc: {},
    };
    const routes = register(services);
    const handler = route(
      routes,
      "post",
      "/api/codascope/projects/:id/epics/:epicId/docs/:docId/annotations/:annId/reattach",
    );

    await expect(handler(
      { params, body: { targetBlockId: "block", contentHash: "stale-hash" } } as never,
      response() as never,
      (() => undefined) as never,
    )).rejects.toMatchObject({ status: 409, code: "conflict" });
    expect(reattachAnnotation).not.toHaveBeenCalled();

    await handler(
      { params, body: { targetBlockId: "block", contentHash: "current-hash" } } as never,
      response() as never,
      (() => undefined) as never,
    );
    expect(reattachAnnotation).toHaveBeenCalledWith("project", "epic", "doc", "ann", "current-hash", "block");

    reattachAnnotation.mockRejectedValueOnce(new CodaScopeAnnotationError(
      "conflict",
      "Document content changed.",
      409,
    ));
    await expect(handler(
      { params, body: { targetBlockId: "block", contentHash: "current-hash" } } as never,
      response() as never,
      (() => undefined) as never,
    )).rejects.toMatchObject({ status: 409, code: "conflict" });

    await expect(handler(
      { params, body: { targetBlockId: "missing", contentHash: "current-hash" } } as never,
      response() as never,
      (() => undefined) as never,
    )).rejects.toMatchObject({ status: 400, code: "invalid_input" });
  });

  it("rechecks after route validation and rolls back a paused stale reattachment as 409", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codascope-annotation-route-race-"));
    const projectDir = path.join(root, "project-dir");
    const definitionPath = path.join(projectDir, "epics", "epic", "definition.md");
    const annotationPath = path.join(projectDir, "epics", "epic", "annotations", "definition-annotations.json");
    mkdirSync(path.dirname(annotationPath), { recursive: true });
    writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({ id: "project", name: "Project" }), "utf-8");
    const now = "2026-01-01T00:00:00.000Z";
    const epic = {
      id: "epic",
      projectId: "project",
      title: "Epic",
      status: "designing",
      createdAt: now,
      updatedAt: now,
      createdBy: "alice",
      collaborators: ["alice"],
      currentVersion: 0,
    };
    writeFileSync(path.join(projectDir, "epics", "epics.json"), JSON.stringify({ epics: [epic] }), "utf-8");
    writeFileSync(
      path.join(projectDir, "epics", "epic", "epic.json"),
      JSON.stringify({ ...epic, conversationId: null }),
      "utf-8",
    );
    writeFileSync(definitionPath, "# Original\n\nTarget.", "utf-8");

    try {
      const actual = new CodaScopeAnnotationService(root);
      const originalBlock = actual.computeBlockIds("# Original\n\nTarget.").find((candidate) => candidate.content === "Target.")!;
      const annotation = await actual.createAnnotation(
        "project",
        "epic",
        "definition",
        { username: "alice", origin: "user" },
        {
          anchor: {
            blockId: originalBlock.blockId,
            sectionSlug: originalBlock.sectionSlug,
            anchorText: originalBlock.content,
            lineNumber: originalBlock.lineStart,
          },
          body: "Comment",
        },
      );
      const firstRevision = "# First\n\nReplacement.";
      writeFileSync(definitionPath, firstRevision, "utf-8");
      await actual.listAnnotations("project", "epic", "definition", firstRevision);
      const before = readFileSync(annotationPath);
      const target = actual.computeBlockIds(firstRevision).find((candidate) => candidate.content === "Replacement.")!;
      const expectedHash = createHash("sha256").update(firstRevision).digest("hex").slice(0, 16);

      let release!: () => void;
      let entered!: () => void;
      const paused = new Promise<void>((resolve) => { release = resolve; });
      const reattachmentEntered = new Promise<void>((resolve) => { entered = resolve; });
      const reattachAnnotation = vi.fn(async (...args: Parameters<CodaScopeAnnotationService["reattachAnnotation"]>) => {
        entered();
        await paused;
        return actual.reattachAnnotation(...args);
      });
      const routes = register({
        annotationSvc: {
          computeBlockIds: actual.computeBlockIds.bind(actual),
          reattachAnnotation,
        },
        epicSvc: { getDefinition: async () => readFileSync(definitionPath, "utf-8") },
        designDocSvc: {},
      });
      const handler = route(
        routes,
        "post",
        "/api/codascope/projects/:id/epics/:epicId/docs/:docId/annotations/:annId/reattach",
      );
      const pending = handler(
        {
          params: { id: "project", epicId: "epic", docId: "definition", annId: annotation.id },
          body: { targetBlockId: target.blockId, contentHash: expectedHash },
        } as never,
        response() as never,
        (() => undefined) as never,
      );
      await reattachmentEntered;
      writeFileSync(definitionPath, "# Second\n\nNew replacement.", "utf-8");
      release();

      await expect(pending).rejects.toMatchObject({ status: 409, code: "conflict" });
      expect(readFileSync(annotationPath)).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the bounded directive API and preserves unsafe undo conflicts as 409", async () => {
    const applyDirective = vi.fn(async () => ({
      directive: { id: "dir" },
      newContent: "Applied.",
    }));
    const undoDirective = vi.fn(async () => {
      throw new CodaScopeDirectiveError("Document content changed after this directive was applied.");
    });
    const executeBatchDirectives = vi.fn(async () => ({
      applied: [],
      newContent: "Current.",
    }));
    const getDesignDoc = vi.fn();
    const updateDesignDocWithVersion = vi.fn();
    const routes = register({
      directiveSvc: { applyDirective, undoDirective, executeBatchDirectives },
      designDocSvc: { getDesignDoc, updateDesignDocWithVersion },
      epicSvc: {},
    });
    const directiveParams = {
      id: "project",
      epicId: "epic",
      docId: "doc",
      dirId: "dir",
    };

    await route(
      routes,
      "post",
      "/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/apply",
    )({ params: directiveParams } as never, response() as never, (() => undefined) as never);
    await expect(route(
      routes,
      "post",
      "/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/undo",
    )({ params: directiveParams } as never, response() as never, (() => undefined) as never))
      .rejects.toMatchObject({ status: 409, code: "conflict" });
    await route(
      routes,
      "post",
      "/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/batch",
    )({ params: directiveParams } as never, response() as never, (() => undefined) as never);

    expect(applyDirective).toHaveBeenCalledWith("project", "epic", "doc", "dir", "alice");
    expect(undoDirective).toHaveBeenCalledWith("project", "epic", "doc", "dir", "alice");
    expect(executeBatchDirectives).toHaveBeenCalledWith("project", "epic", "doc", "alice");
    expect(getDesignDoc).not.toHaveBeenCalled();
    expect(updateDesignDocWithVersion).not.toHaveBeenCalled();
  });

  it("maps every directive transition conflict to one sanitized 409 and preserves missing 404s", async () => {
    const transitionMessage = "Directive state does not allow this operation.";
    const conflict = () => {
      throw new CodaScopeDirectiveError(transitionMessage);
    };
    const conflictServices = {
      executeDirective: vi.fn(conflict),
      rejectDirective: vi.fn(conflict),
      deleteDirective: vi.fn(conflict),
      applyDirective: vi.fn(conflict),
      undoDirective: vi.fn(conflict),
    };
    const conflictRoutes = register({ directiveSvc: conflictServices });
    const directiveParams = {
      id: "project",
      epicId: "epic",
      docId: "doc",
      dirId: "dir",
    };
    const endpoints = [
      {
        method: "post",
        path: "/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/execute",
        request: { params: directiveParams, body: { generatedContent: "Generated" } },
        call: conflictServices.executeDirective,
      },
      {
        method: "post",
        path: "/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/reject",
        request: { params: directiveParams },
        call: conflictServices.rejectDirective,
      },
      {
        method: "delete",
        path: "/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId",
        request: { params: directiveParams },
        call: conflictServices.deleteDirective,
      },
      {
        method: "post",
        path: "/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/apply",
        request: { params: directiveParams },
        call: conflictServices.applyDirective,
      },
      {
        method: "post",
        path: "/api/codascope/projects/:id/epics/:epicId/docs/:docId/directives/:dirId/undo",
        request: { params: directiveParams },
        call: conflictServices.undoDirective,
      },
    ];

    for (const endpoint of endpoints) {
      const caught = await Promise.resolve(route(
        conflictRoutes,
        endpoint.method,
        endpoint.path,
      )(
        endpoint.request as never,
        response() as never,
        (() => undefined) as never,
      )).catch((error: unknown) => error);
      expect(caught).toMatchObject({
        status: 409,
        code: "conflict",
        message: transitionMessage,
      });
      expect(caught).not.toBeInstanceOf(CodaScopeDirectiveError);
      expect(endpoint.call).toHaveBeenCalledTimes(1);
    }
    expect(JSON.stringify(transitionMessage)).not.toContain("/private/");
    expect(JSON.stringify(transitionMessage)).not.toContain("Generated");

    const missingServices = {
      executeDirective: vi.fn(async () => null),
      rejectDirective: vi.fn(async () => null),
      deleteDirective: vi.fn(async () => false),
      applyDirective: vi.fn(async () => null),
      undoDirective: vi.fn(async () => null),
    };
    const missingRoutes = register({ directiveSvc: missingServices });
    for (const endpoint of endpoints) {
      await expect(route(missingRoutes, endpoint.method, endpoint.path)(
        endpoint.request as never,
        response() as never,
        (() => undefined) as never,
      )).rejects.toMatchObject({ status: 404, code: "not_found" });
    }
    expect(Object.values(missingServices).every((call) => call.mock.calls.length === 1)).toBe(true);
  });
});
