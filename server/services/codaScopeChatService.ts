/* ── CodaScope: Conversation Service ──────────────────────────────────
   Full conversation CRUD with atomic writes, per-project mutation queue,
   auto-titling, auto-summary, and stale streaming detection.

   Storage layout per project:
     <projectDir>/conversations/conversations.json   ← index
     <projectDir>/conversations/2026_06_30_conv_*.json ← individual files
   ────────────────────────────────────────────────────────────────────── */

import fs from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CodaScopePathValidationError,
  assertSafePathSegment,
  assertStrictDescendant,
} from "./codaScopePathSafety.js";
import {
  CodaScopePersistence,
  CodaScopePersistenceCorruptError,
  CodaScopePersistenceError,
  codaScopePersistence,
} from "./codaScopePersistence.js";
import {
  normalizeCanonicalProjectNoteRangeTarget,
} from "../../src/apps/codascope/projectNoteRangeTargetValidation.js";
import {
  isProjectNoteRangeActionCandidate,
  normalizeCanonicalProjectNoteRangeAction,
} from "../../src/apps/codascope/projectNoteRangeMutationActionValidation.js";
import type { CodaScopeAction } from "../../src/apps/codascope/codaScopeTypes.js";

// ── Constants ───────────────────────────────────────────────────────

const CONVERSATION_VERSION = 2;
const SUPPORTED_CONVERSATION_VERSIONS = new Set([1, CONVERSATION_VERSION]);
const CONVERSATION_ID_RE = /^[a-zA-Z0-9_-]+$/;
const MAX_TITLE_LENGTH = 72;
const MAX_SUMMARY_LENGTH = 240;
const STALE_STREAMING_MS = 10 * 60 * 1000; // 10 minutes
const MAX_INDEX_SIZE = 100;

// ── Helpers ─────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function datestamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}_${m}_${d}`;
}

function trimText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function titleFromContent(content: string): string {
  const firstLine = String(content ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!firstLine) return "New conversation";
  return firstLine.length > MAX_TITLE_LENGTH
    ? `${firstLine.slice(0, MAX_TITLE_LENGTH - 3)}...`
    : firstLine;
}

function summaryFromContent(content: string): string {
  const text = String(content ?? "").trim();
  if (!text) return "";
  // Strip markdown formatting for a cleaner summary
  const plain = text
    .replace(/[#*_~`>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n+/g, " ")
    .trim();
  return plain.length > MAX_SUMMARY_LENGTH
    ? `${plain.slice(0, MAX_SUMMARY_LENGTH - 3)}...`
    : plain;
}

function metadataWithoutActions(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, "actions")) return metadata;
  const { actions: _actions, ...remaining } = metadata;
  return Object.keys(remaining).length > 0 ? remaining : undefined;
}

// ── Types ───────────────────────────────────────────────────────────

export interface MessageContext {
  view: string;
  topicId?: string | null;
  projectName?: string;
  projectId?: string;
  epicId?: string | null;
  noteScope?: string | null;
  noteVisibility?: string | null;
  notePath?: string | null;
}

export type MessageStatus = "complete" | "streaming" | "error";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  updatedAt?: string | null;
  modelId: string | null;
  status: MessageStatus;
  context?: MessageContext | null;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  version: number;
  id: string;
  projectId: string;
  /** Server-derived owner. Undefined only for legacy records awaiting admin migration. */
  ownerId?: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  defaultModelId: string | null;
  messages: ConversationMessage[];
  epicId?: string;                 // if set, this is a dedicated epic conversation
}

export interface ConversationSummary {
  id: string;
  file: string;
  title: string;
  summary: string;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  epicId?: string;                 // if set, this is a dedicated epic conversation
}

/** Persisted index record. Owner data is used only for service authorization. */
interface ConversationIndexRecord extends ConversationSummary {
  ownerId?: string;
}

interface ConversationIndex {
  version: number;
  conversations: ConversationIndexRecord[];
}

interface OwnedConversationState {
  index: ConversationIndex;
  record: ConversationIndexRecord;
  conversation: Conversation;
}

// ── Normalization ───────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(
  source: Record<string, unknown>,
  key: string,
  options: { allowEmpty?: boolean; maxLength?: number } = {},
): string {
  const value = source[key];
  if (typeof value !== "string") throw new Error(`Invalid ${key}`);
  if (!options.allowEmpty && (!value || value.trim() !== value)) {
    throw new Error(`Invalid ${key}`);
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new Error(`Invalid ${key}`);
  }
  return value;
}

function optionalNonEmptyString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return requiredString(source, key);
}

function nullableNonEmptyString(
  source: Record<string, unknown>,
  key: string,
): string | null {
  if (source[key] === null) return null;
  return requiredString(source, key);
}

function assertSupportedVersion(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || !SUPPORTED_CONVERSATION_VERSIONS.has(value as number)) {
    throw new Error("Unsupported conversation version");
  }
}

function validateConversationFileReference(relativeFile: string): string {
  const parts = relativeFile.split("/");
  if (parts.length !== 2 || parts[0] !== "conversations") {
    throw new CodaScopePathValidationError("conversation file");
  }
  const filename = assertSafePathSegment(parts[1], "conversation filename");
  if (
    filename === "conversations.json"
    || filename.length <= ".json".length
    || !filename.endsWith(".json")
  ) {
    throw new CodaScopePathValidationError("conversation file");
  }
  return filename;
}

function validateIndexRecord(value: unknown): ConversationIndexRecord {
  if (!isRecord(value)) throw new Error("Invalid conversation index record");

  const id = requiredString(value, "id");
  assertSafePathSegment(id, "conversation id");
  if (!CONVERSATION_ID_RE.test(id)) throw new Error("Invalid conversation id");

  const file = requiredString(value, "file");
  validateConversationFileReference(file);

  const messageCount = value.messageCount;
  if (!Number.isSafeInteger(messageCount) || (messageCount as number) < 0) {
    throw new Error("Invalid message count");
  }

  const record: ConversationIndexRecord = {
    id,
    file,
    title: requiredString(value, "title", { maxLength: MAX_TITLE_LENGTH }),
    summary: requiredString(value, "summary", {
      allowEmpty: true,
      maxLength: MAX_SUMMARY_LENGTH,
    }),
    modelId: nullableNonEmptyString(value, "modelId"),
    createdAt: requiredString(value, "createdAt"),
    updatedAt: requiredString(value, "updatedAt"),
    messageCount: messageCount as number,
  };

  const epicId = optionalNonEmptyString(value, "epicId");
  if (epicId) record.epicId = epicId;
  const ownerId = optionalNonEmptyString(value, "ownerId");
  if (ownerId) record.ownerId = ownerId;
  return record;
}

function validateIndex(value: unknown): ConversationIndex {
  if (!isRecord(value)) throw new Error("Invalid conversation index");
  assertSupportedVersion(value.version);
  if (!Array.isArray(value.conversations) || value.conversations.length > MAX_INDEX_SIZE) {
    throw new Error("Invalid conversations collection");
  }

  const conversations = value.conversations.map(validateIndexRecord);
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const record of conversations) {
    if (ids.has(record.id) || files.has(record.file)) {
      throw new Error("Duplicate conversation index identity");
    }
    ids.add(record.id);
    files.add(record.file);
  }

  return {
    version: value.version,
    conversations: conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

function validateMessage(value: unknown): ConversationMessage {
  if (!isRecord(value)) throw new Error("Invalid conversation message");
  const id = requiredString(value, "id");
  const role = value.role;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    throw new Error("Invalid conversation message role");
  }
  const status = value.status;
  if (status !== "complete" && status !== "streaming" && status !== "error") {
    throw new Error("Invalid conversation message status");
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "updatedAt")
    && value.updatedAt !== null
    && (typeof value.updatedAt !== "string" || !value.updatedAt)
  ) {
    throw new Error("Invalid conversation message updatedAt");
  }
  const context = normalizeMessageContext(value.context);
  if (
    Object.prototype.hasOwnProperty.call(value, "metadata")
    && !isRecord(value.metadata)
  ) {
    throw new Error("Invalid conversation message metadata");
  }

  return normalizeMessage({
    ...value,
    id,
    role,
    status,
    content: requiredString(value, "content", { allowEmpty: true }),
    createdAt: requiredString(value, "createdAt"),
    modelId: nullableNonEmptyString(value, "modelId"),
    context,
  });
}

function validateConversation(
  projectId: string,
  record: ConversationIndexRecord,
  value: unknown,
): Conversation {
  if (!isRecord(value)) throw new Error("Invalid conversation");
  assertSupportedVersion(value.version);

  const id = requiredString(value, "id");
  assertSafePathSegment(id, "conversation id");
  if (!CONVERSATION_ID_RE.test(id) || id !== record.id) {
    throw new Error("Conversation identity mismatch");
  }
  if (requiredString(value, "projectId") !== projectId) {
    throw new Error("Conversation project mismatch");
  }

  const ownerId = optionalNonEmptyString(value, "ownerId");
  if (ownerId !== record.ownerId) {
    throw new Error("Conversation custody mismatch");
  }
  if (!Array.isArray(value.messages)) throw new Error("Invalid conversation messages");
  const messages = value.messages.map(validateMessage);
  const messageIds = new Set<string>();
  for (const message of messages) {
    if (messageIds.has(message.id)) throw new Error("Duplicate conversation message id");
    messageIds.add(message.id);
  }

  const conversation = normalizeConversation(projectId, {
    ...value,
    version: value.version,
    id,
    projectId,
    ownerId,
    title: requiredString(value, "title", { maxLength: MAX_TITLE_LENGTH }),
    summary: requiredString(value, "summary", {
      allowEmpty: true,
      maxLength: MAX_SUMMARY_LENGTH,
    }),
    createdAt: requiredString(value, "createdAt"),
    updatedAt: requiredString(value, "updatedAt"),
    defaultModelId: nullableNonEmptyString(value, "defaultModelId"),
    messages,
  });

  const epicId = optionalNonEmptyString(value, "epicId");
  if (epicId) conversation.epicId = epicId;
  return conversation;
}

function normalizeMessage(value: unknown): ConversationMessage {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const createdAt = typeof source.createdAt === "string" ? source.createdAt : nowIso();
  const role = (["user", "assistant", "system"].includes(source.role as string)
    ? source.role
    : "assistant") as ConversationMessage["role"];

  let status: MessageStatus = (["complete", "streaming", "error"].includes(source.status as string)
    ? source.status
    : "complete") as MessageStatus;

  const content = typeof source.content === "string" ? source.content : "";
  const updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : null;
  const context = normalizeMessageContext(source.context);
  const metadata = normalizeMessageMetadata(role, context, source.metadata);

  // Stale streaming detection
  const ts = Date.parse((updatedAt ?? createdAt) as string);
  if (status === "streaming" && Number.isFinite(ts) && Date.now() - ts > STALE_STREAMING_MS) {
    status = "error";
  }

  return {
    id: typeof source.id === "string" && source.id.trim() ? source.id : createId("msg"),
    role,
    content: status === "error" && source.status === "streaming"
      ? `${content.trim()}\n\n[Response was interrupted before completion.]`.trim()
      : content,
    createdAt,
    updatedAt,
    modelId: typeof source.modelId === "string" && source.modelId.trim() ? source.modelId.trim() : null,
    status,
    context,
    metadata,
  };
}

function normalizeMessageContext(value: unknown): MessageContext | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)
    || typeof value.view !== "string"
    || !value.view.trim()) {
    throw new Error("Invalid conversation message context");
  }
  for (const key of ["topicId", "epicId", "noteScope", "noteVisibility", "notePath"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)
      && value[key] !== null
      && typeof value[key] !== "string") {
      throw new Error(`Invalid conversation message context ${key}`);
    }
  }
  for (const key of ["projectName", "projectId"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)
      && typeof value[key] !== "string") {
      throw new Error(`Invalid conversation message context ${key}`);
    }
  }
  return { ...(value as unknown as MessageContext), view: value.view };
}

function normalizeMessageMetadata(
  role: ConversationMessage["role"],
  context: MessageContext | null,
  value: unknown,
): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("Invalid conversation message metadata");
  const metadata: Record<string, unknown> = { ...value };

  if (Object.prototype.hasOwnProperty.call(metadata, "noteRangeTarget")) {
    const target = normalizeCanonicalProjectNoteRangeTarget(
      metadata.noteRangeTarget,
    );
    if (!target
      || role !== "user"
      || !context
      || context.projectId !== target.projectId
      || context.noteScope !== target.scope
      || context.noteVisibility !== target.visibility
      || (target.scope === "epic" && context.epicId !== target.epicId)) {
      throw new Error("Invalid project note-range target metadata");
    }
    metadata.noteRangeTarget = target;
  }

  if (Array.isArray(metadata.actions)) {
    metadata.actions = metadata.actions.map((action) => {
      if (!isProjectNoteRangeActionCandidate(action)) return action;
      const canonical = normalizeCanonicalProjectNoteRangeAction(action);
      if (!canonical) {
        throw new Error("Invalid project note-range completion action");
      }
      return canonical;
    });
  }
  return metadata;
}

function normalizeConversation(projectId: string, value: unknown, fallback: Partial<Conversation> = {}): Conversation {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const id = typeof source.id === "string" && CONVERSATION_ID_RE.test(source.id) ? source.id : fallback.id ?? createId("conv");
  const createdAt = typeof source.createdAt === "string" ? source.createdAt : fallback.createdAt ?? nowIso();
  const updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : fallback.updatedAt ?? createdAt;
  const messages = Array.isArray(source.messages) ? source.messages.map(normalizeMessage) : [];

  const conv: Conversation = {
    version: CONVERSATION_VERSION,
    id,
    projectId: typeof source.projectId === "string" ? source.projectId : projectId,
    title: trimText(source.title, MAX_TITLE_LENGTH) || fallback.title || "New conversation",
    summary: trimText(source.summary, MAX_SUMMARY_LENGTH),
    createdAt,
    updatedAt,
    defaultModelId: typeof source.defaultModelId === "string" && (source.defaultModelId as string).trim()
      ? (source.defaultModelId as string).trim()
      : null,
    messages,
  };

  const ownerId = typeof source.ownerId === "string" && source.ownerId.trim()
    ? source.ownerId.trim()
    : typeof fallback.ownerId === "string" && fallback.ownerId.trim()
      ? fallback.ownerId.trim()
      : undefined;
  if (ownerId) conv.ownerId = ownerId;

  // Preserve epicId if present
  if (typeof source.epicId === "string" && source.epicId.trim()) {
    conv.epicId = source.epicId.trim();
  } else if (fallback.epicId) {
    conv.epicId = fallback.epicId;
  }

  return conv;
}

function summaryFromConversation(conversation: Conversation, file: string): ConversationIndexRecord {
  const lastModelMsg = [...conversation.messages].reverse().find((m) => m.modelId);
  const summary: ConversationIndexRecord = {
    id: conversation.id,
    file,
    title: conversation.title,
    summary: conversation.summary,
    modelId: conversation.defaultModelId ?? lastModelMsg?.modelId ?? null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
  };
  if (conversation.epicId) summary.epicId = conversation.epicId;
  if (conversation.ownerId) summary.ownerId = conversation.ownerId;
  return summary;
}

function prepareIndexForWrite(index: ConversationIndex): ConversationIndex {
  return {
    version: CONVERSATION_VERSION,
    conversations: [...index.conversations]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_INDEX_SIZE),
  };
}

// ── Service ─────────────────────────────────────────────────────────

export class CodaScopeChatService {
  private root: string;
  private mutationQueues = new Map<string, Promise<unknown>>();

  constructor(
    root: string,
    private readonly persistence: CodaScopePersistence = codaScopePersistence,
  ) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  // ── Project directory lookup ──────────────────────────────────────

  private findProjectDir(projectId: string): string | null {
    if (!existsSync(this.root)) return null;
    const entries = readdirSync(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectPath = path.join(this.root, entry.name, "project.json");
      if (existsSync(projectPath)) {
        try {
          const raw = readFileSync(projectPath, "utf-8");
          const data = JSON.parse(raw);
          if (data.id === projectId) return path.join(this.root, entry.name);
        } catch {
          // Skip corrupted
        }
      }
    }
    return null;
  }

  // ── Mutation Queue ────────────────────────────────────────────────

  private async withMutation<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueues.get(projectId) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(operation);
    this.mutationQueues.set(projectId, queued);

    try {
      return await queued;
    } finally {
      if (this.mutationQueues.get(projectId) === queued) {
        this.mutationQueues.delete(projectId);
      }
    }
  }

  // ── Index operations ──────────────────────────────────────────────

  private indexPath(projectDir: string): string {
    return path.join(projectDir, "conversations", "conversations.json");
  }

  /** Resolve persisted conversation metadata without trusting it as a path. */
  private conversationFilePath(projectDir: string, relativeFile: string): string {
    const filename = validateConversationFileReference(relativeFile);
    const conversationsDir = path.join(projectDir, "conversations");
    const target = path.join(
      conversationsDir,
      filename,
    );
    return assertStrictDescendant(conversationsDir, target, "conversation file");
  }

  private async readIndex(projectId: string, projectDir: string): Promise<ConversationIndex> {
    const context = { storage: "conversation_index", projectId };
    const index = await this.persistence.readJson<ConversationIndex | null>(
      this.indexPath(projectDir),
      {
        context,
        missing: () => null,
        validate: validateIndex,
      },
    );
    if (index) return index;

    if (await this.hasPersistedConversationFiles(projectDir, context)) {
      throw new CodaScopePersistenceCorruptError(context);
    }
    return { version: CONVERSATION_VERSION, conversations: [] };
  }

  private async writeIndex(
    projectId: string,
    projectDir: string,
    index: ConversationIndex,
  ): Promise<void> {
    await this.persistence.writeJson(
      this.indexPath(projectDir),
      prepareIndexForWrite(index),
      { storage: "conversation_index", projectId },
    );
  }

  private async hasPersistedConversationFiles(
    projectDir: string,
    context: { storage: string; projectId: string },
  ): Promise<boolean> {
    const conversationsDir = path.join(projectDir, "conversations");
    let entries;
    try {
      entries = await fs.readdir(conversationsDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new CodaScopePersistenceError(context);
    }

    for (const entry of entries) {
      if (entry.isDirectory() || entry.name === "conversations.json") continue;
      if (!entry.name.endsWith(".json")) continue;
      try {
        this.conversationFilePath(projectDir, `conversations/${entry.name}`);
      } catch {
        throw new CodaScopePersistenceCorruptError(context);
      }
      return true;
    }
    return false;
  }

  private async readIndexedConversation(
    projectId: string,
    projectDir: string,
    record: ConversationIndexRecord,
  ): Promise<Conversation> {
    return this.persistence.readJson(
      this.conversationFilePath(projectDir, record.file),
      {
        context: { storage: "conversation", projectId },
        validate: (value) => validateConversation(projectId, record, value),
      },
    );
  }

  private async writeConversationFile(
    projectDir: string,
    relativeFile: string,
    conversation: Conversation,
  ): Promise<void> {
    await this.persistence.writeJson(
      this.conversationFilePath(projectDir, relativeFile),
      conversation,
      { storage: "conversation", projectId: conversation.projectId },
    );
  }

  private publicSummary(record: ConversationIndexRecord): ConversationSummary {
    const { ownerId: _ownerId, ...summary } = record;
    return summary;
  }

  private async readOwnedConversationState(
    projectId: string,
    projectDir: string,
    conversationId: string,
    actorId: string,
  ): Promise<OwnedConversationState | null> {
    const ownerId = actorId.trim();
    if (!ownerId) return null;

    const index = await this.readIndex(projectId, projectDir);
    const record = index.conversations.find((candidate) => candidate.id === conversationId);
    if (!record || record.ownerId !== ownerId) return null;

    const conversation = await this.readIndexedConversation(projectId, projectDir, record);
    return { index, record, conversation };
  }

  private async persistOwnedConversationState(
    projectDir: string,
    state: OwnedConversationState,
    conversation: Conversation,
  ): Promise<Conversation> {
    await this.writeConversationFile(projectDir, state.record.file, conversation);
    await this.writeIndex(conversation.projectId, projectDir, {
      ...state.index,
      conversations: [
        summaryFromConversation(conversation, state.record.file),
        ...state.index.conversations.filter((candidate) => candidate.id !== conversation.id),
      ],
    });
    return conversation;
  }

  // ── Public API ────────────────────────────────────────────────────

  /** List only conversations owned by the authenticated actor. */
  async listConversations(projectId: string, actorId: string): Promise<ConversationSummary[]> {
    const projectDir = this.findProjectDir(projectId);
    const ownerId = actorId.trim();
    if (!projectDir || !ownerId) return [];
    const index = await this.readIndex(projectId, projectDir);
    return index.conversations
      .filter((conversation) => conversation.ownerId === ownerId)
      .map((conversation) => this.publicSummary(conversation));
  }

  /** Create a new conversation for the authenticated actor. */
  async createConversation(
    projectId: string,
    actorId: string,
    opts?: { title?: string; modelId?: string; epicId?: string },
  ): Promise<Conversation> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) throw new Error("Project not found.");
    const ownerId = actorId.trim();
    if (!ownerId) throw new Error("Conversation owner is required.");

    return this.withMutation(projectId, async () => {
      const id = createId("conv");
      const createdAt = nowIso();
      const relativeFile = `conversations/${datestamp()}_${id}.json`;
      const conversation = normalizeConversation(projectId, {
        id,
        projectId,
        ownerId,
        title: trimText(opts?.title, MAX_TITLE_LENGTH) || "New conversation",
        summary: "",
        createdAt,
        updatedAt: createdAt,
        defaultModelId: opts?.modelId?.trim() || null,
        messages: [],
        epicId: opts?.epicId?.trim() || undefined,
      }, { id, ownerId, createdAt, updatedAt: createdAt, epicId: opts?.epicId?.trim() });

      const index = await this.readIndex(projectId, projectDir);
      const conversations = [
        summaryFromConversation(conversation, relativeFile),
        ...index.conversations,
      ].slice(0, MAX_INDEX_SIZE);

      await this.writeConversationFile(projectDir, relativeFile, conversation);
      await this.writeIndex(
        projectId,
        projectDir,
        { version: CONVERSATION_VERSION, conversations },
      );
      return conversation;
    });
  }

  /** Get this actor's dedicated conversation for an epic, or null. */
  async getConversationForEpic(projectId: string, epicId: string, actorId: string): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    const ownerId = actorId.trim();
    if (!projectDir || !ownerId) return null;

    const index = await this.readIndex(projectId, projectDir);
    const record = index.conversations.find((c) => c.epicId === epicId && c.ownerId === ownerId);
    if (!record) return null;

    return this.readConversation(projectId, record.id, ownerId);
  }

  /** Get or create this actor's dedicated conversation for an epic. */
  async getOrCreateEpicConversation(
    projectId: string,
    epicId: string,
    epicTitle: string,
    actorId: string,
  ): Promise<Conversation> {
    const existing = await this.getConversationForEpic(projectId, epicId, actorId);
    if (existing) return existing;

    return this.createConversation(projectId, actorId, {
      title: `Epic: ${epicTitle}`,
      epicId,
    });
  }

  /** Read a single conversation only when it belongs to the authenticated actor. */
  async readConversation(projectId: string, conversationId: string, actorId: string): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    const ownerId = actorId.trim();
    if (!projectDir || !ownerId) return null;

    const index = await this.readIndex(projectId, projectDir);
    const record = index.conversations.find((c) => c.id === conversationId);
    if (!record || record.ownerId !== ownerId) return null;

    return this.readIndexedConversation(projectId, projectDir, record);
  }

  /** List ownerless conversations for the admin migration flow. */
  async listLegacyConversations(projectId: string): Promise<ConversationSummary[]> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return [];

    const index = await this.readIndex(projectId, projectDir);
    const legacy: ConversationSummary[] = [];
    for (const record of index.conversations) {
      if (record.ownerId) continue;
      const conversation = await this.readIndexedConversation(projectId, projectDir, record);
      legacy.push(this.publicSummary(summaryFromConversation(conversation, record.file)));
    }
    return legacy;
  }

  /** Assign an owner to an ownerless conversation after route-level admin/user validation. */
  async assignLegacyConversationOwner(
    projectId: string,
    conversationId: string,
    targetUsername: string,
  ): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    const ownerId = targetUsername.trim();
    if (!projectDir || !ownerId) return null;

    return this.withMutation(projectId, async () => {
      const index = await this.readIndex(projectId, projectDir);
      const record = index.conversations.find((conversation) => conversation.id === conversationId);
      if (!record || record.ownerId) return null;

      const conversation = await this.readIndexedConversation(projectId, projectDir, record);

      const next: Conversation = { ...conversation, ownerId, updatedAt: nowIso() };
      await this.writeConversationFile(projectDir, record.file, next);
      await this.writeIndex(projectId, projectDir, {
        ...index,
        conversations: [
          summaryFromConversation(next, record.file),
          ...index.conversations.filter((candidate) => candidate.id !== conversationId),
        ],
      });
      return next;
    });
  }

  /** Update conversation metadata (title, summary). */
  async updateConversation(
    projectId: string,
    conversationId: string,
    actorId: string,
    patch: { title?: string; summary?: string },
  ): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    return this.withMutation(projectId, async () => {
      const conversation = await this.readConversation(projectId, conversationId, actorId);
      if (!conversation) return null;

      const next: Conversation = {
        ...conversation,
        title: patch.title !== undefined ? (trimText(patch.title, MAX_TITLE_LENGTH) || conversation.title) : conversation.title,
        summary: patch.summary !== undefined ? trimText(patch.summary, MAX_SUMMARY_LENGTH) : conversation.summary,
        updatedAt: nowIso(),
      };

      const index = await this.readIndex(projectId, projectDir);
      const record = index.conversations.find((c) => c.id === conversationId);
      if (!record) return null;

      await this.writeConversationFile(projectDir, record.file, next);
      await this.writeIndex(projectId, projectDir, {
        ...index,
        conversations: [
          summaryFromConversation(next, record.file),
          ...index.conversations.filter((c) => c.id !== conversationId),
        ],
      });

      return next;
    });
  }

  /** Append a message to a conversation. Handles auto-title and auto-summary. */
  async appendMessage(
    projectId: string,
    conversationId: string,
    actorId: string,
    message: Partial<ConversationMessage>,
  ): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    return this.withMutation(projectId, async () => {
      const conversation = await this.readConversation(projectId, conversationId, actorId);
      if (!conversation) return null;

      const normalized = normalizeMessage(message);

      // Auto-title from first user message
      const firstUserMsg = conversation.messages.find((m) => m.role === "user");
      const autoTitle = conversation.title === "New conversation"
        && normalized.role === "user"
        && !firstUserMsg
        ? titleFromContent(normalized.content)
        : conversation.title;

      // Auto-summary from first assistant response
      const firstAssistantMsg = conversation.messages.find((m) => m.role === "assistant");
      const autoSummary = !conversation.summary
        && normalized.role === "assistant"
        && !firstAssistantMsg
        ? summaryFromContent(normalized.content)
        : conversation.summary;

      const next: Conversation = {
        ...conversation,
        title: autoTitle,
        summary: autoSummary,
        defaultModelId: normalized.modelId ?? conversation.defaultModelId,
        updatedAt: nowIso(),
        messages: [...conversation.messages, normalized],
      };

      const index = await this.readIndex(projectId, projectDir);
      const record = index.conversations.find((c) => c.id === conversationId);
      if (!record) return null;

      await this.writeConversationFile(projectDir, record.file, next);
      await this.writeIndex(projectId, projectDir, {
        ...index,
        conversations: [
          summaryFromConversation(next, record.file),
          ...index.conversations.filter((c) => c.id !== conversationId),
        ],
      });

      return next;
    });
  }

  /**
   * Complete one exact streaming assistant placeholder.
   *
   * The current conversation is read only after acquiring the project queue,
   * so unrelated messages committed ahead of this mutation are preserved.
   */
  async completeAssistantMessage(
    projectId: string,
    conversationId: string,
    actorId: string,
    messageId: string,
    completion: {
      content: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    return this.withMutation(projectId, async () => {
      const state = await this.readOwnedConversationState(
        projectId,
        projectDir,
        conversationId,
        actorId,
      );
      if (!state) return null;

      const messageIndex = state.conversation.messages.findIndex((message) =>
        message.id === messageId
        && message.role === "assistant"
        && message.status === "streaming"
      );
      if (messageIndex < 0) return null;

      const messages = [...state.conversation.messages];
      const placeholder = messages[messageIndex];
      const metadata = normalizeMessageMetadata(
        "assistant",
        placeholder.context ?? null,
        {
          ...(placeholder.metadata ?? {}),
          ...(completion.metadata ?? {}),
        },
      );
      messages[messageIndex] = {
        ...placeholder,
        content: completion.content,
        status: "complete",
        updatedAt: nowIso(),
        metadata,
      };
      const next: Conversation = {
        ...state.conversation,
        updatedAt: nowIso(),
        messages,
      };
      return this.persistOwnedConversationState(projectDir, state, next);
    });
  }

  /**
   * Mark one stable assistant-message ID as failed.
   *
   * Existing assistant messages are rewritten in place. The backwards-
   * compatible assistant endpoint may request an append only when that stable
   * ID was not committed; the update-or-append decision remains inside the
   * same project mutation.
   */
  async recordAssistantMessageError(
    projectId: string,
    conversationId: string,
    actorId: string,
    message: {
      id: string;
      content: string;
      modelId?: string | null;
      trustedMutationActions?: CodaScopeAction[];
    },
    options: { appendIfMissing?: boolean } = {},
  ): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    return this.withMutation(projectId, async () => {
      const state = await this.readOwnedConversationState(
        projectId,
        projectDir,
        conversationId,
        actorId,
      );
      if (!state) return null;

      const existingIndex = state.conversation.messages.findIndex(
        (candidate) => candidate.id === message.id,
      );
      let messages: ConversationMessage[];
      let summary = state.conversation.summary;
      let defaultModelId = state.conversation.defaultModelId;
      const trustedMutationActions = normalizeTrustedProjectNoteRangeActions(
        message.trustedMutationActions,
      );

      if (existingIndex >= 0) {
        const existing = state.conversation.messages[existingIndex];
        if (existing.role !== "assistant") return null;
        messages = [...state.conversation.messages];
        const retainedMetadata = metadataWithoutActions(existing.metadata);
        messages[existingIndex] = {
          ...existing,
          content: message.content,
          status: "error",
          updatedAt: nowIso(),
          metadata: {
            ...(retainedMetadata ?? {}),
            ...(trustedMutationActions.length > 0
              ? { actions: trustedMutationActions }
              : {}),
          },
        };
      } else {
        if (!options.appendIfMissing) return null;
        const normalized = normalizeMessage({
          id: message.id,
          role: "assistant",
          content: message.content,
          modelId: message.modelId ?? null,
          status: "error",
          ...(trustedMutationActions.length > 0
            ? { metadata: { actions: trustedMutationActions } }
            : {}),
        });
        const firstAssistantMessage = state.conversation.messages.find(
          (candidate) => candidate.role === "assistant",
        );
        if (!summary && !firstAssistantMessage) {
          summary = summaryFromContent(normalized.content);
        }
        defaultModelId = normalized.modelId ?? defaultModelId;
        messages = [...state.conversation.messages, normalized];
      }

      const next: Conversation = {
        ...state.conversation,
        summary,
        defaultModelId,
        updatedAt: nowIso(),
        messages,
      };
      return this.persistOwnedConversationState(projectDir, state, next);
    });
  }

  /**
   * Full atomic write for callers that intentionally replace all conversation
   * fields. Streaming assistant transitions must use the bounded methods above.
   */
  async writeConversation(projectId: string, actorId: string, conversation: Conversation): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    return this.withMutation(projectId, async () => {
      const existing = await this.readConversation(projectId, conversation.id, actorId);
      if (!existing) return null;
      const next = normalizeConversation(projectId, {
        ...conversation,
        id: existing.id,
        projectId,
        ownerId: existing.ownerId,
        updatedAt: conversation.updatedAt ?? nowIso(),
      }, { id: existing.id, ownerId: existing.ownerId });

      const index = await this.readIndex(projectId, projectDir);
      const record = index.conversations.find((c) => c.id === next.id);
      if (!record) return null;

      await this.writeConversationFile(projectDir, record.file, next);
      await this.writeIndex(projectId, projectDir, {
        ...index,
        conversations: [
          summaryFromConversation(next, record.file),
          ...index.conversations.filter((c) => c.id !== next.id),
        ],
      });

      return next;
    });
  }

  /** Delete a conversation by ID. Removes from index and deletes the file. */
  async deleteConversation(projectId: string, conversationId: string, actorId: string): Promise<boolean> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return false;

    return this.withMutation(projectId, async () => {
      const conversation = await this.readConversation(projectId, conversationId, actorId);
      if (!conversation) return false;
      const index = await this.readIndex(projectId, projectDir);
      const record = index.conversations.find((c) => c.id === conversationId);
      if (!record) return false;

      // Remove from index
      await this.writeIndex(projectId, projectDir, {
        ...index,
        conversations: index.conversations.filter((c) => c.id !== conversationId),
      });

      // Delete the conversation file
      const filePath = this.conversationFilePath(projectDir, record.file);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        // File already gone — not an error
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }

      return true;
    });
  }
}

function normalizeTrustedProjectNoteRangeActions(
  value: CodaScopeAction[] | undefined,
): CodaScopeAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1) {
    throw new Error("Invalid trusted project note-range actions");
  }
  return value.map((action) => {
    const canonical = normalizeCanonicalProjectNoteRangeAction(action);
    if (!canonical) {
      throw new Error("Invalid trusted project note-range action");
    }
    return canonical;
  });
}
