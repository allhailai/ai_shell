import { afterEach, describe, expect, it, vi } from "vitest";
import { runResearchStream } from "./ActionCard";

const encoder = new TextEncoder();

function responseFrom(text: string): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("runResearchStream", () => {
  it("does not resolve on the research-complete progress event without done", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => responseFrom(
      "event: research-complete\ndata: {\"sourcesProcessed\":1}\n\n",
    )));
    await expect(runResearchStream("/research", {}, () => undefined)).rejects.toThrow(
      "before a terminal event",
    );
  });

  it("rejects standard error, cancellation, and premature EOF", async () => {
    const frames = [
      ["event: error\ndata: {\"error\":\"research failed\"}\n\n", "research failed"],
      ["event: cancelled\ndata: {}\n\n", "cancelled"],
      ["event: research-step\ndata: {\"step\":\"generate-plan\"}\n\n", "before a terminal event"],
    ] as const;

    for (const [frame, message] of frames) {
      vi.stubGlobal("fetch", vi.fn(async () => responseFrom(frame)));
      await expect(runResearchStream("/research", {}, () => undefined)).rejects.toThrow(message);
    }
  });

  it("resolves only after the standard done terminal", async () => {
    const progress = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => responseFrom([
      "event: research-complete\ndata: {}\n\n",
      "event: done\ndata: {}\n\n",
    ].join(""))));

    await expect(runResearchStream("/research", {}, progress)).resolves.toBeUndefined();
    expect(progress).toHaveBeenLastCalledWith(null);
  });
});
