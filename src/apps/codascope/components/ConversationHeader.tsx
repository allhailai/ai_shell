/* ── CodaScope: Conversation Header ──────────────────────────────────
   Compact header at the top of the right panel.
   Clickable title toggles a history popover with search/filter.
   Modeled on kiss_ai's AgentConversationHeader.
   ──────────────────────────────────────────────────────────────────── */

import { useRef, useState } from "react";
import { IconChat } from "./CodaScopeIcons";

export interface ConversationSummary {
  id: string;
  title: string;
  summary: string;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ConversationHeader({
  activeConversationId,
  activeTitle,
  conversations,
  disabled,
  onNewConversation,
  onSelectConversation,
}: {
  activeConversationId: string | undefined;
  activeTitle: string;
  conversations: ConversationSummary[];
  disabled: boolean;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const titleRef = useRef<HTMLButtonElement | null>(null);

  const filteredConversations = filter.trim()
    ? conversations.filter((c) => {
        const q = filter.toLowerCase();
        return (
          c.title.toLowerCase().includes(q) ||
          c.summary.toLowerCase().includes(q)
        );
      })
    : conversations;

  const selectConversation = (id: string) => {
    if (disabled) return;
    setHistoryOpen(false);
    setFilter("");
    onSelectConversation(id);
    titleRef.current?.focus();
  };

  const handleNew = () => {
    if (disabled) return;
    setHistoryOpen(false);
    setFilter("");
    onNewConversation();
  };

  return (
    <div className="codascope-conv-header">
      <div className="codascope-conv-title-row">
        <button
          aria-expanded={historyOpen}
          aria-haspopup="listbox"
          aria-label="Select conversation"
          className="codascope-conv-title-trigger"
          disabled={disabled}
          onClick={() => setHistoryOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && historyOpen) {
              e.preventDefault();
              setHistoryOpen(false);
            }
          }}
          ref={titleRef}
          type="button"
        >
          <span className="codascope-conv-title-icon">
            <IconChat size={14} />
          </span>
          <strong className="codascope-conv-title-text">{activeTitle}</strong>
          <span aria-hidden="true" className="codascope-conv-title-chevron">
            {historyOpen ? "▴" : "▾"}
          </span>
        </button>

        <button
          className="codascope-conv-new-btn"
          disabled={disabled}
          onClick={handleNew}
          title="New conversation"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
        </button>
      </div>

      {historyOpen && (
        <section
          aria-label="Saved conversations"
          className="codascope-conv-popover"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setHistoryOpen(false);
              setFilter("");
              titleRef.current?.focus();
            }
          }}
        >
          <input
            aria-label="Filter conversations"
            className="codascope-conv-filter"
            onChange={(e) => setFilter(e.currentTarget.value)}
            placeholder="Search conversations…"
            type="search"
            value={filter}
            autoFocus
          />
          <div className="codascope-conv-list" role="listbox">
            {filteredConversations.length > 0 ? (
              filteredConversations.map((conv) => (
                <button
                  aria-selected={activeConversationId === conv.id}
                  className={`codascope-conv-item ${activeConversationId === conv.id ? "codascope-conv-item--active" : ""}`}
                  disabled={disabled}
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  role="option"
                  type="button"
                >
                  <strong className="codascope-conv-item-title">{conv.title}</strong>
                  {conv.summary && (
                    <span className="codascope-conv-item-summary">{conv.summary}</span>
                  )}
                  <small className="codascope-conv-item-meta">
                    {formatRelativeTime(conv.updatedAt)} · {conv.messageCount} message
                    {conv.messageCount === 1 ? "" : "s"}
                  </small>
                </button>
              ))
            ) : (
              <p className="codascope-conv-empty">
                {filter ? "No conversations match this filter." : "No conversations yet."}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
