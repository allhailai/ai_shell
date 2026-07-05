/* ── useConversationManager ─────────────────────────────────────────
   Encapsulates conversation CRUD, URL sync, localStorage persistence,
   and conversation switching for the CodaScope Assistant.

   Extracted from CodaScopeAssistant to reduce component complexity.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useCallback, useEffect } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { clearRecentViews } from "../contextAssembler";
import type { ConversationSummary } from "../components/ConversationHeader";

/* ── Types ───────────────────────────────────────────────────────── */

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "complete" | "streaming" | "error";
  createdAt?: string;
  metadata?: Record<string, unknown>;
  /** Image attachment URLs (for display in the chat bubble) */
  images?: Array<{ url: string; filename: string }>;
}

export interface UseConversationManagerResult {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  activeTitle: string;
  setActiveTitle: (title: string) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  loadConversationList: () => Promise<ConversationSummary[]>;
  loadConversation: (convId: string) => Promise<void>;
  createNewConversation: (opts: { streaming: boolean; selectedModelId: string | null }) => Promise<void>;
  switchConversation: (convId: string, streaming: boolean) => Promise<void>;
}

/* ── Hook ────────────────────────────────────────────────────────── */

export function useConversationManager(
  activeProjectId: string | null,
): UseConversationManagerResult {
  const { getParam, setParam } = useAppSubRoute("codascope");

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState("New conversation");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const lastProjectRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // ── Load conversation list ────────────────────────────────────────

  const loadConversationList = useCallback(async (): Promise<ConversationSummary[]> => {
    if (!activeProjectId) return [];
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

  // ── Load a single conversation ────────────────────────────────────

  const loadConversation = useCallback(async (convId: string) => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/conversations/${convId}`);
      if (res.ok) {
        const data = await res.json();
        const conv = data.conversation;
        setActiveConversationId(conv.id);
        setActiveTitle(conv.title);
        setMessages(
          conv.messages
            .filter((m: ChatMessage) => m.role === "user" || m.role === "assistant")
            .map((m: ChatMessage) => {
              // Restore image URLs from metadata for conversation history
              const metaImages = m.metadata?.images as Array<{ path: string; filename: string }> | undefined;
              const images = metaImages?.map((img) => ({
                url: `/api/codascope/projects/${activeProjectId}/conversations/${convId}/images/${img.filename}`,
                filename: img.filename,
              }));
              return {
                id: m.id,
                role: m.role,
                content: m.content,
                status: m.status ?? "complete",
                createdAt: m.createdAt,
                metadata: m.metadata,
                images,
              };
            }),
        );
      }
    } catch {
      // silently fail
    }
  }, [activeProjectId]);

  // ── On mount or project change — load conversations, open most recent ──

  useEffect(() => {
    if (!activeProjectId) return;
    if (lastProjectRef.current === activeProjectId) return;
    lastProjectRef.current = activeProjectId;

    // Clear navigation history when switching projects
    clearRecentViews();

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

  // ── Persist active conversation to URL + localStorage ─────────────

  useEffect(() => {
    if (!activeProjectId || !activeConversationId) return;
    // Update URL query param (replaceState — no navigation)
    setParam("conv", activeConversationId);
    // Also keep localStorage as fallback
    try {
      localStorage.setItem(`codascope:lastConv:${activeProjectId}`, activeConversationId);
    } catch { /* ignore */ }
  }, [activeProjectId, activeConversationId, setParam]);

  // ── Create new conversation ───────────────────────────────────────

  const createNewConversation = useCallback(async (opts: { streaming: boolean; selectedModelId: string | null }) => {
    if (!activeProjectId || opts.streaming) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: opts.selectedModelId }),
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
  }, [activeProjectId, loadConversationList]);

  // ── Switch conversation ───────────────────────────────────────────

  const switchConversation = useCallback(async (convId: string, streaming: boolean) => {
    if (streaming) return;
    await loadConversation(convId);
  }, [loadConversation]);

  return {
    conversations,
    activeConversationId,
    setActiveConversationId,
    activeTitle,
    setActiveTitle,
    messages,
    setMessages,
    loadConversationList,
    loadConversation,
    createNewConversation,
    switchConversation,
  };
}
