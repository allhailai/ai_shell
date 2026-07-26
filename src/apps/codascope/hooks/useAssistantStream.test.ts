import { describe, expect, it, vi } from "vitest";
import {
  cancelAssistantRun,
  consumeAssistantStreamResponse,
  createAssistantMessagePayload,
  findPersistedWorkspaceAssistantMessage,
  isAssistantRunCurrent,
  reconcilePersistedWorkspaceAssistantTurn,
  requestAssistantCancellation,
} from "./useAssistantStream";
import type {
  AssistantChatMessage,
  Conversation,
} from "../codaScopeTypes";
import type {
  AssistantConversationApi,
} from "../assistantConversationApi";

const encoder = new TextEncoder();

function responseFrom(chunks: string[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }));
}

describe("consumeAssistantStreamResponse", () => {
  it("returns partial assistant text as an errored result after an error terminal", async () => {
    const onText = vi.fn();
    const outcome = await consumeAssistantStreamResponse(responseFrom([
      "data: {\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Partial answer\"}]}}\n\n",
      "event: error\n",
      "data: {\"error\":\"Agent failed\",\"conversationId\":\"conv-1\"}\n\n",
    ]), undefined, onText, { kind: "project", projectId: "alpha" });

    expect(outcome).toEqual({
      status: "error",
      content: "Partial answer",
      error: "Agent failed",
      actions: [],
      conversationId: "conv-1",
    });
    expect(onText).toHaveBeenLastCalledWith("Partial answer");
  });

  it("does not turn partial text plus premature EOF into a completed message", async () => {
    const outcome = await consumeAssistantStreamResponse(responseFrom([
      "data: {\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Partial\"}]}}\n\n",
    ]), undefined, () => undefined, {
      kind: "project",
      projectId: "alpha",
    });

    expect(outcome).toMatchObject({
      status: "error",
      content: "Partial",
      error: "SSE stream ended before a terminal event.",
    });
  });

  it("accepts actions and conversation identity only from a valid done event", async () => {
    const outcome = await consumeAssistantStreamResponse(responseFrom([
      "data: {\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Complete\"}]}}\n\n",
      "event: done\ndata: {\"conversationId\":\"conv-2\",\"actions\":[]}\n\n",
    ]), undefined, () => undefined, {
      kind: "project",
      projectId: "alpha",
    });

    expect(outcome).toEqual({
      status: "complete",
      content: "Complete",
      actions: [],
      conversationId: "conv-2",
    });
  });

  it.each([
    ["complete", "event: done\ndata: "],
    ["error", "event: error\ndata: "],
    ["cancelled", "event: cancelled\ndata: "],
  ])("retains trusted workspace actions from a %s terminal", async (
    terminalType,
    prefix,
  ) => {
    const action = {
      type: "note_created",
      attributes: {
        stableId: "note-1",
        scope: "codascope",
        visibility: "private",
        path: "notes/one.md",
        title: "One",
        contentHash: "a".repeat(64),
      },
      description: "Created a CodaScope note.",
    };
    const payload = {
      ...(terminalType === "error"
        ? { error: "Workspace assistant run failed." }
        : {}),
      conversationId: "conv-1",
      assistantMessageId: "assistant-1",
      actions: [action],
    };
    const outcome = await consumeAssistantStreamResponse(
      responseFrom([`${prefix}${JSON.stringify(payload)}\n\n`]),
      undefined,
      () => undefined,
      { kind: "workspace" },
    );

    expect(outcome).toMatchObject({
      status: terminalType,
      actions: [action],
      conversationId: "conv-1",
      assistantMessageId: "assistant-1",
    });
  });

  it("rejects malformed workspace terminal actions while project arrays remain unchanged", async () => {
    const malformedPayload = JSON.stringify({
      conversationId: "conv-1",
      actions: [{
        type: "note_created",
        attributes: { stableId: "../escape" },
        description: "Forged.",
      }],
    });
    const workspace = await consumeAssistantStreamResponse(
      responseFrom([`event: done\ndata: ${malformedPayload}\n\n`]),
      undefined,
      () => undefined,
      { kind: "workspace" },
    );
    const project = await consumeAssistantStreamResponse(
      responseFrom([`event: done\ndata: ${malformedPayload}\n\n`]),
      undefined,
      () => undefined,
      { kind: "project", projectId: "alpha" },
    );

    expect(workspace).toMatchObject({ status: "error", actions: [] });
    expect(project).toMatchObject({
      status: "complete",
      actions: [expect.objectContaining({ type: "note_created" })],
    });
  });
});

describe("workspace persisted turn reconciliation", () => {
  const createdAction = {
    type: "note_created",
    attributes: {
      stableId: "note-1",
      scope: "codascope",
      visibility: "private",
      path: "one.md",
      title: "One",
      contentHash: "a".repeat(64),
    },
    description: "Created a CodaScope note.",
  };
  const known: AssistantChatMessage = {
    id: "known-user",
    role: "user",
    content: "Earlier",
    status: "complete",
  };
  const persisted: AssistantChatMessage = {
    id: "assistant-server-id",
    role: "assistant",
    content: "Created it before generation stopped.",
    status: "error",
    metadata: { actions: [createdAction] },
  };

  it("selects the stable server assistant identity without duplicating known messages", () => {
    expect(findPersistedWorkspaceAssistantMessage(
      [known, persisted],
      "assistant-server-id",
      new Set(["known-user"]),
    )).toEqual(persisted);
    expect(findPersistedWorkspaceAssistantMessage(
      [known, persisted],
      undefined,
      new Set(["known-user"]),
    )).toEqual(persisted);
  });

  it("uses the authoritative persisted conversation after error or local transport loss", async () => {
    const conversation: Conversation = {
      id: "conv-1",
      scope: { kind: "workspace" },
      ownerId: "alan",
      title: "Conversation",
      summary: "",
      createdAt: "2026-07-26T10:00:00.000Z",
      updatedAt: "2026-07-26T10:01:00.000Z",
      defaultModelId: null,
      messages: [
        {
          id: "known-user",
          role: "user",
          content: "Earlier",
          createdAt: "2026-07-26T10:00:00.000Z",
          updatedAt: null,
          modelId: null,
          status: "complete",
          context: null,
          metadata: {},
        },
        {
          id: "assistant-server-id",
          role: "assistant",
          content: persisted.content,
          createdAt: "2026-07-26T10:01:00.000Z",
          updatedAt: null,
          modelId: "model",
          status: "error",
          context: null,
          metadata: persisted.metadata ?? {},
        },
      ],
    };
    const api = {
      endpoints: {
        displayImage: vi.fn(),
      },
      readConversation: vi.fn().mockResolvedValue(conversation),
    } as unknown as AssistantConversationApi;

    const result = await reconcilePersistedWorkspaceAssistantTurn(
      api,
      "conv-1",
      "assistant-server-id",
      new Set(["known-user"]),
      1,
    );

    expect(result?.assistantMessage).toMatchObject({
      id: "assistant-server-id",
      status: "error",
      metadata: { actions: [createdAction] },
    });
    expect(result?.messages.map((message) => message.id)).toEqual([
      "known-user",
      "assistant-server-id",
    ]);
  });
});

describe("assistant stream scoping", () => {
  it("builds a workspace payload without a fake project or client grant", () => {
    const payload = createAssistantMessagePayload(
      { kind: "workspace" },
      {
        conversationId: "conv-1",
        message: "Compare the projects",
        modelId: "model",
        context: {
          assistantScope: { kind: "workspace" },
          currentView: { view: "projects" },
          explicitlyReferencedProjectIds: [],
        },
        attachments: [{ type: "image", path: "conv-1/images/image.png" }],
        references: [{ category: "wiki", id: "topic", label: "Topic" }],
        selectionContext: {
          blockId: "block",
          text: "selection",
          startLine: 1,
          endLine: 2,
          docId: "doc",
          epicId: "epic",
        },
      },
    );

    expect(payload).toMatchObject({
      message: "Compare the projects",
      modelId: "model",
      attachments: [{ type: "image", path: "conv-1/images/image.png" }],
    });
    expect(payload).not.toHaveProperty("projectId");
    expect(payload).not.toHaveProperty("workspaceReadGrant");
    expect(payload).not.toHaveProperty("readGrant");
    expect(payload).not.toHaveProperty("ownerId");
    expect(payload).not.toHaveProperty("actorId");
    expect(payload).not.toHaveProperty("references");
    expect(payload).not.toHaveProperty("selectionContext");
  });

  it("preserves project-only references and selection context", () => {
    const payload = createAssistantMessagePayload(
      { kind: "project", projectId: "alpha" },
      {
        conversationId: "conv-1",
        message: "Review",
        modelId: "model",
        references: [{ category: "wiki", id: "topic", label: "Topic" }],
        selectionContext: {
          blockId: "block",
          text: "selection",
          startLine: 1,
          endLine: 2,
          docId: "doc",
          epicId: "epic",
        },
      },
    );
    expect(payload).toMatchObject({
      references: [{ category: "wiki", id: "topic", label: "Topic" }],
      selectionContext: { docId: "doc", epicId: "epic" },
    });
  });

  it("cancels against the run's original scope endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const controller = new AbortController();
    await cancelAssistantRun({ kind: "workspace" }, controller, fetchMock);
    expect(controller.signal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/codascope/workspace/assistant/cancel",
      { method: "POST" },
    );
  });

  it("requests workspace cancellation without aborting terminal delivery", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    await requestAssistantCancellation({ kind: "workspace" }, fetchMock);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/codascope/workspace/assistant/cancel",
      { method: "POST" },
    );
  });

  it("rejects stale stream events after a scope transition", () => {
    const workspaceRun = { id: 1, scopeKey: "workspace" };
    expect(isAssistantRunCurrent(
      workspaceRun,
      workspaceRun,
      "workspace",
    )).toBe(true);
    expect(isAssistantRunCurrent(
      workspaceRun,
      workspaceRun,
      "project:alpha",
    )).toBe(false);
    expect(isAssistantRunCurrent(
      workspaceRun,
      { id: 2, scopeKey: "workspace" },
      "workspace",
    )).toBe(false);
  });
});
