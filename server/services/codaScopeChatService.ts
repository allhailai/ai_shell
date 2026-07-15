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

// ── Constants ───────────────────────────────────────────────────────

const CONVERSATION_VERSION = 1;
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

// ── Types ───────────────────────────────────────────────────────────

export interface MessageContext {
  view: string;
  topicId?: string | null;
  projectName?: string;
  projectId?: string;
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

interface ConversationIndex {
  version: number;
  conversations: ConversationSummary[];
}

// ── Normalization ───────────────────────────────────────────────────

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
    context: source.context && typeof source.context === "object" && !Array.isArray(source.context)
      ? source.context as MessageContext
      : null,
    metadata: source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
      ? source.metadata as Record<string, unknown>
      : {},
  };
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

  // Preserve epicId if present
  if (typeof source.epicId === "string" && source.epicId.trim()) {
    conv.epicId = source.epicId.trim();
  } else if (fallback.epicId) {
    conv.epicId = fallback.epicId;
  }

  return conv;
}

function summaryFromConversation(conversation: Conversation, file: string): ConversationSummary {
  const lastModelMsg = [...conversation.messages].reverse().find((m) => m.modelId);
  const summary: ConversationSummary = {
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
  return summary;
}

function normalizeIndexRecord(value: unknown): ConversationSummary | null {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const id = typeof source.id === "string" && CONVERSATION_ID_RE.test(source.id) ? source.id : "";
  const file = typeof source.file === "string"
    && (source.file as string).startsWith("conversations/")
    && (source.file as string).endsWith(".json")
    ? source.file as string
    : "";
  if (!id || !file) return null;

  const record: ConversationSummary = {
    id,
    file,
    title: trimText(source.title, MAX_TITLE_LENGTH) || "New conversation",
    summary: trimText(source.summary, MAX_SUMMARY_LENGTH),
    modelId: typeof source.modelId === "string" && (source.modelId as string).trim() ? (source.modelId as string).trim() : null,
    createdAt: typeof source.createdAt === "string" ? source.createdAt as string : nowIso(),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt as string : nowIso(),
    messageCount: Number.isFinite(source.messageCount) ? Math.max(0, Number(source.messageCount)) : 0,
  };
  if (typeof source.epicId === "string" && source.epicId.trim()) {
    record.epicId = source.epicId.trim();
  }
  return record;
}

function normalizeIndex(value: unknown): ConversationIndex {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const conversations = Array.isArray(source.conversations)
    ? source.conversations.map(normalizeIndexRecord).filter((r): r is ConversationSummary => r !== null)
    : [];
  return {
    version: CONVERSATION_VERSION,
    conversations: conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_INDEX_SIZE),
  };
}

// ── Service ─────────────────────────────────────────────────────────

export class CodaScopeChatService {
  private root: string;
  private mutationQueues = new Map<string, Promise<unknown>>();

  constructor(root: string) {
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

  // ── Atomic IO ─────────────────────────────────────────────────────

  private async readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      if (err instanceof SyntaxError) return fallback; // corrupted file
      throw err;
    }
  }

  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    await fs.rename(tmp, filePath);
  }

  // ── Index operations ──────────────────────────────────────────────

  private indexPath(projectDir: string): string {
    return path.join(projectDir, "conversations", "conversations.json");
  }

  private async readIndex(projectDir: string): Promise<ConversationIndex> {
    const raw = await this.readJsonFile(
      this.indexPath(projectDir),
      { version: CONVERSATION_VERSION, conversations: [] },
    );
    return normalizeIndex(raw);
  }

  private async writeIndex(projectDir: string, index: ConversationIndex): Promise<void> {
    await this.writeJsonAtomic(this.indexPath(projectDir), normalizeIndex(index));
  }

  // ── Public API ────────────────────────────────────────────────────

  /** List all conversations for a project (sorted by updatedAt desc). */
  async listConversations(projectId: string): Promise<ConversationSummary[]> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return [];
    const index = await this.readIndex(projectDir);
    return index.conversations;
  }

  /** Create a new conversation. */
  async createConversation(
    projectId: string,
    opts?: { title?: string; modelId?: string; epicId?: string },
  ): Promise<Conversation> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) throw new Error("Project not found.");

    return this.withMutation(projectId, async () => {
      const id = createId("conv");
      const createdAt = nowIso();
      const relativeFile = `conversations/${datestamp()}_${id}.json`;
      const absoluteFile = path.join(projectDir, relativeFile);

      const conversation = normalizeConversation(projectId, {
        id,
        projectId,
        title: trimText(opts?.title, MAX_TITLE_LENGTH) || "New conversation",
        summary: "",
        createdAt,
        updatedAt: createdAt,
        defaultModelId: opts?.modelId?.trim() || null,
        messages: [],
        epicId: opts?.epicId?.trim() || undefined,
      }, { id, createdAt, updatedAt: createdAt, epicId: opts?.epicId?.trim() });

      const index = await this.readIndex(projectDir);
      const conversations = [
        summaryFromConversation(conversation, relativeFile),
        ...index.conversations,
      ].slice(0, MAX_INDEX_SIZE);

      await this.writeJsonAtomic(absoluteFile, conversation);
      await this.writeIndex(projectDir, { version: CONVERSATION_VERSION, conversations });
      return conversation;
    });
  }

  /** Get the dedicated conversation for an epic, or null. */
  async getConversationForEpic(projectId: string, epicId: string): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    const index = await this.readIndex(projectDir);
    const record = index.conversations.find((c) => c.epicId === epicId);
    if (!record) return null;

    return this.readConversation(projectId, record.id);
  }

  /** Get or create the dedicated conversation for an epic. */
  async getOrCreateEpicConversation(
    projectId: string,
    epicId: string,
    epicTitle: string,
  ): Promise<Conversation> {
    // Look for existing dedicated conversation
    const existing = await this.getConversationForEpic(projectId, epicId);
    if (existing) return existing;

    // Create a new one
    return this.createConversation(projectId, {
      title: `Epic: ${epicTitle}`,
      epicId,
    });
  }

  /** Read a single conversation with full messages. */
  async readConversation(projectId: string, conversationId: string): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    const index = await this.readIndex(projectDir);
    const record = index.conversations.find((c) => c.id === conversationId);
    if (!record) return null;

    const filePath = path.join(projectDir, record.file);
    const raw = await this.readJsonFile(filePath, null);
    if (!raw) return null;

    return normalizeConversation(projectId, raw, {
      id: conversationId,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  /** Update conversation metadata (title, summary). */
  async updateConversation(
    projectId: string,
    conversationId: string,
    patch: { title?: string; summary?: string },
  ): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    return this.withMutation(projectId, async () => {
      const conversation = await this.readConversation(projectId, conversationId);
      if (!conversation) return null;

      const next: Conversation = {
        ...conversation,
        title: patch.title !== undefined ? (trimText(patch.title, MAX_TITLE_LENGTH) || conversation.title) : conversation.title,
        summary: patch.summary !== undefined ? trimText(patch.summary, MAX_SUMMARY_LENGTH) : conversation.summary,
        updatedAt: nowIso(),
      };

      const index = await this.readIndex(projectDir);
      const record = index.conversations.find((c) => c.id === conversationId);
      if (!record) return null;

      await this.writeJsonAtomic(path.join(projectDir, record.file), next);
      await this.writeIndex(projectDir, {
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
    message: Partial<ConversationMessage>,
  ): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    return this.withMutation(projectId, async () => {
      const conversation = await this.readConversation(projectId, conversationId);
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

      const index = await this.readIndex(projectDir);
      const record = index.conversations.find((c) => c.id === conversationId);
      if (!record) return null;

      await this.writeJsonAtomic(path.join(projectDir, record.file), next);
      await this.writeIndex(projectDir, {
        ...index,
        conversations: [
          summaryFromConversation(next, record.file),
          ...index.conversations.filter((c) => c.id !== conversationId),
        ],
      });

      return next;
    });
  }

  /** Full atomic write of a conversation (for streaming updates). */
  async writeConversation(projectId: string, conversation: Conversation): Promise<Conversation | null> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return null;

    return this.withMutation(projectId, async () => {
      const next = normalizeConversation(projectId, {
        ...conversation,
        updatedAt: conversation.updatedAt ?? nowIso(),
      }, { id: conversation.id });

      const index = await this.readIndex(projectDir);
      const record = index.conversations.find((c) => c.id === next.id);
      if (!record) return null;

      await this.writeJsonAtomic(path.join(projectDir, record.file), next);
      await this.writeIndex(projectDir, {
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
  async deleteConversation(projectId: string, conversationId: string): Promise<boolean> {
    const projectDir = this.findProjectDir(projectId);
    if (!projectDir) return false;

    return this.withMutation(projectId, async () => {
      const index = await this.readIndex(projectDir);
      const record = index.conversations.find((c) => c.id === conversationId);
      if (!record) return false;

      // Remove from index
      await this.writeIndex(projectDir, {
        ...index,
        conversations: index.conversations.filter((c) => c.id !== conversationId),
      });

      // Delete the conversation file
      const filePath = path.join(projectDir, record.file);
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
