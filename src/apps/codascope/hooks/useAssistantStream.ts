/* ── useAssistantStream ─────────────────────────────────────────────
   Scope-aware SSE streaming for the CodaScope assistant. Every run retains
   its original endpoint family through completion or cancellation.
   ──────────────────────────────────────────────────────────────────── */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import type {
  AssistantChatMessage,
  AssistantScope,
  CodaScopeAction,
} from "../codaScopeTypes";
import type { CanonicalProjectNoteRangeTarget } from "../projectNoteRangeTargetValidation";
import type { CanonicalWorkspaceNoteRangeTarget } from "../workspaceNoteRangeTargetValidation";
import {
  createAssistantConversationApi,
  createAssistantEndpointAdapter,
  isCanonicalAssistantRecordId,
  restoreAssistantMessages,
  type AssistantConversationApi,
} from "../assistantConversationApi";
import { getAssistantScopeKey } from "../assistantScope";
import {
  consumeSseResponse,
  SseProtocolError,
} from "../codaScopeSseClient";
import {
  normalizeCanonicalWorkspaceMutationActions,
} from "../workspaceMutationActionValidation";
import {
  isProjectNoteRangeActionCandidate,
  normalizeCanonicalProjectNoteRangeAction,
} from "../projectNoteRangeMutationActionValidation";
import {
  normalizeCanonicalProjectNoteRangeTarget,
} from "../projectNoteRangeTargetValidation";
import {
  normalizeCanonicalWorkspaceNoteRangeTarget,
} from "../workspaceNoteRangeTargetValidation";

export interface StreamOptions {
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
  noteRangeTarget?:
    | CanonicalWorkspaceNoteRangeTarget
    | CanonicalProjectNoteRangeTarget;
  /** UI-only reconciliation input. It is never included in the HTTP payload. */
  knownMessageIds?: string[];
}

interface StreamResult {
  assistantMessage: AssistantChatMessage | null;
  reconciledMessages?: AssistantChatMessage[];
  liveWorkspaceActions?: CodaScopeAction[];
  newTitle?: string;
  conversationId?: string;
  terminalStatus?: "complete" | "error" | "cancelled";
  terminalActions?: CodaScopeAction[];
  discarded?: boolean;
}

export type AssistantStreamOutcome =
  | {
      status: "complete";
      content: string;
      actions: CodaScopeAction[];
      conversationId?: string;
      assistantMessageId?: string;
      workspaceTerminalIdentityValid?: boolean;
    }
  | {
      status: "error";
      content: string;
      error: string;
      actions: CodaScopeAction[];
      conversationId?: string;
      assistantMessageId?: string;
      workspaceTerminalIdentityValid?: boolean;
    }
  | {
      status: "cancelled";
      content: string;
      actions: CodaScopeAction[];
      conversationId?: string;
      assistantMessageId?: string;
      workspaceTerminalIdentityValid?: boolean;
    };

interface ActiveRun {
  id: number;
  scopeKey: string;
  scope: AssistantScope;
  controller: AbortController;
  cancellationRequested: boolean;
}

export function isAssistantRunCurrent(
  run: Pick<ActiveRun, "id" | "scopeKey">,
  activeRun: Pick<ActiveRun, "id" | "scopeKey"> | null,
  currentScopeKey: string,
): boolean {
  return Boolean(activeRun)
    && activeRun?.id === run.id
    && activeRun.scopeKey === run.scopeKey
    && currentScopeKey === run.scopeKey;
}

export async function cancelAssistantRun(
  scope: AssistantScope,
  controller: AbortController,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  controller.abort();
  const endpoints = createAssistantEndpointAdapter(scope);
  try {
    await fetchImpl(endpoints.cancelRun(), { method: "POST" });
  } catch {
    // Cancellation remains best effort after local detachment.
  }
}

export async function requestAssistantCancellation(
  scope: AssistantScope,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const endpoints = createAssistantEndpointAdapter(scope);
  try {
    await fetchImpl(endpoints.cancelRun(), { method: "POST" });
  } catch {
    // The active stream remains authoritative if the best-effort request fails.
  }
}

export function createAssistantMessagePayload(
  scope: AssistantScope,
  options: StreamOptions,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    message: options.message,
    modelId: options.modelId,
    context: options.context,
  };
  if (options.attachments && options.attachments.length > 0) {
    payload.attachments = options.attachments;
  }
  if (scope.kind === "project") {
    if (options.references && options.references.length > 0) {
      payload.references = options.references;
    }
    if (options.selectionContext) {
      payload.selectionContext = options.selectionContext;
    }
  }
  if (options.noteRangeTarget) {
    const target = scope.kind === "workspace"
      ? normalizeCanonicalWorkspaceNoteRangeTarget(options.noteRangeTarget)
      : normalizeCanonicalProjectNoteRangeTarget(options.noteRangeTarget);
    if (!target
      || (scope.kind === "workspace" && target.scope !== "codascope")
      || (scope.kind === "project"
        && (target.scope === "codascope"
          || target.projectId !== scope.projectId))) {
      throw new Error("The selected note range does not match this assistant.");
    }
    payload.noteRangeTarget = target;
  }
  return payload;
}

/** Consume chat SSE while retaining partial text for an explicit error result. */
export async function consumeAssistantStreamResponse(
  response: Response,
  signal: AbortSignal | undefined,
  onText: (content: string) => void,
  scope: AssistantScope,
): Promise<AssistantStreamOutcome> {
  let accumulated = "";
  let workspaceTerminalIdentityValid = true;
  try {
    const terminal = await consumeSseResponse(response, {
      onText: (text) => {
        accumulated += text;
        onText(accumulated);
      },
    }, signal);

    const conversationId = terminal.data.conversationId;
    if (conversationId !== undefined && (
      scope.kind === "workspace"
        ? !isCanonicalAssistantRecordId(conversationId)
        : typeof conversationId !== "string"
    )) {
      workspaceTerminalIdentityValid = false;
      throw new SseProtocolError(
        `Malformed ${terminal.type} terminal event payload.`,
      );
    }
    const assistantMessageId = terminal.data.assistantMessageId;
    if (assistantMessageId !== undefined && (
      scope.kind === "workspace"
        ? !isCanonicalAssistantRecordId(assistantMessageId)
        : typeof assistantMessageId !== "string"
    )) {
      workspaceTerminalIdentityValid = false;
      throw new SseProtocolError(
        `Malformed ${terminal.type} terminal event payload.`,
      );
    }
    const rawActions = terminal.data.actions;
    let actions: CodaScopeAction[] = [];
    if (scope.kind === "workspace") {
      if (rawActions !== undefined) {
        const trusted = normalizeCanonicalWorkspaceMutationActions(rawActions);
        if (!trusted) {
          throw new SseProtocolError(
            `Malformed ${terminal.type} terminal event payload.`,
          );
        }
        actions = trusted;
      }
    } else {
      if (rawActions !== undefined && !Array.isArray(rawActions)) {
        throw new SseProtocolError(
          `Malformed ${terminal.type} terminal event payload.`,
        );
      }
      for (const candidate of rawActions ?? []) {
        if (isProjectNoteRangeActionCandidate(candidate)) {
          const action = normalizeCanonicalProjectNoteRangeAction(candidate);
          if (!action) {
            throw new SseProtocolError(
              `Malformed ${terminal.type} terminal event payload.`,
            );
          }
          if (action.attributes.projectId !== scope.projectId) {
            throw new SseProtocolError(
              `Malformed ${terminal.type} terminal event payload.`,
            );
          }
          actions.push(action);
        } else if (terminal.type === "done") {
          // Preserve the historical successful project-action behavior.
          actions.push(candidate as CodaScopeAction);
        }
      }
    }

    const identity = {
      ...(typeof conversationId === "string" ? { conversationId } : {}),
      ...(typeof assistantMessageId === "string"
        ? { assistantMessageId }
        : {}),
      ...(scope.kind === "workspace"
        ? { workspaceTerminalIdentityValid }
        : {}),
    };

    if (terminal.type === "cancelled") {
      return {
        status: "cancelled",
        content: accumulated,
        actions,
        ...identity,
      };
    }

    if (terminal.type === "error") {
      return {
        status: "error",
        content: accumulated,
        error: terminal.error,
        actions,
        ...identity,
      };
    }

    return {
      status: "complete",
      content: accumulated,
      actions,
      ...identity,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return {
      status: "error",
      content: accumulated,
      error: error instanceof Error ? error.message : "Network error.",
      actions: [],
      ...(scope.kind === "workspace"
        ? { workspaceTerminalIdentityValid }
        : {}),
    };
  }
}

export function findPersistedWorkspaceAssistantMessage(
  messages: readonly AssistantChatMessage[],
  assistantMessageId: string | undefined,
  knownMessageIds: ReadonlySet<string>,
): AssistantChatMessage | null {
  const newEligible = messages.filter((message) =>
    message.role === "assistant"
    && (message.status === "complete" || message.status === "error")
    && !knownMessageIds.has(message.id));
  if (assistantMessageId) {
    return newEligible.find(
      (message) => message.id === assistantMessageId,
    ) ?? null;
  }
  return newEligible.length === 1 ? newEligible[0] : null;
}

export async function reconcilePersistedWorkspaceAssistantTurn(
  api: AssistantConversationApi,
  conversationId: string,
  assistantMessageId: string | undefined,
  knownMessageIds: ReadonlySet<string>,
  attempts = 3,
): Promise<{
  assistantMessage: AssistantChatMessage;
  messages: AssistantChatMessage[];
  liveWorkspaceActions: CodaScopeAction[];
} | null> {
  if (!isCanonicalAssistantRecordId(conversationId)
    || (assistantMessageId !== undefined
      && !isCanonicalAssistantRecordId(assistantMessageId))) {
    return null;
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const conversation = await api.readConversation(conversationId);
      if (conversation
        && conversation.id === conversationId
        && conversation.scope.kind === "workspace") {
        const messages = restoreAssistantMessages(
          conversation,
          api.endpoints,
        );
        const assistantMessage = findPersistedWorkspaceAssistantMessage(
          messages,
          assistantMessageId,
          knownMessageIds,
        );
        if (assistantMessage) {
          const liveWorkspaceActions =
            normalizeCanonicalWorkspaceMutationActions(
              assistantMessage.metadata?.actions ?? [],
            );
          if (liveWorkspaceActions) {
            return {
              assistantMessage,
              messages,
              liveWorkspaceActions,
            };
          }
        }
      }
    } catch {
      // A later bounded attempt may observe the terminal persisted transition.
    }
    if (attempt + 1 < attempts) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, (attempt + 1) * 75);
      });
    }
  }
  return null;
}

export type WorkspaceAssistantTurnResolution =
  | {
      status: "authoritative";
      assistantMessage: AssistantChatMessage;
      messages: AssistantChatMessage[];
      liveWorkspaceActions: CodaScopeAction[];
    }
  | {
      status: "unverified";
      assistantMessage: AssistantChatMessage;
      liveWorkspaceActions: [];
    };

const WORKSPACE_FINALIZATION_FAILURE =
  "**Response finalization could not be verified. Reload the conversation "
  + "to check for a persisted result.**";

function createUnverifiedWorkspaceAssistantMessage(
  partialContent: string,
  preservePartial: boolean,
): AssistantChatMessage {
  return {
    id: `transport-error-${Date.now()}`,
    role: "assistant",
    content: preservePartial && partialContent
      ? `${partialContent}\n\n${WORKSPACE_FINALIZATION_FAILURE}`
      : WORKSPACE_FINALIZATION_FAILURE,
    status: "error",
  };
}

export async function reconcileWorkspaceAssistantOutcome(
  api: AssistantConversationApi,
  requestedConversationId: string,
  outcome: AssistantStreamOutcome,
  knownMessageIds: ReadonlySet<string>,
  attempts = 3,
): Promise<WorkspaceAssistantTurnResolution> {
  const terminalConversationConflict =
    outcome.conversationId !== undefined
    && outcome.conversationId !== requestedConversationId;
  const malformedTerminalIdentity =
    outcome.workspaceTerminalIdentityValid === false;
  if (!isCanonicalAssistantRecordId(requestedConversationId)
    || terminalConversationConflict
    || malformedTerminalIdentity) {
    return {
      status: "unverified",
      assistantMessage: createUnverifiedWorkspaceAssistantMessage("", false),
      liveWorkspaceActions: [],
    };
  }

  const reconciled = await reconcilePersistedWorkspaceAssistantTurn(
    api,
    requestedConversationId,
    outcome.assistantMessageId,
    knownMessageIds,
    attempts,
  );
  if (reconciled) {
    return {
      status: "authoritative",
      ...reconciled,
    };
  }

  return {
    status: "unverified",
    assistantMessage: createUnverifiedWorkspaceAssistantMessage(
      outcome.content,
      outcome.assistantMessageId === undefined,
    ),
    liveWorkspaceActions: [],
  };
}

export interface UseAssistantStreamResult {
  streaming: boolean;
  streamingContent: string;
  streamMessage: (options: StreamOptions) => Promise<StreamResult>;
  cancelStream: () => Promise<void>;
  detachActiveRun: () => Promise<void>;
}

export function useAssistantStream(
  scope: AssistantScope,
): UseAssistantStreamResult {
  const scopeKey = getAssistantScopeKey(scope);
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const activeRunRef = useRef<ActiveRun | null>(null);
  const pendingCancellationRef = useRef<Promise<void> | null>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  const currentScopeKeyRef = useRef(scopeKey);
  currentScopeKeyRef.current = scopeKey;

  const cancelRun = useCallback(async (
    run: ActiveRun,
    updateVisibleState: boolean,
  ) => {
    if (activeRunRef.current === run) activeRunRef.current = null;
    if (updateVisibleState && mountedRef.current) {
      setStreaming(false);
      setStreamingContent("");
    }
    await cancelAssistantRun(run.scope, run.controller);
  }, []);

  const detachActiveRun = useCallback(async () => {
    const run = activeRunRef.current;
    if (run) {
      const pending = cancelRun(run, true);
      pendingCancellationRef.current = pending;
      await pending;
      if (pendingCancellationRef.current === pending) {
        pendingCancellationRef.current = null;
      }
      return;
    }
    await pendingCancellationRef.current;
  }, [cancelRun]);

  useEffect(() => {
    mountedRef.current = true;
    const run = activeRunRef.current;
    if (run && run.scopeKey !== scopeKey) {
      const pending = cancelRun(run, true);
      pendingCancellationRef.current = pending;
      void pending.finally(() => {
        if (pendingCancellationRef.current === pending) {
          pendingCancellationRef.current = null;
        }
      });
    }
  }, [cancelRun, scopeKey]);

  useEffect(() => () => {
    mountedRef.current = false;
    const active = activeRunRef.current;
    if (active) void cancelRun(active, false);
  }, [cancelRun]);

  const streamMessage = useCallback(async (
    options: StreamOptions,
  ): Promise<StreamResult> => {
    const runScope = scope;
    const runScopeKey = scopeKey;
    const endpoints = createAssistantEndpointAdapter(runScope);
    const run: ActiveRun = {
      id: ++runIdRef.current,
      scopeKey: runScopeKey,
      scope: runScope,
      controller: new AbortController(),
      cancellationRequested: false,
    };
    activeRunRef.current = run;
    setStreaming(true);
    setStreamingContent("");

    const isActive = () =>
      mountedRef.current
      && isAssistantRunCurrent(
        run,
        activeRunRef.current,
        currentScopeKeyRef.current,
      );

    try {
      const response = await fetch(
        endpoints.sendMessage(options.conversationId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            createAssistantMessagePayload(runScope, options),
          ),
          signal: run.controller.signal,
        },
      );
      const outcome = await consumeAssistantStreamResponse(
        response,
        run.controller.signal,
        (content) => {
          if (isActive()) setStreamingContent(content);
        },
        runScope,
      );
      if (!isActive()) {
        return { assistantMessage: null, discarded: true };
      }

      let assistantMessage: AssistantChatMessage | null = null;
      let reconciledMessages: AssistantChatMessage[] | undefined;
      let liveWorkspaceActions: CodaScopeAction[] | undefined;
      if (runScope.kind === "workspace") {
        const resolution = await reconcileWorkspaceAssistantOutcome(
          createAssistantConversationApi(runScope),
          options.conversationId,
          outcome,
          new Set(options.knownMessageIds ?? []),
        );
        if (!isActive()) {
          return { assistantMessage: null, discarded: true };
        }
        assistantMessage = resolution.assistantMessage;
        liveWorkspaceActions = resolution.liveWorkspaceActions;
        if (resolution.status === "authoritative") {
          reconciledMessages = resolution.messages;
        }
      } else if (outcome.status === "error") {
        const failureText = `**Stream failed:** ${outcome.error}`;
        assistantMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: outcome.content
            ? `${outcome.content}\n\n${failureText}`
            : failureText,
          status: "error",
          metadata: outcome.actions.length > 0
            ? { actions: outcome.actions }
            : undefined,
        };
      } else if (outcome.status === "cancelled") {
        assistantMessage = outcome.content || outcome.actions.length > 0
          ? {
              id: `cancelled-${Date.now()}`,
              role: "assistant",
              content: outcome.content
                ? `${outcome.content}\n\n**Generation cancelled.**`
                : "**Generation cancelled.**",
              status: "error",
              metadata: outcome.actions.length > 0
                ? { actions: outcome.actions }
                : undefined,
            }
          : null;
      } else if (outcome.status === "complete"
        && (outcome.content || outcome.actions.length > 0)) {
        const actions = outcome.actions;
        assistantMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: outcome.content || "Selected edit completed.",
          status: "complete",
          metadata: actions.length > 0 ? { actions } : undefined,
        };
      }

      const firstLine = options.message
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean) ?? options.message;
      const newTitle = firstLine.length > 72
        ? `${firstLine.slice(0, 69)}...`
        : firstLine;
      return {
        assistantMessage,
        ...(reconciledMessages ? { reconciledMessages } : {}),
        ...(liveWorkspaceActions ? { liveWorkspaceActions } : {}),
        newTitle,
        conversationId: runScope.kind === "workspace"
          ? options.conversationId
          : outcome.conversationId,
        terminalStatus: outcome.status,
        terminalActions: runScope.kind === "workspace"
          ? liveWorkspaceActions ?? []
          : outcome.actions,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          assistantMessage: null,
          discarded: !isActive(),
        };
      }
      if (!isActive()) {
        return { assistantMessage: null, discarded: true };
      }
      if (runScope.kind === "workspace") {
        const resolution = await reconcileWorkspaceAssistantOutcome(
          createAssistantConversationApi(runScope),
          options.conversationId,
          {
            status: "error",
            content: "",
            error: "Workspace assistant transport failed.",
            actions: [],
            workspaceTerminalIdentityValid: true,
          },
          new Set(options.knownMessageIds ?? []),
        );
        if (!isActive()) {
          return { assistantMessage: null, discarded: true };
        }
        const firstLine = options.message
          .split("\n")
          .map((line) => line.trim())
          .find(Boolean) ?? options.message;
        return {
          assistantMessage: resolution.assistantMessage,
          ...(resolution.status === "authoritative"
            ? { reconciledMessages: resolution.messages }
            : {}),
          liveWorkspaceActions: resolution.liveWorkspaceActions,
          newTitle: firstLine.length > 72
            ? `${firstLine.slice(0, 69)}...`
            : firstLine,
          conversationId: options.conversationId,
          terminalStatus: "error",
          terminalActions: resolution.liveWorkspaceActions,
        };
      }
      return {
        assistantMessage: {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `**Error:** ${
            error instanceof Error ? error.message : "Network error."
          }`,
          status: "error",
        },
        terminalStatus: "error",
        terminalActions: [],
      };
    } finally {
      if (activeRunRef.current === run) {
        activeRunRef.current = null;
        if (mountedRef.current && currentScopeKeyRef.current === runScopeKey) {
          setStreaming(false);
          setStreamingContent("");
        }
      }
    }
  }, [scope, scopeKey]);

  const cancelStream = useCallback(async () => {
    const run = activeRunRef.current;
    if (!run) {
      await pendingCancellationRef.current;
      return;
    }
    if (run.cancellationRequested) {
      await pendingCancellationRef.current;
      return;
    }
    // Keep the transport attached so a server-confirmed mutation receipt on
    // the cancelled terminal cannot be lost.
    run.cancellationRequested = true;
    const pending = requestAssistantCancellation(run.scope);
    pendingCancellationRef.current = pending;
    await pending;
    if (pendingCancellationRef.current === pending) {
      pendingCancellationRef.current = null;
    }
  }, []);

  const runIsInCurrentScope =
    activeRunRef.current?.scopeKey === scopeKey;

  return {
    streaming: runIsInCurrentScope ? streaming : false,
    streamingContent: runIsInCurrentScope ? streamingContent : "",
    streamMessage,
    cancelStream,
    detachActiveRun,
  };
}
