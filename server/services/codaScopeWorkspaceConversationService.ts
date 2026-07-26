/* ── CodaScope: Workspace Conversation Service ──────────────────────
   Durable actor-owned workspace conversations stored outside every project.

   <projectsRoot>/_workspace/conversations/<sha256(actorId)>/
     conversations.json
     <conversation-id>.json
     <conversation-id>/images/*
   ──────────────────────────────────────────────────────────────────── */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  CodaScopePersistence,
  CodaScopePersistenceCorruptError,
  CodaScopePersistenceError,
  codaScopePersistence,
} from "./codaScopePersistence.js";
import {
  assertSafePathSegment,
  assertStrictDescendant,
  resolveContainedRelativePath,
} from "./codaScopePathSafety.js";
import {
  validateWorkspaceRetrievedSources,
  type WorkspaceRetrievedSourceReference,
} from "./codaScopeWorkspaceProvenance.js";

const WORKSPACE_CONVERSATION_VERSION = 1;
const MAX_CONVERSATIONS = 100;
const MAX_MESSAGES = 500;
const MAX_TITLE = 72;
const MAX_SUMMARY = 240;
const MAX_MESSAGE_CONTENT = 200_000;
const MAX_CONTEXT_TEXT = 1_000;
const MAX_REFERENCED_PROJECTS = 25;
const MAX_OWNER_ID = 1_000;
const STALE_STREAMING_MS = 10 * 60 * 1_000;

export interface WorkspaceAssistantScope {
  kind: "workspace";
}

export interface WorkspaceCurrentNoteSnapshot {
  stableId: string;
  scope: "codascope";
  path: string;
  title: string;
  visibility: "private" | "shared";
  contentHash?: string;
}

export interface WorkspaceCurrentViewSnapshot {
  view: string;
  identity?: string | null;
  label?: string | null;
}

export interface WorkspaceMessageContext {
  assistantScope: WorkspaceAssistantScope;
  currentNote?: WorkspaceCurrentNoteSnapshot | null;
  explicitlyReferencedProjectIds: string[];
  currentView: WorkspaceCurrentViewSnapshot;
  retrievedSources?: WorkspaceRetrievedSourceReference[];
}

export type WorkspaceMessageStatus = "complete" | "streaming" | "error";

export interface WorkspaceConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  updatedAt: string | null;
  modelId: string | null;
  status: WorkspaceMessageStatus;
  context: WorkspaceMessageContext;
  metadata: Record<string, unknown>;
}

export interface WorkspaceConversation {
  version: 1;
  id: string;
  scope: WorkspaceAssistantScope;
  ownerId: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  defaultModelId: string | null;
  messages: WorkspaceConversationMessage[];
}

export interface WorkspaceConversationSummary {
  id: string;
  scope: WorkspaceAssistantScope;
  title: string;
  summary: string;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface WorkspaceConversationIndexRecord extends WorkspaceConversationSummary {
  ownerId: string;
  file: string;
}

interface WorkspaceConversationIndex {
  version: 1;
  scope: WorkspaceAssistantScope;
  ownerId: string;
  conversations: WorkspaceConversationIndexRecord[];
}

interface OwnedState {
  actorDir: string;
  index: WorkspaceConversationIndex;
  record: WorkspaceConversationIndexRecord;
  conversation: WorkspaceConversation;
}

export function createWorkspaceMessageContext(
  value: unknown,
  retrievedSources?: readonly WorkspaceRetrievedSourceReference[],
): WorkspaceMessageContext {
  const source = value === undefined || value === null ? {} : requireRecord(value);
  assertAllowedFields(source, [
    "assistantScope",
    "currentNote",
    "explicitlyReferencedProjectIds",
    "currentView",
  ]);
  if (source.assistantScope !== undefined) validateWorkspaceScope(source.assistantScope);

  const referenced = source.explicitlyReferencedProjectIds === undefined
    ? []
    : validateReferencedProjects(source.explicitlyReferencedProjectIds);
  const currentView = source.currentView === undefined
    ? { view: "workspace" }
    : validateCurrentView(source.currentView);
  const context: WorkspaceMessageContext = {
    assistantScope: Object.freeze({ kind: "workspace" }),
    explicitlyReferencedProjectIds: referenced,
    currentView,
  };
  if (source.currentNote !== undefined) {
    context.currentNote = source.currentNote === null
      ? null
      : validateCurrentNote(source.currentNote);
  }
  if (retrievedSources !== undefined) {
    context.retrievedSources = validateWorkspaceRetrievedSources([...retrievedSources]);
  }
  return context;
}

export class CodaScopeWorkspaceConversationService {
  private readonly mutationQueues = new Map<string, Promise<unknown>>();
  private readonly activeConversationRuns = new Set<string>();
  private disposed = false;

  constructor(
    private readonly root: string,
    private readonly persistence: CodaScopePersistence = codaScopePersistence,
  ) {}

  getRoot(): string {
    return this.root;
  }

  getActorStorageDirectory(actorId: string): string {
    this.assertActive();
    const ownerId = validateOwner(actorId);
    return path.join(
      this.root,
      "_workspace",
      "conversations",
      createHash("sha256").update(ownerId).digest("hex"),
    );
  }

  getConversationAssetsDirectory(actorId: string, conversationId: string): string {
    const actorDir = this.getActorStorageDirectory(actorId);
    const id = assertSafePathSegment(conversationId, "conversation ID");
    return assertStrictDescendant(
      actorDir,
      path.join(actorDir, id),
      "workspace conversation assets directory",
    );
  }

  tryBeginConversationRun(actorId: string, conversationId: string): boolean {
    this.assertActive();
    const key = this.runKey(actorId, conversationId);
    if (this.activeConversationRuns.has(key)) return false;
    this.activeConversationRuns.add(key);
    return true;
  }

  endConversationRun(actorId: string, conversationId: string): void {
    if (this.disposed) return;
    this.activeConversationRuns.delete(this.runKey(actorId, conversationId));
  }

  dispose(): void {
    this.disposed = true;
    this.activeConversationRuns.clear();
    this.mutationQueues.clear();
  }

  async listConversations(actorId: string): Promise<WorkspaceConversationSummary[]> {
    this.assertActive();
    const ownerId = validateOwner(actorId);
    const index = await this.readIndex(ownerId);
    if (!index) return [];
    return index.conversations.map(publicSummary);
  }

  async createConversation(
    actorId: string,
    options: { title?: string; modelId?: string } = {},
  ): Promise<WorkspaceConversation> {
    this.assertActive();
    const ownerId = validateOwner(actorId);
    return this.withMutation(ownerId, async () => {
      const index = await this.readIndex(ownerId);
      if (!index) throw new Error("Workspace conversation store is unavailable.");
      if (index.conversations.length >= MAX_CONVERSATIONS) {
        throw new Error("Workspace conversation limit reached.");
      }
      const createdAt = nowIso();
      const conversation: WorkspaceConversation = {
        version: WORKSPACE_CONVERSATION_VERSION,
        id: createId("conv"),
        scope: { kind: "workspace" },
        ownerId,
        title: boundedText(options.title, MAX_TITLE) || "New conversation",
        summary: "",
        createdAt,
        updatedAt: createdAt,
        defaultModelId: optionalModel(options.modelId),
        messages: [],
      };
      const record = indexRecord(conversation);
      const nextIndex: WorkspaceConversationIndex = {
        ...index,
        conversations: [record, ...index.conversations],
      };
      await this.publishConversationAndIndex(
        ownerId,
        record,
        null,
        conversation,
        nextIndex,
      );
      return conversation;
    });
  }

  async readConversation(
    actorId: string,
    conversationId: string,
  ): Promise<WorkspaceConversation | null> {
    this.assertActive();
    const ownerId = validateOwner(actorId);
    assertSafePathSegment(conversationId, "conversation ID");
    const state = await this.readOwnedState(ownerId, conversationId);
    return state?.conversation ?? null;
  }

  async updateConversation(
    actorId: string,
    conversationId: string,
    patch: { title?: string; summary?: string },
  ): Promise<WorkspaceConversation | null> {
    this.assertActive();
    const ownerId = validateOwner(actorId);
    return this.withMutation(ownerId, async () => {
      const state = await this.readOwnedState(ownerId, conversationId);
      if (!state) return null;
      const next: WorkspaceConversation = {
        ...state.conversation,
        title: patch.title === undefined
          ? state.conversation.title
          : boundedText(patch.title, MAX_TITLE) || state.conversation.title,
        summary: patch.summary === undefined
          ? state.conversation.summary
          : boundedText(patch.summary, MAX_SUMMARY),
        updatedAt: nowIso(),
      };
      await this.persistState(state, next);
      return next;
    });
  }

  async appendMessage(
    actorId: string,
    conversationId: string,
    message: Partial<WorkspaceConversationMessage>,
  ): Promise<WorkspaceConversation | null> {
    this.assertActive();
    const ownerId = validateOwner(actorId);
    return this.withMutation(ownerId, async () => {
      const state = await this.readOwnedState(ownerId, conversationId);
      if (!state) return null;
      if (state.conversation.messages.length >= MAX_MESSAGES) {
        throw new Error("Workspace conversation message limit reached.");
      }
      const normalized = normalizeNewMessage(message);
      if (state.conversation.messages.some((candidate) => candidate.id === normalized.id)) {
        throw new Error("Duplicate workspace conversation message ID.");
      }
      const firstUser = state.conversation.messages.some((candidate) => candidate.role === "user");
      const firstAssistant = state.conversation.messages.some(
        (candidate) => candidate.role === "assistant",
      );
      const next: WorkspaceConversation = {
        ...state.conversation,
        title: state.conversation.title === "New conversation"
          && normalized.role === "user"
          && !firstUser
          ? titleFromContent(normalized.content)
          : state.conversation.title,
        summary: !state.conversation.summary
          && normalized.role === "assistant"
          && !firstAssistant
          ? summaryFromContent(normalized.content)
          : state.conversation.summary,
        defaultModelId: normalized.modelId ?? state.conversation.defaultModelId,
        updatedAt: nowIso(),
        messages: [...state.conversation.messages, normalized],
      };
      await this.persistState(state, next);
      return next;
    });
  }

  async completeAssistantMessage(
    actorId: string,
    conversationId: string,
    messageId: string,
    completion: {
      content: string;
      retrievedSources: readonly WorkspaceRetrievedSourceReference[];
    },
  ): Promise<WorkspaceConversation | null> {
    this.assertActive();
    return this.transitionAssistantMessage(
      actorId,
      conversationId,
      messageId,
      "complete",
      completion.content,
      completion.retrievedSources,
    );
  }

  async recordAssistantMessageError(
    actorId: string,
    conversationId: string,
    messageId: string,
    content: string,
  ): Promise<WorkspaceConversation | null> {
    this.assertActive();
    return this.transitionAssistantMessage(
      actorId,
      conversationId,
      messageId,
      "error",
      content,
      [],
    );
  }

  async deleteConversation(actorId: string, conversationId: string): Promise<boolean> {
    this.assertActive();
    const ownerId = validateOwner(actorId);
    return this.withMutation(ownerId, async () => {
      const state = await this.readOwnedState(ownerId, conversationId);
      if (!state) return false;
      const nextIndex: WorkspaceConversationIndex = {
        ...state.index,
        conversations: state.index.conversations.filter(
          (candidate) => candidate.id !== conversationId,
        ),
      };
      await this.writeIndex(state.actorDir, nextIndex);
      const recordPath = this.recordPath(state.actorDir, state.record.file);
      try {
        await fs.unlink(recordPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          try {
            await this.writeIndex(state.actorDir, state.index);
          } catch {
            throw new CodaScopePersistenceError({
              storage: "workspace_conversation_index",
              recovery: "operator_required",
            });
          }
          throw new CodaScopePersistenceError({
            storage: "workspace_conversation",
          });
        }
      }
      const assets = this.getConversationAssetsDirectory(ownerId, conversationId);
      await fs.rm(assets, { recursive: true, force: true }).catch(() => undefined);
      return true;
    });
  }

  private async transitionAssistantMessage(
    actorId: string,
    conversationId: string,
    messageId: string,
    status: "complete" | "error",
    content: string,
    retrievedSources: readonly WorkspaceRetrievedSourceReference[],
  ): Promise<WorkspaceConversation | null> {
    const ownerId = validateOwner(actorId);
    return this.withMutation(ownerId, async () => {
      const state = await this.readOwnedState(ownerId, conversationId);
      if (!state) return null;
      const messageIndex = state.conversation.messages.findIndex(
        (candidate) =>
          candidate.id === messageId
          && candidate.role === "assistant"
          && (
            candidate.status === "streaming"
            || (status === "error" && candidate.status === "complete")
          ),
      );
      if (messageIndex < 0) return null;
      const messages = [...state.conversation.messages];
      const placeholder = messages[messageIndex];
      messages[messageIndex] = {
        ...placeholder,
        content: boundedRequiredText(content, MAX_MESSAGE_CONTENT, true),
        status,
        updatedAt: nowIso(),
        context: createWorkspaceMessageContext(
          {
            currentNote: placeholder.context.currentNote,
            explicitlyReferencedProjectIds:
              placeholder.context.explicitlyReferencedProjectIds,
            currentView: placeholder.context.currentView,
          },
          status === "complete" ? retrievedSources : [],
        ),
      };
      const next: WorkspaceConversation = {
        ...state.conversation,
        summary: status === "complete" && !state.conversation.summary
          ? summaryFromContent(content)
          : state.conversation.summary,
        updatedAt: nowIso(),
        messages,
      };
      await this.persistState(state, next);
      return next;
    });
  }

  private runKey(actorId: string, conversationId: string): string {
    return `${validateOwner(actorId)}\u0000${assertSafePathSegment(
      conversationId,
      "conversation ID",
    )}`;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("Workspace conversation service has been disposed.");
    }
  }

  private async withMutation<T>(
    ownerId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = actorStorageKey(ownerId);
    const previous = this.mutationQueues.get(key) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(operation);
    this.mutationQueues.set(key, queued);
    try {
      return await queued;
    } finally {
      if (this.mutationQueues.get(key) === queued) this.mutationQueues.delete(key);
    }
  }

  private async readOwnedState(
    ownerId: string,
    conversationId: string,
  ): Promise<OwnedState | null> {
    assertSafePathSegment(conversationId, "conversation ID");
    const actorDir = this.getActorStorageDirectory(ownerId);
    const index = await this.readIndex(ownerId);
    if (!index) return null;
    const record = index.conversations.find(
      (candidate) => candidate.id === conversationId,
    );
    if (
      !record
      || record.ownerId !== ownerId
      || record.scope.kind !== "workspace"
    ) return null;
    const conversation = await this.persistence.readJson(
      this.recordPath(actorDir, record.file),
      {
        context: { storage: "workspace_conversation" },
        validate: (value) => validateConversation(value, record),
      },
    );
    return { actorDir, index, record, conversation };
  }

  private async readIndex(
    ownerId: string,
  ): Promise<WorkspaceConversationIndex | null> {
    const actorDir = this.getActorStorageDirectory(ownerId);
    const indexPath = path.join(actorDir, "conversations.json");
    let raw: string;
    try {
      raw = await fs.readFile(indexPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new CodaScopePersistenceError({
          storage: "workspace_conversation_index",
        });
      }
      const emptyIndex: WorkspaceConversationIndex = {
        version: WORKSPACE_CONVERSATION_VERSION,
        scope: { kind: "workspace" },
        ownerId,
        conversations: [],
      };
      await this.validateStoreIntegrity(actorDir, emptyIndex, true);
      return emptyIndex;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CodaScopePersistenceCorruptError({
        storage: "workspace_conversation_index",
      });
    }
    if (!isRecord(parsed)) {
      throw new CodaScopePersistenceCorruptError({
        storage: "workspace_conversation_index",
      });
    }
    if (
      parsed.ownerId !== ownerId
      || !isRecord(parsed.scope)
      || parsed.scope.kind !== "workspace"
    ) {
      return null;
    }
    let index: WorkspaceConversationIndex;
    try {
      index = validateIndex(parsed);
    } catch {
      throw new CodaScopePersistenceCorruptError({
        storage: "workspace_conversation_index",
      });
    }
    await this.validateStoreIntegrity(actorDir, index);
    return index;
  }

  private async validateStoreIntegrity(
    actorDir: string,
    index: WorkspaceConversationIndex,
    allowMissingDirectory = false,
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(actorDir, { withFileTypes: true });
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT"
        && allowMissingDirectory
      ) return;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new CodaScopePersistenceCorruptError({
          storage: "workspace_conversation_index",
        });
      }
      throw new CodaScopePersistenceError({
        storage: "workspace_conversation_index",
      });
    }

    const referencedFiles = new Set(index.conversations.map((record) => record.file));
    const presentRecordFiles = new Set<string>();
    for (const entry of entries) {
      if (entry.isFile() && entry.name === "conversations.json") continue;
      if (entry.isFile() && isValidAtomicArtifact(entry.name)) continue;
      if (entry.isDirectory() && isValidConversationAssetsDirectory(entry.name)) {
        continue;
      }
      if (!entry.isFile()) {
        throw new CodaScopePersistenceCorruptError({
          storage: "workspace_conversation_index",
        });
      }
      const candidate = canonicalConversationRecordFilename(entry.name);
      if (!candidate) {
        throw new CodaScopePersistenceCorruptError({
          storage: "workspace_conversation_index",
        });
      }
      presentRecordFiles.add(candidate);
    }

    if (
      presentRecordFiles.size !== referencedFiles.size
      || [...presentRecordFiles].some((file) => !referencedFiles.has(file))
      || [...referencedFiles].some((file) => !presentRecordFiles.has(file))
    ) {
      throw new CodaScopePersistenceCorruptError({
        storage: "workspace_conversation_index",
      });
    }

    await Promise.all(index.conversations.map(async (record) => {
      await this.persistence.readJson(
        this.recordPath(actorDir, record.file),
        {
          context: { storage: "workspace_conversation" },
          validate: (value) => validateConversation(value, record),
        },
      );
    }));
  }

  private async persistState(
    state: OwnedState,
    conversation: WorkspaceConversation,
  ): Promise<void> {
    const nextIndex: WorkspaceConversationIndex = {
      ...state.index,
      conversations: [
        indexRecord(conversation),
        ...state.index.conversations.filter(
          (candidate) => candidate.id !== conversation.id,
        ),
      ],
    };
    await this.publishConversationAndIndex(
      conversation.ownerId,
      state.record,
      state.conversation,
      conversation,
      nextIndex,
    );
  }

  private async publishConversationAndIndex(
    ownerId: string,
    record: WorkspaceConversationIndexRecord,
    previous: WorkspaceConversation | null,
    next: WorkspaceConversation,
    nextIndex: WorkspaceConversationIndex,
  ): Promise<void> {
    const actorDir = this.getActorStorageDirectory(ownerId);
    const recordPath = this.recordPath(actorDir, record.file);
    await this.persistence.writeJson(
      recordPath,
      next,
      { storage: "workspace_conversation" },
    );
    try {
      await this.writeIndex(actorDir, nextIndex);
    } catch (error) {
      try {
        if (previous) {
          await this.persistence.writeJson(
            recordPath,
            previous,
            { storage: "workspace_conversation" },
          );
        } else {
          await fs.unlink(recordPath);
        }
      } catch {
        throw new CodaScopePersistenceError({
          storage: "workspace_conversation",
          recovery: "operator_required",
        });
      }
      throw error;
    }
  }

  private async writeIndex(
    actorDir: string,
    index: WorkspaceConversationIndex,
  ): Promise<void> {
    await this.persistence.writeJson(
      path.join(actorDir, "conversations.json"),
      index,
      { storage: "workspace_conversation_index" },
    );
  }

  private recordPath(actorDir: string, file: string): string {
    const safe = assertSafePathSegment(file, "workspace conversation file");
    if (safe === "conversations.json" || !safe.endsWith(".json")) {
      throw new Error("Invalid workspace conversation file");
    }
    return assertStrictDescendant(
      actorDir,
      path.join(actorDir, safe),
      "workspace conversation file",
    );
  }
}

function validateIndex(value: unknown): WorkspaceConversationIndex {
  const source = requireRecord(value);
  assertAllowedFields(source, ["version", "scope", "ownerId", "conversations"]);
  if (source.version !== WORKSPACE_CONVERSATION_VERSION) {
    throw new Error("Unsupported workspace conversation index");
  }
  const scope = validateWorkspaceScope(source.scope);
  const ownerId = validateOwner(source.ownerId);
  if (!Array.isArray(source.conversations) || source.conversations.length > MAX_CONVERSATIONS) {
    throw new Error("Invalid workspace conversation index records");
  }
  const conversations = source.conversations.map(validateIndexRecord);
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const record of conversations) {
    if (
      record.ownerId !== ownerId
      || record.scope.kind !== scope.kind
      || ids.has(record.id)
      || files.has(record.file)
    ) throw new Error("Workspace conversation index disagreement");
    ids.add(record.id);
    files.add(record.file);
  }
  return {
    version: WORKSPACE_CONVERSATION_VERSION,
    scope,
    ownerId,
    conversations: conversations.sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    ),
  };
}

function validateIndexRecord(value: unknown): WorkspaceConversationIndexRecord {
  const source = requireRecord(value);
  assertAllowedFields(source, [
    "id",
    "scope",
    "ownerId",
    "file",
    "title",
    "summary",
    "modelId",
    "createdAt",
    "updatedAt",
    "messageCount",
  ]);
  const id = safeId(source.id, "conversation ID");
  const file = boundedRequiredText(source.file, 300);
  assertSafePathSegment(file, "workspace conversation file");
  if (file !== `${id}.json`) throw new Error("Workspace conversation file mismatch");
  if (!Number.isSafeInteger(source.messageCount)
    || (source.messageCount as number) < 0
    || (source.messageCount as number) > MAX_MESSAGES) {
    throw new Error("Invalid workspace conversation message count");
  }
  return {
    id,
    scope: validateWorkspaceScope(source.scope),
    ownerId: validateOwner(source.ownerId),
    file,
    title: boundedRequiredText(source.title, MAX_TITLE),
    summary: boundedRequiredText(source.summary, MAX_SUMMARY, true),
    modelId: nullableModel(source.modelId),
    createdAt: validateTimestamp(source.createdAt),
    updatedAt: validateTimestamp(source.updatedAt),
    messageCount: source.messageCount as number,
  };
}

function validateConversation(
  value: unknown,
  record: WorkspaceConversationIndexRecord,
): WorkspaceConversation {
  const source = requireRecord(value);
  assertAllowedFields(source, [
    "version",
    "id",
    "scope",
    "ownerId",
    "title",
    "summary",
    "createdAt",
    "updatedAt",
    "defaultModelId",
    "messages",
  ]);
  if (source.version !== WORKSPACE_CONVERSATION_VERSION) {
    throw new Error("Unsupported workspace conversation");
  }
  const id = safeId(source.id, "conversation ID");
  const scope = validateWorkspaceScope(source.scope);
  const ownerId = validateOwner(source.ownerId);
  if (!Array.isArray(source.messages) || source.messages.length > MAX_MESSAGES) {
    throw new Error("Invalid workspace conversation messages");
  }
  const messages = source.messages.map(validatePersistedMessage);
  const ids = new Set<string>();
  for (const message of messages) {
    if (ids.has(message.id)) throw new Error("Duplicate workspace message ID");
    ids.add(message.id);
  }
  const conversation: WorkspaceConversation = {
    version: WORKSPACE_CONVERSATION_VERSION,
    id,
    scope,
    ownerId,
    title: boundedRequiredText(source.title, MAX_TITLE),
    summary: boundedRequiredText(source.summary, MAX_SUMMARY, true),
    createdAt: validateTimestamp(source.createdAt),
    updatedAt: validateTimestamp(source.updatedAt),
    defaultModelId: nullableModel(source.defaultModelId),
    messages,
  };
  if (!isDeepStrictEqual(record, indexRecord(conversation))) {
    throw new Error("Workspace conversation index disagreement");
  }
  return conversation;
}

function canonicalConversationRecordFilename(filename: string): string | null {
  if (!filename.endsWith(".json") || filename === "conversations.json") return null;
  const id = filename.slice(0, -".json".length);
  try {
    return safeId(id, "conversation ID") === id ? filename : null;
  } catch {
    return null;
  }
}

function isValidConversationAssetsDirectory(directory: string): boolean {
  try {
    return safeId(directory, "conversation ID") === directory;
  } catch {
    return false;
  }
}

function isValidAtomicArtifact(filename: string): boolean {
  const match = /^\.(.+\.json)\.(?:tmp|bak)\.(\d+)\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
    .exec(filename);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return false;
  return match[1] === "conversations.json"
    || canonicalConversationRecordFilename(match[1]) !== null;
}

function validatePersistedMessage(value: unknown): WorkspaceConversationMessage {
  const source = requireRecord(value);
  assertAllowedFields(source, [
    "id",
    "role",
    "content",
    "createdAt",
    "updatedAt",
    "modelId",
    "status",
    "context",
    "metadata",
  ]);
  if (source.role !== "user" && source.role !== "assistant" && source.role !== "system") {
    throw new Error("Invalid workspace message role");
  }
  if (source.status !== "complete" && source.status !== "streaming" && source.status !== "error") {
    throw new Error("Invalid workspace message status");
  }
  const createdAt = validateTimestamp(source.createdAt);
  let status: WorkspaceMessageStatus = source.status;
  let content = boundedRequiredText(source.content, MAX_MESSAGE_CONTENT, true);
  const updatedAt = source.updatedAt === null ? null : validateTimestamp(source.updatedAt);
  const comparison = Date.parse(updatedAt ?? createdAt);
  if (
    status === "streaming"
    && Number.isFinite(comparison)
    && Date.now() - comparison > STALE_STREAMING_MS
  ) {
    status = "error";
    content = `${content.trim()}\n\n[Response was interrupted before completion.]`.trim();
  }
  const metadata = requireRecord(source.metadata);
  return {
    id: safeId(source.id, "message ID"),
    role: source.role,
    content,
    createdAt,
    updatedAt,
    modelId: nullableModel(source.modelId),
    status,
    context: validatePersistedContext(source.context),
    metadata: { ...metadata },
  };
}

function validatePersistedContext(value: unknown): WorkspaceMessageContext {
  const source = requireRecord(value);
  assertAllowedFields(source, [
    "assistantScope",
    "currentNote",
    "explicitlyReferencedProjectIds",
    "currentView",
    "retrievedSources",
  ]);
  const context = createWorkspaceMessageContext({
    assistantScope: source.assistantScope,
    currentNote: source.currentNote,
    explicitlyReferencedProjectIds: source.explicitlyReferencedProjectIds,
    currentView: source.currentView,
  });
  if (source.retrievedSources !== undefined) {
    context.retrievedSources = validateWorkspaceRetrievedSources(source.retrievedSources);
  }
  return context;
}

function normalizeNewMessage(
  value: Partial<WorkspaceConversationMessage>,
): WorkspaceConversationMessage {
  const role = value.role;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    throw new Error("Invalid workspace message role");
  }
  const status = value.status ?? "complete";
  if (status !== "complete" && status !== "streaming" && status !== "error") {
    throw new Error("Invalid workspace message status");
  }
  const createdAt = nowIso();
  return {
    id: value.id ? safeId(value.id, "message ID") : createId("msg"),
    role,
    content: boundedRequiredText(value.content ?? "", MAX_MESSAGE_CONTENT, true),
    createdAt,
    updatedAt: null,
    modelId: optionalModel(value.modelId ?? undefined),
    status,
    context: createWorkspaceMessageContext(value.context),
    metadata: value.metadata === undefined ? {} : { ...requireRecord(value.metadata) },
  };
}

function validateWorkspaceScope(value: unknown): WorkspaceAssistantScope {
  const source = requireRecord(value);
  assertAllowedFields(source, ["kind"]);
  if (source.kind !== "workspace") throw new Error("Invalid workspace scope");
  return { kind: "workspace" };
}

function validateCurrentNote(value: unknown): WorkspaceCurrentNoteSnapshot {
  const source = requireRecord(value);
  assertAllowedFields(source, [
    "stableId",
    "scope",
    "path",
    "title",
    "visibility",
    "contentHash",
  ]);
  if (source.scope !== "codascope") throw new Error("Invalid workspace note scope");
  if (source.visibility !== "private" && source.visibility !== "shared") {
    throw new Error("Invalid workspace note visibility");
  }
  const notePath = boundedRequiredText(source.path, MAX_CONTEXT_TEXT);
  resolveContainedRelativePath("/workspace-note-root", notePath, "workspace note path");
  const note: WorkspaceCurrentNoteSnapshot = {
    stableId: safeId(source.stableId, "workspace note stable ID"),
    scope: "codascope",
    path: notePath,
    title: boundedRequiredText(source.title, MAX_CONTEXT_TEXT),
    visibility: source.visibility,
  };
  if (source.contentHash !== undefined) {
    note.contentHash = boundedRequiredText(source.contentHash, 128);
  }
  return note;
}

function validateCurrentView(value: unknown): WorkspaceCurrentViewSnapshot {
  const source = requireRecord(value);
  assertAllowedFields(source, ["view", "identity", "label"]);
  const currentView: WorkspaceCurrentViewSnapshot = {
    view: boundedRequiredText(source.view, MAX_CONTEXT_TEXT),
  };
  if (source.identity !== undefined) {
    currentView.identity = source.identity === null
      ? null
      : boundedRequiredText(source.identity, MAX_CONTEXT_TEXT);
  }
  if (source.label !== undefined) {
    currentView.label = source.label === null
      ? null
      : boundedRequiredText(source.label, MAX_CONTEXT_TEXT);
  }
  return currentView;
}

function validateReferencedProjects(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_REFERENCED_PROJECTS) {
    throw new Error("Invalid explicitly referenced project IDs");
  }
  const ids = new Set<string>();
  for (const candidate of value) {
    ids.add(safeId(candidate, "explicitly referenced project ID"));
  }
  return [...ids].sort();
}

function indexRecord(
  conversation: WorkspaceConversation,
): WorkspaceConversationIndexRecord {
  const model = [...conversation.messages].reverse().find((message) => message.modelId);
  return {
    id: conversation.id,
    scope: { kind: "workspace" },
    ownerId: conversation.ownerId,
    file: `${conversation.id}.json`,
    title: conversation.title,
    summary: conversation.summary,
    modelId: conversation.defaultModelId ?? model?.modelId ?? null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
  };
}

function publicSummary(
  record: WorkspaceConversationIndexRecord,
): WorkspaceConversationSummary {
  return {
    id: record.id,
    scope: { kind: "workspace" },
    title: record.title,
    summary: record.summary,
    modelId: record.modelId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
  };
}

function actorStorageKey(actorId: string): string {
  return createHash("sha256").update(actorId).digest("hex");
}

function validateOwner(value: unknown): string {
  return boundedRequiredText(value, MAX_OWNER_ID);
}

function safeId(value: unknown, label: string): string {
  const id = boundedRequiredText(value, 255);
  return assertSafePathSegment(id, label);
}

function validateTimestamp(value: unknown): string {
  const timestamp = boundedRequiredText(value, 100);
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("Invalid timestamp");
  return timestamp;
}

function optionalModel(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return boundedRequiredText(value, 255);
}

function nullableModel(value: unknown): string | null {
  if (value === null) return null;
  return boundedRequiredText(value, 255);
}

function boundedRequiredText(
  value: unknown,
  max: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || value.length > max) {
    throw new Error("Invalid bounded text");
  }
  if (!allowEmpty && (!value || value.trim() !== value)) {
    throw new Error("Invalid bounded text");
  }
  return value;
}

function boundedText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function titleFromContent(content: string): string {
  const line = content.split("\n").map((candidate) => candidate.trim()).find(Boolean);
  if (!line) return "New conversation";
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 3)}...` : line;
}

function summaryFromContent(content: string): string {
  const plain = content
    .replace(/[#*_~`>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > MAX_SUMMARY
    ? `${plain.slice(0, MAX_SUMMARY - 3)}...`
    : plain;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid record");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const fields = new Set(allowed);
  if (Object.keys(value).some((key) => !fields.has(key))) {
    throw new Error("Invalid record fields");
  }
}
