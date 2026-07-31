/* ── CodaScope: Agent Service ─────────────────────────────────────────
   Manages Cursor SDK agent lifecycle for CodaScope.

   Key features:
   - Agent pool: one agent per (assistant scope, purpose, authenticated actor)
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
  Run,
  ModelListItem,
} from "@cursor/sdk";
import type { SecretService } from "./secretService.js";
import { CodaScopeProjectService } from "./codaScopeProjectService.js";
import {
  getToolsForPurpose,
  ToolResultCollector,
  ToolResultCollectorHolder,
  type AgentPurpose,
  type ProjectAgentPurpose,
} from "./codaScopeToolDefinitions.js";
import {
  assistantScopeKey,
  type AssistantScope,
} from "./codaScopeAssistantScope.js";
import {
  EMPTY_WORKSPACE_TURN_READ_GRANT,
  WorkspaceTurnReadGrantHolder,
  validateWorkspaceTurnReadGrant,
  type WorkspaceTurnReadGrant,
} from "./codaScopeWorkspaceReadGrant.js";
import {
  getWorkspaceTools,
  type WorkspaceToolServices,
} from "./codaScopeWorkspaceToolDefinitions.js";
import {
  EMPTY_WORKSPACE_TURN_NOTE_GRANT,
  WorkspaceTurnNoteGrantHolder,
  validateWorkspaceTurnNoteGrant,
  type WorkspaceTurnNoteGrant,
} from "./codaScopeWorkspaceNoteGrant.js";
import {
  WorkspaceMutationActionCollector,
  WorkspaceMutationActionCollectorHolder,
} from "./codaScopeWorkspaceMutationActions.js";
import {
  WorkspaceProvenanceCollector,
  WorkspaceProvenanceCollectorHolder,
  type WorkspaceRetrievedSourceReference,
} from "./codaScopeWorkspaceProvenance.js";
import type { CodaScopeAction } from "../../src/apps/codascope/codaScopeTypes.js";
import type { CanonicalProjectNoteRangeTarget } from "../../src/apps/codascope/projectNoteRangeTargetValidation.js";
import type { CodaScopeProjectNoteRangeService } from "./codaScopeProjectNoteRangeService.js";
import { ProjectNoteRangeGrantHolder } from "./codaScopeProjectNoteRangeGrant.js";
import {
  ProjectNoteRangeActionCollector,
  ProjectNoteRangeActionCollectorHolder,
} from "./codaScopeProjectNoteRangeMutationActions.js";
import {
  reportWorkspaceAssistantFailure,
  type WorkspaceAssistantFailureStage,
} from "./codaScopeWorkspaceAssistantDiagnostics.js";

/* ── Types ──────────────────────────────────────────────────────────── */

interface AgentSendCommonOptions {
  /** Authenticated actor for user-facing runs. Never taken from a tool arg. */
  actorId?: string;
  message: string;
  modelId: string;
  systemPrompt?: string;
  context?: string;
  images?: Array<{ data: string; mimeType: string }>;
  onMessage: (msg: SDKMessage) => void;
  onDone: (
    result: RunResult,
    workspaceRetrievedSources?: WorkspaceRetrievedSourceReference[],
    trustedMutationActions?: CodaScopeAction[],
  ) => void;
  onError: (err: Error, trustedMutationActions?: CodaScopeAction[]) => void;
}

export type AgentSendOptions =
  | (AgentSendCommonOptions & {
      scope: Extract<AssistantScope, { kind: "project" }>;
      purpose: ProjectAgentPurpose;
      workspaceReadGrant?: never;
      workspaceNoteGrant?: never;
      projectNoteRangeTarget?: CanonicalProjectNoteRangeTarget;
    })
  | (AgentSendCommonOptions & {
      scope: Extract<AssistantScope, { kind: "workspace" }>;
      purpose: "workspace-assistant";
      actorId: string;
      workspaceReadGrant?: WorkspaceTurnReadGrant;
      workspaceNoteGrant?: WorkspaceTurnNoteGrant;
    });

const PROJECT_PURPOSES = new Set<ProjectAgentPurpose>([
  "chat",
  "assistant",
  "wiki-build",
  "curation",
  "research",
  "artifact-build",
  "artifact-section-regen",
]);

const EPIC_MUTATION_PURPOSES = new Set<ProjectAgentPurpose>([
  "assistant",
  "chat",
  "curation",
  "research",
]);

interface PoolEntry {
  agent: SDKAgent;
  scope: AssistantScope;
  purpose: AgentPurpose;
  actorId?: string;
  lastUsed: number;
  busy: boolean;
  collectorHolder: ToolResultCollectorHolder;
  workspaceGrantHolder?: WorkspaceTurnReadGrantHolder;
  workspaceNoteGrantHolder?: WorkspaceTurnNoteGrantHolder;
  workspaceProvenanceHolder?: WorkspaceProvenanceCollectorHolder;
  workspaceMutationActionHolder?: WorkspaceMutationActionCollectorHolder;
  projectNoteRangeGrantHolder?: ProjectNoteRangeGrantHolder;
  projectNoteRangeActionHolder?: ProjectNoteRangeActionCollectorHolder;
}

export interface AgentLocalWorkspace {
  cwd?: string | string[];
  sandboxOptions?: { enabled: boolean };
}

export interface AgentLocalWorkspaceOptions {
  scope: AssistantScope;
  purpose: AgentPurpose | string;
  projectDir?: string | null;
  repoPaths?: string[];
  sandboxEnabled?: boolean;
}

/**
 * Resolve the native workspace exposed to a CodaScope agent.
 *
 * Wiki builds are intentionally isolated from repositories: their source
 * access is tool-mediated and the SDK sandbox is limited to CodaScope data.
 */
export function getAgentLocalWorkspace(
  options: AgentLocalWorkspaceOptions,
): AgentLocalWorkspace {
  const {
    scope,
    purpose,
    projectDir = null,
    repoPaths = [],
    sandboxEnabled = true,
  } = options;
  if (scope.kind === "workspace") return {};

  if (purpose === "wiki-build") {
    if (!projectDir) throw new Error("CodaScope project directory not found for wiki build.");
    return {
      cwd: projectDir,
      sandboxOptions: { enabled: sandboxEnabled },
    };
  }

  return { cwd: repoPaths.length > 0 ? repoPaths : undefined };
}

export function assertAgentPurposeScope(
  scope: AssistantScope,
  purpose: string,
): asserts purpose is AgentPurpose {
  if (scope.kind === "workspace") {
    if (purpose !== "workspace-assistant") {
      throw new Error(`Invalid CodaScope purpose/scope combination: ${purpose} on workspace`);
    }
    return;
  }
  if (!PROJECT_PURPOSES.has(purpose as ProjectAgentPurpose)) {
    throw new Error(`Invalid CodaScope purpose/scope combination: ${purpose} on project`);
  }
}

export function getAgentName(options: {
  scope: AssistantScope;
  purpose: AgentPurpose;
  projectName?: string | null;
}): string {
  if (options.scope.kind === "workspace") {
    return "CodaScope Workspace Assistant";
  }
  return `CodaScope ${options.purpose} — ${
    options.projectName ?? options.scope.projectId
  }`;
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
  onSandboxUnsupported?: () => void,
): Promise<T> {
  try {
    return await create(workspace);
  } catch (error) {
    if (purpose !== "wiki-build" || !isLocalSandboxUnsupportedError(error)) throw error;
    onSandboxUnsupported?.();
    console.warn("[CodaScope] SDK sandbox unavailable; running wiki-build with project cwd and scoped tools.");
    // Be explicit: omitting the option could inherit an enabled user-level
    // ~/.cursor/sandbox.json setting and repeat the same failure.
    return create({ ...workspace, sandboxOptions: { enabled: false } });
  }
}

/** Retry a run start when the SDK defers its sandbox capability check until send(). */
export async function startRunWithSandboxFallback<TAgent, TRun>(
  purpose: string,
  agent: TAgent,
  start: (agent: TAgent) => Promise<TRun>,
  createFallbackAgent: () => Promise<TAgent>,
): Promise<{ agent: TAgent; run: TRun }> {
  try {
    return { agent, run: await start(agent) };
  } catch (error) {
    if (purpose !== "wiki-build" || !isLocalSandboxUnsupportedError(error)) throw error;
    console.warn("[CodaScope] SDK sandbox unavailable at run start; recreating wiki-build agent without sandboxing.");
    const fallbackAgent = await createFallbackAgent();
    return { agent: fallbackAgent, run: await start(fallbackAgent) };
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
  private workspaceTools?: WorkspaceToolServices;
  private projectNoteRangeService?: CodaScopeProjectNoteRangeService;
  private pool = new Map<string, PoolEntry>();
  private modelCache: ModelCache | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  /** SDK sandbox support is a host capability, not a project-specific setting. */
  private wikiBuildSandboxUnsupported = false;
  private disposed = false;

  /** Active chat AbortControllers keyed by assistant scope and actor. */
  private activeChatControllers = new Map<string, AbortController>();
  /** Every SDK run, including non-chat builds, must be cancellable on cutover. */
  private activeRuns = new Map<string, Set<Run>>();
  /** Busy agents can temporarily fall outside the one-entry-per-pool-key map. */
  private allAgents = new Set<SDKAgent>();

  constructor(
    secretService: SecretService,
    projectsRoot: string,
    workspaceTools?: WorkspaceToolServices,
    projectNoteRangeService?: CodaScopeProjectNoteRangeService,
  ) {
    this.secretService = secretService;
    this.projectsRoot = projectsRoot;
    this.workspaceTools = workspaceTools;
    this.projectNoteRangeService = projectNoteRangeService;

    // Clean up idle agents every 2 minutes
    this.cleanupTimer = setInterval(() => this.cleanIdleAgents(), 2 * 60 * 1000);
    this.cleanupTimer.unref?.();
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

  private getToolsForPurpose(
    options: {
      scope: AssistantScope;
      purpose: AgentPurpose;
      collectorHolder: ToolResultCollectorHolder;
      workspaceGrantHolder?: WorkspaceTurnReadGrantHolder;
      workspaceNoteGrantHolder?: WorkspaceTurnNoteGrantHolder;
      workspaceProvenanceHolder?: WorkspaceProvenanceCollectorHolder;
      workspaceMutationActionHolder?: WorkspaceMutationActionCollectorHolder;
      projectNoteRangeGrantHolder?: ProjectNoteRangeGrantHolder;
      projectNoteRangeActionHolder?: ProjectNoteRangeActionCollectorHolder;
      actorId?: string;
    },
  ): Record<string, SDKCustomTool> {
    const {
      scope,
      purpose,
      collectorHolder,
      workspaceGrantHolder,
      workspaceNoteGrantHolder,
      workspaceProvenanceHolder,
      workspaceMutationActionHolder,
      projectNoteRangeGrantHolder,
      projectNoteRangeActionHolder,
      actorId,
    } = options;
    assertAgentPurposeScope(scope, purpose);
    if (scope.kind === "workspace") {
      if (!this.workspaceTools
        || !workspaceGrantHolder
        || !workspaceNoteGrantHolder
        || !workspaceMutationActionHolder
        || !actorId) {
        throw new Error("CodaScope workspace tool dependencies are unavailable.");
      }
      return getWorkspaceTools(
        this.workspaceTools,
        workspaceGrantHolder,
        workspaceProvenanceHolder,
        workspaceNoteGrantHolder,
        workspaceMutationActionHolder,
        actorId,
      );
    }
    return getToolsForPurpose(
      scope.projectId,
      this.projectsRoot,
      purpose,
      collectorHolder,
      actorId,
      this.projectNoteRangeService
        && projectNoteRangeGrantHolder
        && projectNoteRangeActionHolder
        ? {
            service: this.projectNoteRangeService,
            grantHolder: projectNoteRangeGrantHolder,
            actionHolder: projectNoteRangeActionHolder,
          }
        : undefined,
    );
  }

  /* ── Agent Pool ───────────────────────────────────────────────────── */

  private poolKey(
    scope: AssistantScope,
    purpose: string,
    actorId?: string,
  ): string {
    // Tool closures carry the actor into note/document authorization. Do not
    // reuse one actor's closures for another actor, even when scope/purpose
    // match. A system run is a distinct boundary as well.
    return `${assistantScopeKey(scope)}::${purpose}::${actorId ?? "system"}`;
  }

  private activeChatKey(scope: AssistantScope, actorId?: string): string {
    return `${assistantScopeKey(scope)}::${actorId ?? "system"}`;
  }

  private async getOrCreateAgent(options: {
    scope: AssistantScope;
    purpose: AgentPurpose;
    modelId: string;
    actorId?: string;
  }): Promise<SDKAgent> {
    if (this.disposed) throw new Error("CodaScope agent service has been disposed.");
    const { scope, purpose, modelId, actorId } = options;
    assertAgentPurposeScope(scope, purpose);
    const key = this.poolKey(scope, purpose, actorId);
    const existing = this.pool.get(key);

    if (existing && !existing.busy) {
      existing.lastUsed = Date.now();
      return existing.agent;
    }

    // Create a stable collector holder for this pool entry. Tool closures
    // capture holders whose current run state is replaced before every send.
    const apiKey = await this.getApiKey();
    const collectorHolder = new ToolResultCollectorHolder();
    const workspaceGrantHolder = scope.kind === "workspace"
      ? new WorkspaceTurnReadGrantHolder()
      : undefined;
    const workspaceNoteGrantHolder = scope.kind === "workspace"
      ? new WorkspaceTurnNoteGrantHolder()
      : undefined;
    const workspaceProvenanceHolder = scope.kind === "workspace"
      ? new WorkspaceProvenanceCollectorHolder()
      : undefined;
    const workspaceMutationActionHolder = scope.kind === "workspace"
      ? new WorkspaceMutationActionCollectorHolder()
      : undefined;
    const projectNoteRangeGrantHolder = scope.kind === "project"
      && (purpose === "assistant" || purpose === "chat")
      ? new ProjectNoteRangeGrantHolder()
      : undefined;
    const projectNoteRangeActionHolder = scope.kind === "project"
      && (purpose === "assistant" || purpose === "chat")
      ? new ProjectNoteRangeActionCollectorHolder()
      : undefined;

    let projectName: string | null = null;
    let projectDir: string | null = null;
    let repoPaths: string[] = [];
    if (scope.kind === "project") {
      const projectService = new CodaScopeProjectService(this.projectsRoot);
      const project = await projectService.getProject(scope.projectId);
      projectName = project?.name ?? scope.projectId;
      repoPaths = project?.repositories?.map(
        (repository: { path: string }) => repository.path,
      ) ?? [];
      projectDir = projectService.getProjectDir(scope.projectId);
    }

    const localWorkspace = getAgentLocalWorkspace({
      scope,
      purpose,
      projectDir,
      repoPaths,
      sandboxEnabled: purpose !== "wiki-build"
        || !this.wikiBuildSandboxUnsupported,
    });
    const customTools = this.getToolsForPurpose({
      scope,
      purpose,
      collectorHolder,
      workspaceGrantHolder,
      workspaceNoteGrantHolder,
      workspaceProvenanceHolder,
      workspaceMutationActionHolder,
      projectNoteRangeGrantHolder,
      projectNoteRangeActionHolder,
      actorId,
    });
    const agentName = getAgentName({ scope, purpose, projectName });
    const createAgent = (workspace: typeof localWorkspace) => Agent.create({
      model: { id: modelId },
      apiKey,
      name: agentName,
      local: {
        // Source repositories remain outside the wiki-build native
        // filesystem boundary. Custom tools run in the host service and
        // enforce their own project/repository scoping.
        ...workspace,
        customTools,
      },
    });

    const agent = await createAgentWithSandboxFallback(
      purpose,
      localWorkspace,
      createAgent,
      () => { this.wikiBuildSandboxUnsupported = true; },
    );
    if (this.disposed) {
      try { agent.close(); } catch { /* already unusable */ }
      throw new Error("CodaScope agent service was disposed during agent creation.");
    }
    this.allAgents.add(agent);

    this.pool.set(key, {
      agent,
      scope,
      purpose,
      actorId,
      lastUsed: Date.now(),
      busy: false,
      collectorHolder,
      workspaceGrantHolder,
      workspaceNoteGrantHolder,
      workspaceProvenanceHolder,
      workspaceMutationActionHolder,
      projectNoteRangeGrantHolder,
      projectNoteRangeActionHolder,
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
        this.clearWorkspaceEntryState(entry);
        this.allAgents.delete(entry.agent);
        this.pool.delete(key);
      }
    }
  }

  /* ── Cancel Support ──────────────────────────────────────────────── */

  /** Cancel an active assistant run without crossing scope or actor custody. */
  cancelAgent(options: { scope: AssistantScope; actorId?: string }): boolean {
    const { scope, actorId } = options;
    const key = this.activeChatKey(scope, actorId);
    const controller = this.activeChatControllers.get(key);
    const runs = this.activeRuns.get(key);
    for (const run of runs ?? []) void run.cancel().catch(() => undefined);
    if (controller) {
      controller.abort();
      this.activeChatControllers.delete(key);
      return true;
    }
    return Boolean(runs?.size);
  }

  /* ── Send Message ─────────────────────────────────────────────────── */

  async send(options: AgentSendOptions): Promise<void> {
    const {
      scope,
      actorId,
      message,
      modelId,
      systemPrompt,
      context,
      images,
      purpose,
      onMessage,
      onDone,
      onError,
    } = options;

    if (this.disposed) {
      const error = new Error("CodaScope agent service has been disposed.");
      onError(scope.kind === "workspace"
        ? reportWorkspaceAssistantFailure("agent_prerequisites", error)
        : error);
      return;
    }
    try {
      assertAgentPurposeScope(scope, purpose);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      onError(scope.kind === "workspace"
        ? reportWorkspaceAssistantFailure("agent_prerequisites", normalized)
        : normalized);
      return;
    }
    if ((purpose === "workspace-assistant"
      || EPIC_MUTATION_PURPOSES.has(purpose as ProjectAgentPurpose))
      && !actorId?.trim()) {
      const error = new Error(
        `An authenticated initiating actor is required for ${purpose} agent tools.`,
      );
      onError(purpose === "workspace-assistant"
        ? reportWorkspaceAssistantFailure("agent_prerequisites", error)
        : error);
      return;
    }

    let workspaceReadGrant = EMPTY_WORKSPACE_TURN_READ_GRANT;
    let workspaceNoteGrant = EMPTY_WORKSPACE_TURN_NOTE_GRANT;
    let projectNoteRangeTarget: CanonicalProjectNoteRangeTarget | null = null;
    if (scope.kind === "workspace") {
      if (!this.workspaceTools) {
        onError(reportWorkspaceAssistantFailure(
          "agent_prerequisites",
          new Error("CodaScope workspace tool dependencies are unavailable."),
        ));
        return;
      }
      try {
        workspaceReadGrant = await validateWorkspaceTurnReadGrant(
          options.workspaceReadGrant ?? EMPTY_WORKSPACE_TURN_READ_GRANT,
          this.workspaceTools.activeResolver,
        );
        if (this.workspaceTools.workspaceNote) {
          workspaceNoteGrant = await validateWorkspaceTurnNoteGrant(
            options.workspaceNoteGrant ?? EMPTY_WORKSPACE_TURN_NOTE_GRANT,
            actorId!,
            this.workspaceTools.workspaceNote,
          );
        } else if (options.workspaceNoteGrant !== undefined) {
          throw new Error("Workspace note grant is unavailable.");
        }
      } catch (error) {
        onError(reportWorkspaceAssistantFailure(
          "agent_grant_validation",
          error,
        ));
        return;
      }
    }
    if (scope.kind === "project"
      && "projectNoteRangeTarget" in options
      && options.projectNoteRangeTarget !== undefined) {
      if ((purpose !== "assistant" && purpose !== "chat")
        || !actorId
        || !this.projectNoteRangeService) {
        onError(new Error("Project note-range authority is unavailable."));
        return;
      }
      try {
        projectNoteRangeTarget =
          await this.projectNoteRangeService.revalidateTarget(
            actorId,
            options.projectNoteRangeTarget,
          );
      } catch {
        onError(new Error("Project note-range authority is invalid or stale."));
        return;
      }
    }

    const key = this.poolKey(scope, purpose, actorId);
    const chatKey = this.activeChatKey(scope, actorId);

    // Set up AbortController for cancel support (assistant/chat only)
    const abortController = new AbortController();
    if (purpose === "assistant"
      || purpose === "chat"
      || purpose === "workspace-assistant") {
      // Cancel any existing controller for this scope and actor.
      this.activeChatControllers.get(chatKey)?.abort();
      this.activeChatControllers.set(chatKey, abortController);
    }

    // Swap to a fresh per-run collector so concurrent runs don't cross-contaminate.
    // The pool entry's collectorHolder is a stable reference captured by tool closures;
    // swapping .current redirects all tool result collection to this run's collector.
    const runCollector = new ToolResultCollector();
    const workspaceProvenanceCollector = new WorkspaceProvenanceCollector();
    const workspaceMutationActionCollector =
      new WorkspaceMutationActionCollector();
    const projectNoteRangeActionCollector =
      new ProjectNoteRangeActionCollector();
    let activeEntry: PoolEntry | undefined;
    let startedRun: Run | undefined;
    let workspaceFailureStage: WorkspaceAssistantFailureStage =
      "agent_creation";

    try {
      const agent = await this.getOrCreateAgent({
        scope,
        purpose,
        modelId,
        actorId,
      });
      if (this.disposed) throw new Error("CodaScope agent service has been disposed.");

      activeEntry = this.pool.get(key);
      if (activeEntry) {
        activeEntry.busy = true;
        activeEntry.collectorHolder.current = runCollector;
        activeEntry.workspaceGrantHolder?.replace(workspaceReadGrant);
        activeEntry.workspaceNoteGrantHolder?.replace(workspaceNoteGrant);
        if (activeEntry.workspaceProvenanceHolder) {
          activeEntry.workspaceProvenanceHolder.current =
            workspaceProvenanceCollector;
        }
        if (activeEntry.workspaceMutationActionHolder) {
          activeEntry.workspaceMutationActionHolder.current =
            workspaceMutationActionCollector;
        }
        activeEntry.projectNoteRangeGrantHolder?.replace(
          projectNoteRangeTarget,
        );
        if (activeEntry.projectNoteRangeActionHolder) {
          activeEntry.projectNoteRangeActionHolder.current =
            projectNoteRangeActionCollector;
        }
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

      workspaceFailureStage = "agent_start";
      const startRun = async (currentAgent: SDKAgent) => {
        // Deltas arrive after send() resolves in the SDK, but retaining the id
        // separately also keeps the retry path free of a temporal-dead-zone
        // reference to the pending run.
        let runId = "";
        const run = await currentAgent.send(messagePayload, {
          model: { id: modelId },
          onDelta: ({ update }) => {
            // Check if cancelled
            if (abortController.signal.aborted) return;

            // Convert delta updates to a synthetic message for the frontend
            if ("text" in update && update.text) {
              onMessage({
                type: "assistant",
                agent_id: currentAgent.agentId,
                run_id: runId,
                message: {
                  role: "assistant",
                  content: [{ type: "text", text: update.text }],
                },
              } as SDKMessage);
            }
          },
        });
        runId = run.id;
        return run;
      };

      const { run } = await startRunWithSandboxFallback(
        purpose,
        agent,
        startRun,
        async () => {
          // The SDK can defer the capability check to send(). Discard this
          // unusable agent, remember the host capability, then create a fresh
          // agent with sandboxing explicitly disabled.
          this.wikiBuildSandboxUnsupported = true;
          const staleEntry = this.pool.get(key);
          if (staleEntry?.agent === agent) {
            try {
              staleEntry.agent.close();
            } catch {
              // The failed agent has no usable run; close errors are harmless.
            }
            this.allAgents.delete(staleEntry.agent);
            this.clearWorkspaceEntryState(staleEntry);
            this.pool.delete(key);
          }

          const fallbackAgent = await this.getOrCreateAgent({
            scope,
            purpose,
            modelId,
            actorId,
          });
          activeEntry = this.pool.get(key);
          if (activeEntry) {
            activeEntry.busy = true;
            activeEntry.collectorHolder.current = runCollector;
            activeEntry.workspaceGrantHolder?.replace(workspaceReadGrant);
            activeEntry.workspaceNoteGrantHolder?.replace(workspaceNoteGrant);
            if (activeEntry.workspaceProvenanceHolder) {
              activeEntry.workspaceProvenanceHolder.current =
                workspaceProvenanceCollector;
            }
            if (activeEntry.workspaceMutationActionHolder) {
              activeEntry.workspaceMutationActionHolder.current =
                workspaceMutationActionCollector;
            }
            activeEntry.projectNoteRangeGrantHolder?.replace(
              projectNoteRangeTarget,
            );
            if (activeEntry.projectNoteRangeActionHolder) {
              activeEntry.projectNoteRangeActionHolder.current =
                projectNoteRangeActionCollector;
            }
          }
          return fallbackAgent;
        },
      );
      startedRun = run;

      // shutdown() can race an SDK send() that has not returned a Run yet.
      // Do not let that late Run escape the old service graph after a root
      // cutover has already completed.
      if (this.disposed) {
        await run.cancel().catch(() => undefined);
        await run.wait().catch(() => undefined);
        throw new Error("CodaScope agent service has been shut down.");
      }

      const scopedRuns = this.activeRuns.get(chatKey) ?? new Set<Run>();
      scopedRuns.add(run);
      this.activeRuns.set(chatKey, scopedRuns);

      // Wait for completion
      workspaceFailureStage = "agent_execution";
      const result = await run.wait();
      const terminalStatus = "status" in result
        ? String(result.status)
        : "";
      if (terminalStatus
        && terminalStatus !== "finished"
        && terminalStatus !== "completed") {
        throw new Error(
          `Cursor SDK run ended with terminal status "${terminalStatus}".`,
        );
      }
      this.removeActiveRun(chatKey, run);

      if (activeEntry) {
        activeEntry.busy = false;
        activeEntry.lastUsed = Date.now();
        activeEntry.workspaceGrantHolder?.clear();
        activeEntry.workspaceNoteGrantHolder?.clear();
        activeEntry.projectNoteRangeGrantHolder?.clear();
      }

      // Clean up controller
      if (this.activeChatControllers.get(chatKey) === abortController) {
        this.activeChatControllers.delete(chatKey);
      }

      if (abortController.signal.aborted) {
        runCollector.drain(); // discard collected results on cancel
        workspaceProvenanceCollector.clear();
        const mutationActions = scope.kind === "workspace"
          ? workspaceMutationActionCollector.drain()
          : projectNoteRangeActionCollector.drain();
        activeEntry?.workspaceMutationActionHolder?.clear();
        activeEntry?.projectNoteRangeActionHolder?.clear();
        onError(
          new Error("Agent cancelled by user."),
          mutationActions,
        );
      } else {
        // Forward any tool results collected during execution
        // (e.g., design doc tools push action tags to the collector)
        for (const text of runCollector.drain()) {
          onMessage({
            type: "tool-result",
            text,
          } as unknown as SDKMessage);
        }
        const mutationActions = scope.kind === "workspace"
          ? workspaceMutationActionCollector.drain()
          : projectNoteRangeActionCollector.drain();
        activeEntry?.workspaceMutationActionHolder?.clear();
        activeEntry?.projectNoteRangeActionHolder?.clear();
        onDone(
          result,
          workspaceProvenanceCollector.drain(),
          mutationActions,
        );
      }
    } catch (err) {
      if (activeEntry) {
        activeEntry.busy = false;
        activeEntry.workspaceGrantHolder?.clear();
        activeEntry.workspaceNoteGrantHolder?.clear();
        activeEntry.projectNoteRangeGrantHolder?.clear();
      }

      // Never let an older failed run delete a newer busy entry that reused
      // the same scope/purpose/actor key.
      if (activeEntry && this.pool.get(key) === activeEntry) {
        this.pool.delete(key);
      }

      if (this.activeChatControllers.get(chatKey) === abortController) {
        this.activeChatControllers.delete(chatKey);
      }
      if (startedRun) this.removeActiveRun(chatKey, startedRun);

      if (abortController.signal.aborted) {
        workspaceProvenanceCollector.clear();
        const mutationActions = scope.kind === "workspace"
          ? workspaceMutationActionCollector.drain()
          : projectNoteRangeActionCollector.drain();
        activeEntry?.workspaceMutationActionHolder?.clear();
        activeEntry?.projectNoteRangeActionHolder?.clear();
        onError(
          new Error("Agent cancelled by user."),
          mutationActions,
        );
      } else if (scope.kind === "workspace") {
        workspaceProvenanceCollector.clear();
        const mutationActions = workspaceMutationActionCollector.drain();
        activeEntry?.workspaceMutationActionHolder?.clear();
        onError(
          reportWorkspaceAssistantFailure(workspaceFailureStage, err, {
            actions: mutationActions,
          }),
          mutationActions,
        );
      } else {
        workspaceProvenanceCollector.clear();
        const mutationActions = projectNoteRangeActionCollector.drain();
        activeEntry?.projectNoteRangeActionHolder?.clear();
        onError(
          err instanceof Error ? err : new Error(String(err)),
          mutationActions,
        );
      }
    }
  }

  private removeActiveRun(key: string, run: Run): void {
    const runs = this.activeRuns.get(key);
    if (!runs) return;
    runs.delete(run);
    if (runs.size === 0) this.activeRuns.delete(key);
  }

  private clearWorkspaceEntryState(entry: PoolEntry): void {
    entry.workspaceGrantHolder?.clear();
    entry.workspaceNoteGrantHolder?.clear();
    entry.workspaceProvenanceHolder?.current.clear();
    entry.workspaceMutationActionHolder?.clear();
    entry.projectNoteRangeGrantHolder?.clear();
    entry.projectNoteRangeActionHolder?.clear();
  }

  /* ── Cleanup ──────────────────────────────────────────────────────── */

  async shutdown(): Promise<void> {
    this.disposed = true;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Cancel all active chats
    for (const [, controller] of this.activeChatControllers) {
      controller.abort();
    }
    this.activeChatControllers.clear();

    const runs = [...this.activeRuns.values()].flatMap((group) => [...group]);
    this.activeRuns.clear();
    await Promise.allSettled(runs.map((run) => run.cancel()));
    await Promise.allSettled(runs.map((run) => run.wait()));

    for (const entry of this.pool.values()) {
      this.clearWorkspaceEntryState(entry);
    }
    for (const agent of this.allAgents) {
      try {
        agent.close();
      } catch {
        // ignore
      }
    }
    this.allAgents.clear();
    this.pool.clear();
  }
}
