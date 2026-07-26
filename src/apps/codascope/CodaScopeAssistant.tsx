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
import { assembleContext } from "./contextAssembler";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import { ModelPicker, useModelPicker } from "./components/ModelPicker";
import { IconAgent, IconUser, IconChat, IconSearch, IconCopy, IconCheck, IconClose, IconCurate, IconMap, IconBook, IconShield, IconPlan, IconClipboard, IconSend, IconWarning } from "./components/CodaScopeIcons";
import { ConversationHeader } from "./components/ConversationHeader";
import { ActionCardList } from "./components/ActionCard";
import { WorkspaceActionCardList } from "./components/WorkspaceActionCardList";
import { PromptChips, type PromptChipContext } from "./components/PromptChips";
import { RichChatInput, type ChatAttachment } from "../../shared/rich-chat-input/RichChatInput";
import { AtMentionPicker, type AtMentionItem } from "./components/AtMentionPicker";
import {
  appendWorkspaceProjectReference,
  removeWorkspaceProjectReference,
  WorkspaceProjectReferencePicker,
  WORKSPACE_PROJECT_REFERENCE_MAX,
} from "./components/WorkspaceProjectReferencePicker";
import { WorkspaceSourceReferences } from "./components/WorkspaceSourceReferences";
import { SlashCommandPalette, getVisibleCommandCount } from "./components/SlashCommandPalette";
import type { SlashCommand, CommandContext } from "./commandRegistry";
import { canDispatchCommand, getFilteredCommands } from "./commandRegistry";
import { useCommandBus } from "../../shell/hooks";
import { useAssistantStream } from "./hooks/useAssistantStream";
import { openDeepRunModal } from "./views/ProjectDashboard";
import { useConversationManager } from "./hooks/useConversationManager";
import { useEpicContext } from "./hooks/useEpicContext";
import type {
  AssistantChatMessage,
  CodaScopeAction,
  EpicStatus,
} from "./codaScopeTypes";
import {
  buildWorkspaceMessageContext,
  canUseProjectMentions,
  getAssistantScopeKey,
  resolveAssistantScope,
  rootNoteMatchesRoute,
} from "./assistantScope";
import { useRootNoteContext } from "./assistantNoteContext";
import { createWorkspaceNoteApi } from "./workspaceNoteApi";
import {
  claimLiveTurnNavigation,
  navigateSingleLiveCreatedNote,
  selectSingleCreatedNoteStableId,
} from "./workspaceCreatedNote";
import type { WorkspaceProjectReference } from "./workspaceProjectCatalogApi";

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

// ── Component ───────────────────────────────────────────────────────

export function CodaScopeAssistant() {
  const { segments, getParam, setParam, navigate } = useAppSubRoute("codascope");
  const { projects, wikiTopics, epics } = useCodaScopeStore();
  const assistantScope = useMemo(
    () => resolveAssistantScope(segments),
    [segments[0], segments[1]],
  );
  const scopeKey = getAssistantScopeKey(assistantScope);
  const projectId = assistantScope.kind === "project"
    ? assistantScope.projectId
    : null;
  const publishedRootNote = useRootNoteContext();
  const currentRootNote = rootNoteMatchesRoute(publishedRootNote, segments)
    ? publishedRootNote
    : null;

  const {
    streaming,
    streamingContent,
    streamMessage,
    cancelStream,
    detachActiveRun,
  } = useAssistantStream(assistantScope);

  // Extracted hooks
  const convManager = useConversationManager(
    assistantScope,
    detachActiveRun,
  );
  const {
    api: conversationApi,
    conversations,
    activeConversationId,
    setActiveConversationId,
    activeTitle,
    setActiveTitle,
    messages,
    setMessages,
    loadConversationList,
    createNewConversation,
    updateConversation,
    deleteConversation,
    switchConversation,
  } = convManager;

  const epicCtx = useEpicContext(
    projectId,
    setActiveConversationId,
    setActiveTitle,
    setMessages,
    loadConversationList,
  );
  const { currentEpicId, currentEpic, epicKnowledge, curationStatus } = epicCtx;

  // Input state
  const [input, setInput] = useState("");
  const inputScopeKeyRef = useRef(scopeKey);

  // Attachment state for RichChatInput
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const attachmentsScopeKeyRef = useRef(scopeKey);
  const [workspaceProjectReferences, setWorkspaceProjectReferences] = useState<
    WorkspaceProjectReference[]
  >([]);
  const workspaceReferencesScopeKeyRef = useRef(scopeKey);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // @-mention picker state
  const [atPickerOpen, setAtPickerOpen] = useState(false);
  const atPickerScopeKeyRef = useRef(scopeKey);

  // Slash command palette state
  const [slashPaletteOpen, setSlashPaletteOpen] = useState(false);
  const slashPaletteScopeKeyRef = useRef(scopeKey);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashToast, setSlashToast] = useState<string | null>(null);
  const slashToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Command bus for cross-component communication
  const commandBus = useCommandBus();

  const { models, selectedModelId, selectModel, loading: modelsLoading } = useModelPicker();
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoSendRef = useRef(false); // Prevents double auto-send
  const currentScopeKeyRef = useRef(scopeKey);
  currentScopeKeyRef.current = scopeKey;
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const liveTurnIdRef = useRef(0);
  const claimedNavigationTurnsRef = useRef(new Set<number>());
  const workspaceNoteApi = useMemo(() => createWorkspaceNoteApi(), []);
  const visibleInput = inputScopeKeyRef.current === scopeKey ? input : "";
  const visibleBaseAttachments = attachmentsScopeKeyRef.current === scopeKey
    ? attachments
    : [];
  const visibleWorkspaceProjectReferences =
    workspaceReferencesScopeKeyRef.current === scopeKey
      && assistantScope.kind === "workspace"
      ? workspaceProjectReferences
      : [];
  const workspaceProjectReferenceChips = visibleWorkspaceProjectReferences.map(
    (project): ChatAttachment => ({
      id: `workspace-project-${project.projectId}`,
      type: "reference",
      label: project.name,
      metadata: {
        category: "workspace-project",
        projectId: project.projectId,
      },
    }),
  );
  const visibleAttachments = assistantScope.kind === "workspace"
    ? [...visibleBaseAttachments, ...workspaceProjectReferenceChips]
    : visibleBaseAttachments;
  const visibleAtPickerOpen = atPickerScopeKeyRef.current === scopeKey
    && atPickerOpen;
  const visibleSlashPaletteOpen =
    slashPaletteScopeKeyRef.current === scopeKey && slashPaletteOpen;

  // Get the current project name for context
  const projectName = projects.find((p) => p.id === projectId)?.name ?? "Unknown";

  useEffect(() => {
    inputScopeKeyRef.current = scopeKey;
    attachmentsScopeKeyRef.current = scopeKey;
    workspaceReferencesScopeKeyRef.current = scopeKey;
    atPickerScopeKeyRef.current = scopeKey;
    slashPaletteScopeKeyRef.current = scopeKey;
    setInput("");
    setAttachments([]);
    setWorkspaceProjectReferences([]);
    setAtPickerOpen(false);
    setSlashPaletteOpen(false);
  }, [scopeKey]);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, streamingContent]);

  // Build context from current view
  const getContext = useCallback((
    explicitlyReferencedProjectIds: readonly string[] = [],
  ) => {
    if (assistantScope.kind === "workspace") {
      return buildWorkspaceMessageContext(
        segments,
        currentRootNote,
        explicitlyReferencedProjectIds,
      );
    }
    // Resolve the topic title from the store for enriched context
    const topicId = segments[2] === "wiki" ? (segments[3] ?? null) : null;
    const topicTitle = topicId
      ? (wikiTopics.find((t) => t.id === topicId)?.title ?? null)
      : null;
    // Resolve epic title from store when viewing an epic
    const epicId = segments[2] === "epic" ? (segments[3] ?? null) : null;
    const activeEpic = epicId ? epics.find((e) => e.id === epicId) : null;
    const epicTitle = activeEpic?.title ?? null;
    const ctx = assembleContext(segments, projectName, assistantScope.projectId, { topicTitle, epicId, epicTitle, epicTab: segments[2] === "epic" ? (segments[4] ?? "define") : null });
    if (!ctx) return undefined;
    return ctx;
  }, [assistantScope, currentRootNote, segments, projectName, wikiTopics, epics]);

  // Get context badge label
  const contextBadge = (() => {
    if (assistantScope.kind === "workspace") return "Workspace";
    const ctx = assembleContext(
      segments,
      projectName,
      assistantScope.projectId,
    );
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

      case "epics": return "Epics";
      case "epic": {
        const epicId = segments[3] ?? null;
        const epic = epicId ? epics.find((e) => e.id === epicId) : null;
        return epic ? `Epic: ${epic.title}` : "Epic";
      }
      default: return ctx.view;
    }
  })();

  // ── Unified dispatch message ──────────────────────────────────────
  // Merges the old sendMessage and handleSendPrompt into one function.
  // `promptText` overrides the input field when provided (e.g. prompt chips).

  const dispatchMessage = useCallback(async (promptText?: string) => {
    const text = promptText ?? visibleInput.trim();
    if (!text || streaming || !selectedModelId) return;

    // If no active conversation, create one first
    let convId = activeConversationId;
    if (!convId) {
      const conversation = await createNewConversation({
        streaming: false,
        selectedModelId,
      });
      convId = conversation?.id ?? null;
    }

    if (!convId) return;
    activeConversationIdRef.current = convId;

    // Build image URLs from attachments for display in the chat bubble
    const currentAttachments = promptText ? [] : [...visibleAttachments];
    const currentWorkspaceProjectReferences = promptText
      ? []
      : [...visibleWorkspaceProjectReferences];
    const imageUrls = currentAttachments
      .filter((a) => a.type === "image" && a.metadata?.path)
      .map((a) => ({
        url: conversationApi.endpoints.displayImage(
          convId,
          (a.metadata?.path as string).split("/").pop() ?? "",
        ),
        filename: a.label,
      }));
    // Also capture blob previews for immediate display (before server URL is available)
    const imagePreviews = currentAttachments
      .filter((a) => a.type === "image" && a.preview)
      .map((a) => ({
        url: a.preview!,
        filename: a.label,
      }));

    const userMsg: AssistantChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      status: "complete",
      images: imageUrls.length > 0 ? imageUrls : imagePreviews.length > 0 ? imagePreviews : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setAttachments([]);
    setWorkspaceProjectReferences([]);

    // Build attachments payload
    const imageAttachments = currentAttachments
      .filter((a) => a.type === "image")
      .map((a) => ({ type: "image" as const, path: a.metadata?.path as string }));

    // Build references payload from @-mention chips
    const referenceAttachments = currentAttachments
      .filter((a) =>
        assistantScope.kind === "project" && a.type === "reference")
      .map((a) => ({
        category: a.metadata?.category as string,
        id: a.metadata?.itemId as string,
        label: a.label,
      }));

    // Build selection context from selection chips (Phase 3)
    const selectionChip = assistantScope.kind === "project"
      ? currentAttachments.find((a) => a.type === "selection")
      : undefined;
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
    const liveTurnId = ++liveTurnIdRef.current;
    const turnScopeKey = scopeKey;
    const knownMessageIds = messages.map((message) => message.id);
    const result = await streamMessage({
      conversationId: convId,
      message: text,
      modelId: selectedModelId,
      context: getContext(
        currentWorkspaceProjectReferences.map((project) => project.projectId),
      ) as Record<string, unknown> | undefined,
      attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
      references: referenceAttachments.length > 0 ? referenceAttachments : undefined,
      selectionContext,
      knownMessageIds,
    });

    if (result.discarded) return;
    if (result.conversationId) {
      setActiveConversationId(result.conversationId);
    }
    if (result.reconciledMessages) {
      setMessages(result.reconciledMessages);
    } else if (result.assistantMessage) {
      setMessages((prev) => {
        const withoutDuplicate = prev.filter(
          (message) => message.id !== result.assistantMessage!.id,
        );
        return [...withoutDuplicate, result.assistantMessage!];
      });
    }

    // Auto-update title if this was the first message
    if (isFirstMessage && result.newTitle) {
      setActiveTitle(result.newTitle);
    }

    const createdStableId = assistantScope.kind === "workspace"
      ? selectSingleCreatedNoteStableId(result.liveWorkspaceActions ?? [])
      : null;
    if (createdStableId
      && currentScopeKeyRef.current === turnScopeKey
      && activeConversationIdRef.current === convId
      && claimLiveTurnNavigation(
        claimedNavigationTurnsRef.current,
        liveTurnId,
      )) {
      await navigateSingleLiveCreatedNote(
        result.liveWorkspaceActions ?? [],
        workspaceNoteApi,
        () => currentScopeKeyRef.current === turnScopeKey
          && activeConversationIdRef.current === convId,
        navigate,
      );
    }

    // Refresh conversation list to get updated titles/summaries
    await loadConversationList();
  }, [visibleInput, streaming, selectedModelId, activeConversationId, visibleAttachments, visibleWorkspaceProjectReferences, getContext, messages, loadConversationList, streamMessage, setActiveConversationId, setActiveTitle, setMessages, assistantScope.kind, conversationApi.endpoints, createNewConversation, navigate, scopeKey, workspaceNoteApi]);

  // Wrapper for send button (uses input field text)
  const sendMessage = useCallback(() => {
    void dispatchMessage();
  }, [dispatchMessage]);

  // Wrapper for prompt chips / auto-send (uses explicit prompt text)
  const handleSendPrompt = useCallback((prompt: string) => {
    setInput(prompt);
    queueMicrotask(() => void dispatchMessage(prompt));
  }, [dispatchMessage]);

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
    if (!activeConversationId) return;
    const uploadScopeKey = scopeKey;

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
      const data = await conversationApi.uploadImage(
        activeConversationId,
        formData,
      );
      if (currentScopeKeyRef.current !== uploadScopeKey) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      if (data) {
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
      if (currentScopeKeyRef.current === uploadScopeKey) {
        setAttachments((prev) => prev.filter((a) => a.id !== tempId));
      }
    }
  }, [activeConversationId, conversationApi, scopeKey]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    if (id.startsWith("workspace-project-")) {
      setWorkspaceProjectReferences((prev) => {
        const project = prev.find(
          (candidate) => `workspace-project-${candidate.projectId}` === id,
        );
        return project
          ? removeWorkspaceProjectReference(prev, project.projectId)
          : prev;
      });
    }
  }, []);

  const handleClearAttachments = useCallback(() => {
    setAttachments([]);
    setWorkspaceProjectReferences([]);
  }, []);

  // ── @-mention picker handlers ────────────────────────────────────

  const handleAtTrigger = useCallback((_position: { top: number; left: number }) => {
    if (assistantScope.kind === "workspace"
      || canUseProjectMentions(assistantScope)) {
      atPickerScopeKeyRef.current = scopeKey;
      setAtPickerOpen(true);
    }
  }, [assistantScope, scopeKey]);

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

  const handleWorkspaceProjectSelect = useCallback((
    project: WorkspaceProjectReference,
  ) => {
    if (visibleWorkspaceProjectReferences.some(
      (candidate) => candidate.projectId === project.projectId,
    ) || visibleWorkspaceProjectReferences.length
      >= WORKSPACE_PROJECT_REFERENCE_MAX) {
      return;
    }
    workspaceReferencesScopeKeyRef.current = scopeKey;
    setWorkspaceProjectReferences((current) => (
      appendWorkspaceProjectReference(current, project)
    ));
    setInput((current) => {
      const referenceText = `@project/${project.name}`;
      return current.endsWith("@")
        ? `${current.slice(0, -1)}${referenceText} `
        : `${current}${referenceText} `;
    });
    setAtPickerOpen(false);
  }, [scopeKey, visibleWorkspaceProjectReferences]);

  const handleAtPickerClose = useCallback(() => {
    setAtPickerOpen(false);
  }, []);

  // ── Slash command palette handlers ─────────────────────────────────

  const showSlashToast = useCallback((msg: string) => {
    if (slashToastTimer.current) clearTimeout(slashToastTimer.current);
    setSlashToast(msg);
    slashToastTimer.current = setTimeout(() => setSlashToast(null), 2500);
  }, []);

  const slashCommandContext: CommandContext = useMemo(() => {
    const currentView = assistantScope.kind === "project"
      ? (segments[2] ?? "dashboard")
      : (segments[0] ?? "projects");
    return {
      assistantScope: assistantScope.kind,
      currentView,
      hasProject: assistantScope.kind === "project",
      isEpicView: currentView === "epic" || segments[2] === "epic",
      epicId: segments[2] === "epic" ? (segments[3] ?? null) : null,
      hasWiki: wikiTopics.length > 0,
      hasCodeMap: true, // TODO: track from store if needed
    };
  }, [assistantScope, segments, wikiTopics]);

  const handleSlashTrigger = useCallback((_position: { top: number; left: number }) => {
    slashPaletteScopeKeyRef.current = scopeKey;
    setSlashPaletteOpen(true);
    setSlashActiveIndex(0);
  }, [scopeKey]);

  const handleSlashSelect = useCallback(async (cmd: SlashCommand) => {
    setSlashPaletteOpen(false);
    setInput("");

    if (!canDispatchCommand(cmd, slashCommandContext)) {
      showSlashToast("That command is not available in workspace scope.");
      return;
    }

    if (cmd.behavior === "chat" && cmd.prompt) {
      // Inject prompt into input — user reviews and sends
      setInput(cmd.prompt);
      return;
    }

    // Dispatch behavior
    switch (cmd.id) {
      // ── Navigation commands ──
      case "goto-dashboard":
        navigate(`project/${projectId}/dashboard`);
        showSlashToast("Navigating to Dashboard…");
        break;
      case "goto-wiki":
        navigate(`project/${projectId}/wiki`);
        showSlashToast("Navigating to Wiki…");
        break;

      case "goto-skills":
        navigate(`project/${projectId}/skills`);
        showSlashToast("Navigating to Skills…");
        break;
      case "goto-epics":
        navigate(`project/${projectId}/epics`);
        showSlashToast("Navigating to Epics…");
        break;
      case "goto-settings":
        navigate(`project/${projectId}/settings`);
        showSlashToast("Navigating to Settings…");
        break;

      // ── Build commands ──
      case "build-wiki":
        if (projectId && selectedModelId) {
          showSlashToast("Building wiki…");
          try {
            await fetch(`/api/codascope/projects/${projectId}/runs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ command: "do_build_full_wiki", modelId: selectedModelId }),
            });
          } catch { /* error handled by server */ }
        }
        break;
      case "build-wiki-page":
        if (projectId && selectedModelId) {
          showSlashToast("Building wiki page…");
          try {
            await fetch(`/api/codascope/projects/${projectId}/runs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ command: "do_build_wiki_page", modelId: selectedModelId }),
            });
          } catch { /* error handled by server */ }
        }
        break;
      case "build-code-map":
        if (projectId && selectedModelId) {
          showSlashToast("Exploring codebase…");
          try {
            await fetch(`/api/codascope/projects/${projectId}/runs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ command: "do_explore", modelId: selectedModelId }),
            });
          } catch { /* error handled by server */ }
        }
        break;

      // ── Analyze commands ──
      case "explore":
        if (projectId && selectedModelId) {
          showSlashToast("Exploring codebase…");
          try {
            await fetch(`/api/codascope/projects/${projectId}/runs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ command: "do_explore", modelId: selectedModelId }),
            });
          } catch { /* error handled by server */ }
        }
        break;
      case "scan-delta":
        if (projectId && selectedModelId) {
          showSlashToast("Scanning for changes…");
          try {
            await fetch(`/api/codascope/projects/${projectId}/runs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ command: "do_delta_scan", modelId: selectedModelId }),
            });
          } catch { /* error handled by server */ }
        }
        break;

      // ── Epic commands ──
      case "epic-create":
        if (projectId) {
          showSlashToast("Creating new epic…");
          try {
            const res = await fetch(`/api/codascope/projects/${projectId}/epics`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: "New Epic" }),
            });
            if (res.ok) {
              const data = await res.json();
              navigate(`project/${projectId}/epic/${data.epic.id}/define?new=1`);
            }
          } catch { /* error handled by server */ }
        }
        break;

      // ── Help commands ──
      case "help":
        commandBus.emit("codascope:open-guide", {});
        break;
      case "commands":
        commandBus.emit("codascope:open-guide", {});
        break;
      case "shortcuts":
        commandBus.emit("codascope:open-guide", {});
        break;

      // ── Deep Run ──
      case "deep-run":
        navigate(`project/${projectId}/dashboard`);
        // Small delay to ensure dashboard mounts before opening modal
        setTimeout(() => openDeepRunModal(), 100);
        showSlashToast("Opening Deep Run…");
        break;

      default:
        break;
    }
  }, [projectId, selectedModelId, navigate, showSlashToast, slashCommandContext, commandBus]);

  const handleSlashClose = useCallback(() => {
    setSlashPaletteOpen(false);
    // Clear the `/` from input if it's just a bare `/`
    setInput((prev) => (prev === "/" ? "" : prev));
  }, []);

  // Keyboard capture for slash palette navigation
  const handleSlashKeyCapture = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!visibleSlashPaletteOpen) return false;

      const totalItems = getVisibleCommandCount(
        visibleInput.startsWith("/") ? visibleInput.slice(1) : "",
        slashCommandContext,
      );

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashActiveIndex((prev) => Math.min(prev + 1, totalItems - 1));
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashActiveIndex((prev) => Math.max(prev - 1, 0));
        return true;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        // Find the selected item from the filtered list at the active index
        const q = visibleInput.startsWith("/")
          ? visibleInput.slice(1)
          : "";
        const { relevant, other } = getFilteredCommands(q, slashCommandContext);
        const allItems = [...relevant, ...other];
        const selected = allItems[slashActiveIndex];
        if (selected) {
          void handleSlashSelect(selected);
        }
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleSlashClose();
        return true;
      }
      return false;
    },
    [visibleSlashPaletteOpen, visibleInput, slashCommandContext, slashActiveIndex, handleSlashSelect, handleSlashClose],
  );

  // Close palette if input becomes empty (user deleted `/`)
  useEffect(() => {
    if (visibleSlashPaletteOpen && !visibleInput.startsWith("/")) {
      setSlashPaletteOpen(false);
    }
  }, [visibleInput, visibleSlashPaletteOpen]);

  // Reset active index when query changes
  useEffect(() => {
    if (visibleSlashPaletteOpen) {
      setSlashActiveIndex(0);
    }
  }, [visibleInput, visibleSlashPaletteOpen]);

  // ── First-visit auto-pop guide modal ─────────────────────────────

  useEffect(() => {
    const seen = localStorage.getItem("codascope-guide-seen");
    if (!seen) {
      commandBus.emit("codascope:open-guide", {});
      localStorage.setItem("codascope-guide-seen", "1");
    }
  }, []);



  // ── Phase 3: Selection-to-chat listener ────────────────────────────

  useEffect(() => {
    if (!commandBus) return;
    const unsub = commandBus.on("codascope:design-selection-to-chat", ((payload: {
      blockId: string;
      text: string;
      startLine: number;
      endLine: number;
      docId: string;
      epicId: string;
    }) => {
      if (assistantScope.kind !== "project") return;
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
    }) as (payload: unknown) => void);
    return unsub;
  }, [assistantScope.kind, commandBus]);

  // ── Directive generate → prefill and auto-send ─────────────────────

  useEffect(() => {
    if (!commandBus) return;
    const unsub = commandBus.on("codascope:assistant-prefill", ((payload: {
      prompt: string;
    }) => {
      if (assistantScope.kind === "project" && payload.prompt) {
        handleSendPrompt(payload.prompt);
      }
    }) as (payload: unknown) => void);
    return unsub;
  }, [assistantScope.kind, commandBus, handleSendPrompt]);

  // ── Design doc action tag handlers ────────────────────────────────

  // After SSE completes, check for design doc actions in the final message
  useEffect(() => {
    if (assistantScope.kind !== "project") return;
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
        if (projectId) {
          navigate(`project/${projectId}/epic/${action.attributes.epicId}/design/artifact:${action.attributes.artifactId}`);
        }
      }
    }
  }, [assistantScope.kind, messages, streaming, commandBus, navigate, projectId]);


  const stopStreaming = useCallback(async () => {
    await cancelStream();
  }, [cancelStream]);

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

  // ── Create/switch wrappers for ConversationHeader ──────────────────

  const handleNewConversation = useCallback(() => {
    void createNewConversation({ streaming, selectedModelId });
  }, [createNewConversation, streaming, selectedModelId]);

  const handleSwitchConversation = useCallback((convId: string) => {
    void switchConversation(convId, streaming);
  }, [switchConversation, streaming]);

  const handleRenameConversation = useCallback((
    conversationId: string,
    title: string,
  ) => {
    void updateConversation(conversationId, { title });
  }, [updateConversation]);

  const handleDeleteConversation = useCallback((conversationId: string) => {
    void deleteConversation(conversationId);
  }, [deleteConversation]);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="codascope-assistant">
      {/* Conversation Header */}
      <ConversationHeader
        activeConversationId={activeConversationId ?? undefined}
        activeTitle={activeTitle}
        conversations={conversations}
        disabled={streaming}
        onNewConversation={handleNewConversation}
        onSelectConversation={handleSwitchConversation}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      {assistantScope.kind === "workspace" && (
        <div className="codascope-assistant-scope">
          <span className="codascope-assistant-scope-icon">
            <IconChat size={14} />
          </span>
          <strong>Workspace Assistant</strong>
          <span className="codascope-assistant-scope-mode">
            Notes by directive
          </span>
        </div>
      )}

      {/* Context Badge */}
      {contextBadge && (
        <div className="codascope-assistant-context">
          <span className="codascope-assistant-context-badge">{contextBadge}</span>
          <span className="codascope-assistant-context-label">Context</span>
        </div>
      )}

      {assistantScope.kind === "workspace" && currentRootNote && (
        <div className="codascope-assistant-note-context">
          <span className="codascope-assistant-note-context-title">
            {currentRootNote.title}
          </span>
          <span className="codascope-assistant-note-context-visibility">
            {currentRootNote.visibility === "private" ? "Private" : "Shared"}
          </span>
        </div>
      )}

      {/* Phase 3: Epic Context Banner */}
      {currentEpic && (
        <div className="codascope-assistant-epic-banner">
          <span className="codascope-assistant-epic-banner-icon"><IconClipboard size={14} /></span>
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
            <h3>
              {assistantScope.kind === "workspace"
                ? "Workspace Assistant"
                : "CodaScope Assistant"}
            </h3>
            <p>
              {assistantScope.kind === "workspace"
                ? "Reference active projects for focused read-only knowledge. CodaScope Notes can change only when you explicitly ask."
                : "I help you understand, document, and analyze your codebase."}
            </p>
            <div className="codascope-assistant-welcome-cards">
              {assistantScope.kind === "workspace" ? (
                <>
                  <button
                    className="codascope-assistant-welcome-card"
                    onClick={() => handleSendPrompt("Summarize the active projects in this workspace and their documentation coverage")}
                    type="button"
                  >
                    <span className="codascope-assistant-welcome-card-icon"><IconBook size={18} /></span>
                    <span className="codascope-assistant-welcome-card-label">Workspace Overview</span>
                  </button>
                  <button
                    className="codascope-assistant-welcome-card"
                    onClick={() => handleSendPrompt("Compare the architecture documentation available across my active projects")}
                    type="button"
                  >
                    <span className="codascope-assistant-welcome-card-icon"><IconSearch size={18} /></span>
                    <span className="codascope-assistant-welcome-card-label">Compare Documentation</span>
                  </button>
                </>
              ) : wikiTopics.length === 0 ? (
                /* New project — no wiki yet */
                <>
                  <button
                    className="codascope-assistant-welcome-card"
                    onClick={() => handleSendPrompt("Explore and map the codebase structure")}
                    type="button"
                  >
                    <span className="codascope-assistant-welcome-card-icon"><IconMap size={18} /></span>
                    <span className="codascope-assistant-welcome-card-label">Explore Codebase</span>
                  </button>
                  <button
                    className="codascope-assistant-welcome-card"
                    onClick={() => handleSendPrompt("Build wiki documentation from the code map")}
                    type="button"
                  >
                    <span className="codascope-assistant-welcome-card-icon"><IconBook size={18} /></span>
                    <span className="codascope-assistant-welcome-card-label">Build Wiki</span>
                  </button>
                </>
              ) : (
                /* Established project — wiki exists */
                <>
                  <button
                    className="codascope-assistant-welcome-card"
                    onClick={() => handleSendPrompt("Help me understand how this codebase is structured")}
                    type="button"
                  >
                    <span className="codascope-assistant-welcome-card-icon"><IconSearch size={18} /></span>
                    <span className="codascope-assistant-welcome-card-label">Ask About Code</span>
                  </button>
                  <button
                    className="codascope-assistant-welcome-card"
                    onClick={() => handleSendPrompt("Run a quality scan and explain the top issues")}
                    type="button"
                  >
                    <span className="codascope-assistant-welcome-card-icon"><IconShield size={18} /></span>
                    <span className="codascope-assistant-welcome-card-label">Check Quality</span>
                  </button>
                  <button
                    className="codascope-assistant-welcome-card"
                    onClick={() => handleSendPrompt("Help me plan a new feature epic")}
                    type="button"
                  >
                    <span className="codascope-assistant-welcome-card-icon"><IconPlan size={18} /></span>
                    <span className="codascope-assistant-welcome-card-label">Plan Epic</span>
                  </button>
                </>
              )}
            </div>
            <div className="codascope-assistant-welcome-hint">
              {assistantScope.kind === "workspace" ? (
                <>Type <code>@</code> to reference active projects &nbsp;·&nbsp; <code>/</code> for workspace-safe help &nbsp;·&nbsp; <code>?</code> for the full guide</>
              ) : (
                <>Type <code>/</code> for commands &nbsp;·&nbsp; <code>@</code> to add context &nbsp;·&nbsp; <code>?</code> for the full guide</>
              )}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const actions = Array.isArray(msg.metadata?.actions)
            ? msg.metadata.actions
            : [];
          // Always strip action tags from assistant messages — even if metadata.actions
          // is empty (e.g. older messages or unrecognized action types)
          const displayContent = msg.role === "assistant"
            ? stripActionTagsClient(msg.content)
            : msg.content;

          return (
            <div key={msg.id}>
              <div
                className={`codascope-assistant-msg codascope-assistant-msg-${msg.role}${msg.status === "error" ? " codascope-assistant-msg-error" : ""}`}
              >
                <div className="codascope-assistant-msg-avatar">
                  {msg.role === "user"
                    ? <IconUser size={15} />
                    : <IconAgent size={15} />}
                </div>
                <div className="codascope-assistant-msg-content">
                  {msg.role === "assistant" ? (
                    <>
                      {msg.status === "error" && (
                        <div className="codascope-assistant-msg-error-label">
                          <IconWarning size={12} /> Incomplete response
                        </div>
                      )}
                      <MarkdownViewer content={convertWikiLinks(displayContent, projectId, currentEpicId)} />
                    </>
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
              <WorkspaceSourceReferences
                scope={assistantScope}
                message={msg}
              />
              {actions.length > 0 && (
                assistantScope.kind === "project"
                  ? <ActionCardList actions={actions as CodaScopeAction[]} />
                  : <WorkspaceActionCardList actions={actions} />
              )}
            </div>
          );
        })}

        {/* Streaming message */}
        {streaming && (
          <div className="codascope-assistant-msg codascope-assistant-msg-assistant">
            <div className="codascope-assistant-msg-avatar">
              <IconAgent size={15} />
            </div>
            <div className="codascope-assistant-msg-content">
              {streamingContent ? (
                <MarkdownViewer content={convertWikiLinks(stripActionTagsClient(streamingContent), projectId, currentEpicId)} />
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
      {assistantScope.kind === "project" && (
        <PromptChips
          onSend={handleSendPrompt}
          context={promptChipContext}
        />
      )}

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
                <IconClose size={14} />
              </button>
            )}
            <button
              className="codascope-assistant-help-btn"
              onClick={() => { commandBus.emit("codascope:open-guide", {}); }}
              type="button"
              title="CodaScope Guide"
              aria-label="CodaScope Guide"
            >
              ?
            </button>
            <button
              className="codascope-conv-new-btn"
              disabled={streaming}
              onClick={handleNewConversation}
              title="New conversation"
              type="button"
            >
              + New Chat
            </button>
          </div>
        </div>
        <div className="codascope-assistant-input-row">
          {visibleAtPickerOpen && (
            assistantScope.kind === "workspace" ? (
              <WorkspaceProjectReferencePicker
                scopeKey={scopeKey}
                selectedProjectIds={visibleWorkspaceProjectReferences.map(
                  (project) => project.projectId,
                )}
                onSelect={handleWorkspaceProjectSelect}
                onClose={handleAtPickerClose}
              />
            ) : projectId ? (
              <AtMentionPicker
                projectId={projectId}
                epicId={currentEpicId}
                onSelect={handleAtMentionSelect}
                onClose={handleAtPickerClose}
              />
            ) : null
          )}
          {visibleSlashPaletteOpen && (
            <SlashCommandPalette
              isOpen={visibleSlashPaletteOpen}
              query={visibleInput.startsWith("/") ? visibleInput.slice(1) : ""}
              context={slashCommandContext}
              onSelect={handleSlashSelect}
              onClose={handleSlashClose}
              activeIndex={slashActiveIndex}
              onActiveIndexChange={setSlashActiveIndex}
            />
          )}
          <RichChatInput
            value={visibleInput}
            onChange={setInput}
            onSend={sendMessage}
            onAtTrigger={handleAtTrigger}
            onSlashTrigger={handleSlashTrigger}
            onKeyDownCapture={handleSlashKeyCapture}
            onImagePaste={handleImageFile}
            onImageDrop={handleImageFile}
            attachments={visibleAttachments}
            onRemoveAttachment={handleRemoveAttachment}
            onClearAttachments={handleClearAttachments}
            placeholder={assistantScope.kind === "workspace"
              ? "Message the Workspace Assistant... (@ active projects, / help)"
              : "Message the agent... (@ to add context, / for commands)"}
            disabled={streaming || !selectedModelId}
            sendDisabled={!visibleInput.trim() || streaming || !selectedModelId}
          />
          <button
            className="codascope-assistant-send-btn"
            onClick={sendMessage}
            disabled={!visibleInput.trim() || streaming || !selectedModelId}
            type="button"
            title="Send message"
          >
            <IconSend size={16} />
          </button>
        </div>


        {/* Slash command toast */}
        {slashToast && (
          <div className="codascope-slash-toast" key={slashToast}>
            <span className="codascope-slash-toast-icon"><IconCheck size={13} /></span>
            {slashToast}
          </div>
        )}
      </div>
    </div>
  );
}
