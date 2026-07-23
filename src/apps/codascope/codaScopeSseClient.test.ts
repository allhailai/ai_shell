import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CodaScopeSseParser,
  connectToSseStream,
  consumeSseResponse,
  responseErrorMessage,
  SseProtocolError,
  type SseEventRecord,
} from "./codaScopeSseClient";

const encoder = new TextEncoder();

afterEach(() => vi.unstubAllGlobals());

function responseFromChunks(chunks: string[], status = 200): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status });
}

function splitAtEveryBoundary(value: string): string[][] {
  const variants: string[][] = [];
  for (let i = 0; i <= value.length; i += 1) {
    for (let j = i; j <= value.length; j += 1) {
      variants.push([value.slice(0, i), value.slice(i, j), value.slice(j)]);
    }
  }
  return variants;
}

describe("CodaScopeSseParser", () => {
  it("preserves an error event name across every event/data chunk boundary", async () => {
    const frame = "event: error\ndata: {\"error\":\"broken\"}\n\n";
    for (const chunks of splitAtEveryBoundary(frame)) {
      const terminal = await consumeSseResponse(responseFromChunks(chunks));
      expect(terminal).toMatchObject({ type: "error", error: "broken" });
    }
  });

  it("handles one-byte chunks, CRLF, comments, multiple records, and multi-line data", () => {
    const records: SseEventRecord[] = [];
    const parser = new CodaScopeSseParser((record) => records.push(record));
    const stream = [
      ": heartbeat\r\n\r\n",
      "event: custom\r\n",
      "data: first\r\n",
      "data: second\r\n\r\n",
      "data: {\"type\":\"progress\"}\r\n\r\n",
    ].join("");
    for (const byte of stream) parser.push(byte);
    parser.finish();

    expect(records).toEqual([
      { event: "custom", data: "first\nsecond" },
      { event: "message", data: "{\"type\":\"progress\"}" },
    ]);
  });

  it("rejects an incomplete trailing record", () => {
    const parser = new CodaScopeSseParser(() => undefined);
    parser.push("event: done\ndata: {}");
    expect(() => parser.finish()).toThrow("incomplete event record");
  });
});

describe("consumeSseResponse", () => {
  it("settles on done, cancels the reader, and does not wait for transport EOF", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: done\ndata: {\"buildSummary\":\"Finished\"}\n\n"));
        // Intentionally leave the transport open forever.
      },
      cancel,
    }));
    const settled = vi.fn();

    const completion = consumeSseResponse(response);
    void completion.then(settled);
    await expect(completion).resolves.toMatchObject({ type: "done", summary: "Finished" });
    await Promise.resolve();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("accepts done followed by EOF exactly once and ignores post-terminal records", async () => {
    const onEvent = vi.fn();
    const terminal = await consumeSseResponse(responseFromChunks([
      "event: done\ndata: {\"buildSummary\":\"Finished\"}\n\n",
      "event: error\ndata: {\"error\":\"late\"}\n\n",
    ]), { onEvent });

    expect(terminal).toEqual({
      type: "done",
      data: { buildSummary: "Finished" },
      summary: "Finished",
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("returns error followed by EOF once and never reports success", async () => {
    const terminal = await consumeSseResponse(responseFromChunks([
      "event: error\ndata: {\"error\":\"server failed\"}\n\n",
    ]));
    expect(terminal).toMatchObject({ type: "error", error: "server failed" });
  });

  it("fails unexpected EOF without a terminal event", async () => {
    await expect(consumeSseResponse(responseFromChunks([
      "event: message\ndata: {\"type\":\"progress\"}\n\n",
    ]))).rejects.toThrow("before a terminal event");
  });

  it.each([
    ["done", "null"],
    ["done", "{\"buildSummary\":42}"],
    ["error", "{}"],
    ["error", "not-json"],
    ["cancelled", "{\"runId\":42}"],
    ["cancelled", "not-json"],
  ])("fails closed for malformed %s payload %s", async (event, data) => {
    await expect(consumeSseResponse(responseFromChunks([
      `event: ${event}\ndata: ${data}\n\n`,
    ]))).rejects.toBeInstanceOf(SseProtocolError);
  });

  it("keeps caller abort distinct from unexpected EOF", async () => {
    const controller = new AbortController();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encoder.encode("event: message\ndata: {}\n\n"));
        controller.abort();
        stream.close();
      },
    }));

    await expect(consumeSseResponse(response, {}, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("preserves useful JSON and text HTTP errors", async () => {
    await expect(responseErrorMessage(new Response(
      JSON.stringify({ error: "Model is unavailable" }),
      { status: 503 },
    ))).resolves.toBe("Model is unavailable");
    await expect(responseErrorMessage(new Response(
      "Gateway timeout while starting research",
      { status: 504 },
    ))).resolves.toBe("Gateway timeout while starting research");
  });
});

describe("connectToSseStream terminal callbacks", () => {
  it("calls success exactly once and never failure after done", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => responseFromChunks([
      "event: done\ndata: {}\n\n",
      "event: error\ndata: {\"error\":\"late\"}\n\n",
    ])));
    const onDone = vi.fn();
    const onError = vi.fn();
    connectToSseStream("/stream", { onDone, onError });

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls failure exactly once and never success after error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => responseFromChunks([
      "event: error\ndata: {\"error\":\"failed\"}\n\n",
      "event: done\ndata: {}\n\n",
    ])));
    const onDone = vi.fn();
    const onError = vi.fn();
    connectToSseStream("/stream", { onDone, onError });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith("failed");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("does not turn an onDone exception into an error terminal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => responseFromChunks([
      "event: done\ndata: {}\n\n",
    ])));
    const onDone = vi.fn(() => { throw new Error("consumer done failure"); });
    const onError = vi.fn();
    connectToSseStream("/stream", { onDone, onError });

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not turn an onCancelled exception into an error terminal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => responseFromChunks([
      "event: cancelled\ndata: {\"runId\":\"run-1\"}\n\n",
    ])));
    const onCancelled = vi.fn(() => { throw new Error("consumer cancellation failure"); });
    const onError = vi.fn();
    connectToSseStream("/stream", { onDone: vi.fn(), onError, onCancelled });

    await vi.waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
  });

  it("contains an onError exception without invoking it again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => responseFromChunks([
      "event: error\ndata: {\"error\":\"failed\"}\n\n",
    ])));
    const onError = vi.fn(() => { throw new Error("consumer error failure"); });
    connectToSseStream("/stream", { onDone: vi.fn(), onError });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
