/* ── CodaScope: SSE Client ────────────────────────────────────────────
   Shared streaming utilities for connecting to CodaScope SSE endpoints.

   Used by ProjectDashboard (build pipeline) and potentially other views
   that consume server-sent events from the CodaScope backend.
   ──────────────────────────────────────────────────────────────────── */

/* ── Types ──────────────────────────────────────────────────────────── */

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

export interface SseStreamCallbacks {
  onText: (text: string) => void;
  onRunStarted?: (runId: string, pipeline?: unknown) => void;
  onDone: (summary: string | null) => void;
  onError: (error: string) => void;
  onWikiRefresh?: (topics: unknown[]) => void;
  onPipelineStep?: (step: PipelineStep) => void;
  onCancelled?: (runId: string) => void;
}

export type SseStreamTarget =
  | string
  | { url: string; method: "POST"; body: Record<string, unknown> };

/* ── SSE Line Parser ────────────────────────────────────────────────── */

/**
 * Parse SSE lines from a streaming response chunk.
 * Returns any incomplete remainder (to be prepended to the next chunk).
 */
export function parseSseChunk(
  chunk: string,
  handler: (event: string, data: string) => void,
): string {
  const lines = chunk.split("\n");
  const remainder = lines.pop() ?? "";
  let currentEvent = "message";

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      handler(currentEvent, line.slice(6));
      currentEvent = "message";
    }
  }

  return remainder;
}

/* ── SSE Stream Connection ──────────────────────────────────────────── */

/**
 * Connect to a CodaScope SSE endpoint and dispatch events to callbacks.
 * Returns an AbortController that can be used to cancel the connection.
 *
 * Handles all standard CodaScope SSE events:
 * - `run-started` — emitted at the beginning of a pipeline run
 * - `pipeline-step` — progress updates for individual pipeline steps
 * - `done` — run completed successfully
 * - `error` — run failed
 * - `cancelled` — run was cancelled by the user
 * - `wiki-refresh` — wiki topics were updated
 * - `message` (default) — streaming agent text output
 */
export function connectToSseStream(
  url: SseStreamTarget,
  callbacks: SseStreamCallbacks,
): AbortController {
  const controller = new AbortController();

  const fetchOpts: RequestInit = {
    signal: controller.signal,
  };

  let fetchUrl: string;
  if (typeof url === "string") {
    fetchUrl = url;
  } else {
    fetchUrl = url.url;
    fetchOpts.method = url.method;
    fetchOpts.headers = { "Content-Type": "application/json" };
    fetchOpts.body = JSON.stringify(url.body);
  }

  void (async () => {
    try {
      const res = await fetch(fetchUrl, fetchOpts);

      if (!res.ok || !res.body) {
        let errorText = "Failed to connect.";
        try {
          const data = await res.json();
          errorText = data.error ?? data.message ?? errorText;
        } catch {
          errorText = await res.text();
        }
        callbacks.onError(errorText);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        buffer = parseSseChunk(buffer, (event, data) => {
          if (event === "run-started") {
            try {
              const parsed = JSON.parse(data);
              callbacks.onRunStarted?.(parsed.runId, parsed.pipeline);
            } catch { /* skip */ }
          } else if (event === "pipeline-step") {
            try {
              const parsed = JSON.parse(data);
              callbacks.onPipelineStep?.(parsed);
            } catch { /* skip */ }
          } else if (event === "done") {
            try {
              const parsed = JSON.parse(data);
              callbacks.onDone(parsed.buildSummary ?? null);
            } catch {
              callbacks.onDone(null);
            }
          } else if (event === "error") {
            try {
              const parsed = JSON.parse(data);
              callbacks.onError(parsed.error ?? "Unknown error");
            } catch {
              callbacks.onError("Unknown error");
            }
          } else if (event === "cancelled") {
            try {
              const parsed = JSON.parse(data);
              callbacks.onCancelled?.(parsed.runId ?? "");
            } catch {
              callbacks.onCancelled?.("");
            }
          } else if (event === "wiki-refresh") {
            try {
              const parsed = JSON.parse(data);
              callbacks.onWikiRefresh?.(parsed.topics ?? []);
            } catch { /* skip */ }
          } else {
            // Regular data message — streaming agent text
            try {
              const msg = JSON.parse(data);
              if (msg.type === "assistant" && msg.message?.content) {
                for (const block of msg.message.content) {
                  if (block.type === "text" && block.text) {
                    callbacks.onText(block.text);
                  }
                }
              }
            } catch { /* skip malformed */ }
          }
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : "Network error.";
        callbacks.onError(message);
      }
    }
  })();

  return controller;
}
