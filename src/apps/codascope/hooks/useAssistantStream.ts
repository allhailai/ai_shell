/* ── useAssistantStream ─────────────────────────────────────────────
   Scope-aware SSE streaming for the CodaScope assistant. Every run retains
   its original endpoint family through completion or cancellation.
   ──────────────────────────────────────────────────────────────────── */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import type {
  AssistantChatMessage,
  AssistantScope,
  CodaScopeAction,
} from "../codaScopeTypes";
import { createAssistantEndpointAdapter } from "../assistantConversationApi";
import { getAssistantScopeKey } from "../assistantScope";
import {
  consumeSseResponse,
  SseProtocolError,
} from "../codaScopeSseClient";

export interface StreamOptions {
  conversationId: string;
  message: string;
  modelId: string;
  context?: Record<string, unknown>;
  attachments?: Array<{ type: "image"; path: string }>;
  references?: Array<{ category: string; id: string; label: string }>;
  selectionContext?: {
    blockId: string;
    text: string;
    startLine: number;
    endLine: number;
    docId: string;
    epicId: string;
  };
}

interface StreamResult {
  assistantMessage: AssistantChatMessage | null;
  newTitle?: string;
  conversationId?: string;
  discarded?: boolean;
}

export type AssistantStreamOutcome =
  | {
      status: "complete";
      content: string;
      actions: CodaScopeAction[];
      conversationId?: string;
    }
  | {
      status: "error";
      content: string;
      error: string;
      conversationId?: string;
    }
  | { status: "cancelled"; content: string };

interface ActiveRun {
  id: number;
  scopeKey: string;
  scope: AssistantScope;
  controller: AbortController;
}

export function isAssistantRunCurrent(
  run: Pick<ActiveRun, "id" | "scopeKey">,
  activeRun: Pick<ActiveRun, "id" | "scopeKey"> | null,
  currentScopeKey: string,
): boolean {
  return Boolean(activeRun)
    && activeRun?.id === run.id
    && activeRun.scopeKey === run.scopeKey
    && currentScopeKey === run.scopeKey;
}

export async function cancelAssistantRun(
  scope: AssistantScope,
  controller: AbortController,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  controller.abort();
  const endpoints = createAssistantEndpointAdapter(scope);
  try {
    await fetchImpl(endpoints.cancelRun(), { method: "POST" });
  } catch {
    // Cancellation remains best effort after local detachment.
  }
}

export function createAssistantMessagePayload(
  scope: AssistantScope,
  options: StreamOptions,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    message: options.message,
    modelId: options.modelId,
    context: options.context,
  };
  if (options.attachments && options.attachments.length > 0) {
    payload.attachments = options.attachments;
  }
  if (scope.kind === "project") {
    if (options.references && options.references.length > 0) {
      payload.references = options.references;
    }
    if (options.selectionContext) {
      payload.selectionContext = options.selectionContext;
    }
  }
  return payload;
}

/** Consume chat SSE while retaining partial text for an explicit error result. */
export async function consumeAssistantStreamResponse(
  response: Response,
  signal: AbortSignal | undefined,
  onText: (content: string) => void,
): Promise<AssistantStreamOutcome> {
  let accumulated = "";
  try {
    const terminal = await consumeSseResponse(response, {
      onText: (text) => {
        accumulated += text;
        onText(accumulated);
      },
    }, signal);

    if (terminal.type === "cancelled") {
      return { status: "cancelled", content: accumulated };
    }

    const conversationId = terminal.data.conversationId;
    if (conversationId !== undefined && typeof conversationId !== "string") {
      throw new SseProtocolError(
        `Malformed ${terminal.type} terminal event payload.`,
      );
    }

    if (terminal.type === "error") {
      return {
        status: "error",
        content: accumulated,
        error: terminal.error,
        ...(typeof conversationId === "string" ? { conversationId } : {}),
      };
    }

    const rawActions = terminal.data.actions;
    if (rawActions !== undefined && !Array.isArray(rawActions)) {
      throw new SseProtocolError("Malformed done terminal event payload.");
    }
    return {
      status: "complete",
      content: accumulated,
      actions: (rawActions ?? []) as CodaScopeAction[],
      ...(typeof conversationId === "string" ? { conversationId } : {}),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return {
      status: "error",
      content: accumulated,
      error: error instanceof Error ? error.message : "Network error.",
    };
  }
}

export interface UseAssistantStreamResult {
  streaming: boolean;
  streamingContent: string;
  streamMessage: (options: StreamOptions) => Promise<StreamResult>;
  cancelStream: () => Promise<void>;
  detachActiveRun: () => Promise<void>;
}

export function useAssistantStream(
  scope: AssistantScope,
): UseAssistantStreamResult {
  const scopeKey = getAssistantScopeKey(scope);
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const activeRunRef = useRef<ActiveRun | null>(null);
  const pendingCancellationRef = useRef<Promise<void> | null>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  const currentScopeKeyRef = useRef(scopeKey);
  currentScopeKeyRef.current = scopeKey;

  const cancelRun = useCallback(async (
    run: ActiveRun,
    updateVisibleState: boolean,
  ) => {
    if (activeRunRef.current === run) activeRunRef.current = null;
    if (updateVisibleState && mountedRef.current) {
      setStreaming(false);
      setStreamingContent("");
    }
    await cancelAssistantRun(run.scope, run.controller);
  }, []);

  const detachActiveRun = useCallback(async () => {
    const run = activeRunRef.current;
    if (run) {
      const pending = cancelRun(run, true);
      pendingCancellationRef.current = pending;
      await pending;
      if (pendingCancellationRef.current === pending) {
        pendingCancellationRef.current = null;
      }
      return;
    }
    await pendingCancellationRef.current;
  }, [cancelRun]);

  useEffect(() => {
    mountedRef.current = true;
    const run = activeRunRef.current;
    if (run && run.scopeKey !== scopeKey) {
      const pending = cancelRun(run, true);
      pendingCancellationRef.current = pending;
      void pending.finally(() => {
        if (pendingCancellationRef.current === pending) {
          pendingCancellationRef.current = null;
        }
      });
    }
  }, [cancelRun, scopeKey]);

  useEffect(() => () => {
    mountedRef.current = false;
    const active = activeRunRef.current;
    if (active) void cancelRun(active, false);
  }, [cancelRun]);

  const streamMessage = useCallback(async (
    options: StreamOptions,
  ): Promise<StreamResult> => {
    const runScope = scope;
    const runScopeKey = scopeKey;
    const endpoints = createAssistantEndpointAdapter(runScope);
    const run: ActiveRun = {
      id: ++runIdRef.current,
      scopeKey: runScopeKey,
      scope: runScope,
      controller: new AbortController(),
    };
    activeRunRef.current = run;
    setStreaming(true);
    setStreamingContent("");

    const isActive = () =>
      mountedRef.current
      && isAssistantRunCurrent(
        run,
        activeRunRef.current,
        currentScopeKeyRef.current,
      );

    try {
      const response = await fetch(
        endpoints.sendMessage(options.conversationId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            createAssistantMessagePayload(runScope, options),
          ),
          signal: run.controller.signal,
        },
      );
      const outcome = await consumeAssistantStreamResponse(
        response,
        run.controller.signal,
        (content) => {
          if (isActive()) setStreamingContent(content);
        },
      );
      if (!isActive()) {
        return { assistantMessage: null, discarded: true };
      }
      if (outcome.status === "cancelled") {
        return { assistantMessage: null };
      }

      let assistantMessage: AssistantChatMessage | null = null;
      if (outcome.status === "error") {
        const failureText = `**Stream failed:** ${outcome.error}`;
        assistantMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: outcome.content
            ? `${outcome.content}\n\n${failureText}`
            : failureText,
          status: "error",
        };
      } else if (outcome.content) {
        const actions = runScope.kind === "project" ? outcome.actions : [];
        assistantMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: outcome.content,
          status: "complete",
          metadata: actions.length > 0 ? { actions } : undefined,
        };
      }

      const firstLine = options.message
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean) ?? options.message;
      const newTitle = firstLine.length > 72
        ? `${firstLine.slice(0, 69)}...`
        : firstLine;
      return {
        assistantMessage,
        newTitle,
        conversationId: outcome.conversationId,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          assistantMessage: null,
          discarded: currentScopeKeyRef.current !== runScopeKey,
        };
      }
      if (!isActive()) {
        return { assistantMessage: null, discarded: true };
      }
      return {
        assistantMessage: {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `**Error:** ${
            error instanceof Error ? error.message : "Network error."
          }`,
          status: "error",
        },
      };
    } finally {
      if (activeRunRef.current === run) {
        activeRunRef.current = null;
        if (mountedRef.current && currentScopeKeyRef.current === runScopeKey) {
          setStreaming(false);
          setStreamingContent("");
        }
      }
    }
  }, [scope, scopeKey]);

  const cancelStream = useCallback(async () => {
    const run = activeRunRef.current;
    if (!run) {
      await pendingCancellationRef.current;
      return;
    }
    const pending = cancelRun(run, true);
    pendingCancellationRef.current = pending;
    await pending;
    if (pendingCancellationRef.current === pending) {
      pendingCancellationRef.current = null;
    }
  }, [cancelRun]);

  const runIsInCurrentScope =
    activeRunRef.current?.scopeKey === scopeKey;

  return {
    streaming: runIsInCurrentScope ? streaming : false,
    streamingContent: runIsInCurrentScope ? streamingContent : "",
    streamMessage,
    cancelStream,
    detachActiveRun,
  };
}
