import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";

const orchestrator = vi.hoisted(() => ({
  streamAssistantResponse: vi.fn(),
}));

vi.mock("../services/codaScopeChatOrchestrator.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/codaScopeChatOrchestrator.js")>(),
  streamAssistantResponse: orchestrator.streamAssistantResponse,
}));

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

interface TestMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "complete" | "streaming" | "error";
  createdAt: string;
  updatedAt: string;
  modelId?: string | null;
  metadata?: Record<string, unknown>;
}

interface TestConversation {
  id: string;
  projectId: string;
  ownerId: string;
  title: string;
  summary: string;
  defaultModelId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: TestMessage[];
}

function chatConversation(messages: TestMessage[] = []): TestConversation {
  return {
    id: "conv-1",
    projectId: "proj",
    ownerId: "alice",
    title: "Conversation",
    summary: "",
    defaultModelId: "model",
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
    messages,
  };
}

function cloneConversation(conversation: TestConversation | null): TestConversation | null {
  return conversation ? structuredClone(conversation) : null;
}

function statefulChatService(initial = chatConversation()) {
  let conversation: TestConversation | null = cloneConversation(initial);
  let generatedId = 0;

  const readConversation = vi.fn(async () => cloneConversation(conversation));
  const appendMessage = vi.fn(async (
    _projectId: string,
    _conversationId: string,
    _actorId: string,
    message: Partial<TestMessage>,
  ) => {
    if (!conversation) return null;
    const now = "2026-07-23T00:00:01.000Z";
    const normalized: TestMessage = {
      id: message.id ?? `generated-${++generatedId}`,
      role: message.role ?? "assistant",
      content: message.content ?? "",
      status: message.status ?? "complete",
      createdAt: message.createdAt ?? now,
      updatedAt: message.updatedAt ?? now,
      modelId: message.modelId,
      metadata: message.metadata,
    };
    conversation = {
      ...conversation,
      messages: [...conversation.messages, normalized],
      updatedAt: now,
    };
    return cloneConversation(conversation);
  });
  const writeConversation = vi.fn(async (
    _projectId: string,
    _actorId: string,
    next: TestConversation,
  ) => {
    conversation = cloneConversation(next);
    return cloneConversation(conversation);
  });

  return {
    service: {
      readConversation,
      appendMessage,
      writeConversation,
      createConversation: vi.fn(async () => chatConversation()),
    },
    readConversation,
    appendMessage,
    writeConversation,
    getConversation: () => cloneConversation(conversation),
    setConversation: (next: TestConversation | null) => {
      conversation = cloneConversation(next);
    },
  };
}

function streamingServices(chatSvc: Record<string, unknown>) {
  return {
    agentSvc: {},
    chatSvc,
    projectSvc: {
      getProject: vi.fn(async () => ({ id: "proj", name: "Project", repositories: [] })),
      getProjectDir: vi.fn(() => "/tmp/project"),
    },
    wikiSvc: { listTopics: vi.fn(async () => []) },
    buildSvc: { getBuildState: vi.fn(() => null) },
    wikiStateSvc: { getWikiState: vi.fn(() => null) },
    codeMapSvc: { getCodeMapMeta: vi.fn(() => null) },
  };
}

function sseResponse(timeline: string[] = []) {
  const listeners = new Map<string, () => void>();
  const res = {
    headersSent: false,
    writableEnded: false,
    writeHead: vi.fn(() => {
      res.headersSent = true;
    }),
    write: vi.fn((frame: string) => {
      if (frame.startsWith("event: done\n")) timeline.push("terminal:done");
      if (frame.startsWith("event: error\n")) timeline.push("terminal:error");
      return true;
    }),
    end: vi.fn(() => {
      res.writableEnded = true;
      listeners.get("close")?.();
    }),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return res;
    }),
  };
  return res;
}

function terminalFrames(res: ReturnType<typeof sseResponse>): string[] {
  return res.write.mock.calls
    .map(([frame]) => String(frame))
    .filter((frame) => /^event: (done|error|cancelled)\n/.test(frame));
}

const messagesPath = "/api/codascope/projects/:id/conversations/:convId/messages";
const assistantPath = "/api/codascope/projects/:id/assistant";
const streamRequest = {
  params: { id: "proj", convId: "conv-1" },
  body: { message: "Hello", modelId: "model" },
};

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

describe("CodaScope chat SSE completion persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the exact conversation placeholder before one done terminal", async () => {
    const timeline: string[] = [];
    const chat = statefulChatService();
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    chat.writeConversation.mockImplementation(async (_projectId, _actorId, next) => {
      const assistant = next.messages.find((message) => message.role === "assistant");
      expect(assistant?.status).toBe("complete");
      timeline.push("persist:complete:start");
      await writeGate;
      chat.setConversation(next);
      timeline.push("persist:complete:resolved");
      return next;
    });
    orchestrator.streamAssistantResponse.mockResolvedValueOnce({
      fullResponse: "Durable answer",
      actions: [],
      agentResult: { usage: { totalTokens: 7 } },
    });
    const routes = registeredRoutes({ services: streamingServices(chat.service) });
    const res = sseResponse(timeline);
    const next = vi.fn();

    route(routes, "post", messagesPath)(streamRequest as never, res as never, next);

    await vi.waitFor(() => expect(timeline).toContain("persist:complete:start"));
    expect(terminalFrames(res)).toEqual([]);
    releaseWrite?.();
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledTimes(1));

    expect(timeline).toEqual([
      "persist:complete:start",
      "persist:complete:resolved",
      "terminal:done",
    ]);
    expect(terminalFrames(res)).toEqual([
      "event: done\ndata: {\"usage\":{\"totalTokens\":7},\"conversationId\":\"conv-1\",\"actions\":[]}\n\n",
    ]);
    expect(chat.getConversation()?.messages.find((message) => message.role === "assistant"))
      .toMatchObject({ content: "Durable answer", status: "complete" });
    expect(next).not.toHaveBeenCalled();
  });

  it("persists one valid empty assistant completion before the backwards-compatible done terminal", async () => {
    const timeline: string[] = [];
    const chat = statefulChatService();
    const appendNormally = chat.appendMessage.getMockImplementation()!;
    chat.appendMessage.mockImplementation(async (...args) => {
      const result = await appendNormally(...args);
      const message = args[3];
      if (message.role === "assistant" && message.status === "complete") {
        timeline.push("persist:complete:resolved");
      }
      return result;
    });
    orchestrator.streamAssistantResponse.mockResolvedValueOnce({
      fullResponse: "",
      actions: [],
      agentResult: {},
    });
    const routes = registeredRoutes({ services: streamingServices(chat.service) });
    const res = sseResponse(timeline);
    const next = vi.fn();

    route(routes, "post", assistantPath)({
      params: { id: "proj" },
      body: { message: "Hello", modelId: "model", conversationId: "conv-1" },
    } as never, res as never, next);
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledTimes(1));

    expect(timeline).toEqual(["persist:complete:resolved", "terminal:done"]);
    expect(terminalFrames(res)).toEqual([
      "event: done\ndata: {\"conversationId\":\"conv-1\",\"actions\":[]}\n\n",
    ]);
    expect(chat.getConversation()?.messages.at(-1))
      .toMatchObject({ role: "assistant", content: "", status: "complete" });
    expect(next).not.toHaveBeenCalled();
  });

  it("downgrades generated text to error when the conversation completion write throws", async () => {
    const chat = statefulChatService();
    chat.writeConversation.mockImplementation(async (_projectId, _actorId, next) => {
      const assistant = next.messages.find((message) => message.role === "assistant");
      if (assistant?.status === "complete") throw new Error("completion write failed");
      chat.setConversation(next);
      return next;
    });
    orchestrator.streamAssistantResponse.mockResolvedValueOnce({
      fullResponse: "Generated answer",
      actions: [{ type: "completed_operation", attributes: { operation: "test" } }],
      agentResult: {},
    });
    const routes = registeredRoutes({ services: streamingServices(chat.service) });
    const res = sseResponse();
    const next = vi.fn();

    route(routes, "post", messagesPath)(streamRequest as never, res as never, next);
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledTimes(1));

    expect(terminalFrames(res)).toEqual([
      "event: error\ndata: {\"error\":\"completion write failed\"}\n\n",
    ]);
    expect(chat.writeConversation).toHaveBeenCalledTimes(2);
    expect(chat.getConversation()?.messages.find((message) => message.role === "assistant"))
      .toMatchObject({ content: "Generated answer", status: "error", metadata: undefined });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ["conversation disappears", true],
    ["expected placeholder is missing", false],
  ])("emits only error when the %s before completion", async (_label, disappears) => {
    const chat = statefulChatService();
    chat.readConversation.mockImplementation(async () => {
      const current = chat.getConversation();
      if (chat.readConversation.mock.calls.length < 3) return current;
      if (disappears) return null;
      return current
        ? { ...current, messages: current.messages.filter((message) => message.role !== "assistant") }
        : null;
    });
    orchestrator.streamAssistantResponse.mockResolvedValueOnce({
      fullResponse: "Generated answer",
      actions: [],
      agentResult: {},
    });
    const routes = registeredRoutes({ services: streamingServices(chat.service) });
    const res = sseResponse();
    const next = vi.fn();

    route(routes, "post", messagesPath)(streamRequest as never, res as never, next);
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledTimes(1));

    const expectedError = disappears
      ? "Conversation disappeared before assistant completion could be persisted."
      : "Expected assistant streaming placeholder was not found.";
    expect(terminalFrames(res)).toEqual([
      `event: error\ndata: ${JSON.stringify({ error: expectedError })}\n\n`,
    ]);
    expect(chat.writeConversation).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ["throws", "throw"],
    ["returns null", "null"],
  ])("fails the backwards-compatible stream when assistant append %s", async (_label, mode) => {
    const chat = statefulChatService();
    const appendNormally = chat.appendMessage.getMockImplementation()!;
    chat.appendMessage.mockImplementation(async (...args) => {
      const message = args[3];
      if (message.role === "assistant" && message.status === "complete") {
        if (mode === "throw") throw new Error("assistant append failed");
        return null;
      }
      return appendNormally(...args);
    });
    orchestrator.streamAssistantResponse.mockResolvedValueOnce({
      fullResponse: "Generated answer",
      actions: [],
      agentResult: {},
    });
    const routes = registeredRoutes({ services: streamingServices(chat.service) });
    const res = sseResponse();
    const next = vi.fn();

    route(routes, "post", assistantPath)({
      params: { id: "proj" },
      body: { message: "Hello", modelId: "model", conversationId: "conv-1" },
    } as never, res as never, next);
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledTimes(1));

    const expectedError = mode === "throw"
      ? "assistant append failed"
      : "Conversation disappeared before assistant completion could be persisted.";
    expect(terminalFrames(res)).toEqual([
      `event: error\ndata: ${JSON.stringify({ error: expectedError, conversationId: "conv-1" })}\n\n`,
    ]);
    expect(chat.getConversation()?.messages.at(-1))
      .toMatchObject({ role: "assistant", content: "Generated answer", status: "error" });
    expect(next).not.toHaveBeenCalled();
  });

  it("still emits one error and ends once when error-state persistence also fails", async () => {
    const chat = statefulChatService();
    chat.writeConversation.mockRejectedValue(new Error("all writes failed"));
    orchestrator.streamAssistantResponse.mockResolvedValueOnce({
      fullResponse: "Generated answer",
      actions: [],
      agentResult: {},
    });
    const routes = registeredRoutes({ services: streamingServices(chat.service) });
    const res = sseResponse();
    const next = vi.fn();

    route(routes, "post", messagesPath)(streamRequest as never, res as never, next);
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledTimes(1));

    expect(terminalFrames(res)).toEqual([
      "event: error\ndata: {\"error\":\"all writes failed\"}\n\n",
    ]);
    expect(chat.writeConversation).toHaveBeenCalledTimes(2);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it("preflights an unserializable done payload before attempting complete persistence", async () => {
    const chat = statefulChatService();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    orchestrator.streamAssistantResponse.mockResolvedValueOnce({
      fullResponse: "Generated answer",
      actions: [],
      agentResult: circular,
    });
    const routes = registeredRoutes({ services: streamingServices(chat.service) });
    const res = sseResponse();
    const next = vi.fn();

    route(routes, "post", messagesPath)(streamRequest as never, res as never, next);
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledTimes(1));

    expect(terminalFrames(res)).toEqual([
      "event: error\ndata: {\"error\":\"Server could not serialize done terminal payload.\"}\n\n",
    ]);
    expect(chat.writeConversation).toHaveBeenCalledTimes(1);
    const attemptedAssistant = chat.writeConversation.mock.calls[0][2].messages
      .find((message) => message.role === "assistant");
    expect(attemptedAssistant).toMatchObject({ content: "Generated answer", status: "error" });
    expect(next).not.toHaveBeenCalled();
  });

  it("persists an orchestrator partial response only as error and publishes one error", async () => {
    const chat = statefulChatService();
    orchestrator.streamAssistantResponse.mockRejectedValueOnce(
      Object.assign(new Error("agent stream failed"), { fullResponse: "Partial answer" }),
    );
    const routes = registeredRoutes({ services: streamingServices(chat.service) });
    const res = sseResponse();
    const next = vi.fn();

    route(routes, "post", messagesPath)(streamRequest as never, res as never, next);
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledTimes(1));

    expect(terminalFrames(res)).toEqual([
      "event: error\ndata: {\"error\":\"agent stream failed\"}\n\n",
    ]);
    expect(chat.writeConversation).toHaveBeenCalledTimes(1);
    for (const call of chat.writeConversation.mock.calls) {
      const assistant = call[2].messages.find((message) => message.role === "assistant");
      expect(assistant?.status).toBe("error");
    }
    expect(chat.getConversation()?.messages.find((message) => message.role === "assistant"))
      .toMatchObject({ content: "Partial answer", status: "error" });
    expect(next).not.toHaveBeenCalled();
  });
});
