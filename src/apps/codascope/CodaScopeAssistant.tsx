/* ── CodaScope: Right-Panel Assistant ─────────────────────────────────
   Contextual AI assistant that lives in the right panel.
   
   Features:
   - Streaming responses via SSE (POST → text/event-stream)
   - Auto-injected context from current view (lightweight)
   - Agent progressively discovers wiki/repo content via custom tools
   - Model picker with last-selection memory
   - Thinking indicator during processing
   ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, useCallback } from "react";
import { MarkdownViewer } from "../../shared/markdown";
import { ModelPicker, useModelPicker } from "./components/ModelPicker";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import { useCodaScopeStore } from "./useCodaScopeStore";
import { assembleContext, formatContextForAgent } from "./contextAssembler";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export function CodaScopeAssistant() {
  const { segments } = useAppSubRoute("codascope");
  const { activeProjectId, projects } = useCodaScopeStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  const { models, selectedModelId, selectModel, loading: modelsLoading } = useModelPicker();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Get the current project name for context
  const projectName = projects.find((p) => p.id === activeProjectId)?.name ?? "Unknown";

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, streamingContent]);

  // Build context from current view
  const getContext = useCallback(() => {
    const ctx = assembleContext(segments, projectName);
    return formatContextForAgent(ctx);
  }, [segments, projectName]);

  // Get context badge label
  const contextBadge = (() => {
    const ctx = assembleContext(segments, projectName);
    if (!ctx) return null;
    switch (ctx.view) {
      case "wiki": return `📄 Wiki`;
      case "dashboard": return "📊 Dashboard";
      case "settings": return "⚙️ Settings";
      case "skills": return "🛠️ Skills";
      case "chat": return "💬 Chat";
      default: return `📋 ${ctx.view}`;
    }
  })();

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming || !selectedModelId || !activeProjectId) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);
    setStreamingContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`/api/codascope/projects/${activeProjectId}/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          modelId: selectedModelId,
          context: getContext(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error((err as { error?: string }).error ?? `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

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
              // Skip malformed JSON
            }
          } else if (line.startsWith("event: done")) {
            // Stream complete — handled below
          } else if (line.startsWith("event: error")) {
            // Next data line will have the error
          }
        }
      }

      // Finalize the assistant message
      if (accumulated) {
        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: accumulated,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // User cancelled

      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `**Error:** ${(err as Error).message}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setStreaming(false);
      setStreamingContent("");
      abortRef.current = null;
    }
  }, [input, streaming, selectedModelId, activeProjectId, getContext]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    setStreamingContent("");
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setStreamingContent("");
  }, []);

  if (!activeProjectId) {
    return (
      <div className="codascope-assistant-empty">
        <div className="codascope-assistant-empty-icon">🤖</div>
        <p>Select a project to use the assistant.</p>
      </div>
    );
  }

  return (
    <div className="codascope-assistant">
      {/* Context Badge */}
      {contextBadge && (
        <div className="codascope-assistant-context">
          <span className="codascope-assistant-context-badge">{contextBadge}</span>
          <span className="codascope-assistant-context-label">Context</span>
        </div>
      )}

      {/* Messages */}
      <div className="codascope-assistant-messages" ref={scrollRef}>
        {messages.length === 0 && !streaming && (
          <div className="codascope-assistant-welcome">
            <div className="codascope-assistant-welcome-icon">🔍</div>
            <h3>CodaScope Assistant</h3>
            <p>
              Ask questions about your codebase. I can browse your wiki,
              search repositories, and help you understand the code.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`codascope-assistant-msg codascope-assistant-msg-${msg.role}`}
          >
            <div className="codascope-assistant-msg-avatar">
              {msg.role === "user" ? "👤" : "🤖"}
            </div>
            <div className="codascope-assistant-msg-content">
              {msg.role === "assistant" ? (
                <MarkdownViewer content={msg.content} />
              ) : (
                <p>{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {/* Streaming message */}
        {streaming && (
          <div className="codascope-assistant-msg codascope-assistant-msg-assistant">
            <div className="codascope-assistant-msg-avatar">🤖</div>
            <div className="codascope-assistant-msg-content">
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
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="codascope-assistant-input-area">
        <div className="codascope-assistant-input-controls">
          <ModelPicker
            models={models}
            selectedModelId={selectedModelId}
            onSelect={selectModel}
            disabled={modelsLoading || streaming}
            compact
          />
          <div className="codascope-assistant-input-actions">
            {streaming ? (
              <button
                className="codascope-assistant-stop-btn"
                onClick={stopStreaming}
                type="button"
                title="Stop generation"
              >
                ■
              </button>
            ) : (
              <button
                className="codascope-assistant-clear-btn"
                onClick={clearChat}
                type="button"
                title="Clear conversation"
                disabled={messages.length === 0}
              >
                🗑️
              </button>
            )}
          </div>
        </div>
        <div className="codascope-assistant-input-row">
          <textarea
            ref={inputRef}
            className="codascope-assistant-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your codebase..."
            rows={1}
            disabled={streaming || !selectedModelId}
          />
          <button
            className="codascope-assistant-send-btn"
            onClick={sendMessage}
            disabled={!input.trim() || streaming || !selectedModelId}
            type="button"
            title="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
