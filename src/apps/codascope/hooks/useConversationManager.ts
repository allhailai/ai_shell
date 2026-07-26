/* ── useConversationManager ─────────────────────────────────────────
   Scope-isolated conversation CRUD, URL restoration, and history state for
   the CodaScope assistant.
   ──────────────────────────────────────────────────────────────────── */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { clearRecentViews } from "../contextAssembler";
import {
  createAssistantConversationApi,
  restoreAssistantMessages,
  type AssistantConversationApi,
} from "../assistantConversationApi";
import {
  getAssistantRestorationKey,
  getAssistantScopeKey,
} from "../assistantScope";
import type {
  AssistantChatMessage,
  AssistantScope,
  Conversation,
  ConversationSummary,
} from "../codaScopeTypes";

interface ScopedConversationState {
  scopeKey: string;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  activeTitle: string;
  messages: AssistantChatMessage[];
}

export interface ConversationRestorePlan {
  conversationId: string | null;
  clearUrlConversation: boolean;
}

export function isConversationRequestCurrent(
  request: { scopeKey: string; version: number },
  current: { scopeKey: string; version: number },
): boolean {
  return request.scopeKey === current.scopeKey
    && request.version === current.version;
}

export function resolveConversationRestorePlan(
  conversations: readonly ConversationSummary[],
  urlConversationId: string | null,
  storedConversationId: string | null,
): ConversationRestorePlan {
  const byId = new Map(conversations.map((conversation) => [
    conversation.id,
    conversation,
  ]));
  const urlConversation = urlConversationId
    ? byId.get(urlConversationId)
    : null;
  if (urlConversation) {
    return {
      conversationId: urlConversation.id,
      clearUrlConversation: false,
    };
  }
  const storedConversation = storedConversationId
    ? byId.get(storedConversationId)
    : null;
  if (storedConversation) {
    return {
      conversationId: storedConversation.id,
      clearUrlConversation: Boolean(urlConversationId),
    };
  }
  const mostRecent = [...conversations].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  )[0];
  return {
    conversationId: mostRecent?.id ?? null,
    clearUrlConversation: Boolean(urlConversationId),
  };
}

export interface UseConversationManagerResult {
  api: AssistantConversationApi;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  activeTitle: string;
  setActiveTitle: (title: string) => void;
  messages: AssistantChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<AssistantChatMessage[]>>;
  loadConversationList: () => Promise<ConversationSummary[]>;
  loadConversation: (conversationId: string) => Promise<Conversation | null>;
  createNewConversation: (opts: {
    streaming: boolean;
    selectedModelId: string | null;
  }) => Promise<Conversation | null>;
  updateConversation: (
    conversationId: string,
    input: { title?: string; summary?: string },
  ) => Promise<Conversation | null>;
  deleteConversation: (conversationId: string) => Promise<boolean>;
  switchConversation: (
    conversationId: string,
    streaming: boolean,
  ) => Promise<void>;
}

export function useConversationManager(
  scope: AssistantScope,
  detachPreviousScope?: () => Promise<void>,
): UseConversationManagerResult {
  const { getParam, setParam } = useAppSubRoute("codascope");
  const scopeKey = getAssistantScopeKey(scope);
  const restorationKey = getAssistantRestorationKey(scope);
  const api = useMemo(
    () => createAssistantConversationApi(scope),
    [scopeKey],
  );
  const [state, setState] = useState<ScopedConversationState>(
    () => emptyState(scopeKey),
  );
  const scopeVersionRef = useRef(0);
  const mountedRef = useRef(true);
  const previousScopeKeyRef = useRef<string | null>(null);
  const getParamRef = useRef(getParam);
  getParamRef.current = getParam;

  const visibleState = state.scopeKey === scopeKey
    ? state
    : emptyState(scopeKey);

  const isCurrent = useCallback(
    (requestScopeKey: string, requestVersion: number) =>
      mountedRef.current
      && isConversationRequestCurrent(
        { scopeKey: requestScopeKey, version: requestVersion },
        { scopeKey, version: scopeVersionRef.current },
      ),
    [scopeKey],
  );

  const applyConversation = useCallback((
    conversation: Conversation,
    requestScopeKey = scopeKey,
    requestVersion = scopeVersionRef.current,
  ) => {
    if (!isCurrent(requestScopeKey, requestVersion)) return false;
    const messages = restoreAssistantMessages(conversation, api.endpoints);
    setState((current) => {
      if (current.scopeKey !== requestScopeKey) return current;
      return {
        ...current,
        activeConversationId: conversation.id,
        activeTitle: conversation.title,
        messages,
      };
    });
    return true;
  }, [api.endpoints, isCurrent, scopeKey]);

  const loadConversationList = useCallback(async () => {
    const requestScopeKey = scopeKey;
    const requestVersion = scopeVersionRef.current;
    try {
      const conversations = await api.listConversations();
      if (!isCurrent(requestScopeKey, requestVersion)) return [];
      setState((current) => current.scopeKey === requestScopeKey
        ? { ...current, conversations }
        : current);
      return conversations;
    } catch {
      return [];
    }
  }, [api, isCurrent, scopeKey]);

  const loadConversation = useCallback(async (conversationId: string) => {
    const requestScopeKey = scopeKey;
    const requestVersion = scopeVersionRef.current;
    try {
      const conversation = await api.readConversation(conversationId);
      if (!conversation
        || !applyConversation(
          conversation,
          requestScopeKey,
          requestVersion,
        )) {
        return null;
      }
      return conversation;
    } catch {
      return null;
    }
  }, [api, applyConversation, scopeKey]);

  // Register the mount guard before the scope-loading effect. React Strict
  // Mode replays effect setup/cleanup in declaration order; keeping this
  // lifecycle effect first restores the guard before the replayed load begins.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scopeVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const requestVersion = ++scopeVersionRef.current;
    const requestScopeKey = scopeKey;
    const isTransition = previousScopeKeyRef.current !== null
      && previousScopeKeyRef.current !== scopeKey;
    previousScopeKeyRef.current = scopeKey;

    setState(emptyState(scopeKey));
    clearRecentViews();

    void (async () => {
      if (isTransition && detachPreviousScope) {
        await detachPreviousScope();
      }
      if (!isCurrent(requestScopeKey, requestVersion)) return;

      let conversations: ConversationSummary[] = [];
      try {
        conversations = await api.listConversations();
      } catch {
        conversations = [];
      }
      if (!isCurrent(requestScopeKey, requestVersion)) return;
      setState((current) => current.scopeKey === requestScopeKey
        ? { ...current, conversations }
        : current);

      const urlConversationId = getParamRef.current("conv");
      let storedConversationId: string | null = null;
      try {
        storedConversationId = localStorage.getItem(restorationKey);
      } catch {
        // Storage is an optional restoration aid.
      }
      const plan = resolveConversationRestorePlan(
        conversations,
        urlConversationId,
        storedConversationId,
      );
      if (plan.clearUrlConversation) setParam("conv", null);
      if (!plan.conversationId) return;

      let conversation: Conversation | null = null;
      try {
        conversation = await api.readConversation(plan.conversationId);
      } catch {
        conversation = null;
      }
      if (conversation) {
        applyConversation(conversation, requestScopeKey, requestVersion);
      }
    })();
  }, [
    api,
    applyConversation,
    detachPreviousScope,
    isCurrent,
    restorationKey,
    scopeKey,
    setParam,
  ]);

  useEffect(() => {
    if (state.scopeKey !== scopeKey || !state.activeConversationId) return;
    setParam("conv", state.activeConversationId);
    try {
      localStorage.setItem(restorationKey, state.activeConversationId);
    } catch {
      // URL state remains authoritative when storage is unavailable.
    }
  }, [
    restorationKey,
    scopeKey,
    setParam,
    state.activeConversationId,
    state.scopeKey,
  ]);

  const setActiveConversationId = useCallback((id: string | null) => {
    setState((current) => current.scopeKey === scopeKey
      ? { ...current, activeConversationId: id }
      : current);
  }, [scopeKey]);

  const setActiveTitle = useCallback((title: string) => {
    setState((current) => current.scopeKey === scopeKey
      ? { ...current, activeTitle: title }
      : current);
  }, [scopeKey]);

  const setMessages = useCallback<
    React.Dispatch<React.SetStateAction<AssistantChatMessage[]>>
  >((value) => {
    setState((current) => {
      if (current.scopeKey !== scopeKey) return current;
      const messages = typeof value === "function"
        ? value(current.messages)
        : value;
      return { ...current, messages };
    });
  }, [scopeKey]);

  const createNewConversation = useCallback(async (opts: {
    streaming: boolean;
    selectedModelId: string | null;
  }) => {
    if (opts.streaming) return null;
    const requestScopeKey = scopeKey;
    const requestVersion = scopeVersionRef.current;
    try {
      const conversation = await api.createConversation({
        modelId: opts.selectedModelId,
      });
      if (!conversation
        || !isCurrent(requestScopeKey, requestVersion)) {
        return null;
      }
      applyConversation(conversation, requestScopeKey, requestVersion);
      await loadConversationList();
      return conversation;
    } catch {
      return null;
    }
  }, [api, applyConversation, isCurrent, loadConversationList, scopeKey]);

  const updateConversation = useCallback(async (
    conversationId: string,
    input: { title?: string; summary?: string },
  ) => {
    const requestScopeKey = scopeKey;
    const requestVersion = scopeVersionRef.current;
    try {
      const conversation = await api.updateConversation(conversationId, input);
      if (!conversation
        || !isCurrent(requestScopeKey, requestVersion)) {
        return null;
      }
      setState((current) => {
        if (current.scopeKey !== requestScopeKey) return current;
        return {
          ...current,
          activeTitle: current.activeConversationId === conversationId
            ? conversation.title
            : current.activeTitle,
          conversations: current.conversations.map((summary) =>
            summary.id === conversationId
              ? {
                  ...summary,
                  title: conversation.title,
                  summary: conversation.summary ?? summary.summary,
                  updatedAt: conversation.updatedAt ?? summary.updatedAt,
                }
              : summary),
        };
      });
      return conversation;
    } catch {
      return null;
    }
  }, [api, isCurrent, scopeKey]);

  const deleteConversation = useCallback(async (conversationId: string) => {
    const requestScopeKey = scopeKey;
    const requestVersion = scopeVersionRef.current;
    try {
      if (!await api.deleteConversation(conversationId)
        || !isCurrent(requestScopeKey, requestVersion)) {
        return false;
      }
      const remaining = await api.listConversations();
      if (!isCurrent(requestScopeKey, requestVersion)) return false;
      setState((current) => current.scopeKey === requestScopeKey
        ? { ...current, conversations: remaining }
        : current);
      if (visibleState.activeConversationId !== conversationId) return true;

      setParam("conv", null);
      try {
        if (localStorage.getItem(restorationKey) === conversationId) {
          localStorage.removeItem(restorationKey);
        }
      } catch {
        // Best-effort fallback cleanup.
      }
      const next = resolveConversationRestorePlan(remaining, null, null);
      if (!next.conversationId) {
        setState(emptyState(requestScopeKey));
        return true;
      }
      const conversation = await api.readConversation(next.conversationId);
      if (conversation) {
        applyConversation(conversation, requestScopeKey, requestVersion);
      }
      return true;
    } catch {
      return false;
    }
  }, [
    api,
    applyConversation,
    isCurrent,
    restorationKey,
    scopeKey,
    setParam,
    visibleState.activeConversationId,
  ]);

  const switchConversation = useCallback(async (
    conversationId: string,
    streaming: boolean,
  ) => {
    if (streaming) return;
    await loadConversation(conversationId);
  }, [loadConversation]);

  return {
    api,
    conversations: visibleState.conversations,
    activeConversationId: visibleState.activeConversationId,
    setActiveConversationId,
    activeTitle: visibleState.activeTitle,
    setActiveTitle,
    messages: visibleState.messages,
    setMessages,
    loadConversationList,
    loadConversation,
    createNewConversation,
    updateConversation,
    deleteConversation,
    switchConversation,
  };
}

function emptyState(scopeKey: string): ScopedConversationState {
  return {
    scopeKey,
    conversations: [],
    activeConversationId: null,
    activeTitle: "New conversation",
    messages: [],
  };
}
