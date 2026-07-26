import type {
  AssistantScope,
  Conversation,
  ConversationMessage,
  ConversationSummary,
} from "./codaScopeTypes";
import { getAssistantScopeKey } from "./assistantScope";

export interface AssistantEndpointAdapter {
  scope: AssistantScope;
  scopeKey: string;
  listConversations: () => string;
  createConversation: () => string;
  readConversation: (conversationId: string) => string;
  updateConversation: (conversationId: string) => string;
  deleteConversation: (conversationId: string) => string;
  sendMessage: (conversationId: string) => string;
  uploadImage: (conversationId: string) => string;
  displayImage: (conversationId: string, filename: string) => string;
  cancelRun: () => string;
}

export function createAssistantEndpointAdapter(
  scope: AssistantScope,
): AssistantEndpointAdapter {
  const conversations = scope.kind === "workspace"
    ? "/api/codascope/workspace/conversations"
    : `/api/codascope/projects/${scope.projectId}/conversations`;
  const cancel = scope.kind === "workspace"
    ? "/api/codascope/workspace/assistant/cancel"
    : `/api/codascope/projects/${scope.projectId}/assistant/cancel`;
  const conversation = (conversationId: string) =>
    `${conversations}/${conversationId}`;

  return {
    scope,
    scopeKey: getAssistantScopeKey(scope),
    listConversations: () => conversations,
    createConversation: () => conversations,
    readConversation: conversation,
    updateConversation: conversation,
    deleteConversation: conversation,
    sendMessage: (conversationId) => `${conversation(conversationId)}/messages`,
    uploadImage: (conversationId) => `${conversation(conversationId)}/images`,
    displayImage: (conversationId, filename) =>
      `${conversation(conversationId)}/images/${filename}`,
    cancelRun: () => cancel,
  };
}

export interface AssistantConversationApi {
  endpoints: AssistantEndpointAdapter;
  listConversations: () => Promise<ConversationSummary[]>;
  createConversation: (input: {
    title?: string;
    modelId?: string | null;
  }) => Promise<Conversation | null>;
  readConversation: (conversationId: string) => Promise<Conversation | null>;
  updateConversation: (
    conversationId: string,
    input: { title?: string; summary?: string },
  ) => Promise<Conversation | null>;
  deleteConversation: (conversationId: string) => Promise<boolean>;
  uploadImage: (
    conversationId: string,
    formData: FormData,
  ) => Promise<{ path: string; filename: string } | null>;
}

export function createAssistantConversationApi(
  scope: AssistantScope,
  fetchImpl: typeof fetch = fetch,
): AssistantConversationApi {
  const endpoints = createAssistantEndpointAdapter(scope);
  return {
    endpoints,
    async listConversations() {
      const response = await fetchImpl(endpoints.listConversations());
      if (!response.ok) return [];
      const payload = await response.json() as { conversations?: unknown };
      if (!Array.isArray(payload.conversations)) return [];
      return payload.conversations
        .map(normalizeConversationSummary)
        .filter((value): value is ConversationSummary => value !== null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async createConversation(input) {
      const response = await fetchImpl(endpoints.createConversation(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(input.title ? { title: input.title } : {}),
          ...(input.modelId ? { modelId: input.modelId } : {}),
        }),
      });
      if (!response.ok) return null;
      return normalizeConversationEnvelope(await response.json());
    },
    async readConversation(conversationId) {
      const response = await fetchImpl(
        endpoints.readConversation(conversationId),
      );
      if (!response.ok) return null;
      return normalizeConversationEnvelope(await response.json());
    },
    async updateConversation(conversationId, input) {
      const response = await fetchImpl(
        endpoints.updateConversation(conversationId),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) return null;
      return normalizeConversationEnvelope(await response.json());
    },
    async deleteConversation(conversationId) {
      const response = await fetchImpl(
        endpoints.deleteConversation(conversationId),
        { method: "DELETE" },
      );
      return response.ok;
    },
    async uploadImage(conversationId, formData) {
      const response = await fetchImpl(endpoints.uploadImage(conversationId), {
        method: "POST",
        body: formData,
      });
      if (!response.ok) return null;
      const payload = await response.json() as Record<string, unknown>;
      return typeof payload.path === "string"
        && typeof payload.filename === "string"
        ? { path: payload.path, filename: payload.filename }
        : null;
    },
  };
}

export function restoreAssistantMessages(
  conversation: Conversation,
  endpoints: AssistantEndpointAdapter,
): import("./codaScopeTypes").AssistantChatMessage[] {
  return conversation.messages
    .filter((message) =>
      message.role === "user" || message.role === "assistant")
    .map((message) => {
      const metadataImages = Array.isArray(message.metadata?.images)
        ? message.metadata.images
        : [];
      const images = metadataImages.flatMap((candidate) => {
        if (!isRecord(candidate) || typeof candidate.filename !== "string") {
          return [];
        }
        return [{
          url: endpoints.displayImage(conversation.id, candidate.filename),
          filename: candidate.filename,
        }];
      });
      return {
        id: message.id,
        role: message.role as "user" | "assistant",
        content: message.content,
        status: message.status ?? "complete",
        createdAt: message.createdAt,
        metadata: message.metadata,
        ...(images.length > 0 ? { images } : {}),
      };
    });
}

function normalizeConversationEnvelope(value: unknown): Conversation | null {
  if (!isRecord(value)) return null;
  return normalizeConversation(value.conversation);
}

function normalizeConversation(value: unknown): Conversation | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.title !== "string"
    || !Array.isArray(value.messages)) {
    return null;
  }
  const messages = value.messages
    .map(normalizeConversationMessage)
    .filter((message): message is ConversationMessage => message !== null);
  return {
    ...(value as unknown as Conversation),
    id: value.id,
    title: value.title,
    summary: typeof value.summary === "string" ? value.summary : "",
    messages,
  };
}

function normalizeConversationMessage(
  value: unknown,
): ConversationMessage | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || (value.role !== "user"
      && value.role !== "assistant"
      && value.role !== "system")
    || typeof value.content !== "string") {
    return null;
  }
  return value as unknown as ConversationMessage;
}

function normalizeConversationSummary(
  value: unknown,
): ConversationSummary | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.title !== "string"
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string") {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    summary: typeof value.summary === "string" ? value.summary : "",
    modelId: typeof value.modelId === "string" ? value.modelId : null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    messageCount: typeof value.messageCount === "number"
      ? value.messageCount
      : 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
