import type {
  AssistantScope,
  CodaScopeAction,
  Conversation,
  ConversationMessage,
  ConversationSummary,
  MessageContext,
  WorkspaceCurrentNoteMetadata,
  WorkspaceCurrentView,
  WorkspaceMessageContext,
  WorkspaceRetrievedSourceReference,
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
      return normalizeConversationList(await response.json(), scope);
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
      return normalizeConversationEnvelope(await response.json(), scope);
    },
    async readConversation(conversationId) {
      const response = await fetchImpl(
        endpoints.readConversation(conversationId),
      );
      if (!response.ok) return null;
      return normalizeConversationEnvelope(
        await response.json(),
        scope,
        conversationId,
      );
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
      return normalizeConversationEnvelope(
        await response.json(),
        scope,
        conversationId,
      );
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

function normalizeConversationList(
  value: unknown,
  expectedScope: AssistantScope,
): ConversationSummary[] {
  if (!isRecord(value)) return [];
  if (!Array.isArray(value.conversations)) return [];

  if (expectedScope.kind === "workspace") {
    if (!matchesExactScope(value.scope, expectedScope)
      || hasOwn(value, "projectId")) {
      return [];
    }
  } else {
    if ((hasOwn(value, "scope")
        && !matchesExactScope(value.scope, expectedScope))
      || (hasOwn(value, "projectId")
        && value.projectId !== expectedScope.projectId)) {
      return [];
    }
  }

  const summaries: ConversationSummary[] = [];
  const ids = new Set<string>();
  for (const candidate of value.conversations) {
    const summary = normalizeConversationSummary(candidate, expectedScope);
    if (!summary || ids.has(summary.id)) return [];
    ids.add(summary.id);
    summaries.push(summary);
  }
  return summaries.sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
  );
}

function normalizeConversationEnvelope(
  value: unknown,
  expectedScope: AssistantScope,
  expectedConversationId?: string,
): Conversation | null {
  if (!isRecord(value)) return null;
  return normalizeConversation(
    value.conversation,
    expectedScope,
    expectedConversationId,
  );
}

function normalizeConversation(
  value: unknown,
  expectedScope: AssistantScope,
  expectedConversationId?: string,
): Conversation | null {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || (expectedConversationId !== undefined
      && value.id !== expectedConversationId)
    || !isNonEmptyString(value.title)
    || typeof value.summary !== "string"
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || !isNullableNonEmptyString(value.defaultModelId)
    || !Array.isArray(value.messages)) {
    return null;
  }

  if (expectedScope.kind === "workspace") {
    if (value.version !== 1
      || !matchesExactScope(value.scope, expectedScope)
      || hasOwn(value, "projectId")
      || !isNonEmptyString(value.ownerId)) {
      return null;
    }
  } else if (value.version !== 2
    || value.projectId !== expectedScope.projectId
    || (hasOwn(value, "scope")
      && !matchesExactScope(value.scope, expectedScope))
    || (hasOwn(value, "ownerId") && !isNonEmptyString(value.ownerId))) {
    return null;
  }

  const messages: ConversationMessage[] = [];
  const messageIds = new Set<string>();
  for (const candidate of value.messages) {
    const message = normalizeConversationMessage(candidate, expectedScope);
    if (!message || messageIds.has(message.id)) return null;
    messageIds.add(message.id);
    messages.push(message);
  }

  const conversation: Conversation = {
    id: value.id,
    scope: canonicalScope(expectedScope),
    title: value.title,
    summary: value.summary,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    defaultModelId: value.defaultModelId,
    messages,
  };
  if (isNonEmptyString(value.ownerId)) {
    conversation.ownerId = value.ownerId;
  }
  if (expectedScope.kind === "project") {
    conversation.projectId = expectedScope.projectId;
    if (hasOwn(value, "epicId")) {
      if (!isNonEmptyString(value.epicId)) return null;
      conversation.epicId = value.epicId;
    }
  }
  return conversation;
}

function normalizeConversationMessage(
  value: unknown,
  expectedScope: AssistantScope,
): ConversationMessage | null {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || (value.role !== "user"
      && value.role !== "assistant"
      && value.role !== "system")
    || typeof value.content !== "string"
    || !isTimestamp(value.createdAt)
    || !(value.updatedAt === null || isTimestamp(value.updatedAt))
    || !isNullableNonEmptyString(value.modelId)
    || (value.status !== "complete"
      && value.status !== "streaming"
      && value.status !== "error")
    || !isRecord(value.metadata)) {
    return null;
  }

  const context = expectedScope.kind === "workspace"
    ? normalizeWorkspaceMessageContext(value.context)
    : normalizeProjectMessageContext(value.context);
  if (context === undefined) return null;
  const metadata = expectedScope.kind === "workspace"
    ? normalizeWorkspaceMessageMetadata(value.metadata)
    : { ...value.metadata };
  if (metadata === null) return null;

  return {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    modelId: value.modelId,
    status: value.status,
    context,
    metadata,
  };
}

function normalizeWorkspaceMessageMetadata(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  if (value.actions === undefined) return { ...value };
  if (!Array.isArray(value.actions) || value.actions.length > 25) return null;
  const actions: CodaScopeAction[] = [];
  const created = new Set<string>();
  for (const candidate of value.actions) {
    const action = normalizeWorkspaceMutationAction(candidate);
    if (!action) return null;
    if (action.type === "note_created") {
      if (created.has(action.attributes.stableId)) continue;
      created.add(action.attributes.stableId);
    }
    actions.push(action);
  }
  return { ...value, actions };
}

function normalizeWorkspaceMutationAction(
  value: unknown,
): CodaScopeAction | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["type", "attributes", "description"])
    || (value.type !== "note_created" && value.type !== "operation_completed")
    || !isRecord(value.attributes)
    || !isNonEmptyString(value.description)
    || value.description.length > 500) {
    return null;
  }
  const required = value.type === "note_created"
    ? ["stableId", "scope", "visibility", "path", "title", "contentHash"]
    : [
        "operation",
        "stableId",
        "scope",
        "visibility",
        "path",
        "title",
        "contentHash",
      ];
  const attributes = value.attributes;
  if (!hasOnlyKeys(attributes, required)
    || required.some((field) => !isNonEmptyString(attributes[field]))
    || attributes.scope !== "codascope"
    || (attributes.visibility !== "private"
      && attributes.visibility !== "shared")
    || !/^[a-f0-9]{32,128}$/i.test(String(attributes.contentHash))
    || !isContainedWorkspaceNotePath(attributes.path)) {
    return null;
  }
  return {
    type: value.type,
    attributes: { ...(attributes as Record<string, string>) },
    description: value.description,
  };
}

function normalizeConversationSummary(
  value: unknown,
  expectedScope: AssistantScope,
): ConversationSummary | null {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.title)
    || typeof value.summary !== "string"
    || !isNullableNonEmptyString(value.modelId)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || !Number.isSafeInteger(value.messageCount)
    || (value.messageCount as number) < 0) {
    return null;
  }

  if (expectedScope.kind === "workspace") {
    if (!matchesExactScope(value.scope, expectedScope)
      || hasOwn(value, "projectId")) {
      return null;
    }
  } else if ((hasOwn(value, "scope")
      && !matchesExactScope(value.scope, expectedScope))
    || (hasOwn(value, "projectId")
      && value.projectId !== expectedScope.projectId)) {
    return null;
  }
  if (hasOwn(value, "epicId") && !isNonEmptyString(value.epicId)) {
    return null;
  }

  return {
    id: value.id,
    scope: canonicalScope(expectedScope),
    title: value.title,
    summary: value.summary,
    modelId: value.modelId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    messageCount: value.messageCount as number,
  };
}

function normalizeProjectMessageContext(
  value: unknown,
): MessageContext | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isNonEmptyString(value.view)) return undefined;

  const context: MessageContext = { view: value.view };
  for (const field of [
    "topicId",
    "topicTitle",
    "filePath",
    "epicId",
    "epicTitle",
    "epicTab",
  ] as const) {
    if (!hasOwn(value, field)) continue;
    const candidate = value[field];
    if (candidate !== null && typeof candidate !== "string") return undefined;
    context[field] = candidate;
  }
  for (const field of ["projectName", "projectId"] as const) {
    if (!hasOwn(value, field)) continue;
    const candidate = value[field];
    if (typeof candidate !== "string") return undefined;
    context[field] = candidate;
  }
  if (hasOwn(value, "notePath")) {
    if (value.notePath !== null && typeof value.notePath !== "string") {
      return undefined;
    }
    context.notePath = value.notePath;
  }
  if (hasOwn(value, "noteScope")) {
    if (value.noteScope !== null
      && value.noteScope !== "codascope"
      && value.noteScope !== "project"
      && value.noteScope !== "epic") {
      return undefined;
    }
    context.noteScope = value.noteScope;
  }
  if (hasOwn(value, "noteVisibility")) {
    if (value.noteVisibility !== null
      && value.noteVisibility !== "private"
      && value.noteVisibility !== "shared") {
      return undefined;
    }
    context.noteVisibility = value.noteVisibility;
  }
  if (hasOwn(value, "recentViews")) {
    if (!Array.isArray(value.recentViews)) return undefined;
    const recentViews: Array<{ view: string; label: string }> = [];
    for (const candidate of value.recentViews) {
      if (!isRecord(candidate)
        || !isNonEmptyString(candidate.view)
        || typeof candidate.label !== "string") {
        return undefined;
      }
      recentViews.push({ view: candidate.view, label: candidate.label });
    }
    context.recentViews = recentViews;
  }
  return context;
}

function normalizeWorkspaceMessageContext(
  value: unknown,
): WorkspaceMessageContext | undefined {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      "assistantScope",
      "currentNote",
      "explicitlyReferencedProjectIds",
      "currentView",
      "retrievedSources",
    ])
    || !matchesExactScope(value.assistantScope, { kind: "workspace" })
    || !Array.isArray(value.explicitlyReferencedProjectIds)
    || value.explicitlyReferencedProjectIds.length > 25) {
    return undefined;
  }

  const projectIds: string[] = [];
  const seenProjectIds = new Set<string>();
  for (const candidate of value.explicitlyReferencedProjectIds) {
    if (!isNonEmptyString(candidate) || seenProjectIds.has(candidate)) {
      return undefined;
    }
    seenProjectIds.add(candidate);
    projectIds.push(candidate);
  }

  const currentView = normalizeWorkspaceCurrentView(value.currentView);
  if (!currentView) return undefined;
  const context: WorkspaceMessageContext = {
    assistantScope: { kind: "workspace" },
    explicitlyReferencedProjectIds: projectIds,
    currentView,
  };

  if (hasOwn(value, "currentNote")) {
    if (value.currentNote === null) {
      context.currentNote = null;
    } else {
      const currentNote = normalizeWorkspaceCurrentNote(value.currentNote);
      if (!currentNote) return undefined;
      context.currentNote = currentNote;
    }
  }
  if (hasOwn(value, "retrievedSources")) {
    const sources = normalizeWorkspaceRetrievedSources(value.retrievedSources);
    if (!sources) return undefined;
    context.retrievedSources = sources;
  }
  return context;
}

function normalizeWorkspaceCurrentView(
  value: unknown,
): WorkspaceCurrentView | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["view", "identity", "label"])
    || !isNonEmptyString(value.view)) {
    return null;
  }
  const currentView: WorkspaceCurrentView = { view: value.view };
  for (const field of ["identity", "label"] as const) {
    if (!hasOwn(value, field)) continue;
    const candidate = value[field];
    if (candidate !== null && typeof candidate !== "string") return null;
    currentView[field] = candidate;
  }
  return currentView;
}

function normalizeWorkspaceCurrentNote(
  value: unknown,
): WorkspaceCurrentNoteMetadata | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      "stableId",
      "scope",
      "path",
      "title",
      "visibility",
      "contentHash",
    ])
    || !isNonEmptyString(value.stableId)
    || value.scope !== "codascope"
    || !isNonEmptyString(value.path)
    || !isNonEmptyString(value.title)
    || (value.visibility !== "private" && value.visibility !== "shared")) {
    return null;
  }
  const note: WorkspaceCurrentNoteMetadata = {
    stableId: value.stableId,
    scope: "codascope",
    path: value.path,
    title: value.title,
    visibility: value.visibility,
  };
  if (hasOwn(value, "contentHash")) {
    if (!isNonEmptyString(value.contentHash)) return null;
    note.contentHash = value.contentHash;
  }
  return note;
}

function normalizeWorkspaceRetrievedSources(
  value: unknown,
): WorkspaceRetrievedSourceReference[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const sources: WorkspaceRetrievedSourceReference[] = [];
  const identities = new Set<string>();
  for (const candidate of value) {
    const source = normalizeWorkspaceRetrievedSource(candidate);
    if (!source) return null;
    const identity = source.kind === "project_wiki"
      ? `${source.kind}\0${source.retrieval}\0${source.projectId}\0${source.topicId}`
      : `${source.kind}\0${source.retrieval}\0${source.projectId}\0${source.codeMapId}`;
    if (identities.has(identity)) return null;
    identities.add(identity);
    sources.push(source);
  }
  return sources;
}

function normalizeWorkspaceRetrievedSource(
  value: unknown,
): WorkspaceRetrievedSourceReference | null {
  if (!isRecord(value)) return null;
  if (value.kind === "project_wiki") {
    if (!hasOnlyKeys(value, [
      "kind",
      "retrieval",
      "projectId",
      "projectName",
      "topicId",
      "topicTitle",
      "topicUpdatedAt",
      "lastWikiBuildAt",
    ])
      || (value.retrieval !== "direct" && value.retrieval !== "search")
      || !isNonEmptyString(value.projectId)
      || !isNonEmptyString(value.projectName)
      || !isNonEmptyString(value.topicId)
      || !isNonEmptyString(value.topicTitle)
      || !isTimestamp(value.topicUpdatedAt)
      || !(value.lastWikiBuildAt === null
        || isTimestamp(value.lastWikiBuildAt))) {
      return null;
    }
    return {
      kind: "project_wiki",
      retrieval: value.retrieval,
      projectId: value.projectId,
      projectName: value.projectName,
      topicId: value.topicId,
      topicTitle: value.topicTitle,
      topicUpdatedAt: value.topicUpdatedAt,
      lastWikiBuildAt: value.lastWikiBuildAt,
    };
  }
  if (value.kind === "code_map") {
    if (!hasOnlyKeys(value, [
      "kind",
      "retrieval",
      "projectId",
      "projectName",
      "codeMapId",
      "generatedAt",
      "lastWikiBuildAt",
    ])
      || value.retrieval !== "direct"
      || !isNonEmptyString(value.projectId)
      || !isNonEmptyString(value.projectName)
      || !isNonEmptyString(value.codeMapId)
      || !(value.generatedAt === null || isTimestamp(value.generatedAt))
      || !(value.lastWikiBuildAt === null
        || isTimestamp(value.lastWikiBuildAt))) {
      return null;
    }
    return {
      kind: "code_map",
      retrieval: "direct",
      projectId: value.projectId,
      projectName: value.projectName,
      codeMapId: value.codeMapId,
      generatedAt: value.generatedAt,
      lastWikiBuildAt: value.lastWikiBuildAt,
    };
  }
  return null;
}

function matchesExactScope(
  value: unknown,
  expectedScope: AssistantScope,
): boolean {
  if (!isRecord(value)) return false;
  if (expectedScope.kind === "workspace") {
    return hasOnlyKeys(value, ["kind"]) && value.kind === "workspace";
  }
  return hasOnlyKeys(value, ["kind", "projectId"])
    && value.kind === "project"
    && value.projectId === expectedScope.projectId;
}

function canonicalScope(scope: AssistantScope): AssistantScope {
  return scope.kind === "workspace"
    ? { kind: "workspace" }
    : { kind: "project", projectId: scope.projectId };
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isNullableNonEmptyString(
  value: unknown,
): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isContainedWorkspaceNotePath(value: unknown): value is string {
  if (!isNonEmptyString(value)
    || value.startsWith("/")
    || value.startsWith("\\")
    || /^[a-z]:[\\/]/i.test(value)
    || value.includes("\\")
    || value.includes("\u0000")) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) =>
    segment.length > 0 && segment !== "." && segment !== "..");
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
