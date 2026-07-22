/* ── CodaScope: Build State Service ───────────────────────────────────
   Tracks active builds and stores build logs on disk.

   Key features:
   - In-memory build state per project (survives until server restart)
   - Build output streamed to disk as it arrives (survives page refresh)
   - Build log history stored as JSON files for long-term reference
   - Reconnectable: clients can read the stored output file on refresh

   Storage layout:
     <projectDir>/build-logs/
       <runId>.log     — raw agent output (appended during streaming)
       <runId>.json    — metadata (status, timestamps, summary)
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertSafePathSegment } from "./codaScopePathSafety.js";

/* ── Types ──────────────────────────────────────────────────────────── */

export type BuildStatus = "idle" | "building" | "complete" | "error";

export interface TokenUsageRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

export interface PipelineStepRecord {
  id: string;
  label: string;
  status: string;
  detail?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  tokenUsage?: TokenUsageRecord;
  updatedAt: string;
}

export interface BuildState {
  runId: string;
  status: BuildStatus;
  command: string;
  modelId: string;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  error: string | null;
  outputLength: number;  // bytes of output written so far
  pipelineSteps: PipelineStepRecord[];
  scope?: string;  // Optional scope key (e.g. "epic-deepen::epicId", "research::epicId")
  buildType?: "analyze" | "deep-run";
}

export interface BuildLogEntry {
  runId: string;
  command: string;
  modelId: string;
  status: BuildStatus;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  error: string | null;
  pageCount: number | null;
  durationMs: number | null;
  pipelineSteps?: PipelineStepRecord[];
  // ── Build Analytics ──
  totalTokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  buildMode?: string;
  buildType?: string;
  syncGitHeads?: Record<string, string>;
  topicsBuilt?: number;
  topicsSkipped?: number;
}

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeBuildStateService {
  private root: string;

  /** Active build state per key (in-memory). Key = projectId or projectId::scope */
  private activeBuilds = new Map<string, BuildState>();

  /** Track which keys have been hydrated from disk */
  private hydratedKeys = new Set<string>();

  /** Map project IDs to their actual directory paths on disk */
  private projectDirs = new Map<string, string>();

  /** Cancelled builds — build key set, checked by running pipelines */
  private cancelledKeys = new Set<string>();

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /** Invalidate all in-memory work before this root-bound service is discarded. */
  dispose(): void {
    for (const [key, state] of this.activeBuilds) {
      if (state.status === "building") this.cancelledKeys.add(key);
    }
    this.projectDirs.clear();
    this.hydratedKeys.clear();
  }

  /** Compute the internal map key for a projectId + optional scope. */
  private buildKey(projectId: string, scope?: string): string {
    return scope ? `${projectId}::${scope}` : projectId;
  }

  /** Request cancellation of the active build for a project (optionally scoped). */
  cancelBuild(projectId: string, scope?: string): void {
    this.cancelledKeys.add(this.buildKey(projectId, scope));
  }

  /** Check if the build for a project has been cancelled (optionally scoped). */
  isCancelled(projectId: string, scope?: string): boolean {
    return this.cancelledKeys.has(this.buildKey(projectId, scope));
  }

  /** Clear the cancellation flag (call when a new build starts). */
  clearCancellation(projectId: string, scope?: string): void {
    this.cancelledKeys.delete(this.buildKey(projectId, scope));
  }

  /**
   * Register the actual filesystem directory for a project.
   * Call this before any build operations so build-logs go to the right place.
   */
  registerProjectDir(projectId: string, projectDir: string): void {
    this.projectDirs.set(projectId, projectDir);
  }

  /**
   * Hydrate build state from disk for a given project.
   * If a build was "building" when the server crashed, mark it as interrupted.
   * Only runs once per project per server lifetime.
   */
  /**
   * Hydrate build state from disk for a given key.
   * If a build was "building" when the server crashed, mark it as interrupted.
   * Only runs once per key per server lifetime.
   *
   * When scope is provided, only hydrates builds matching that scope.
   */
  private hydrateFromDisk(projectId: string, scope?: string): void {
    const key = this.buildKey(projectId, scope);
    if (this.hydratedKeys.has(key)) return;
    this.hydratedKeys.add(key);

    // If we already have in-memory state for this key, skip disk read
    if (this.activeBuilds.has(key)) return;

    const dir = this.buildLogsDir(projectId);
    if (!existsSync(dir)) return;

    // Find all .json build logs, sorted most-recent first
    const jsonFiles = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const fullPath = path.join(dir, f);
        try {
          const stat = statSync(fullPath);
          return { file: f, path: fullPath, mtime: stat.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as { file: string; path: string; mtime: number }[];

    if (jsonFiles.length === 0) return;

    jsonFiles.sort((a, b) => b.mtime - a.mtime);

    // Find the most recent log that matches the requested scope
    for (const file of jsonFiles) {
      try {
        const data = JSON.parse(readFileSync(file.path, "utf-8")) as BuildLogEntry;

        // Scope matching: if scope is provided, only match builds with that scope
        const logScope = (data as BuildLogEntry & { scope?: string }).scope;
        if (scope && logScope !== scope) continue;
        if (!scope && logScope) continue; // unscoped query should not match scoped builds

        // Convert BuildLogEntry back into BuildState
        const state: BuildState = {
          runId: data.runId,
          status: data.status,
          command: data.command,
          modelId: data.modelId,
          startedAt: data.startedAt,
          completedAt: data.completedAt,
          summary: data.summary,
          error: data.error,
          outputLength: 0,
          pipelineSteps: data.pipelineSteps ?? [],
          scope: logScope,
        };

        // If the build was interrupted (still "building" on disk), mark it as crashed
        if (state.status === "building") {
          const now = new Date();
          state.status = "error";
          state.completedAt = now.toISOString();
          state.error = "Build was interrupted by server restart.";
          const startTime = new Date(state.startedAt).getTime();
          const durationMs = now.getTime() - startTime;
          state.summary = `Interrupted after ${formatDuration(durationMs)}`;

          // Update the on-disk metadata too
          const entry: BuildLogEntry = {
            ...data,
            status: "error",
            completedAt: state.completedAt,
            summary: state.summary,
            error: state.error,
            durationMs,
          };
          writeFileSync(file.path, JSON.stringify(entry, null, 2), "utf-8");
        }

        this.activeBuilds.set(key, state);
        return; // found the matching log, stop searching
      } catch {
        // Skip corrupt files, try next
      }
    }
  }

  /* ── Directory helpers ─────────────────────────────────────────────── */

  private buildLogsDir(projectId: string): string {
    // Use the registered project directory if available, otherwise fall back to ID-based path
    const baseDir = this.projectDirs.get(projectId)
      ?? path.join(this.root, assertSafePathSegment(projectId, "project ID"));
    return path.join(baseDir, "build-logs");
  }

  private runMetadataPath(projectId: string, runId: string): string {
    return path.join(
      this.buildLogsDir(projectId),
      `${assertSafePathSegment(runId, "run ID")}.json`,
    );
  }

  private runLogPath(projectId: string, runId: string): string {
    return path.join(
      this.buildLogsDir(projectId),
      `${assertSafePathSegment(runId, "run ID")}.log`,
    );
  }

  private ensureBuildLogsDir(projectId: string): string {
    const dir = this.buildLogsDir(projectId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /* ── Build lifecycle ───────────────────────────────────────────────── */

  /**
   * Start a new build. Returns the runId, or null if a build is already running.
   *
   * @param scope — Optional scope key for per-epic builds (e.g. "research::epicId").
   *   Scoped builds are independent of each other and of unscoped project builds.
   */
  startBuild(projectId: string, command: string, modelId: string, scope?: string): string | null {
    const key = this.buildKey(projectId, scope);

    // Hydrate from disk first to detect stale builds
    this.hydrateFromDisk(projectId, scope);

    const existing = this.activeBuilds.get(key);
    if (existing && existing.status === "building") {
      return null; // Already building
    }

    // Clear any previous cancellation
    this.clearCancellation(projectId, scope);

    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    this.ensureBuildLogsDir(projectId);

    const state: BuildState = {
      runId,
      status: "building",
      command,
      modelId,
      startedAt: new Date().toISOString(),
      completedAt: null,
      summary: null,
      error: null,
      outputLength: 0,
      pipelineSteps: [],
      scope,
    };

    this.activeBuilds.set(key, state);

    // Write initial metadata (include scope for disk hydration)
    const metaPath = this.runMetadataPath(projectId, runId);
    writeFileSync(metaPath, JSON.stringify(state, null, 2), "utf-8");

    // Create empty log file
    const logPath = this.runLogPath(projectId, runId);
    writeFileSync(logPath, "", "utf-8");

    return runId;
  }

  /** Append output text to the build log file. */
  appendOutput(projectId: string, runId: string, text: string, scope?: string): void {
    const logPath = this.runLogPath(projectId, runId);
    appendFileSync(logPath, text, "utf-8");

    const key = this.buildKey(projectId, scope);
    const state = this.activeBuilds.get(key);
    if (state && state.runId === runId) {
      state.outputLength += Buffer.byteLength(text, "utf-8");
    }
  }

  /** Record a pipeline step update. Persists to disk for reconnection. */
  addPipelineStep(
    projectId: string,
    runId: string,
    step: { step: string; status: string; repo?: string; topic?: string; progress?: string; reason?: string; error?: string; mode?: string; tokenUsage?: TokenUsageRecord },
    scope?: string,
  ): void {
    const key = this.buildKey(projectId, scope);
    const state = this.activeBuilds.get(key);
    if (!state || state.runId !== runId) return;

    const labelMap: Record<string, string> = {
      "code-map": "Code Map",
      "wiki": "Wiki",
      "wiki-draft": "Wiki (Draft)",
      "wiki-enrich": "Wiki (Enrichment)",
      "wiki-delta": "Wiki (Delta)",
      "wiki-outline": "Wiki (Outline)",
      "wiki-state": "Wiki State",
      "quality": "Quality Scan",
      "generate-plan": "Research Plan",
      "execute-downloads": "Download Sources",
      "process-sources": "Process Sources",
      // Deep Run pipeline steps
      "deep-code-map": "⚡ Code Maps (Force Refresh)",
      "deep-outline": "⚡ Wiki Outline",
      // deep-cross-ref-batch-* steps are resolved dynamically below
      "deep-index": "⚡ Regenerate Index",
      "deep-finalize": "⚡ Finalize Sync Point",
    };

    let detail = "";
    if (step.repo) detail = step.repo;
    if (step.topic) detail = step.topic;
    if (step.progress) detail = step.progress;
    if (step.reason) detail = step.reason;
    if (step.error) detail = `Error: ${step.error}`;
    if (step.mode) detail = step.mode;

    const now = new Date().toISOString();
    const existing = state.pipelineSteps.findIndex((s) => s.id === step.step);

    // Resolve dynamic step labels
    let resolvedLabel = labelMap[step.step];
    if (!resolvedLabel && step.step.startsWith("deep-cross-ref-batch-")) {
      resolvedLabel = `⚡ Cross-References (${step.progress || step.step.slice("deep-cross-ref-".length)})`;
    }

    // Preserve startedAt from existing record, or set it now if step is starting
    let startedAt = now;
    let completedAt: string | undefined;
    let durationMs: number | undefined;
    let tokenUsage: TokenUsageRecord | undefined = step.tokenUsage;

    if (existing >= 0) {
      const prev = state.pipelineSteps[existing];
      startedAt = prev.startedAt; // preserve original start time
      // Carry forward tokenUsage if not provided in this update
      if (!tokenUsage && prev.tokenUsage) tokenUsage = prev.tokenUsage;
    }

    // If step is completing, compute duration
    const isTerminal = ["complete", "error", "skipped", "enriched"].includes(step.status);
    if (isTerminal) {
      completedAt = now;
      durationMs = new Date(now).getTime() - new Date(startedAt).getTime();
    }

    const record: PipelineStepRecord = {
      id: step.step,
      label: resolvedLabel ?? step.step,
      status: step.status,
      detail: detail || undefined,
      startedAt,
      completedAt,
      durationMs,
      tokenUsage,
      updatedAt: now,
    };

    if (existing >= 0) {
      state.pipelineSteps[existing] = record;
    } else {
      state.pipelineSteps.push(record);
    }

    // Persist updated metadata to disk
    const metaPath = this.runMetadataPath(projectId, runId);
    if (existsSync(metaPath)) {
      try {
        const data = JSON.parse(readFileSync(metaPath, "utf-8"));
        data.pipelineSteps = state.pipelineSteps;
        writeFileSync(metaPath, JSON.stringify(data, null, 2), "utf-8");
      } catch { /* skip */ }
    }
  }

  /** Mark build as complete with auto-generated summary. */
  completeBuild(
    projectId: string,
    runId: string,
    pageCount?: number,
    buildInfo?: {
      buildMode?: "outline" | "delta" | "full" | "epic-deepen";
      buildType?: "analyze" | "deep-run";
      topicsRebuilt?: number;
      topicsSkipped?: number;
      syncGitHeads?: Record<string, string>;
    },
    scope?: string,
  ): void {
    const key = this.buildKey(projectId, scope);
    const state = this.activeBuilds.get(key);
    if (!state || state.runId !== runId) return;

    const now = new Date();
    state.status = "complete";
    state.completedAt = now.toISOString();

    // Auto-generate summary based on what actually happened
    const startTime = new Date(state.startedAt).getTime();
    const durationMs = now.getTime() - startTime;
    const durationStr = formatDuration(durationMs);

    if (buildInfo?.buildType === "deep-run") {
      state.summary = `⚡ Deep Run: ${buildInfo.topicsRebuilt ?? pageCount ?? 0} topics synced in ${durationStr}`;
    } else if (buildInfo?.buildMode === "delta") {
      if (buildInfo.topicsRebuilt && buildInfo.topicsRebuilt > 0) {
        state.summary = `Delta: updated ${buildInfo.topicsRebuilt} of ${pageCount ?? "?"} topics in ${durationStr}`;
      } else {
        state.summary = `Delta: no topics affected (${pageCount ?? 0} pages unchanged) in ${durationStr}`;
      }
    } else if (buildInfo?.buildMode === "outline") {
      state.summary = `Outline: built ${pageCount ?? 0} topics in ${durationStr}`;
    } else {
      const pageStr = pageCount !== undefined ? `${pageCount} wiki page${pageCount !== 1 ? "s" : ""}` : "wiki";
      state.summary = `Built ${pageStr} in ${durationStr}`;
    }

    // Save metadata to disk
    this.saveMetadata(projectId, runId, state, pageCount, durationMs, buildInfo);
  }

  /** Mark build as failed with error message. */
  failBuild(projectId: string, runId: string, error: string, scope?: string): void {
    const key = this.buildKey(projectId, scope);
    const state = this.activeBuilds.get(key);
    if (!state || state.runId !== runId) return;

    const now = new Date();
    state.status = "error";
    state.completedAt = now.toISOString();
    state.error = error;

    const startTime = new Date(state.startedAt).getTime();
    const durationMs = now.getTime() - startTime;
    state.summary = `Failed after ${formatDuration(durationMs)}: ${error}`;

    this.saveMetadata(projectId, runId, state, null, durationMs);
  }

  private saveMetadata(
    projectId: string,
    runId: string,
    state: BuildState,
    pageCount: number | null | undefined,
    durationMs: number | null,
    buildInfo?: {
      buildMode?: string;
      buildType?: string;
      topicsRebuilt?: number;
      topicsSkipped?: number;
      syncGitHeads?: Record<string, string>;
    },
  ): void {
    this.ensureBuildLogsDir(projectId);
    const metaPath = this.runMetadataPath(projectId, runId);

    // Aggregate token usage from pipeline steps
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let buildMode: string | undefined;
    let buildType: string | undefined;
    let syncGitHeads: Record<string, string> | undefined;
    let topicsBuilt: number | undefined;
    let topicsSkipped: number | undefined;

    for (const step of state.pipelineSteps) {
      if (step.tokenUsage) {
        totalTokens += step.tokenUsage.totalTokens;
        totalInputTokens += step.tokenUsage.inputTokens;
        totalOutputTokens += step.tokenUsage.outputTokens;
      }
    }

    // Try to read existing metadata for analytics fields set during the build
    try {
      if (existsSync(metaPath)) {
        const existing = JSON.parse(readFileSync(metaPath, "utf-8"));
        if (existing.buildMode) buildMode = existing.buildMode;
        if (existing.buildType) buildType = existing.buildType;
        if (existing.syncGitHeads) syncGitHeads = existing.syncGitHeads;
        if (existing.topicsBuilt != null) topicsBuilt = existing.topicsBuilt;
        if (existing.topicsSkipped != null) topicsSkipped = existing.topicsSkipped;
      }
    } catch { /* skip */ }

    // Override with buildInfo values if provided
    if (buildInfo?.buildMode) buildMode = buildInfo.buildMode;
    if (buildInfo?.buildType) buildType = buildInfo.buildType;
    if (buildInfo?.syncGitHeads) syncGitHeads = buildInfo.syncGitHeads;
    if (buildInfo?.topicsRebuilt != null) topicsBuilt = buildInfo.topicsRebuilt;
    if (buildInfo?.topicsSkipped != null) topicsSkipped = buildInfo.topicsSkipped;

    const entry: BuildLogEntry = {
      runId,
      command: state.command,
      modelId: state.modelId,
      status: state.status,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      summary: state.summary,
      error: state.error,
      pageCount: pageCount ?? null,
      durationMs,
      pipelineSteps: state.pipelineSteps,
      totalTokens: totalTokens > 0 ? totalTokens : undefined,
      totalInputTokens: totalInputTokens > 0 ? totalInputTokens : undefined,
      totalOutputTokens: totalOutputTokens > 0 ? totalOutputTokens : undefined,
      buildMode,
      buildType,
      syncGitHeads,
      topicsBuilt,
      topicsSkipped,
    };

    writeFileSync(metaPath, JSON.stringify(entry, null, 2), "utf-8");
  }

  /* ── Queries ───────────────────────────────────────────────────────── */

  /** Get current build state for a project (optionally scoped). Returns null if no build tracked. */
  getBuildState(projectId: string, scope?: string): BuildState | null {
    // Hydrate from disk if we haven't seen this key yet
    this.hydrateFromDisk(projectId, scope);
    return this.activeBuilds.get(this.buildKey(projectId, scope)) ?? null;
  }

  /** Read the output log file for a given run. Returns the text content. */
  readBuildOutput(projectId: string, runId: string): string {
    const logPath = this.runLogPath(projectId, runId);
    if (!existsSync(logPath)) return "";
    return readFileSync(logPath, "utf-8");
  }

  /** Get the output file path for a given run (for streaming tail). */
  getBuildOutputPath(projectId: string, runId: string): string {
    return this.runLogPath(projectId, runId);
  }

  /** List recent build logs (most recent first). */
  listBuildLogs(projectId: string, limit = 20): BuildLogEntry[] {
    const dir = this.buildLogsDir(projectId);
    if (!existsSync(dir)) return [];

    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const fullPath = path.join(dir, f);
        const stat = statSync(fullPath);
        return { file: f, path: fullPath, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);

    const logs: BuildLogEntry[] = [];
    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(f.path, "utf-8"));
        logs.push(data);
      } catch {
        // Skip corrupt files
      }
    }

    return logs;
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return remainSec > 0 ? `${minutes}m ${remainSec}s` : `${minutes}m`;
}
