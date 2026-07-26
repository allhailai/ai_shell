import { describe, expect, it, vi } from "vitest";
import {
  cancelAssistantRun,
  consumeAssistantStreamResponse,
  createAssistantMessagePayload,
  isAssistantRunCurrent,
} from "./useAssistantStream";

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
    ]), undefined, onText);

    expect(outcome).toEqual({
      status: "error",
      content: "Partial answer",
      error: "Agent failed",
      conversationId: "conv-1",
    });
    expect(onText).toHaveBeenLastCalledWith("Partial answer");
  });

  it("does not turn partial text plus premature EOF into a completed message", async () => {
    const outcome = await consumeAssistantStreamResponse(responseFrom([
      "data: {\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Partial\"}]}}\n\n",
    ]), undefined, () => undefined);

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
    ]), undefined, () => undefined);

    expect(outcome).toEqual({
      status: "complete",
      content: "Complete",
      actions: [],
      conversationId: "conv-2",
    });
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
