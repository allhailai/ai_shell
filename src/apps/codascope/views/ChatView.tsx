/* ── CodaScope: ChatView ──────────────────────────────────────────────
   Full-screen codebase Q&A interface with SSE streaming.
   Uses the same Cursor SDK agent as the right-panel assistant,
   but with purpose "chat" for multi-turn conversations.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useRef, useEffect } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { MarkdownViewer } from "../../../shared/markdown";
import { ModelPicker, useModelPicker } from "../components/ModelPicker";

interface LocalChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: number;
}

export function ChatView() {
  const { activeProjectId, clearChat: storeClearChat } = useCodaScopeStore();

  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  const { models, selectedModelId, selectModel, loading: modelsLoading } = useModelPicker();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll to bottom on new messages / streaming content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent]);

  // ── Send message ──────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || !activeProjectId || !selectedModelId) return;

    const userMessage: LocalChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setStreaming(true);
    setStreamingContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, modelId: selectedModelId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

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
            } catch {
              // Skip
            }
          }
        }
      }

      if (accumulated) {
        const agentMsg: LocalChatMessage = {
          id: `msg-${Date.now()}-agent`,
          role: "agent",
          content: accumulated,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, agentMsg]);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;

      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-error`,
          role: "agent",
          content: `**Error:** ${(err as Error).message}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setStreaming(false);
      setStreamingContent("");
      abortRef.current = null;
    }
  }, [input, streaming, activeProjectId, selectedModelId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleClear = useCallback(() => {
    setMessages([]);
    setStreamingContent("");
    storeClearChat();
  }, [storeClearChat]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setStreamingContent("");
  }, []);

  if (!activeProjectId) {
    return (
      <div className="codascope-empty-state">
        <div className="codascope-empty-state-icon">💬</div>
        <div className="codascope-empty-state-title">No Project Selected</div>
        <div className="codascope-empty-state-text">
          Select a project to chat with your codebase.
        </div>
      </div>
    );
  }

  return (
    <div className="codascope-chat">
      {/* Messages */}
      <div className="codascope-chat-messages">
        {messages.length === 0 && !streaming && (
          <div className="codascope-empty-state" style={{ flex: 1 }}>
            <div className="codascope-empty-state-icon">💬</div>
            <div className="codascope-empty-state-title">Chat with Your Codebase</div>
            <div className="codascope-empty-state-text">
              Ask questions about your code. The agent will search your wiki and
              repositories to find answers.
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`codascope-chat-message codascope-chat-message--${msg.role}`}
          >
            {msg.role === "agent" ? (
              <MarkdownViewer content={msg.content} />
            ) : (
              msg.content
            )}
          </div>
        ))}

        {/* Streaming message */}
        {streaming && (
          <div className="codascope-chat-message codascope-chat-message--agent">
            {streamingContent ? (
              <MarkdownViewer content={streamingContent} />
            ) : (
              <div className="codascope-assistant-thinking">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="codascope-chat-input-area">
        <div className="codascope-chat-controls">
          <ModelPicker
            models={models}
            selectedModelId={selectedModelId}
            onSelect={selectModel}
            disabled={modelsLoading || streaming}
          />
          <div className="codascope-chat-control-actions">
            {streaming ? (
              <button
                className="codascope-btn codascope-btn-ghost"
                onClick={handleStop}
                type="button"
                title="Stop generation"
              >
                ■ Stop
              </button>
            ) : messages.length > 0 ? (
              <button
                className="codascope-btn codascope-btn-ghost"
                onClick={handleClear}
                title="Clear chat"
                type="button"
              >
                🗑️ Clear
              </button>
            ) : null}
          </div>
        </div>
        <div className="codascope-chat-input-row">
          <textarea
            className="codascope-chat-input"
            placeholder="Ask about your codebase…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={streaming || !selectedModelId}
          />
          <button
            className="codascope-btn codascope-btn-primary"
            onClick={handleSend}
            disabled={streaming || !input.trim() || !selectedModelId}
            type="button"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
