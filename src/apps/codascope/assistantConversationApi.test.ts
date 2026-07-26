import { describe, expect, it, vi } from "vitest";
import {
  createAssistantConversationApi,
  restoreAssistantMessages,
} from "./assistantConversationApi";
import type { Conversation } from "./codaScopeTypes";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const conversation = {
  id: "conv-1",
  scope: { kind: "workspace" as const },
  title: "Workspace chat",
  summary: "Summary",
  createdAt: "2026-07-26T10:00:00.000Z",
  updatedAt: "2026-07-26T11:00:00.000Z",
  defaultModelId: "model",
  messages: [],
};

describe("assistant conversation API boundary", () => {
  it("runs workspace create, read/select, update, delete, and image upload through workspace URLs", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ conversation }, 201))
      .mockResolvedValueOnce(jsonResponse({ conversation }))
      .mockResolvedValueOnce(jsonResponse({
        conversation: { ...conversation, title: "Renamed" },
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({
        path: "conv-1/images/image.png",
        filename: "image.png",
      }, 201));
    const api = createAssistantConversationApi(
      { kind: "workspace" },
      fetchMock,
    );

    expect(await api.createConversation({ modelId: "model" }))
      .toMatchObject({ id: "conv-1", title: "Workspace chat" });
    expect(await api.readConversation("conv-1"))
      .toMatchObject({ id: "conv-1" });
    expect(await api.updateConversation("conv-1", { title: "Renamed" }))
      .toMatchObject({ title: "Renamed" });
    expect(await api.deleteConversation("conv-1")).toBe(true);
    expect(await api.uploadImage("conv-1", new FormData())).toEqual({
      path: "conv-1/images/image.png",
      filename: "image.png",
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/codascope/workspace/conversations",
      "/api/codascope/workspace/conversations/conv-1",
      "/api/codascope/workspace/conversations/conv-1",
      "/api/codascope/workspace/conversations/conv-1",
      "/api/codascope/workspace/conversations/conv-1/images",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "PATCH" });
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("normalizes and sorts workspace and legacy project list responses at the API boundary", async () => {
    const payload = {
      conversations: [
        {
          id: "older",
          title: "Older",
          createdAt: "2026-07-25T10:00:00.000Z",
          updatedAt: "2026-07-25T11:00:00.000Z",
        },
        {
          id: "newer",
          title: "Newer",
          summary: "Latest",
          modelId: "model",
          messageCount: 2,
          createdAt: "2026-07-26T10:00:00.000Z",
          updatedAt: "2026-07-26T11:00:00.000Z",
        },
      ],
    };
    for (const scope of [
      { kind: "workspace" } as const,
      { kind: "project", projectId: "alpha" } as const,
    ]) {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(payload));
      const summaries = await createAssistantConversationApi(
        scope,
        fetchMock,
      ).listConversations();
      expect(summaries.map((summary) => summary.id))
        .toEqual(["newer", "older"]);
      expect(summaries[1]).toMatchObject({
        summary: "",
        modelId: null,
        messageCount: 0,
      });
    }
  });

  it.each([
    {
      scope: { kind: "workspace" } as const,
      expected:
        "/api/codascope/workspace/conversations/conv-1/images/image.png",
    },
    {
      scope: { kind: "project", projectId: "alpha" } as const,
      expected:
        "/api/codascope/projects/alpha/conversations/conv-1/images/image.png",
    },
  ])("restores $scope.kind image display URLs", ({ scope, expected }) => {
    const api = createAssistantConversationApi(scope, vi.fn());
    const withImage: Conversation = {
      ...conversation,
      messages: [{
        id: "message-1",
        role: "user",
        content: "See image",
        metadata: {
          images: [{ path: "ignored/server/path", filename: "image.png" }],
        },
      }],
    };
    expect(restoreAssistantMessages(withImage, api.endpoints)[0]?.images)
      .toEqual([{ url: expected, filename: "image.png" }]);
  });
});
