/* ── useAssistantStream ─────────────────────────────────────────────
   Encapsulates the SSE streaming logic for the CodaScope Assistant.

   Responsibilities:
   - POSTs to the messages endpoint and parses the SSE stream
   - Accumulates streaming text, extracts action tags from done event
   - Handles auto-titling on first message
   - Provides cancel support (client + server-side)
   - Returns streaming state for the UI layer

   NOTE: This hook intentionally keeps inline SSE parsing (not using
   codaScopeSseClient.ts) because the chat stream has specialized
   handling for action parsing, auto-title, and per-block text
   accumulation that doesn't fit the generic SSE client interface.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useCallback } from "react";
import type { CodaScopeAction } from "../components/ActionCard";

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

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error((err as { error?: string }).error ?? `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      let parsedActions: CodaScopeAction[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "assistant" && data.message?.content) {
                for (const block of data.message.content) {
                  if (block.type === "text") {
                    accumulated += block.text;
                    setStreamingContent(accumulated);
                  }
                }
              }
              // Capture actions from done event
              if (data.actions && Array.isArray(data.actions)) {
                parsedActions = data.actions as CodaScopeAction[];
              }
              // Capture conversation ID if it was just created
              if (data.conversationId) {
                setActiveConversationId(data.conversationId);
              }
            } catch {
              // Skip malformed JSON
            }
          }
          // "event: done" line is consumed; the data line above handles the payload.
        }
      }

      // Build the final assistant message
      let assistantMessage: ChatMessage | null = null;
      if (accumulated) {
        assistantMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: accumulated,
          status: "complete",
          metadata: parsedActions.length > 0 ? { actions: parsedActions } : undefined,
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
