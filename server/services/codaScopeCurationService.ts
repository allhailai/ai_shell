/* ── CodaScope: Curation Service ─────────────────────────────────────
   Manages curation trigger reasons and curation run logs.
   Reasons accumulate between curation runs. When a curation run starts,
   reasons are cleared and recorded in the run log.

   Storage structure:
     <epicDir>/curation/
     ├── reasons.json              # Accumulated trigger reasons
     └── logs/
         └── <curationId>.json     # Individual curation run logs
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  CurationReason,
  CurationReasons,
  CurationLogEntry,
} from "../../src/apps/codascope/codaScopeTypes.js";
import { startBackgroundSsePump } from "./codaScopeBackgroundSse.js";
import { assertSafePathSegment } from "./codaScopePathSafety.js";

/* ── Helpers ────────────────────────────────────────────────────────── */

function nowIso(): string {
  return new Date().toISOString();
}

function generateCurationId(): string {
  return `cur_${crypto.randomBytes(6).toString("hex")}`;
}

/** Atomic write: temp → rename for crash safety. */
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.tmp.${crypto.randomBytes(4).toString("hex")}`;
  await fs.writeFile(tmpPath, data, "utf-8");
  await fs.rename(tmpPath, filePath);
}

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeCurationService {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path helpers ──────────────────────────────────────────────────── */

  /** Resolve the project directory for a given project ID. */
  private projectDir(projectId: string): string | null {
    if (!existsSync(this.root)) return null;
    const entries = readdirSync(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectPath = path.join(this.root, entry.name, "project.json");
      if (existsSync(projectPath)) {
        try {
          const data = JSON.parse(readFileSync(projectPath, "utf-8"));
          if (data.id === projectId) return path.join(this.root, entry.name);
        } catch { /* skip corrupted */ }
      }
    }
    return null;
  }

  private epicDir(projectDir: string, epicId: string): string {
    return path.join(projectDir, "epics", assertSafePathSegment(epicId, "epic ID"));
  }

  private curationDir(epicDir: string): string {
    return path.join(epicDir, "curation");
  }

  private reasonsPath(epicDir: string): string {
    return path.join(this.curationDir(epicDir), "reasons.json");
  }

  private logsDir(epicDir: string): string {
    return path.join(this.curationDir(epicDir), "logs");
  }

  private logPath(epicDir: string, curationId: string): string {
    return path.join(this.logsDir(epicDir), `${assertSafePathSegment(curationId, "curation ID")}.json`);
  }

  /** Resolve epicDir from project ID + epic ID. Returns null if not found. */
  private resolveEpicDir(projectId: string, epicId: string): string | null {
    const projDir = this.projectDir(projectId);
    if (!projDir) return null;
    const ed = this.epicDir(projDir, epicId);
    return existsSync(ed) ? ed : null;
  }

  /* ── Initialization ────────────────────────────────────────────────── */

  /**
   * Initialize the curation/ directory structure for a new epic.
   * Called during epic creation.
   */
  initializeCurationDir(epicDir: string): void {
    const cDir = this.curationDir(epicDir);
    const lDir = this.logsDir(epicDir);

    mkdirSync(cDir, { recursive: true });
    mkdirSync(lDir, { recursive: true });

    // Initialize empty reasons
    if (!existsSync(this.reasonsPath(epicDir))) {
      const reasons: CurationReasons = { reasons: [] };
      writeFileSync(this.reasonsPath(epicDir), JSON.stringify(reasons, null, 2), "utf-8");
    }
  }

  /** Ensure curation directory exists (lazy init for pre-existing epics). */
  private ensureCurationDir(epicDir: string): void {
    const cDir = this.curationDir(epicDir);
    if (!existsSync(cDir)) {
      this.initializeCurationDir(epicDir);
    }
  }

  /* ── Curation Reasons ──────────────────────────────────────────────── */

  /** Read accumulated curation reasons. */
  private readReasons(epicDir: string): CurationReasons {
    const p = this.reasonsPath(epicDir);
    if (!existsSync(p)) return { reasons: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { reasons: [] };
    }
  }

  /** Write curation reasons atomically. */
  private async writeReasons(epicDir: string, reasons: CurationReasons): Promise<void> {
    this.ensureCurationDir(epicDir);
    await atomicWrite(this.reasonsPath(epicDir), JSON.stringify(reasons, null, 2));
  }

  /** Add a curation reason (trigger). */
  async addReason(projectId: string, epicId: string, reason: CurationReason): Promise<void> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) throw new Error("Epic not found");

    const data = this.readReasons(epicDir);
    data.reasons.push(reason);
    await this.writeReasons(epicDir, data);
  }

  /** Get all accumulated curation reasons. */
  async getReasons(projectId: string, epicId: string): Promise<CurationReason[]> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return [];
    return this.readReasons(epicDir).reasons;
  }

  /**
   * Clear all accumulated reasons and return them.
   * Used when starting a curation run — the returned reasons are recorded in the log.
   */
  async clearReasons(projectId: string, epicId: string): Promise<CurationReason[]> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return [];

    const data = this.readReasons(epicDir);
    const cleared = [...data.reasons];

    data.reasons = [];
    await this.writeReasons(epicDir, data);

    return cleared;
  }

  /* ── Curation Logs ─────────────────────────────────────────────────── */

  /** Create a new curation log entry. */
  async createLog(projectId: string, epicId: string, entry: Omit<CurationLogEntry, "curationId">): Promise<CurationLogEntry> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) throw new Error("Epic not found");

    this.ensureCurationDir(epicDir);

    const curationId = generateCurationId();
    const fullEntry: CurationLogEntry = { ...entry, curationId };

    const logDir = this.logsDir(epicDir);
    mkdirSync(logDir, { recursive: true });

    await atomicWrite(this.logPath(epicDir, curationId), JSON.stringify(fullEntry, null, 2));
    return fullEntry;
  }

  /** Update an existing curation log entry. */
  async updateLog(projectId: string, epicId: string, curationId: string, updates: Partial<CurationLogEntry>): Promise<void> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) throw new Error("Epic not found");

    const logFile = this.logPath(epicDir, curationId);
    if (!existsSync(logFile)) throw new Error("Curation log not found");

    let entry: CurationLogEntry;
    try {
      entry = JSON.parse(readFileSync(logFile, "utf-8"));
    } catch {
      throw new Error("Curation log corrupted");
    }

    Object.assign(entry, updates);
    await atomicWrite(logFile, JSON.stringify(entry, null, 2));
  }

  /** Get a specific curation log entry. */
  async getLog(projectId: string, epicId: string, curationId: string): Promise<CurationLogEntry | null> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return null;

    const logFile = this.logPath(epicDir, curationId);
    if (!existsSync(logFile)) return null;
    try {
      return JSON.parse(readFileSync(logFile, "utf-8"));
    } catch {
      return null;
    }
  }

  /** List all curation logs for an epic, newest first. */
  async listLogs(projectId: string, epicId: string): Promise<CurationLogEntry[]> {
    const epicDir = this.resolveEpicDir(projectId, epicId);
    if (!epicDir) return [];

    const logDir = this.logsDir(epicDir);
    if (!existsSync(logDir)) return [];

    const files = readdirSync(logDir).filter((f) => f.endsWith(".json"));
    const logs: CurationLogEntry[] = [];

    for (const file of files) {
      try {
        const entry = JSON.parse(readFileSync(path.join(logDir, file), "utf-8"));
        logs.push(entry);
      } catch { /* skip corrupted logs */ }
    }

    // Sort newest first
    logs.sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime());
    return logs;
  }

  /** Get the most recent curation log entry. */
  async getLatestLog(projectId: string, epicId: string): Promise<CurationLogEntry | null> {
    const logs = await this.listLogs(projectId, epicId);
    return logs[0] ?? null;
  }

  /**
   * Trigger the curation pipeline via internal HTTP POST to the SSE endpoint.
   * Consumes the SSE stream in the background so the connection stays alive
   * and the pipeline runs to completion.
   *
   * Extracted from the `trigger_curation` tool definition to centralize
   * the localhost HTTP call pattern.
   */
  async triggerCurationPipeline(
    projectId: string,
    epicId: string,
    modelId: string,
    actorId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const port = process.env.AISHELL_PORT ?? "5175";
    const url = `http://localhost:${port}/api/codascope/projects/${projectId}/epics/${epicId}/curation/run`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.AISHELL_INTERNAL_REQUEST_TOKEN
            ? { "X-AIShell-Internal-Token": process.env.AISHELL_INTERNAL_REQUEST_TOKEN }
            : {}),
          "X-AIShell-Initiating-Actor": actorId,
        },
        body: JSON.stringify({ modelId }),
      });

      if (!res.ok) {
        const text = await res.text();
        let errorMsg: string;
        try {
          const parsed = JSON.parse(text);
          errorMsg = parsed.error ?? text;
        } catch {
          errorMsg = text;
        }
        return { success: false, error: errorMsg };
      }

      // Consume the SSE stream in the background so the connection stays alive.
      // The pipeline runs server-side; we just need to keep the client connection open.
      if (!startBackgroundSsePump(res, "curation-start")) {
        return { success: false, error: "Curation stream did not include a response body." };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
