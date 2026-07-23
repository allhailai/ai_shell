/* ── CodaScope: SSE Client ───────────────────────────────────
   Canonical parser and transport for fetch-based CodaScope SSE streams.
   ───────────────────────────────────────────────────────────────────────────── */

export interface PipelineStep {
  step: string;
  status: string;
  repo?: string;
  topic?: string;
  progress?: string;
  reason?: string;
  error?: string;
  mode?: string;
}

export interface SseEventRecord {
  event: string;
  data: string;
}

export interface SseEventCallbacks {
  onText?: (text: string) => void;
  onEvent?: (record: SseEventRecord) => void;
  onRunStarted?: (runId: string, pipeline?: unknown) => void;
  onWikiRefresh?: (topics: unknown[]) => void;
  onPipelineStep?: (step: PipelineStep) => void;
}

export interface SseStreamCallbacks extends SseEventCallbacks {
  onDone: (summary: string | null) => void;
  onError: (error: string) => void;
  onCancelled?: (runId: string) => void;
}

export type SseStreamTarget =
  | string
  | { url: string; method: "POST"; body: Record<string, unknown> };

export type SseTerminalResult =
  | { type: "done"; data: Record<string, unknown>; summary: string | null }
  | { type: "error"; data: Record<string, unknown>; error: string }
  | { type: "cancelled"; data: Record<string, unknown>; runId: string };

export class SseProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SseProtocolError";
  }
}

/* ── Stateful SSE parser ─────────────────────────────────────────────── */

/**
 * Stateful SSE record parser. Event names, data lines, and partial lines are
 * retained until a blank-line record boundary is received.
 */
export class CodaScopeSseParser {
  private lineBuffer = "";
  private eventName = "";
  private dataLines: string[] = [];
  private recordStarted = false;

  constructor(private readonly handler: (record: SseEventRecord) => void) {}

  push(chunk: string): void {
    this.lineBuffer += chunk;
    let newline = this.lineBuffer.indexOf("\n");
    while (newline >= 0) {
      let line = this.lineBuffer.slice(0, newline);
      this.lineBuffer = this.lineBuffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.processLine(line);
      newline = this.lineBuffer.indexOf("\n");
    }
  }

  /** Flush the final line and fail if EOF interrupted an SSE record. */
  finish(): void {
    if (this.lineBuffer.length > 0) {
      let line = this.lineBuffer;
      this.lineBuffer = "";
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.processLine(line);
    }

    if (this.recordStarted) {
      throw new SseProtocolError("SSE stream ended with an incomplete event record.");
    }
  }

  private processLine(line: string): void {
    if (line === "") {
      if (this.recordStarted) {
        this.handler({
          event: this.eventName || "message",
          data: this.dataLines.join("\n"),
        });
      }
      this.resetRecord();
      return;
    }

    // Comment/heartbeat lines never create records.
    if (line.startsWith(":")) return;

    const colon = line.indexOf(":");
    const field = colon >= 0 ? line.slice(0, colon) : line;
    let value = colon >= 0 ? line.slice(colon + 1) : "";
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") {
      this.recordStarted = true;
      this.eventName = value;
    } else if (field === "data") {
      this.recordStarted = true;
      this.dataLines.push(value);
    }
  }

  private resetRecord(): void {
    this.eventName = "";
    this.dataLines = [];
    this.recordStarted = false;
  }
}

function parseObjectPayload(record: SseEventRecord): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.data);
  } catch {
    throw new SseProtocolError(`Malformed ${record.event} terminal event payload.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SseProtocolError(`Malformed ${record.event} terminal event payload.`);
  }
  return parsed as Record<string, unknown>;
}

function parseTerminal(record: SseEventRecord): SseTerminalResult {
  const data = parseObjectPayload(record);
  if (record.event === "done") {
    const summary = data.buildSummary;
    if (summary !== undefined && summary !== null && typeof summary !== "string") {
      throw new SseProtocolError("Malformed done terminal event payload.");
    }
    return { type: "done", data, summary: typeof summary === "string" ? summary : null };
  }
  if (record.event === "error") {
    if (typeof data.error !== "string" || data.error.trim() === "") {
      throw new SseProtocolError("Malformed error terminal event payload.");
    }
    return { type: "error", data, error: data.error };
  }

  const runId = data.runId;
  if (runId !== undefined && typeof runId !== "string") {
    throw new SseProtocolError("Malformed cancelled terminal event payload.");
  }
  return { type: "cancelled", data, runId: typeof runId === "string" ? runId : "" };
}

function parseJsonRecord(record: SseEventRecord): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(record.data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function invokeConsumerCallback(callback: (() => void) | undefined): void {
  if (!callback) return;
  try {
    callback();
  } catch {
    // Consumer observers never own parser or transport state.
  }
}

function dispatchNonTerminal(record: SseEventRecord, callbacks: SseEventCallbacks): void {
  invokeConsumerCallback(callbacks.onEvent ? () => callbacks.onEvent!(record) : undefined);
  const parsed = parseJsonRecord(record);

  if (record.event === "run-started") {
    if (parsed && typeof parsed.runId === "string") {
      invokeConsumerCallback(callbacks.onRunStarted
        ? () => callbacks.onRunStarted!(parsed.runId as string, parsed.pipeline)
        : undefined);
    }
    return;
  }
  if (record.event === "pipeline-step") {
    if (parsed) {
      invokeConsumerCallback(callbacks.onPipelineStep
        ? () => callbacks.onPipelineStep!(parsed as unknown as PipelineStep)
        : undefined);
    }
    return;
  }
  if (record.event === "wiki-refresh") {
    if (parsed && Array.isArray(parsed.topics)) {
      invokeConsumerCallback(callbacks.onWikiRefresh
        ? () => callbacks.onWikiRefresh!(parsed.topics as unknown[])
        : undefined);
    }
    return;
  }
  if (record.event !== "message" || !parsed || parsed.type !== "assistant") return;

  const message = parsed.message;
  if (!message || typeof message !== "object") return;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block && typeof block === "object") {
      const typed = block as { type?: unknown; text?: unknown };
      if (typed.type === "text" && typeof typed.text === "string" && typed.text) {
        invokeConsumerCallback(callbacks.onText ? () => callbacks.onText!(typed.text as string) : undefined);
      }
    }
  }
}

/** Read a failed HTTP response once and preserve JSON or text error details. */
export async function responseErrorMessage(
  response: Response,
  fallback = "Failed to connect.",
): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `${fallback} (HTTP ${response.status})`;
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
  } catch {
    // Plain text is already the most useful server response.
  }
  return text;
}

/**
 * Consume a fetch response until one explicit standard terminal event arrives.
 * EOF without `done`, `error`, or `cancelled` is a protocol failure.
 */
export async function consumeSseResponse(
  response: Response,
  callbacks: SseEventCallbacks = {},
  signal?: AbortSignal,
): Promise<SseTerminalResult> {
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  if (!response.body) throw new Error("SSE response did not include a body.");

  let terminal: SseTerminalResult | null = null;
  const parser = new CodaScopeSseParser((record) => {
    // Terminal state is exactly once. Records delivered after it are ignored.
    if (terminal) return;
    if (record.event === "done" || record.event === "error" || record.event === "cancelled") {
      terminal = parseTerminal(record);
      invokeConsumerCallback(callbacks.onEvent ? () => callbacks.onEvent!(record) : undefined);
      return;
    }
    dispatchNonTerminal(record, callbacks);
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      parser.push(decoder.decode(value, { stream: true }));

      const parsedTerminal = terminal as SseTerminalResult | null;
      if (parsedTerminal) {
        // A terminal SSE record, not transport EOF, owns completion. Request
        // cancellation without awaiting an underlying source that may stay open.
        void reader.cancel().catch(() => undefined);
        return parsedTerminal;
      }
    }
    parser.push(decoder.decode());

    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    parser.finish();
    if (!terminal) {
      throw new SseProtocolError("SSE stream ended before a terminal event.");
    }

    return terminal;
  } finally {
    reader.releaseLock();
  }
}

/* ── SSE stream connection ─────────────────────────────────────────── */

export interface StartedSseStream {
  controller: AbortController;
  completion: Promise<SseTerminalResult>;
}

/** Start a stream with a promise outcome for non-React/background consumers. */
export function startSseStream(
  target: SseStreamTarget,
  callbacks: SseEventCallbacks = {},
): StartedSseStream {
  const controller = new AbortController();
  const fetchOpts: RequestInit = { signal: controller.signal };
  let fetchUrl: string;

  if (typeof target === "string") {
    fetchUrl = target;
  } else {
    fetchUrl = target.url;
    fetchOpts.method = target.method;
    fetchOpts.headers = { "Content-Type": "application/json" };
    fetchOpts.body = JSON.stringify(target.body);
  }

  return {
    controller,
    completion: (async () => {
      const response = await fetch(fetchUrl, fetchOpts);
      return consumeSseResponse(response, callbacks, controller.signal);
    })(),
  };
}

/** Connect to a CodaScope SSE endpoint and return an unmount-safe abort handle. */
export function connectToSseStream(
  target: SseStreamTarget,
  callbacks: SseStreamCallbacks,
): AbortController {
  const { controller, completion } = startSseStream(target, callbacks);

  void (async () => {
    let terminal: SseTerminalResult;
    try {
      terminal = await completion;
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) return;
      terminal = {
        type: "error",
        data: { error: err instanceof Error ? err.message : "Network error." },
        error: err instanceof Error ? err.message : "Network error.",
      };
    }

    // Terminal callbacks are application code. Keep their exceptions outside
    // the transport failure path so one outcome can never trigger another.
    try {
      if (terminal.type === "done") {
        callbacks.onDone(terminal.summary);
      } else if (terminal.type === "error") {
        callbacks.onError(terminal.error);
      } else if (callbacks.onCancelled) {
        callbacks.onCancelled(terminal.runId);
      } else {
        callbacks.onError("Operation was cancelled.");
      }
    } catch {
      // Consumer callback failures must not alter or repeat the terminal state.
    }
  })();

  return controller;
}
