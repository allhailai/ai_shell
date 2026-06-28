/* ── CodaScope: ChatView ──────────────────────────────────────────────
   Codebase Q&A interface. Users ask questions, the agent responds
   using wiki and code context. Rendered with the shared MarkdownViewer.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useRef, useEffect } from "react";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { MarkdownViewer } from "../../../shared/markdown";

export function ChatView() {
  const {
    activeProjectId,
    chatMessages,
    addChatMessage,
    clearChat,
    selectedModel,
  } = useCodaScopeStore();

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length]);

  // ── Send message ──────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !activeProjectId) return;

    const userMessage = {
      id: `msg-${Date.now()}`,
      role: "user" as const,
      content: text,
      timestamp: new Date().toISOString(),
    };

    addChatMessage(userMessage);
    setInput("");
    setSending(true);

    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, model: selectedModel }),
      });

      if (res.ok) {
        const data = await res.json();
        addChatMessage({
          id: `msg-${Date.now()}-agent`,
          role: "agent",
          content: data.response ?? "No response received.",
          timestamp: new Date().toISOString(),
          context: data.context,
        });
      } else {
        addChatMessage({
          id: `msg-${Date.now()}-error`,
          role: "agent",
          content: "Sorry, I encountered an error processing your question. Please try again.",
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      addChatMessage({
        id: `msg-${Date.now()}-error`,
        role: "agent",
        content: "Network error. Is the server running?",
        timestamp: new Date().toISOString(),
      });
    } finally {
      setSending(false);
    }
  }, [input, sending, activeProjectId, selectedModel, addChatMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

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
        {chatMessages.length === 0 && (
          <div className="codascope-empty-state" style={{ flex: 1 }}>
            <div className="codascope-empty-state-icon">💬</div>
            <div className="codascope-empty-state-title">Chat with Your Codebase</div>
            <div className="codascope-empty-state-text">
              Ask questions about your code and the agent will answer using wiki context and code analysis.
            </div>
          </div>
        )}

        {chatMessages.map((msg) => (
          <div key={msg.id} className={`codascope-chat-message codascope-chat-message--${msg.role}`}>
            {msg.role === "agent" ? (
              <MarkdownViewer content={msg.content} />
            ) : (
              msg.content
            )}
            {msg.context && msg.context.length > 0 && (
              <div style={{
                marginTop: "var(--space-2)",
                paddingTop: "var(--space-2)",
                borderTop: "1px solid var(--color-border-primary)",
                fontSize: "var(--text-2xs)",
                color: "var(--color-text-tertiary)",
              }}>
                Context: {msg.context.join(", ")}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="codascope-chat-message codascope-chat-message--agent">
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              color: "var(--color-text-tertiary)",
              fontSize: "var(--text-sm)",
            }}>
              <span className="codascope-status-badge codascope-status-badge--running">● Thinking</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="codascope-chat-input-area">
        <textarea
          className="codascope-chat-input"
          placeholder="Ask about your codebase…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="codascope-btn codascope-btn-primary"
          onClick={handleSend}
          disabled={sending || !input.trim()}
          type="button"
        >
          Send
        </button>
        {chatMessages.length > 0 && (
          <button
            className="codascope-btn codascope-btn-ghost"
            onClick={clearChat}
            title="Clear chat history"
            type="button"
          >
            🗑️
          </button>
        )}
      </div>
    </div>
  );
}
