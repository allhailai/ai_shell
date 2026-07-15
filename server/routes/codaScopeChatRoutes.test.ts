import { describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";
import { registerChatRoutes } from "./codaScopeChatRoutes.js";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";

type RouteRegistration = { method: string; path: string; handlers: Array<RequestHandler | undefined> };

interface RouteOptions {
  services?: Record<string, unknown>;
  principal?: { username: string; isAdmin: boolean };
  getUser?: (username: string) => Promise<unknown>;
}

function registeredRoutes({
  services = {},
  principal = { username: "alice", isAdmin: false },
  getUser = async (username: string) => ({ username }),
}: RouteOptions = {}): RouteRegistration[] {
  const routes: RouteRegistration[] = [];
  const app = new Proxy({}, {
    get: (_target, method) => (path: string, ...handlers: Array<RequestHandler | undefined>) => {
      routes.push({ method: String(method), path, handlers });
    },
  });
  const httpError = (message: string, status: number, code: string) =>
    Object.assign(new Error(message), { status, code });
  const ctx = {
    app,
    authService: { getUser },
    secretService: {},
    httpError,
    repoRoot: "/tmp",
    ensureServices: async () => services,
    wrap: (handler: RequestHandler) => handler,
    param: (req: { params?: Record<string, string | string[]> }, name: string) => {
      const value = req.params?.[name];
      return Array.isArray(value) ? value[0] ?? "" : value ?? "";
    },
    principal: () => principal,
    upload: { single: () => undefined },
  } as unknown as CodaScopeRouteContext;
  registerChatRoutes(ctx);
  return routes;
}

function route(routes: RouteRegistration[], method: string, path: string): RequestHandler {
  const registration = routes.find((candidate) => candidate.method === method && candidate.path === path);
  expect(registration).toBeDefined();
  const handler = registration!.handlers.at(-1);
  expect(handler).toBeDefined();
  return handler!;
}

describe("CodaScope chat route custody", () => {
  it("derives the actor for conversation CRUD instead of accepting a client owner", async () => {
    const listConversations = vi.fn(async () => []);
    const createConversation = vi.fn(async () => ({ id: "conv_new", title: "New conversation" }));
    const readConversation = vi.fn(async () => ({ id: "conv_alice", title: "Private" }));
    const updateConversation = vi.fn(async () => ({ id: "conv_alice", title: "Updated" }));
    const deleteConversation = vi.fn(async () => true);
    const pruneConversationImages = vi.fn(async () => undefined);
    const routes = registeredRoutes({ services: {
      chatSvc: { listConversations, createConversation, readConversation, updateConversation, deleteConversation },
      imageSvc: { pruneConversationImages },
    } });
    const json = vi.fn();

    await route(routes, "get", "/api/codascope/projects/:id/conversations")(
      { params: { id: "proj" } } as never, { json } as never, (() => undefined) as never,
    );
    await route(routes, "post", "/api/codascope/projects/:id/conversations")(
      { params: { id: "proj" }, body: { title: "Ignored owner", ownerId: "mallory" } } as never,
      { status: () => ({ json }) } as never, (() => undefined) as never,
    );
    await route(routes, "get", "/api/codascope/projects/:id/conversations/:convId")(
      { params: { id: "proj", convId: "conv_alice" } } as never, { json } as never, (() => undefined) as never,
    );
    await route(routes, "patch", "/api/codascope/projects/:id/conversations/:convId")(
      { params: { id: "proj", convId: "conv_alice" }, body: { title: "Updated" } } as never,
      { json } as never, (() => undefined) as never,
    );
    await route(routes, "delete", "/api/codascope/projects/:id/conversations/:convId")(
      { params: { id: "proj", convId: "conv_alice" } } as never, { json } as never, (() => undefined) as never,
    );

    expect(listConversations).toHaveBeenCalledWith("proj", "alice");
    expect(createConversation).toHaveBeenCalledWith("proj", "alice", { title: "Ignored owner", modelId: undefined });
    expect(readConversation).toHaveBeenCalledWith("proj", "conv_alice", "alice");
    expect(updateConversation).toHaveBeenCalledWith("proj", "conv_alice", "alice", { title: "Updated", summary: undefined });
    expect(pruneConversationImages).toHaveBeenCalledWith("proj", "conv_alice", "alice");
    expect(deleteConversation).toHaveBeenCalledWith("proj", "conv_alice", "alice");
  });

  it("returns generic absence before a supplied assistant conversation can be reused by a second user", async () => {
    const readConversation = vi.fn(async () => null);
    const appendMessage = vi.fn();
    const routes = registeredRoutes({ services: { chatSvc: { readConversation, appendMessage, createConversation: vi.fn() } }, principal: { username: "bob", isAdmin: false } });
    const next = vi.fn();

    route(routes, "post", "/api/codascope/projects/:id/assistant")(
      { params: { id: "proj" }, body: { message: "Hello", modelId: "model", conversationId: "conv_alice" } } as never,
      {} as never,
      next,
    );

    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(readConversation).toHaveBeenCalledWith("proj", "conv_alice", "bob");
    expect(appendMessage).not.toHaveBeenCalled();
    expect((next.mock.calls[0][0] as Error).message).toBe("Conversation not found.");
  });

  it("returns generic absence before an image upload reaches storage", async () => {
    const readConversation = vi.fn(async () => null);
    const uploadImage = vi.fn();
    const routes = registeredRoutes({ services: { chatSvc: { readConversation }, imageSvc: { uploadImage } }, principal: { username: "bob", isAdmin: false } });

    await expect(route(routes, "post", "/api/codascope/projects/:id/conversations/:convId/images")(
      {
        params: { id: "proj", convId: "conv_alice" },
        file: { buffer: Buffer.from("image"), mimetype: "image/png", originalname: "private.png" },
      } as never,
      {} as never,
      (() => undefined) as never,
    )).rejects.toThrow("Conversation not found.");
    expect(readConversation).toHaveBeenCalledWith("proj", "conv_alice", "bob");
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("reserves ownerless conversation migration for administrators and validates the target account", async () => {
    const listLegacyConversations = vi.fn(async () => [{ id: "conv_legacy", title: "Legacy" }]);
    const assignLegacyConversationOwner = vi.fn(async () => ({ id: "conv_legacy", ownerId: "bob" }));
    const getUser = vi.fn(async (username: string) => ({ username }));
    const services = { chatSvc: { listLegacyConversations, assignLegacyConversationOwner } };
    const userRoutes = registeredRoutes({ services, getUser });
    const adminRoutes = registeredRoutes({ services, getUser, principal: { username: "admin", isAdmin: true } });
    const json = vi.fn();

    await expect(route(userRoutes, "get", "/api/codascope/projects/:id/conversations/legacy")(
      { params: { id: "proj" } } as never, { json } as never, (() => undefined) as never,
    )).rejects.toThrow("Administrator access is required.");
    expect(listLegacyConversations).not.toHaveBeenCalled();

    await route(adminRoutes, "get", "/api/codascope/projects/:id/conversations/legacy")(
      { params: { id: "proj" } } as never, { json } as never, (() => undefined) as never,
    );
    await route(adminRoutes, "patch", "/api/codascope/projects/:id/conversations/:convId/owner")(
      { params: { id: "proj", convId: "conv_legacy" }, body: { targetUsername: "bob" } } as never,
      { json } as never, (() => undefined) as never,
    );

    expect(listLegacyConversations).toHaveBeenCalledWith("proj");
    expect(getUser).toHaveBeenCalledWith("bob");
    expect(assignLegacyConversationOwner).toHaveBeenCalledWith("proj", "conv_legacy", "bob");
  });
});
