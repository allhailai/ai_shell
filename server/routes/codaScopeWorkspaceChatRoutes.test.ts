import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";

const orchestrator = vi.hoisted(() => ({
  stream: vi.fn(),
}));

vi.mock("../services/codaScopeWorkspaceChatOrchestrator.js", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("../services/codaScopeWorkspaceChatOrchestrator.js")
  >(),
  streamWorkspaceAssistantResponse: orchestrator.stream,
}));

import { registerWorkspaceChatRoutes } from "./codaScopeWorkspaceChatRoutes.js";
import type { CodaScopeRouteContext } from "./codaScopeServiceContext.js";
import {
  WorkspaceAssistantCancelledError,
} from "../services/codaScopeWorkspaceChatOrchestrator.js";
import { createWorkspaceMessageContext } from "../services/codaScopeWorkspaceConversationService.js";

type Registration = {
  method: string;
  path: string;
  handlers: Array<RequestHandler | undefined>;
};

function registeredRoutes(options: {
  services?: Record<string, any>;
  principal?: () => { username: string; isAdmin: boolean };
} = {}): Registration[] {
  const routes: Registration[] = [];
  const app = new Proxy({}, {
    get: (_target, method) => (
      routePath: string,
      ...handlers: Array<RequestHandler | undefined>
    ) => routes.push({ method: String(method), path: routePath, handlers }),
  });
  const httpError = (message: string, status: number, code: string) =>
    Object.assign(new Error(message), { status, code });
  registerWorkspaceChatRoutes({
    app,
    ensureServices: async () => options.services ?? {},
    httpError,
    param: (req: any, name: string) => req.params?.[name] ?? "",
    principal: options.principal ?? (() => ({ username: "alice", isAdmin: false })),
    upload: { single: () => undefined },
    wrap: (handler: any) => handler,
  } as unknown as CodaScopeRouteContext);
  return routes;
}

function route(
  routes: Registration[],
  method: string,
  routePath: string,
): RequestHandler {
  const registration = routes.find(
    (candidate) => candidate.method === method && candidate.path === routePath,
  );
  expect(registration).toBeDefined();
  const handler = registration?.handlers.at(-1);
  expect(handler).toBeDefined();
  return handler!;
}

function response() {
  const listeners = new Map<string, () => void>();
  const res = {
    headersSent: false,
    writableEnded: false,
    frames: [] as string[],
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    setHeader: vi.fn(),
    sendFile: vi.fn(),
    writeHead: vi.fn(() => {
      res.headersSent = true;
      return res;
    }),
    write: vi.fn((frame: string) => {
      res.frames.push(frame);
      return true;
    }),
    end: vi.fn(() => {
      res.writableEnded = true;
      listeners.get("close")?.();
      return res;
    }),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return res;
    }),
  };
  return res;
}

function terminals(res: ReturnType<typeof response>): string[] {
  return res.frames.filter((frame) =>
    /^event: (done|error|cancelled)\n/.test(frame),
  );
}

function conversation(messages: any[] = []) {
  return {
    version: 1,
    id: "conv-workspace",
    scope: { kind: "workspace" },
    ownerId: "alice",
    title: "Workspace",
    summary: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    defaultModelId: "model",
    messages,
  };
}

function statefulConversationService(timeline: string[] = []) {
  let current = conversation();
  const readConversation = vi.fn(async (
    actorId: string,
    conversationId: string,
  ) => actorId === "alice" && conversationId === current.id
    ? structuredClone(current)
    : null);
  const appendMessage = vi.fn(async (
    _actorId: string,
    _conversationId: string,
    message: any,
  ) => {
    const now = "2026-01-01T00:00:01.000Z";
    current = {
      ...current,
      messages: [...current.messages, {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: now,
        updatedAt: null,
        modelId: message.modelId ?? null,
        status: message.status,
        context: message.context ?? createWorkspaceMessageContext(undefined),
        metadata: message.metadata ?? {},
      }],
    };
    if (message.role === "assistant") timeline.push("persist:placeholder");
    return structuredClone(current);
  });
  const completeAssistantMessage = vi.fn(async (
    _actorId: string,
    _conversationId: string,
    messageId: string,
    completion: any,
  ) => {
    current = {
      ...current,
      messages: current.messages.map((message) => message.id === messageId
        ? {
            ...message,
            content: completion.content,
            status: "complete",
            context: {
              ...message.context,
              retrievedSources: completion.retrievedSources,
            },
          }
        : message),
    };
    timeline.push("persist:complete");
    return structuredClone(current);
  });
  const recordAssistantMessageError = vi.fn(async (
    _actorId: string,
    _conversationId: string,
    messageId: string,
    content: string,
  ) => {
    current = {
      ...current,
      messages: current.messages.map((message) => message.id === messageId
        ? {
            ...message,
            content,
            status: "error",
            context: { ...message.context, retrievedSources: [] },
          }
        : message),
    };
    timeline.push("persist:error");
    return structuredClone(current);
  });
  return {
    service: {
      readConversation,
      appendMessage,
      completeAssistantMessage,
      recordAssistantMessageError,
      tryBeginConversationRun: vi.fn(() => true),
      endConversationRun: vi.fn(),
      listConversations: vi.fn(async () => []),
      createConversation: vi.fn(async () => current),
      updateConversation: vi.fn(async () => current),
      deleteConversation: vi.fn(async () => true),
    },
    get: () => structuredClone(current),
  };
}

function streamingServices(
  workspaceConversationSvc: Record<string, any>,
  extras: Record<string, any> = {},
) {
  return {
    workspaceConversationSvc,
    workspaceImageSvc: {
      getImagePath: vi.fn(async () => null),
      uploadImage: vi.fn(),
    },
    workspaceCatalogSvc: {},
    workspaceIntentSvc: {
      resolveTurn: vi.fn(async () => ({
        grant: { epicDiscoveryProjectIds: [], epicResources: [] },
      })),
    },
    activeEntityResolver: {
      resolveActiveProject: vi.fn(async () => ({ projectId: "alpha" })),
    },
    agentSvc: { cancelAgent: vi.fn(() => false) },
    ...extras,
  };
}

const messagePath =
  "/api/codascope/workspace/conversations/:convId/messages";
const messageRequest = {
  params: { convId: "conv-workspace" },
  body: {
    message: "Compare Alpha's architecture",
    modelId: "model",
    context: {
      explicitlyReferencedProjectIds: ["alpha"],
      currentView: { view: "wiki", identity: "architecture" },
    },
  },
};

async function waitForEnd(res: ReturnType<typeof response>): Promise<void> {
  await vi.waitFor(() => expect(res.writableEnded).toBe(true));
}

beforeEach(() => {
  orchestrator.stream.mockReset();
});

describe("workspace chat routes", () => {
  it("derives the actor for workspace CRUD and retains explicit scope responses", async () => {
    const listConversations = vi.fn(async () => []);
    const createConversation = vi.fn(async (actorId: string) => ({
      ...conversation(),
      ownerId: actorId,
    }));
    const readConversation = vi.fn(async () => conversation());
    const updateConversation = vi.fn(async () => conversation());
    const deleteConversation = vi.fn(async () => true);
    const routes = registeredRoutes({ services: {
      workspaceConversationSvc: {
        listConversations,
        createConversation,
        readConversation,
        updateConversation,
        deleteConversation,
      },
    } });
    const res = response();

    await route(routes, "get", "/api/codascope/workspace/conversations")(
      {} as any,
      res as any,
      vi.fn(),
    );
    expect(listConversations).toHaveBeenCalledWith("alice");
    expect(res.json).toHaveBeenCalledWith({
      scope: { kind: "workspace" },
      conversations: [],
    });

    await expect(Promise.resolve(route(
      routes,
      "post",
      "/api/codascope/workspace/conversations",
    )(
      { body: { title: "New", ownerId: undefined } } as any,
      res as any,
      vi.fn(),
    ))).rejects.toMatchObject({ status: 400, code: "invalid_input" });
    expect(createConversation).not.toHaveBeenCalled();

    await route(routes, "post", "/api/codascope/workspace/conversations")(
      { body: { title: "New" } } as any,
      res as any,
      vi.fn(),
    );
    expect(createConversation).toHaveBeenCalledWith("alice", {
      title: "New",
      modelId: undefined,
    });
  });

  it("requires an authenticated principal", async () => {
    const error = Object.assign(new Error("Authentication required."), {
      status: 401,
      code: "authentication_required",
    });
    const routes = registeredRoutes({
      principal: () => {
        throw error;
      },
      services: { workspaceConversationSvc: { listConversations: vi.fn() } },
    });
    await expect(route(
      routes,
      "get",
      "/api/codascope/workspace/conversations",
    )({} as any, response() as any, vi.fn())).rejects.toBe(error);
  });

  it("rejects project conversation IDs and client-forged grants generically", async () => {
    const readConversation = vi.fn(async () => null);
    const appendMessage = vi.fn();
    const routes = registeredRoutes({ services: streamingServices({
      readConversation,
      appendMessage,
    }) });
    const res = response();

    await expect(route(
      routes,
      "get",
      "/api/codascope/workspace/conversations/:convId",
    )(
      { params: { convId: "project-conversation" } } as any,
      res as any,
      vi.fn(),
    )).rejects.toMatchObject({ status: 404, code: "not_found" });

    const next = vi.fn();
    route(routes, "post", messagePath)(
      {
        ...messageRequest,
        body: {
          ...messageRequest.body,
          workspaceReadGrant: {
            epicDiscoveryProjectIds: ["alpha"],
            epicResources: [],
          },
        },
      } as any,
      res as any,
      next,
    );
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.calls[0][0]).toMatchObject({
      status: 400,
      code: "invalid_input",
    });
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("persists one stable completion with provenance before exactly one done terminal", async () => {
    const timeline: string[] = [];
    const state = statefulConversationService(timeline);
    orchestrator.stream.mockResolvedValueOnce({
      fullResponse: "Workspace answer",
      agentResult: { usage: { totalTokens: 7 } },
      retrievedSources: [{
        kind: "project_wiki",
        retrieval: "direct",
        projectId: "alpha",
        projectName: "Alpha",
        topicId: "architecture",
        topicTitle: "Architecture",
        topicUpdatedAt: "2026-01-01T00:00:00.000Z",
        lastWikiBuildAt: null,
      }],
    });
    const routes = registeredRoutes({
      services: streamingServices(state.service),
    });
    const res = response();
    res.write.mockImplementation((frame: string) => {
      res.frames.push(frame);
      if (frame.startsWith("event: done\n")) timeline.push("terminal:done");
      return true;
    });

    route(routes, "post", messagePath)(
      messageRequest as any,
      res as any,
      vi.fn(),
    );
    await waitForEnd(res);

    expect(timeline).toEqual([
      "persist:placeholder",
      "persist:complete",
      "terminal:done",
    ]);
    expect(terminals(res)).toHaveLength(1);
    const assistant = state.get().messages.find(
      (message: any) => message.role === "assistant",
    );
    expect(assistant).toMatchObject({
      status: "complete",
      content: "Workspace answer",
      context: {
        retrievedSources: [expect.objectContaining({
          kind: "project_wiki",
          topicId: "architecture",
        })],
      },
    });
  });

  it("persists sanitized failure before one error terminal without path leakage", async () => {
    const timeline: string[] = [];
    const state = statefulConversationService(timeline);
    orchestrator.stream.mockRejectedValueOnce(Object.assign(
      new Error("/private/repository/sdk-token"),
      { fullResponse: "Partial answer" },
    ));
    const routes = registeredRoutes({
      services: streamingServices(state.service),
    });
    const res = response();
    res.write.mockImplementation((frame: string) => {
      res.frames.push(frame);
      if (frame.startsWith("event: error\n")) timeline.push("terminal:error");
      return true;
    });

    route(routes, "post", messagePath)(
      messageRequest as any,
      res as any,
      vi.fn(),
    );
    await waitForEnd(res);

    expect(timeline).toEqual([
      "persist:placeholder",
      "persist:error",
      "terminal:error",
    ]);
    expect(terminals(res)).toEqual([
      'event: error\ndata: {"error":"Workspace assistant run failed."}\n\n',
    ]);
    expect(res.frames.join("")).not.toContain("/private/repository");
    expect(state.get().messages.find((message: any) => message.role === "assistant"))
      .toMatchObject({ status: "error", content: "Partial answer" });
  });

  it("persists cancellation before one cancelled terminal and never emits done", async () => {
    const timeline: string[] = [];
    const state = statefulConversationService(timeline);
    orchestrator.stream.mockRejectedValueOnce(
      new WorkspaceAssistantCancelledError("Partial"),
    );
    const routes = registeredRoutes({
      services: streamingServices(state.service),
    });
    const res = response();
    res.write.mockImplementation((frame: string) => {
      res.frames.push(frame);
      if (frame.startsWith("event: cancelled\n")) {
        timeline.push("terminal:cancelled");
      }
      return true;
    });

    route(routes, "post", messagePath)(
      messageRequest as any,
      res as any,
      vi.fn(),
    );
    await waitForEnd(res);

    expect(timeline).toEqual([
      "persist:placeholder",
      "persist:error",
      "terminal:cancelled",
    ]);
    expect(terminals(res)).toHaveLength(1);
    expect(terminals(res)[0]).toMatch(/^event: cancelled/);
    expect(res.frames.join("")).not.toContain("event: done");
  });

  it("emits one sanitized error when completion persistence fails but error persistence succeeds", async () => {
    const timeline: string[] = [];
    const state = statefulConversationService(timeline);
    state.service.completeAssistantMessage.mockRejectedValueOnce(
      new Error("/private/storage/completion-write-failed"),
    );
    orchestrator.stream.mockResolvedValueOnce({
      fullResponse: "Generated answer",
      agentResult: {},
      retrievedSources: [],
    });
    const routes = registeredRoutes({
      services: streamingServices(state.service),
    });
    const res = response();

    route(routes, "post", messagePath)(
      messageRequest as any,
      res as any,
      vi.fn(),
    );
    await waitForEnd(res);

    expect(terminals(res)).toEqual([
      'event: error\ndata: {"error":"Workspace assistant run failed."}\n\n',
    ]);
    expect(res.frames.join("")).not.toContain("/private/storage");
    expect(state.service.completeAssistantMessage).toHaveBeenCalledTimes(1);
    expect(state.service.recordAssistantMessageError).toHaveBeenCalledTimes(1);
    expect(state.get().messages.find((message: any) => message.role === "assistant"))
      .toMatchObject({ status: "error", content: "Generated answer" });
    expect(state.service.endConversationRun).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["error-state rejection", false, "rejects"],
    ["error-state null transition", false, "returns-null"],
    ["cancellation rejection", true, "rejects"],
    ["cancellation null transition", true, "returns-null"],
  ])(
    "emits one emergency error when %s",
    async (_label, cancelled, persistenceOutcome) => {
      const state = statefulConversationService();
      const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
      if (persistenceOutcome === "rejects") {
        state.service.recordAssistantMessageError.mockRejectedValueOnce(
          new Error("/private/storage/error-state-write-failed"),
        );
      } else {
        state.service.recordAssistantMessageError.mockResolvedValueOnce(null as any);
      }
      orchestrator.stream.mockRejectedValueOnce(
        cancelled
          ? new WorkspaceAssistantCancelledError("Partial")
          : Object.assign(
              new Error("/private/sdk/native-failure"),
              { fullResponse: "Partial" },
            ),
      );
      const routes = registeredRoutes({
        services: streamingServices(state.service),
      });
      const res = response();

      route(routes, "post", messagePath)(
        messageRequest as any,
        res as any,
        vi.fn(),
      );
      await waitForEnd(res);

      expect(terminals(res)).toEqual([
        "event: error\ndata: {\"error\":\"Workspace assistant run could not be finalized.\"}\n\n",
      ]);
      expect(res.frames.join("")).not.toContain("/private/");
      expect(res.frames.join("")).not.toContain("event: done");
      expect(res.frames.join("")).not.toContain("event: cancelled");
      expect(res.end).toHaveBeenCalledTimes(1);
      expect(state.service.recordAssistantMessageError).toHaveBeenCalledTimes(1);
      expect(state.service.endConversationRun).toHaveBeenCalledTimes(1);
      expect(diagnostic).toHaveBeenCalledWith(
        "[CodaScope] workspace assistant failure state could not be persisted.",
      );
    },
  );

  it("rejects overlapping same-conversation sends before appending", async () => {
    const state = statefulConversationService();
    state.service.tryBeginConversationRun.mockReturnValue(false);
    const routes = registeredRoutes({
      services: streamingServices(state.service),
    });
    const res = response();
    const next = vi.fn();

    route(routes, "post", messagePath)(
      messageRequest as any,
      res as any,
      next,
    );
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next.mock.calls[0][0]).toMatchObject({
      status: 409,
      code: "conversation_busy",
    });
    expect(state.service.appendMessage).not.toHaveBeenCalled();
  });

  it("cancels only the authenticated actor's workspace scope", async () => {
    const cancelAgent = vi.fn(() => true);
    const routes = registeredRoutes({ services: {
      agentSvc: { cancelAgent },
    } });
    const res = response();

    await route(
      routes,
      "post",
      "/api/codascope/workspace/assistant/cancel",
    )({} as any, res as any, vi.fn());
    expect(cancelAgent).toHaveBeenCalledWith({
      scope: { kind: "workspace" },
      actorId: "alice",
    });
    expect(res.json).toHaveBeenCalledWith({ cancelled: true });
  });

  it("enforces conversation custody for workspace image upload and reads", async () => {
    const readConversation = vi.fn(async () => conversation());
    const uploadImage = vi.fn(async () => ({
      path: "conv-workspace/images/image.png",
      filename: "image.png",
    }));
    const getImagePath = vi.fn(async () => "/tmp/workspace-image.png");
    const routes = registeredRoutes({ services: {
      workspaceConversationSvc: { readConversation },
      workspaceImageSvc: { uploadImage, getImagePath },
    } });
    const uploadRes = response();
    await route(
      routes,
      "post",
      "/api/codascope/workspace/conversations/:convId/images",
    )({
      params: { convId: "conv-workspace" },
      file: {
        buffer: Buffer.from("image"),
        mimetype: "image/png",
      },
    } as any, uploadRes as any, vi.fn());
    expect(uploadImage).toHaveBeenCalledWith(
      "alice",
      "conv-workspace",
      expect.any(Buffer),
      "image/png",
    );

    const readRes = response();
    await route(
      routes,
      "get",
      "/api/codascope/workspace/conversations/:convId/images/:filename",
    )({
      params: { convId: "conv-workspace", filename: "image.png" },
    } as any, readRes as any, vi.fn());
    expect(getImagePath).toHaveBeenCalledWith(
      "alice",
      "conv-workspace",
      "image.png",
    );
    expect(readRes.sendFile).toHaveBeenCalledWith("/tmp/workspace-image.png");
  });
});
