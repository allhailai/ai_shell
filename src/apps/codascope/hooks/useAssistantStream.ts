/* ── useAssistantStream ─────────────────────────────────────────────
   Encapsulates the SSE streaming logic for the CodaScope Assistant.

   Responsibilities:
   - POSTs to the messages endpoint and parses the SSE stream
   - Accumulates streaming text, extracts action tags from done event
   - Handles auto-titling on first message
   - Provides cancel support (client + server-side)
   - Returns streaming state for the UI layer

   Parsing and terminal enforcement are delegated to codaScopeSseClient.ts.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useCallback } from "react";
import type { CodaScopeAction } from "../components/ActionCard";
import {
  consumeSseResponse,
  SseProtocolError,
} from "../codaScopeSseClient";

/* ── Types ───────────────────────────────────────────────────────── */

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "complete" | "streaming" | "error";
  createdAt?: string;
  metadata?: Record<string, unknown>;
  images?: Array<{ url: string; filename: string }>;
}

interface StreamOptions {
  projectId: string;
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
  assistantMessage: ChatMessage | null;
  newTitle?: string;
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
      throw new SseProtocolError(`Malformed ${terminal.type} terminal event payload.`);
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
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return {
      status: "error",
      content: accumulated,
      error: err instanceof Error ? err.message : "Network error.",
    };
  }
}

interface UseAssistantStreamResult {
  streaming: boolean;
  streamingContent: string;
  /** Send a message and stream the response. Returns the final assistant message. */
  streamMessage: (options: StreamOptions) => Promise<StreamResult>;
  /** Cancel the current stream (client + server). */
  cancelStream: (projectId: string) => Promise<void>;
}

/* ── Hook ────────────────────────────────────────────────────────── */

export function useAssistantStream(
  setActiveConversationId: (id: string) => void,
): UseAssistantStreamResult {
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const streamMessage = useCallback(async (options: StreamOptions): Promise<StreamResult> => {
    const {
      projectId,
      conversationId,
      message,
      modelId,
      context,
      attachments,
      references,
      selectionContext,
    } = options;

    setStreaming(true);
    setStreamingContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(
        `/api/codascope/projects/${projectId}/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            modelId,
            context,
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
            ...(references && references.length > 0 ? { references } : {}),
            ...(selectionContext ? { selectionContext } : {}),
          }),
          signal: controller.signal,
        },
      );

      const outcome = await consumeAssistantStreamResponse(
        response,
        controller.signal,
        setStreamingContent,
      );
      if (outcome.status !== "cancelled" && outcome.conversationId) {
        setActiveConversationId(outcome.conversationId);
      }

      if (outcome.status === "cancelled") {
        return { assistantMessage: null };
      }

      // Build the final assistant message
      let assistantMessage: ChatMessage | null = null;
      if (outcome.status === "error") {
        const failureText = `**Stream failed:** ${outcome.error}`;
        assistantMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: outcome.content ? `${outcome.content}\n\n${failureText}` : failureText,
          status: "error",
        };
      } else if (outcome.content) {
        assistantMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: outcome.content,
          status: "complete",
          metadata: outcome.actions.length > 0 ? { actions: outcome.actions } : undefined,
        };
      }

      // Auto-title from first user message
      const firstLine = message.split("\n").map((l) => l.trim()).find(Boolean) ?? message;
      const newTitle = firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;

      return { assistantMessage, newTitle };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { assistantMessage: null };
      }

      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `**Error:** ${(err as Error).message}`,
        status: "error",
      };
      return { assistantMessage: errorMsg };
    } finally {
      setStreaming(false);
      setStreamingContent("");
      abortRef.current = null;
    }
  }, [setActiveConversationId]);

  const cancelStream = useCallback(async (projectId: string) => {
    abortRef.current?.abort();
    // Also cancel server-side agent
    try {
      await fetch(`/api/codascope/projects/${projectId}/assistant/cancel`, {
        method: "POST",
      });
    } catch { /* best effort */ }
    setStreaming(false);
    setStreamingContent("");
  }, []);

  return { streaming, streamingContent, streamMessage, cancelStream };
}
