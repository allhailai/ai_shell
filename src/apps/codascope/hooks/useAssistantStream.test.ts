import { describe, expect, it, vi } from "vitest";
import { consumeAssistantStreamResponse } from "./useAssistantStream";

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
