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

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useCodaScopeStore } from "./useCodaScopeStore";
import { MarkdownViewer } from "../../shared/markdown";
import { assembleContext, clearRecentViews } from "./contextAssembler";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import { ModelPicker, useModelPicker } from "./components/ModelPicker";
import { IconSearch, IconCopy, IconCheck, IconCurate } from "./components/CodaScopeIcons";
import { ConversationHeader, type ConversationSummary } from "./components/ConversationHeader";
import { ActionCardList, type CodaScopeAction } from "./components/ActionCard";
import { PromptChips, type PromptChipContext } from "./components/PromptChips";
import { RichChatInput, type ChatAttachment } from "../../shared/rich-chat-input/RichChatInput";
import { ChatHelpModal } from "./components/ChatHelpModal";
import { AtMentionPicker, type AtMentionItem } from "./components/AtMentionPicker";
import { useCommandBus } from "../../shell/hooks";
import { useAssistantStream } from "./hooks/useAssistantStream";
import type { EpicStatus } from "./codaScopeTypes";

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Strip <codascope_action> tags from text for clean rendering.
 * Client-side version (avoids importing server module).
 */
function stripActionTagsClient(text: string): string {
  if (!text) return "";
  return text
    .replace(/<codascope_action\s+[^>]*>[\s\S]*?<\/codascope_action>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Convert Obsidian-style [[topic-id]] wikilinks into markdown links
 * that navigate to the wiki topic page within CodaScope.
 * When epicId is provided, links target the epic-scoped wiki.
 */
function convertWikiLinks(text: string, projectId: string | null, epicId?: string | null): string {
  if (!text || !projectId) return text;
  return text.replace(
    /\[\[([^\]]+)\]\]/g,
    (_match, topicId: string) => {
      const slug = topicId.trim();
      const encodedSlug = encodeURIComponent(slug);
      const url = epicId
        ? `/codascope/project/${projectId}/epic/${epicId}/knowledge/wiki/${encodedSlug}`
        : `/codascope/project/${projectId}/wiki/${encodedSlug}`;
      return `[${slug}](${url})`;
    },
  );
}

// ── Types ───────────────────────────────────────────────────────────

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

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
}

// ── Component ───────────────────────────────────────────────────────

export function CodaScopeAssistant() {
  const { segments, getParam, setParam } = useAppSubRoute("codascope");
  const { activeProjectId, projects, wikiTopics, epics } = useCodaScopeStore();

  // Conversation state
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState("New conversation");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");

  // Streaming via extracted hook
  const { streaming, streamingContent, streamMessage, cancelStream } = useAssistantStream(setActiveConversationId);

  // Attachment state for RichChatInput
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // @-mention picker state
  const [atPickerOpen, setAtPickerOpen] = useState(false);

  // Command bus for cross-component communication
  const commandBus = useCommandBus();

  const { models, selectedModelId, selectModel, loading: modelsLoading } = useModelPicker();
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastProjectRef = useRef<string | null>(null);
  const autoSendRef = useRef(false); // Prevents double auto-send

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

  // On mount or project change — load conversations, open most recent
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
    if (!activeProjectId) return undefined;
    // Resolve the topic title from the store for enriched context
    const topicId = segments[2] === "wiki" ? (segments[3] ?? null) : null;
    const topicTitle = topicId
      ? (wikiTopics.find((t) => t.id === topicId)?.title ?? null)
      : null;
    // Resolve epic title from store when viewing an epic
    const epicId = segments[2] === "epic" ? (segments[3] ?? null) : null;
    const activeEpic = epicId ? epics.find((e) => e.id === epicId) : null;
    const epicTitle = activeEpic?.title ?? null;
    const ctx = assembleContext(segments, projectName, activeProjectId, { topicTitle, epicId, epicTitle, epicTab: segments[2] === "epic" ? (segments[4] ?? "define") : null });
    if (!ctx) return undefined;
    return ctx;
  }, [segments, projectName, activeProjectId, wikiTopics, epics]);

  // Phase 3: Detect if user is viewing an epic
  const currentEpicId = segments[2] === "epic" ? (segments[3] ?? null) : null;
  const currentEpic = currentEpicId ? epics.find((e) => e.id === currentEpicId) : null;
  const currentEpicIdRef = useRef<string | null>(null);

  // ── Epic knowledge summary for prompt chips & context ──────────────
  const [epicKnowledge, setEpicKnowledge] = useState<{
    sourceCount: number;
    wikiPageCount: number;
    curationReasonCount: number;
    wikiPageTitles: Array<{ id: string; title: string }>;
  }>({ sourceCount: 0, wikiPageCount: 0, curationReasonCount: 0, wikiPageTitles: [] });

  useEffect(() => {
    if (!activeProjectId || !currentEpicId) {
      setEpicKnowledge({ sourceCount: 0, wikiPageCount: 0, curationReasonCount: 0, wikiPageTitles: [] });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        // Fetch sources, wiki pages, and curation reasons in parallel
        const [sourcesRes, wikiRes, reasonsRes] = await Promise.all([
          fetch(`/api/codascope/projects/${activeProjectId}/epics/${currentEpicId}/knowledge/sources`),
          fetch(`/api/codascope/projects/${activeProjectId}/epics/${currentEpicId}/knowledge/wiki`),
          fetch(`/api/codascope/projects/${activeProjectId}/epics/${currentEpicId}/curation/reasons`),
        ]);
        if (cancelled) return;
        const sources = sourcesRes.ok ? await sourcesRes.json() : { sources: [] };
        const wiki = wikiRes.ok ? await wikiRes.json() : { pages: [] };
        const reasons = reasonsRes.ok ? await reasonsRes.json() : { reasons: [] };
        setEpicKnowledge({
          sourceCount: (sources.sources ?? []).length,
          wikiPageCount: (wiki.pages ?? []).length,
          curationReasonCount: (reasons.reasons ?? []).length,
          wikiPageTitles: (wiki.pages ?? []).map((p: { id: string; title: string }) => ({ id: p.id, title: p.title })),
        });
      } catch {
        if (!cancelled) {
          setEpicKnowledge({ sourceCount: 0, wikiPageCount: 0, curationReasonCount: 0, wikiPageTitles: [] });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeProjectId, currentEpicId]);

  // ── Curation build-status poll (for chat status bar) ─────────────────
  const [curationStatus, setCurationStatus] = useState<{
    running: boolean;
    step: string;
  }>({ running: false, step: "" });

  useEffect(() => {
    if (!activeProjectId || !currentEpicId) {
      setCurationStatus({ running: false, step: "" });
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/build-status?scope=curation::${currentEpicId}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const build = data.build;

        if (build?.status === "building") {
          const steps = build.pipelineSteps;
          let desc = "Curation in progress…";
          if (Array.isArray(steps) && steps.length > 0) {
            const latest = steps[steps.length - 1];
            desc = latest.detail ?? latest.label ?? latest.id ?? desc;
          }
          setCurationStatus({ running: true, step: desc });
        } else {
          setCurationStatus((prev) => prev.running ? { running: false, step: "" } : prev);
        }
      } catch { /* silent */ }
    };

    void poll();
    const id = setInterval(() => void poll(), 3000);
    return () => clearInterval(id);
  }, [activeProjectId, currentEpicId]);

  // Auto-switch to epic conversation when navigating into an epic
  useEffect(() => {
    if (!activeProjectId || !currentEpicId || !currentEpic) {
      currentEpicIdRef.current = null;
      return;
    }
    if (currentEpicIdRef.current === currentEpicId) return;
    currentEpicIdRef.current = currentEpicId;

    void (async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${currentEpicId}/conversation`,
        );
        if (res.ok) {
          const data = await res.json();
          const conv = data.conversation;
          setActiveConversationId(conv.id);
          setActiveTitle(conv.title || `Epic: ${currentEpic.title}`);
          // Load messages from the epic conversation
          const msgs = (conv.messages ?? [])
            .filter((m: ChatMessage) => m.role === "user" || m.role === "assistant")
            .map((m: ChatMessage) => {
              // Restore image URLs from metadata for conversation history
              const metaImages = m.metadata?.images as Array<{ path: string; filename: string }> | undefined;
              const images = metaImages?.map((img) => ({
                url: `/api/codascope/projects/${activeProjectId}/conversations/${conv.id}/images/${img.filename}`,
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
            });
          setMessages(msgs);
          // Update conversation list
          await loadConversationList();
        }
      } catch { /* silently fail */ }
    })();
  }, [activeProjectId, currentEpicId, currentEpic, loadConversationList]);

  // Get context badge label
  const contextBadge = (() => {
    const ctx = activeProjectId ? assembleContext(segments, projectName, activeProjectId) : null;
    if (!ctx) return null;
    switch (ctx.view) {
      case "wiki": {
        if (ctx.topicId) {
          const title = wikiTopics.find((t) => t.id === ctx.topicId)?.title;
          return title ? `Wiki: ${title}` : "Wiki";
        }
        return "Wiki";
      }
      case "dashboard": return "Dashboard";
      case "settings": return "Settings";
      case "skills": return "Skills";
      case "quality": return "Quality";
      case "rules": return "Golden Rules";
      case "concepts": return "Concepts";
      case "epics": return "Epics";
      case "epic": {
        const epicId = segments[3] ?? null;
        const epic = epicId ? epics.find((e) => e.id === epicId) : null;
        return epic ? `Epic: ${epic.title}` : "Epic";
      }
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

    // Build image URLs from attachments for display in the chat bubble
    const imageUrls = attachments
      .filter((a) => a.type === "image" && a.metadata?.path)
      .map((a) => ({
        url: `/api/codascope/projects/${activeProjectId}/conversations/${convId}/images/${(a.metadata?.path as string).split("/").pop()}`,
        filename: a.label,
      }));
    // Also capture blob previews for immediate display (before server URL is available)
    const imagePreviews = attachments
      .filter((a) => a.type === "image" && a.preview)
      .map((a) => ({
        url: a.preview!,
        filename: a.label,
      }));

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      status: "complete",
      images: imageUrls.length > 0 ? imageUrls : imagePreviews.length > 0 ? imagePreviews : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    const currentAttachments = [...attachments];
    setAttachments([]);

    // Build attachments payload
    const imageAttachments = currentAttachments
      .filter((a) => a.type === "image")
      .map((a) => ({ type: "image" as const, path: a.metadata?.path as string }));

    // Build references payload from @-mention chips
    const referenceAttachments = currentAttachments
      .filter((a) => a.type === "reference")
      .map((a) => ({
        category: a.metadata?.category as string,
        id: a.metadata?.itemId as string,
        label: a.label,
      }));

    // Build selection context from selection chips (Phase 3)
    const selectionChip = currentAttachments.find((a) => a.type === "selection");
    const selectionContext = selectionChip
      ? {
          blockId: selectionChip.metadata?.blockId as string,
          text: selectionChip.metadata?.text as string,
          startLine: selectionChip.metadata?.startLine as number,
          endLine: selectionChip.metadata?.endLine as number,
          docId: selectionChip.metadata?.docId as string,
          epicId: selectionChip.metadata?.epicId as string,
        }
      : undefined;

    const isFirstMessage = messages.length === 0;
    const result = await streamMessage({
      projectId: activeProjectId,
      conversationId: convId,
      message: trimmed,
      modelId: selectedModelId,
      context: getContext(),
      attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
      references: referenceAttachments.length > 0 ? referenceAttachments : undefined,
      selectionContext,
    });

    if (result.assistantMessage) {
      setMessages((prev) => [...prev, result.assistantMessage!]);
    }

    // Auto-update title if this was the first message
    if (isFirstMessage && result.newTitle) {
      setActiveTitle(result.newTitle);
    }

    // Refresh conversation list to get updated titles/summaries
    await loadConversationList();
  }, [input, streaming, selectedModelId, activeProjectId, activeConversationId, attachments, getContext, messages.length, loadConversationList, streamMessage]);

  // ── Send prompt (for prompt chips + auto-send) ────────────────────

  const handleSendPrompt = useCallback((prompt: string) => {
    setInput(prompt);
    // Use a microtask to let React update input state before sending
    queueMicrotask(() => {
      const sendPrompt = async () => {
        if (streaming || !selectedModelId || !activeProjectId) return;

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
          content: prompt,
          status: "complete",
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput("");

        const isFirstMessage = messages.length === 0;
        const result = await streamMessage({
          projectId: activeProjectId,
          conversationId: convId,
          message: prompt,
          modelId: selectedModelId,
          context: getContext(),
        });

        if (result.assistantMessage) {
          setMessages((prev) => [...prev, result.assistantMessage!]);
        }

        if (isFirstMessage && result.newTitle) {
          setActiveTitle(result.newTitle);
        }

        await loadConversationList();
      };
      sendPrompt();
    });
  }, [streaming, selectedModelId, activeProjectId, activeConversationId, getContext, messages.length, loadConversationList, streamMessage]);

  // ── Auto-send interview for new epics (?new=1) ────────────────────

  useEffect(() => {
    const isNew = getParam("new");
    if (isNew !== "1") return;
    if (!currentEpicId || !activeConversationId || autoSendRef.current) return;
    if (streaming || !selectedModelId) return;
    if (messages.length > 0) return; // Don't auto-send if conversation already has messages

    autoSendRef.current = true;
    // Remove the ?new=1 param immediately to prevent re-trigger on refresh
    setParam("new", null);
    // Auto-send the interview prompt
    handleSendPrompt("Help me define this epic — let's start with the interview");
  }, [currentEpicId, activeConversationId, streaming, selectedModelId, messages.length, getParam, setParam, handleSendPrompt]);

  // Reset auto-send flag when epic changes
  useEffect(() => {
    autoSendRef.current = false;
  }, [currentEpicId]);

  // ── Image upload handler ─────────────────────────────────────────

  const handleImageFile = useCallback(async (file: File) => {
    if (!activeProjectId || !activeConversationId) return;

    // Create a local preview URL
    const previewUrl = URL.createObjectURL(file);
    const tempId = `img-${Date.now()}`;

    // Add chip immediately with preview
    setAttachments((prev) => [
      ...prev,
      {
        id: tempId,
        type: "image",
        label: file.name || "Pasted image",
        preview: previewUrl,
        metadata: { uploading: true },
      },
    ]);

    // Upload to server
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/conversations/${activeConversationId}/images`,
        { method: "POST", body: formData },
      );
      if (res.ok) {
        const data = await res.json();
        // Update chip with server path
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === tempId
              ? { ...a, metadata: { path: data.path, filename: data.filename } }
              : a,
          ),
        );
      } else {
        // Remove chip on failure
        setAttachments((prev) => prev.filter((a) => a.id !== tempId));
      }
    } catch {
      setAttachments((prev) => prev.filter((a) => a.id !== tempId));
    }
  }, [activeProjectId, activeConversationId]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleClearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  // ── @-mention picker handlers ────────────────────────────────────

  const handleAtTrigger = useCallback((_position: { top: number; left: number }) => {
    setAtPickerOpen(true);
  }, []);

  const handleAtMentionSelect = useCallback((item: AtMentionItem) => {
    // Insert @category/id text into the input
    const mentionText = item.category === "definition"
      ? "@def"
      : `@${item.category}/${item.id}`;

    setInput((prev) => {
      // Replace the trailing @ that triggered the picker
      if (prev.endsWith("@")) {
        return prev.slice(0, -1) + mentionText + " ";
      }
      return prev + mentionText + " ";
    });

    // Add a reference chip
    setAttachments((prev) => [
      ...prev,
      {
        id: `ref-${item.category}-${item.id}-${Date.now()}`,
        type: "reference",
        label: item.category === "definition" ? "Epic Definition" : `${item.category}/${item.label}`,
        metadata: {
          category: item.category,
          itemId: item.id,
          itemLabel: item.label,
        },
      },
    ]);

    setAtPickerOpen(false);
  }, []);

  const handleAtPickerClose = useCallback(() => {
    setAtPickerOpen(false);
  }, []);

  // ── Phase 3: Selection-to-chat listener ────────────────────────────

  useEffect(() => {
    if (!commandBus) return;
    const unsub = commandBus.on("codascope:design-selection-to-chat", (payload: {
      blockId: string;
      text: string;
      startLine: number;
      endLine: number;
      docId: string;
      epicId: string;
    }) => {
      // Create a selection attachment chip
      const chipId = `sel-${Date.now()}`;
      const preview = payload.text.length > 100
        ? payload.text.slice(0, 97) + "..."
        : payload.text;

      setAttachments((prev) => [
        ...prev,
        {
          id: chipId,
          type: "selection" as const,
          label: `Lines ${payload.startLine}–${payload.endLine}`,
          preview,
          metadata: {
            blockId: payload.blockId,
            text: payload.text,
            startLine: payload.startLine,
            endLine: payload.endLine,
            docId: payload.docId,
            epicId: payload.epicId,
          },
        },
      ]);
    });
    return unsub;
  }, [commandBus]);

  // ── Design doc action tag handlers ────────────────────────────────

  // After SSE completes, check for design doc actions in the final message
  useEffect(() => {
    if (streaming || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role !== "assistant" || !lastMsg.metadata?.actions) return;

    const actions = lastMsg.metadata.actions as Array<{ type: string; attributes: Record<string, string> }>;
    for (const action of actions) {
      if (action.type === "design_doc_created" && action.attributes?.epicId && action.attributes?.docId) {
        commandBus?.emit("codascope:design-doc-created", {
          epicId: action.attributes.epicId,
          docId: action.attributes.docId,
        });
      } else if (action.type === "design_doc_edited" && action.attributes?.epicId && action.attributes?.docId) {
        commandBus?.emit("codascope:design-doc-edited", {
          epicId: action.attributes.epicId,
          docId: action.attributes.docId,
          summary: action.attributes.summary ?? "",
          startLine: action.attributes.startLine ? Number(action.attributes.startLine) : undefined,
          endLine: action.attributes.endLine ? Number(action.attributes.endLine) : undefined,
        });
      } else if (action.type === "artifact_built" && action.attributes?.epicId && action.attributes?.artifactId) {
        // Auto-navigate to the artifact preview view
        if (activeProjectId) {
          navigate(`project/${activeProjectId}/epic/${action.attributes.epicId}/design/artifact:${action.attributes.artifactId}`);
        }
      }
    }
  }, [messages, streaming, commandBus, navigate, activeProjectId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  const stopStreaming = useCallback(async () => {
    if (activeProjectId) {
      await cancelStream(activeProjectId);
    }
  }, [activeProjectId, cancelStream]);

  // ── Copy message to clipboard ──────────────────────────────────────

  const handleCopyMessage = useCallback((msgId: string, content: string, role: string) => {
    const textToCopy = role === "assistant" ? stripActionTagsClient(content) : content;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopiedMessageId(msgId);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopiedMessageId(null), 2000);
    }).catch(() => {
      // Silently fail if clipboard access is denied
    });
  }, []);
  // ── Prompt chip context ────────────────────────────────────────────

  const promptChipContext: PromptChipContext = useMemo(() => {
    const epicTab = currentEpicId ? (segments[4] ?? "define") : null;
    const currentView = segments[2] ?? "dashboard";
    const epicDetail = currentEpic as (typeof currentEpic & {
      definition?: string;
      scope?: { entries?: unknown[] } | null;
    }) | null;

    return {
      currentView,
      hasDefinition: !!epicDetail?.definition,
      hasScope: !!(epicDetail?.scope?.entries && (epicDetail.scope.entries as unknown[]).length > 0),
      hasResearch: epicKnowledge.sourceCount > 0,
      hasCuratedKnowledge: epicKnowledge.wikiPageCount > 0,
      curationReasonCount: epicKnowledge.curationReasonCount,
      epicStatus: (epicDetail?.status ?? null) as EpicStatus | null,
      epicTab,
      isEpicView: !!currentEpicId,
    };
  }, [currentEpicId, currentEpic, segments, epicKnowledge]);

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

      {/* Phase 3: Epic Context Banner */}
      {currentEpic && (
        <div className="codascope-assistant-epic-banner">
          <span className="codascope-assistant-epic-banner-icon">📋</span>
          <span className="codascope-assistant-epic-banner-text">
            Scoped to <strong>{currentEpic.title}</strong>
          </span>
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

        {messages.map((msg) => {
          const actions = (msg.metadata?.actions ?? []) as CodaScopeAction[];
          // Always strip action tags from assistant messages — even if metadata.actions
          // is empty (e.g. older messages or unrecognized action types)
          const displayContent = msg.role === "assistant"
            ? stripActionTagsClient(msg.content)
            : msg.content;

          return (
            <div key={msg.id}>
              <div
                className={`codascope-assistant-msg codascope-assistant-msg-${msg.role}`}
              >
                <div className="codascope-assistant-msg-avatar">
                  {msg.role === "user" ? "👤" : "🤖"}
                </div>
                <div className="codascope-assistant-msg-content">
                  {msg.role === "assistant" ? (
                    <MarkdownViewer content={convertWikiLinks(displayContent, activeProjectId, currentEpicId)} />
                  ) : (
                    <>
                      {msg.images && msg.images.length > 0 && (
                        <div className="codascope-msg-images">
                          {msg.images.map((img, i) => (
                            <img
                              key={i}
                              src={img.url}
                              alt={img.filename}
                              className="codascope-msg-image-thumb"
                              loading="lazy"
                            />
                          ))}
                        </div>
                      )}
                      <p>{msg.content}</p>
                    </>
                  )}
                  <button
                    className={`codascope-msg-copy-btn${copiedMessageId === msg.id ? " codascope-msg-copy-btn-copied" : ""}`}
                    onClick={() => handleCopyMessage(msg.id, msg.content, msg.role)}
                    type="button"
                    title={copiedMessageId === msg.id ? "Copied!" : "Copy message"}
                    aria-label={copiedMessageId === msg.id ? "Copied!" : "Copy message"}
                  >
                    {copiedMessageId === msg.id ? <IconCheck size={13} /> : <IconCopy size={13} />}
                  </button>
                </div>
              </div>
              {actions.length > 0 && (
                <ActionCardList actions={actions} />
              )}
            </div>
          );
        })}

        {/* Streaming message */}
        {streaming && (
          <div className="codascope-assistant-msg codascope-assistant-msg-assistant">
            <div className="codascope-assistant-msg-avatar">🤖</div>
            <div className="codascope-assistant-msg-content">
              {streamingContent ? (
                <MarkdownViewer content={convertWikiLinks(stripActionTagsClient(streamingContent), activeProjectId, currentEpicId)} />
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

      {/* Curation status bar */}
      {curationStatus.running && (
        <div className="codascope-assistant-curation-bar">
          <span className="codascope-assistant-curation-bar-icon">
            <IconCurate size={13} />
          </span>
          <span className="codascope-assistant-curation-bar-text">
            {curationStatus.step}
          </span>
        </div>
      )}

      {/* Prompt Chips */}
      <PromptChips
        onSend={handleSendPrompt}
        context={promptChipContext}
      />

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
            <button
              className="codascope-assistant-help-btn"
              onClick={() => setHelpModalOpen(true)}
              type="button"
              title="Chat help"
              aria-label="Chat help"
            >
              ?
            </button>
            <button
              className="codascope-conv-new-btn"
              disabled={streaming}
              onClick={createNewConversation}
              title="New conversation"
              type="button"
            >
              + New Chat
            </button>
          </div>
        </div>
        <div className="codascope-assistant-input-row">
          {atPickerOpen && activeProjectId && (
            <AtMentionPicker
              projectId={activeProjectId}
              epicId={currentEpicId}
              onSelect={handleAtMentionSelect}
              onClose={handleAtPickerClose}
            />
          )}
          <RichChatInput
            value={input}
            onChange={setInput}
            onSend={sendMessage}
            onAtTrigger={handleAtTrigger}
            onImagePaste={handleImageFile}
            onImageDrop={handleImageFile}
            attachments={attachments}
            onRemoveAttachment={handleRemoveAttachment}
            onClearAttachments={handleClearAttachments}
            placeholder="Message the agent... (@ to add context)"
            disabled={streaming || !selectedModelId}
            sendDisabled={!input.trim() || streaming || !selectedModelId}
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
        <ChatHelpModal isOpen={helpModalOpen} onClose={() => setHelpModalOpen(false)} />
      </div>
    </div>
  );
}
