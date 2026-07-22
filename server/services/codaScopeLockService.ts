/* ── CodaScope: Lock Service ─────────────────────────────────────────
   Manages edit locks for epic documents. Extracted from CodaScopeEpicService
   to follow single-responsibility principle.

   Features:
   - File-based lock storage (locks.json per epic)
   - Auto-expiry of stale locks (5 min TTL)
   - Agent vs human lock differentiation
   - Heartbeat-based lock refresh
   - Bulk cleanup of expired locks
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { EditLock } from "../../src/apps/codascope/codaScopeTypes.js";
import { assertSafePathSegment } from "./codaScopePathSafety.js";

/* ── Storage Schema ───────────────────────────────────────────────── */

interface LockFile {
  locks: EditLock[];
}

/* ── Service ──────────────────────────────────────────────────────── */

export class CodaScopeLockService {
  private root: string;
  /** Lock expiry in milliseconds — 5 minutes */
  private static readonly LOCK_TTL_MS = 5 * 60 * 1000;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path helpers ─────────────────────────────────────────────────── */

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

  private epicsDir(projectDir: string): string {
    return path.join(projectDir, "epics");
  }

  private epicDir(projectDir: string, epicId: string): string {
    return path.join(this.epicsDir(projectDir), assertSafePathSegment(epicId, "epic ID"));
  }

  private lockFilePath(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "locks.json");
  }

  /* ── Internal lock I/O ───────────────────────────────────────────── */

  private readLocks(projectDir: string, epicId: string): LockFile {
    const p = this.lockFilePath(projectDir, epicId);
    if (!existsSync(p)) return { locks: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { locks: [] };
    }
  }

  private writeLocks(projectDir: string, epicId: string, lockFile: LockFile): void {
    writeFileSync(this.lockFilePath(projectDir, epicId), JSON.stringify(lockFile, null, 2), "utf-8");
  }

  /** Auto-expire stale locks (5 min idle). Returns cleaned lock list. */
  private cleanExpiredLocks(lockFile: LockFile): LockFile {
    const now = Date.now();
    lockFile.locks = lockFile.locks.filter((lock) => {
      const lastActivity = new Date(lock.lastActivityAt).getTime();
      return (now - lastActivity) < CodaScopeLockService.LOCK_TTL_MS;
    });
    return lockFile;
  }

  /* ── Public API ──────────────────────────────────────────────────── */

  /** Acquire an edit lock on a document within an epic. */
  async acquireLock(projectId: string, epicId: string, opts: {
    documentId: string;
    lockedBy: string;
  }): Promise<EditLock | { error: string; holder: EditLock }> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    let lockFile = this.readLocks(projectDir, epicId);
    lockFile = this.cleanExpiredLocks(lockFile);

    // Check if already locked by someone else
    const existing = lockFile.locks.find((l) => l.documentId === opts.documentId);
    if (existing && existing.lockedBy !== opts.lockedBy) {
      return { error: "Document is locked", holder: existing };
    }

    // Refresh existing lock or create new
    const now = new Date().toISOString();
    if (existing) {
      existing.lastActivityAt = now;
      this.writeLocks(projectDir, epicId, lockFile);
      return existing;
    }

    const lock: EditLock = {
      lockedBy: opts.lockedBy,
      lockedAt: now,
      lastActivityAt: now,
      documentId: opts.documentId,
    };
    lockFile.locks.push(lock);
    this.writeLocks(projectDir, epicId, lockFile);
    return lock;
  }

  /** Release an edit lock only for its holder. */
  async releaseLock(projectId: string, epicId: string, documentId: string, actorId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const lockFile = this.readLocks(projectDir, epicId);
    const before = lockFile.locks.length;
    lockFile.locks = lockFile.locks.filter((lock) =>
      lock.documentId !== documentId || lock.lockedBy !== actorId,
    );
    this.writeLocks(projectDir, epicId, lockFile);
    return lockFile.locks.length < before;
  }

  /** Check current lock status for a document. */
  async getLockStatus(projectId: string, epicId: string): Promise<EditLock[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];

    let lockFile = this.readLocks(projectDir, epicId);
    lockFile = this.cleanExpiredLocks(lockFile);
    this.writeLocks(projectDir, epicId, lockFile);
    return lockFile.locks;
  }

  /**
   * Heartbeat — refresh lock TTL for active editing.
   * Called periodically (every 60s) by the client to keep the lock alive.
   */
  async heartbeatLock(projectId: string, epicId: string, documentId: string, lockedBy: string): Promise<EditLock | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    let lockFile = this.readLocks(projectDir, epicId);
    lockFile = this.cleanExpiredLocks(lockFile);

    const lock = lockFile.locks.find((l) => l.documentId === documentId && l.lockedBy === lockedBy);
    if (!lock) return null;

    lock.lastActivityAt = new Date().toISOString();
    this.writeLocks(projectDir, epicId, lockFile);
    return lock;
  }

  /**
   * Check if a document is currently locked by a human.
   * Used by the agent to verify before writing — returns the lock holder
   * or null if unlocked / only locked by agent.
   */
  async isDocumentLockedByHuman(projectId: string, epicId: string, documentId: string): Promise<EditLock | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    let lockFile = this.readLocks(projectDir, epicId);
    lockFile = this.cleanExpiredLocks(lockFile);
    this.writeLocks(projectDir, epicId, lockFile);

    const lock = lockFile.locks.find((l) => l.documentId === documentId);
    if (!lock) return null;

    // Agent locks (lockedBy starts with "agent_") don't block
    if (lock.lockedBy.startsWith("agent_")) return null;
    return lock;
  }

  /**
   * Cleanup all expired locks across all epics.
   * Called on server startup to clear stale locks from crashes.
   */
  async cleanupAllExpiredLocks(projectId: string): Promise<number> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return 0;

    const epicsDirectory = this.epicsDir(projectDir);
    if (!existsSync(epicsDirectory)) return 0;

    let cleaned = 0;
    const entries = readdirSync(epicsDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      const lockPath = this.lockFilePath(projectDir, entry.name);
      if (!existsSync(lockPath)) continue;

      let lockFile = this.readLocks(projectDir, entry.name);
      const before = lockFile.locks.length;
      lockFile = this.cleanExpiredLocks(lockFile);
      if (lockFile.locks.length < before) {
        cleaned += before - lockFile.locks.length;
        this.writeLocks(projectDir, entry.name, lockFile);
      }
    }
    return cleaned;
  }
}
