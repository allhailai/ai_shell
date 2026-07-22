/* ── CodaScope: Agent Service ─────────────────────────────────────────
   Manages Cursor SDK agent lifecycle for CodaScope.

   Key features:
   - Agent pool: one agent per (projectId, purpose, authenticated actor) with idle cleanup
   - Custom tools: purpose-based filtering (read-only vs read+write)
   - Streaming: emits SDKMessage objects via callback for SSE
   - Model listing: cached Cursor.models.list() results
   - Cancel support: AbortController registry per project and authenticated actor
   ──────────────────────────────────────────────────────────────────── */

import { Agent, Cursor } from "@cursor/sdk";
import type {
  SDKAgent,
  SDKCustomTool,
  SDKMessage,
  SDKUserMessage,
  SDKImage,
  RunResult,
  ModelListItem,
} from "@cursor/sdk";
import type { SecretService } from "./secretService.js";
import { CodaScopeProjectService } from "./codaScopeProjectService.js";
import { getToolsForPurpose, ToolResultCollector, ToolResultCollectorHolder } from "./codaScopeToolDefinitions.js";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface AgentSendOptions {
  projectId: string;
  /** Authenticated actor for user-facing runs. Never taken from a tool arg. */
  actorId?: string;
  message: string;
  modelId: string;
  systemPrompt?: string;
  context?: string;
  images?: Array<{ data: string; mimeType: string }>;
  purpose: "chat" | "assistant" | "wiki-build" | "curation" | "research" | "artifact-build" | "artifact-section-regen";
  onMessage: (msg: SDKMessage) => void;
  onDone: (result: RunResult) => void;
  onError: (err: Error) => void;
}

interface PoolEntry {
  agent: SDKAgent;
  projectId: string;
  purpose: string;
  actorId?: string;
  lastUsed: number;
  busy: boolean;
  collectorHolder: ToolResultCollectorHolder;
}

export interface AgentLocalWorkspace {
  cwd?: string | string[];
  sandboxOptions?: { enabled: boolean };
}

/**
 * Resolve the native workspace exposed to a CodaScope agent.
 *
 * Wiki builds are intentionally isolated from repositories: their source
 * access is tool-mediated and the SDK sandbox is limited to CodaScope data.
 */
export function getAgentLocalWorkspace(
  purpose: string,
  projectDir: string | null,
  repoPaths: string[],
): AgentLocalWorkspace {
  if (purpose === "wiki-build") {
    if (!projectDir) throw new Error("CodaScope project directory not found for wiki build.");
    return {
      cwd: projectDir,
      sandboxOptions: { enabled: true },
    };
  }

  return { cwd: repoPaths.length > 0 ? repoPaths : undefined };
}

/** The SDK emits this stable error when the host cannot provide its sandbox. */
export function isLocalSandboxUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Local SDK sandboxing was requested, but sandboxing is not supported in this environment");
}

/**
 * Create an agent with the strongest available boundary. The retry is deliberately
 * limited to wiki builds and to the SDK's known unsupported-host error.
 */
export async function createAgentWithSandboxFallback<T>(
  purpose: string,
  workspace: AgentLocalWorkspace,
  create: (workspace: AgentLocalWorkspace) => Promise<T>,
): Promise<T> {
  try {
    return await create(workspace);
  } catch (error) {
    if (purpose !== "wiki-build" || !isLocalSandboxUnsupportedError(error)) throw error;
    console.warn("[CodaScope] SDK sandbox unavailable; running wiki-build with project cwd and scoped tools.");
    // Be explicit: omitting the option could inherit an enabled user-level
    // ~/.cursor/sandbox.json setting and repeat the same failure.
    return create({ ...workspace, sandboxOptions: { enabled: false } });
  }
}

/* ── Model Cache ────────────────────────────────────────────────────── */

interface ModelCache {
  models: ModelListItem[];
  fetchedAt: number;
}

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeAgentService {
  private secretService: SecretService;
  private projectsRoot: string;
  private pool = new Map<string, PoolEntry>();
  private modelCache: ModelCache | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Active chat AbortControllers keyed by project and authenticated actor. */
  private activeChatControllers = new Map<string, AbortController>();

  constructor(secretService: SecretService, projectsRoot: string) {
    this.secretService = secretService;
    this.projectsRoot = projectsRoot;

    // Clean up idle agents every 2 minutes
    this.cleanupTimer = setInterval(() => this.cleanIdleAgents(), 2 * 60 * 1000);
  }

  setProjectsRoot(root: string): void {
    this.projectsRoot = root;
  }

  /* ── API Key ──────────────────────────────────────────────────────── */

  private async getApiKey(): Promise<string> {
    const key = await this.secretService.getAppSecret("codascope", "cursor_api_key");
    if (!key) {
      throw new Error("Cursor API key not configured. Set it in CodaScope settings.");
    }
    return key;
  }

  /* ── Models ───────────────────────────────────────────────────────── */

  async listModels(): Promise<ModelListItem[]> {
    if (this.modelCache && Date.now() - this.modelCache.fetchedAt < MODEL_CACHE_TTL_MS) {
      return this.modelCache.models;
    }

    const apiKey = await this.getApiKey();
    const models = await Cursor.models.list({ apiKey });
    this.modelCache = { models, fetchedAt: Date.now() };
    return models;
  }

  /**
   * Validate an API key by attempting a lightweight Cursor SDK call.
   * Returns { valid, modelCount, error }.
   */
  async validateApiKey(apiKey: string): Promise<{
    valid: boolean;
    modelCount: number;
    error: string | null;
  }> {
    try {
      const models = await Cursor.models.list({ apiKey });
      // If we got here, key works — update cache with the fresh result
      this.modelCache = { models, fetchedAt: Date.now() };
      return { valid: true, modelCount: models.length, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Detect common failure modes
      if (message.includes("MODULE_NOT_FOUND") || message.includes("Cannot find module")) {
        return {
          valid: false,
          modelCount: 0,
          error: "Cursor SDK is not installed. Run `npm install @cursor/sdk` to install it.",
        };
      }
      if (message.includes("401") || message.includes("Unauthorized") || message.includes("invalid")) {
        return {
          valid: false,
          modelCount: 0,
          error: "API key is invalid or unauthorized. Check your key and try again.",
        };
      }
      if (message.includes("403") || message.includes("Forbidden")) {
        return {
          valid: false,
          modelCount: 0,
          error: "API key does not have permission to access Cursor models.",
        };
      }
      return {
        valid: false,
        modelCount: 0,
        error: `Validation failed: ${message}`,
      };
    }
  }

  /* ── Tool Assembly by Purpose ─────────────────────────────────────── */

  /**
   * Get the appropriate tools for a given agent purpose.
   * Delegates to codaScopeToolDefinitions.ts for the actual tool objects.
   */
  private getToolsForPurpose(
    projectId: string,
    purpose: string,
    collectorHolder?: ToolResultCollectorHolder,
    actorId?: string,
  ): Record<string, SDKCustomTool> {
    return getToolsForPurpose(projectId, this.projectsRoot, purpose, collectorHolder, actorId);
  }

  /* ── Agent Pool ───────────────────────────────────────────────────── */

  private poolKey(projectId: string, purpose: string, actorId?: string): string {
    // Tool closures carry the actor into note/document authorization. Do not
    // reuse one actor's closures for another actor, even when project/purpose
    // match. A system run is a distinct boundary as well.
    return `${projectId}::${purpose}::${actorId ?? "system"}`;
  }

  private activeChatKey(projectId: string, actorId?: string): string {
    return `${projectId}::${actorId ?? "system"}`;
  }

  private async getOrCreateAgent(
    projectId: string,
    purpose: string,
    modelId: string,
    actorId?: string,
  ): Promise<SDKAgent> {
    const key = this.poolKey(projectId, purpose, actorId);
    const existing = this.pool.get(key);

    if (existing && !existing.busy) {
      existing.lastUsed = Date.now();
      return existing.agent;
    }

    // Create new agent
    const apiKey = await this.getApiKey();
    const projectService = new CodaScopeProjectService(this.projectsRoot);
    const project = await projectService.getProject(projectId);

    const repoPaths = project?.repositories?.map(
      (r: { path: string }) => r.path,
    ) ?? [];
    const projectDir = projectService.getProjectDir(projectId);

    // Create a stable collector holder for this pool entry.
    // Tool closures capture the holder; before each run we swap
    // holder.current to a fresh ToolResultCollector.
    const collectorHolder = new ToolResultCollectorHolder();

    const localWorkspace = getAgentLocalWorkspace(purpose, projectDir, repoPaths);
    const customTools = this.getToolsForPurpose(projectId, purpose, collectorHolder, actorId);
    const createAgent = (workspace: typeof localWorkspace) => Agent.create({
      model: { id: modelId },
      apiKey,
      name: `CodaScope ${purpose} — ${project?.name ?? projectId}`,
      local: {
        // Source repositories remain outside the wiki-build native
        // filesystem boundary. Custom tools run in the host service and
        // enforce their own project/repository scoping.
        ...workspace,
        customTools,
      },
    });

    const agent = await createAgentWithSandboxFallback(purpose, localWorkspace, createAgent);

    this.pool.set(key, {
      agent,
      projectId,
      purpose,
      actorId,
      lastUsed: Date.now(),
      busy: false,
      collectorHolder,
    });

    return agent;
  }

  private cleanIdleAgents(): void {
    const now = Date.now();
    const IDLE_MS = 10 * 60 * 1000; // 10 minutes

    for (const [key, entry] of this.pool) {
      if (!entry.busy && now - entry.lastUsed > IDLE_MS) {
        try {
          entry.agent.close();
        } catch {
          // ignore close errors
        }
        this.pool.delete(key);
      }
    }
  }

  /* ── Cancel Support ──────────────────────────────────────────────── */

  /**
   * Cancel an active agent chat for a project.
   * Returns true if a controller was found and aborted.
   */
  cancelAgent(projectId: string, actorId?: string): boolean {
    const key = this.activeChatKey(projectId, actorId);
    const controller = this.activeChatControllers.get(key);
    if (controller) {
      controller.abort();
      this.activeChatControllers.delete(key);
      return true;
    }
    return false;
  }

  /* ── Send Message ─────────────────────────────────────────────────── */

  async send(options: AgentSendOptions): Promise<void> {
    const { projectId, actorId, message, modelId, systemPrompt, context, images, purpose, onMessage, onDone, onError } = options;

    const key = this.poolKey(projectId, purpose, actorId);
    const chatKey = this.activeChatKey(projectId, actorId);

    // Set up AbortController for cancel support (assistant/chat only)
    const abortController = new AbortController();
    if (purpose === "assistant" || purpose === "chat") {
      // Cancel any existing controller for this project
      this.activeChatControllers.get(chatKey)?.abort();
      this.activeChatControllers.set(chatKey, abortController);
    }

    // Swap to a fresh per-run collector so concurrent runs don't cross-contaminate.
    // The pool entry's collectorHolder is a stable reference captured by tool closures;
    // swapping .current redirects all tool result collection to this run's collector.
    const runCollector = new ToolResultCollector();

    try {
      const agent = await this.getOrCreateAgent(projectId, purpose, modelId, actorId);

      const entry = this.pool.get(key);
      if (entry) {
        entry.busy = true;
        entry.collectorHolder.current = runCollector;
      }

      // Build the full message with optional context
      let fullMessage = "";
      if (systemPrompt) {
        fullMessage += systemPrompt + "\n\n";
      }
      if (context) {
        fullMessage += `<current_context>\n${context}\n</current_context>\n\n`;
      }
      fullMessage += message;

      // Build the message payload: use SDKUserMessage when images are present
      const messagePayload: string | SDKUserMessage = images && images.length > 0
        ? {
            text: fullMessage,
            images: images.map((img): SDKImage => ({
              data: img.data,
              mimeType: img.mimeType,
            })),
          }
        : fullMessage;

      const run = await agent.send(messagePayload, {
        model: { id: modelId },
        onDelta: ({ update }) => {
          // Check if cancelled
          if (abortController.signal.aborted) return;

          // Convert delta updates to a synthetic message for the frontend
          if ("text" in update && update.text) {
            onMessage({
              type: "assistant",
              agent_id: agent.agentId,
              run_id: run.id,
              message: {
                role: "assistant",
                content: [{ type: "text", text: update.text }],
              },
            } as SDKMessage);
          }
        },
      });

      // Wait for completion
      const result = await run.wait();

      if (entry) {
        entry.busy = false;
        entry.lastUsed = Date.now();
      }

      // Clean up controller
      this.activeChatControllers.delete(chatKey);

      if (abortController.signal.aborted) {
        runCollector.drain(); // discard collected results on cancel
        onError(new Error("Agent cancelled by user."));
      } else {
        // Forward any tool results collected during execution
        // (e.g., design doc tools push action tags to the collector)
        for (const text of runCollector.drain()) {
          onMessage({
            type: "tool-result",
            text,
          } as unknown as SDKMessage);
        }
        onDone(result);
      }
    } catch (err) {
      const entry = this.pool.get(key);
      if (entry) entry.busy = false;

      // If agent creation failed, remove from pool
      this.pool.delete(key);

      // Clean up controller
      this.activeChatControllers.delete(chatKey);

      if (abortController.signal.aborted) {
        onError(new Error("Agent cancelled by user."));
      } else {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /* ── Cleanup ──────────────────────────────────────────────────────── */

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Cancel all active chats
    for (const [, controller] of this.activeChatControllers) {
      controller.abort();
    }
    this.activeChatControllers.clear();

    for (const [, entry] of this.pool) {
      try {
        entry.agent.close();
      } catch {
        // ignore
      }
    }
    this.pool.clear();
  }
}
