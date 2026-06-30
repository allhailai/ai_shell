/* ── CodaScope: Right-Panel Assistant ─────────────────────────────────
   Contextual AI assistant that lives in the right panel.
   
   Features:
   - Persistent conversations (survives refresh / panel close)
   - History switching via ConversationHeader dropdown
   - Streaming responses via SSE (POST → text/event-stream)
   - Auto-injected context from current view (lightweight)
   - Agent progressively discovers wiki/repo content via custom tools
   - Model picker with last-selection memory
   - Thinking indicator during processing
   ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, useCallback } from "react";
import { useCodaScopeStore } from "./useCodaScopeStore";
import { MarkdownViewer } from "../../shared/markdown";
import { assembleContext } from "./contextAssembler";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import { ModelPicker, useModelPicker } from "./components/ModelPicker";
import { IconSearch } from "./components/CodaScopeIcons";
import { ConversationHeader, type ConversationSummary } from "./components/ConversationHeader";

// ── Types ───────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "complete" | "streaming" | "error";
  createdAt?: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
}

// ── Component ───────────────────────────────────────────────────────

export function CodaScopeAssistant() {
  const { segments, getParam, setParam } = useAppSubRoute("codascope");
  const { activeProjectId, projects } = useCodaScopeStore();

  // Conversation state
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState("New conversation");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  const { models, selectedModelId, selectModel, loading: modelsLoading } = useModelPicker();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastProjectRef = useRef<string | null>(null);

  // Get the current project name for context
  const projectName = projects.find((p) => p.id === activeProjectId)?.name ?? "Unknown";

  // ── Load conversations on mount / project change ──────────────────

  const loadConversationList = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/conversations`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations ?? []);
        return data.conversations ?? [];
      }
    } catch {
      // silently fail
    }
    return [];
  }, [activeProjectId]);

  const loadConversation = useCallback(async (convId: string) => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/conversations/${convId}`);
      if (res.ok) {
        const data = await res.json();
        const conv: Conversation = data.conversation;
        setActiveConversationId(conv.id);
        setActiveTitle(conv.title);
        setMessages(
          conv.messages
            .filter((m: ChatMessage) => m.role === "user" || m.role === "assistant")
            .map((m: ChatMessage) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              status: m.status ?? "complete",
              createdAt: m.createdAt,
            })),
        );
      }
    } catch {
      // silently fail
    }
  }, [activeProjectId]);

  // On mount or project change — load conversations, open most recent
  useEffect(() => {
    if (!activeProjectId) return;
    if (lastProjectRef.current === activeProjectId) return;
    lastProjectRef.current = activeProjectId;

    let cancelled = false;
    void (async () => {
      const convs = await loadConversationList();
      if (cancelled) return;

      // Priority: URL param > localStorage > most recent
      const urlConvId = getParam("conv");
      let restoreId: string | null = urlConvId;

      // Fall back to localStorage if no URL param
      if (!restoreId) {
        const lastConvKey = `codascope:lastConv:${activeProjectId}`;
        try { restoreId = localStorage.getItem(lastConvKey); } catch { /* ignore */ }
      }

      // Check if the target conversation exists in the list
      const restoreConv = restoreId && convs.find((c: ConversationSummary) => c.id === restoreId);
      if (restoreConv) {
        await loadConversation(restoreConv.id);
      } else if (convs.length > 0) {
        await loadConversation(convs[0].id);
      } else {
        // No conversations — show welcome
        setActiveConversationId(null);
        setActiveTitle("New conversation");
        setMessages([]);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProjectId, loadConversationList, loadConversation, getParam]);

  // Persist active conversation to URL + localStorage
  useEffect(() => {
    if (!activeProjectId || !activeConversationId) return;
    // Update URL query param (replaceState — no navigation)
    setParam("conv", activeConversationId);
    // Also keep localStorage as fallback
    try {
      localStorage.setItem(`codascope:lastConv:${activeProjectId}`, activeConversationId);
    } catch { /* ignore */ }
  }, [activeProjectId, activeConversationId, setParam]);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, streamingContent]);

  // Build context from current view
  const getContext = useCallback(() => {
    const ctx = assembleContext(segments, projectName);
    if (!ctx) return undefined;
    return {
      view: ctx.view,
      projectName: ctx.projectName,
      projectId: activeProjectId,
    };
  }, [segments, projectName, activeProjectId]);

  // Get context badge label
  const contextBadge = (() => {
    const ctx = assembleContext(segments, projectName);
    if (!ctx) return null;
    switch (ctx.view) {
      case "wiki": return "Wiki";
      case "dashboard": return "Dashboard";
      case "settings": return "Settings";
      case "skills": return "Skills";
      case "quality": return "Quality";
      case "rules": return "Golden Rules";
      case "concepts": return "Concepts";
      default: return ctx.view;
    }
  })();

  // ── Create new conversation ───────────────────────────────────────

  const createNewConversation = useCallback(async () => {
    if (!activeProjectId || streaming) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: selectedModelId }),
      });
      if (res.ok) {
        const data = await res.json();
        const conv = data.conversation;
        setActiveConversationId(conv.id);
        setActiveTitle(conv.title);
        setMessages([]);
        // Refresh list
        await loadConversationList();
        inputRef.current?.focus();
      }
    } catch {
      // silently fail
    }
  }, [activeProjectId, streaming, selectedModelId, loadConversationList]);

  // ── Switch conversation ───────────────────────────────────────────

  const switchConversation = useCallback(async (convId: string) => {
    if (streaming) return;
    await loadConversation(convId);
  }, [streaming, loadConversation]);

  // ── Send message ──────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming || !selectedModelId || !activeProjectId) return;

    // If no active conversation, create one first
    let convId = activeConversationId;
    if (!convId) {
      try {
        const res = await fetch(`/api/codascope/projects/${activeProjectId}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId: selectedModelId }),
        });
        if (res.ok) {
          const data = await res.json();
          convId = data.conversation.id;
          setActiveConversationId(convId);
          setActiveTitle(data.conversation.title);
        }
      } catch {
        return;
      }
    }

    if (!convId) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      status: "complete",
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);
    setStreamingContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(
        `/api/codascope/projects/${activeProjectId}/conversations/${convId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            modelId: selectedModelId,
            context: getContext(),
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
      let newTitle: string | undefined;

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
              // Capture conversation ID from done event
              if (data.conversationId && !activeConversationId) {
                setActiveConversationId(data.conversationId);
              }
            } catch {
              // Skip malformed JSON
            }
          } else if (line.startsWith("event: done")) {
            // Next data line contains result with conversationId
          }
        }
      }

      // Finalize the assistant message
      if (accumulated) {
        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: accumulated,
          status: "complete",
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }

      // Auto-update title if this was the first message
      if (messages.length === 0 && trimmed) {
        const firstLine = trimmed.split("\n").map((l) => l.trim()).find(Boolean) ?? trimmed;
        newTitle = firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
        setActiveTitle(newTitle);
      }

      // Refresh conversation list to get updated titles/summaries
      await loadConversationList();
    } catch (err) {
      if ((err as Error).name === "AbortError") return;

      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `**Error:** ${(err as Error).message}`,
        status: "error",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setStreaming(false);
      setStreamingContent("");
      abortRef.current = null;
    }
  }, [input, streaming, selectedModelId, activeProjectId, activeConversationId, getContext, messages.length, loadConversationList]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setStreamingContent("");
  }, []);

  // ── Render ────────────────────────────────────────────────────────

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
      {/* Conversation Header */}
      <ConversationHeader
        activeConversationId={activeConversationId ?? undefined}
        activeTitle={activeTitle}
        conversations={conversations}
        disabled={streaming}
        onNewConversation={createNewConversation}
        onSelectConversation={switchConversation}
      />

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
            <div className="codascope-assistant-welcome-icon"><IconSearch size={24} /></div>
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
            {streaming && (
              <button
                className="codascope-assistant-stop-btn"
                onClick={stopStreaming}
                type="button"
                title="Stop generation"
              >
                ■
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
