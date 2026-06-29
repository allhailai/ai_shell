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
}

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeBuildStateService {
  private root: string;

  /** Active build state per project (in-memory) */
  private activeBuilds = new Map<string, BuildState>();

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Directory helpers ─────────────────────────────────────────────── */

  private buildLogsDir(projectId: string): string {
    return path.join(this.root, projectId, "build-logs");
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

  /** Mark build as complete with auto-generated summary. */
  completeBuild(projectId: string, runId: string, pageCount?: number): void {
    const state = this.activeBuilds.get(projectId);
    if (!state || state.runId !== runId) return;

    const now = new Date();
    state.status = "complete";
    state.completedAt = now.toISOString();

    // Auto-generate summary
    const startTime = new Date(state.startedAt).getTime();
    const durationMs = now.getTime() - startTime;
    const durationStr = formatDuration(durationMs);
    const pageStr = pageCount !== undefined ? `${pageCount} wiki page${pageCount !== 1 ? "s" : ""}` : "wiki";
    state.summary = `Built ${pageStr} in ${durationStr}`;

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
    };

    writeFileSync(metaPath, JSON.stringify(entry, null, 2), "utf-8");
  }

  /* ── Queries ───────────────────────────────────────────────────────── */

  /** Get current build state for a project. Returns null if no build tracked. */
  getBuildState(projectId: string): BuildState | null {
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
