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
  topicsBuilt?: number;
  topicsSkipped?: number;
}

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeBuildStateService {
  private root: string;

  /** Active build state per project (in-memory) */
  private activeBuilds = new Map<string, BuildState>();

  /** Track which projects have been hydrated from disk */
  private hydratedProjects = new Set<string>();

  /** Map project IDs to their actual directory paths on disk */
  private projectDirs = new Map<string, string>();

  /** Cancelled builds — projectId set, checked by running pipelines */
  private cancelledProjects = new Set<string>();

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /** Request cancellation of the active build for a project. */
  cancelBuild(projectId: string): void {
    this.cancelledProjects.add(projectId);
  }

  /** Check if the build for a project has been cancelled. */
  isCancelled(projectId: string): boolean {
    return this.cancelledProjects.has(projectId);
  }

  /** Clear the cancellation flag (call when a new build starts). */
  clearCancellation(projectId: string): void {
    this.cancelledProjects.delete(projectId);
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
  private hydrateProjectFromDisk(projectId: string): void {
    if (this.hydratedProjects.has(projectId)) return;
    this.hydratedProjects.add(projectId);

    // If we already have in-memory state for this project, skip disk read
    if (this.activeBuilds.has(projectId)) return;

    const dir = this.buildLogsDir(projectId);
    if (!existsSync(dir)) return;

    // Find the most recent .json build log
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
    const latest = jsonFiles[0];

    try {
      const data = JSON.parse(readFileSync(latest.path, "utf-8")) as BuildLogEntry;

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
        writeFileSync(latest.path, JSON.stringify(entry, null, 2), "utf-8");
      }

      this.activeBuilds.set(projectId, state);
    } catch {
      // Skip corrupt files
    }
  }

  /* ── Directory helpers ─────────────────────────────────────────────── */

  private buildLogsDir(projectId: string): string {
    // Use the registered project directory if available, otherwise fall back to ID-based path
    const baseDir = this.projectDirs.get(projectId) ?? path.join(this.root, projectId);
    return path.join(baseDir, "build-logs");
  }

  private ensureBuildLogsDir(projectId: string): string {
    const dir = this.buildLogsDir(projectId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /* ── Build lifecycle ───────────────────────────────────────────────── */

  /** Start a new build. Returns the runId, or null if a build is already running. */
  startBuild(projectId: string, command: string, modelId: string): string | null {
    // Hydrate from disk first to detect stale builds
    this.hydrateProjectFromDisk(projectId);

    const existing = this.activeBuilds.get(projectId);
    if (existing && existing.status === "building") {
      return null; // Already building
    }

    const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const dir = this.ensureBuildLogsDir(projectId);

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
    };

    this.activeBuilds.set(projectId, state);

    // Write initial metadata
    const metaPath = path.join(dir, `${runId}.json`);
    writeFileSync(metaPath, JSON.stringify(state, null, 2), "utf-8");

    // Create empty log file
    const logPath = path.join(dir, `${runId}.log`);
    writeFileSync(logPath, "", "utf-8");

    return runId;
  }

  /** Append output text to the build log file. */
  appendOutput(projectId: string, runId: string, text: string): void {
    const dir = this.buildLogsDir(projectId);
    const logPath = path.join(dir, `${runId}.log`);
    appendFileSync(logPath, text, "utf-8");

    const state = this.activeBuilds.get(projectId);
    if (state && state.runId === runId) {
      state.outputLength += Buffer.byteLength(text, "utf-8");
    }
  }

  /** Record a pipeline step update. Persists to disk for reconnection. */
  addPipelineStep(
    projectId: string,
    runId: string,
    step: { step: string; status: string; repo?: string; topic?: string; progress?: string; reason?: string; error?: string; mode?: string; tokenUsage?: TokenUsageRecord },
  ): void {
    const state = this.activeBuilds.get(projectId);
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
      label: labelMap[step.step] ?? step.step,
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
    const dir = this.buildLogsDir(projectId);
    const metaPath = path.join(dir, `${runId}.json`);
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
      buildMode?: "outline" | "delta" | "full";
      topicsRebuilt?: number;
      topicsSkipped?: number;
    },
  ): void {
    const state = this.activeBuilds.get(projectId);
    if (!state || state.runId !== runId) return;

    const now = new Date();
    state.status = "complete";
    state.completedAt = now.toISOString();

    // Auto-generate summary based on what actually happened
    const startTime = new Date(state.startedAt).getTime();
    const durationMs = now.getTime() - startTime;
    const durationStr = formatDuration(durationMs);

    if (buildInfo?.buildMode === "delta") {
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
    this.saveMetadata(projectId, runId, state, pageCount, durationMs);
  }

  /** Mark build as failed with error message. */
  failBuild(projectId: string, runId: string, error: string): void {
    const state = this.activeBuilds.get(projectId);
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
  ): void {
    const dir = this.ensureBuildLogsDir(projectId);
    const metaPath = path.join(dir, `${runId}.json`);

    // Aggregate token usage from pipeline steps
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let buildMode: string | undefined;
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
        if (existing.topicsBuilt != null) topicsBuilt = existing.topicsBuilt;
        if (existing.topicsSkipped != null) topicsSkipped = existing.topicsSkipped;
      }
    } catch { /* skip */ }

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
      topicsBuilt,
      topicsSkipped,
    };

    writeFileSync(metaPath, JSON.stringify(entry, null, 2), "utf-8");
  }

  /* ── Queries ───────────────────────────────────────────────────────── */

  /** Get current build state for a project. Returns null if no build tracked. */
  getBuildState(projectId: string): BuildState | null {
    // Hydrate from disk if we haven't seen this project yet
    this.hydrateProjectFromDisk(projectId);
    return this.activeBuilds.get(projectId) ?? null;
  }

  /** Read the output log file for a given run. Returns the text content. */
  readBuildOutput(projectId: string, runId: string): string {
    const dir = this.buildLogsDir(projectId);
    const logPath = path.join(dir, `${runId}.log`);
    if (!existsSync(logPath)) return "";
    return readFileSync(logPath, "utf-8");
  }

  /** Get the output file path for a given run (for streaming tail). */
  getBuildOutputPath(projectId: string, runId: string): string {
    return path.join(this.buildLogsDir(projectId), `${runId}.log`);
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
