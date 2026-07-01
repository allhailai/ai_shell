/* ── CodaScope: Epic Design Service ──────────────────────────────────
   Core CRUD service for epic designs.
   Follows existing service patterns (module singleton, atomic writes,
   project-directory-based storage).

   Responsibilities:
   - Epic CRUD (create, read, update, delete, list)
   - Definition document read/write (markdown file I/O)
   - Edit lock management (acquire, release, check, auto-expire after 5 min)
   - Storage layout management (creates epics/ directory structure)
   - Epic health computation (derived from timestamps and annotation counts)
   ──────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, renameSync, cpSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  EpicDesign,
  EpicDesignDetail,
  EpicStatus,
  EpicHealth,
  EpicHealthInfo,
  EditLock,
  EpicScope,
  EpicScopeEntry,
  ScopeDiff,
  EpicDesignDoc,
  EpicVersion,
} from "../../src/apps/codascope/codaScopeTypes.js";

/* ── Storage Schema ────────────────────────────────────────────────── */

interface EpicsIndex {
  epics: EpicDesign[];
}

interface EpicMetadata extends EpicDesign {
  conversationId: string | null;
}

interface LockFile {
  locks: EditLock[];
}

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeEpicService {
  private root: string;
  /** Lock expiry in milliseconds — 5 minutes */
  private static readonly LOCK_TTL_MS = 5 * 60 * 1000;

  constructor(root: string) {
    this.root = root;
  }

  setRoot(root: string): void {
    this.root = root;
  }

  /* ── Path helpers ──────────────────────────────────────────────────── */

  private projectDir(projectId: string): string | null {
    // Walk root to find project by ID (matches project.json)
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

  private indexPath(projectDir: string): string {
    return path.join(this.epicsDir(projectDir), "epics.json");
  }

  private epicDir(projectDir: string, epicId: string): string {
    return path.join(this.epicsDir(projectDir), epicId);
  }

  private epicMetaPath(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "epic.json");
  }

  private definitionPath(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "definition.md");
  }

  private lockFilePath(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "locks.json");
  }

  private scopePath(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "scope.json");
  }

  private archiveDir(projectDir: string): string {
    return path.join(this.epicsDir(projectDir), "_archive");
  }

  private archivedEpicDir(projectDir: string, epicId: string): string {
    return path.join(this.archiveDir(projectDir), epicId);
  }

  /* ── Index helpers ─────────────────────────────────────────────────── */

  private readIndex(projectDir: string): EpicsIndex {
    const p = this.indexPath(projectDir);
    if (!existsSync(p)) return { epics: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return { epics: [] };
    }
  }

  private writeIndex(projectDir: string, index: EpicsIndex): void {
    const dir = this.epicsDir(projectDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.indexPath(projectDir), JSON.stringify(index, null, 2), "utf-8");
  }

  private readEpicMeta(projectDir: string, epicId: string): EpicMetadata | null {
    const p = this.epicMetaPath(projectDir, epicId);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return null;
    }
  }

  private writeEpicMeta(projectDir: string, epicId: string, meta: EpicMetadata): void {
    const dir = this.epicDir(projectDir, epicId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.epicMetaPath(projectDir, epicId), JSON.stringify(meta, null, 2), "utf-8");
  }

  /* ── CRUD ──────────────────────────────────────────────────────────── */

  /** List all epics for a project (with computed health). */
  async listEpics(projectId: string): Promise<(EpicDesign & { health: EpicHealthInfo })[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];
    const index = this.readIndex(projectDir);
    return index.epics.map((epic) => ({
      ...epic,
      health: this.computeHealth(epic),
    }));
  }

  /** Create a new epic. */
  async createEpic(projectId: string, opts: {
    title: string;
    createdBy?: string;
    status?: EpicStatus;
  }): Promise<EpicDesign> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) throw new Error("Project not found");

    const now = new Date().toISOString();
    const id = `epic_${crypto.randomBytes(6).toString("hex")}`;

    const epic: EpicDesign = {
      id,
      projectId,
      title: opts.title,
      status: opts.status ?? "defining",
      createdAt: now,
      updatedAt: now,
      createdBy: opts.createdBy ?? "user",
      collaborators: [opts.createdBy ?? "user"],
      currentVersion: 0,
    };

    // Create epic directory
    const epicDirectory = this.epicDir(projectDir, id);
    mkdirSync(epicDirectory, { recursive: true });

    // Write metadata
    const meta: EpicMetadata = { ...epic, conversationId: null };
    this.writeEpicMeta(projectDir, id, meta);

    // Write empty definition
    writeFileSync(this.definitionPath(projectDir, id), "", "utf-8");

    // Update index
    const index = this.readIndex(projectDir);
    index.epics.push(epic);
    this.writeIndex(projectDir, index);

    return epic;
  }

  /** Get full epic detail (assembled read model). */
  async getEpic(projectId: string, epicId: string): Promise<EpicDesignDetail | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const meta = this.readEpicMeta(projectDir, epicId);
    if (!meta) return null;

    // Read definition
    const defPath = this.definitionPath(projectDir, epicId);
    const definition = existsSync(defPath) ? readFileSync(defPath, "utf-8") : "";

    // Read scope if present
    const scopeFilePath = this.scopePath(projectDir, epicId);
    let scope: EpicScope | null = null;
    if (existsSync(scopeFilePath)) {
      try {
        scope = JSON.parse(readFileSync(scopeFilePath, "utf-8"));
      } catch { /* corrupted scope.json — treat as unscoped */ }
    }

    // Read design docs index if present
    const designsIndexPath = path.join(this.epicDir(projectDir, epicId), "designs", "designs.json");
    let designDocs: EpicDesignDoc[] = [];
    if (existsSync(designsIndexPath)) {
      try {
        const designsData = JSON.parse(readFileSync(designsIndexPath, "utf-8"));
        designDocs = designsData.docs ?? [];
      } catch { /* corrupted designs.json */ }
    }

    // Read versions index if present
    const versionsIndexPath = path.join(this.epicDir(projectDir, epicId), "versions", "versions.json");
    let versions: EpicVersion[] = [];
    if (existsSync(versionsIndexPath)) {
      try {
        const versionsData = JSON.parse(readFileSync(versionsIndexPath, "utf-8"));
        versions = versionsData.versions ?? [];
      } catch { /* corrupted versions.json */ }
    }

    const detail: EpicDesignDetail = {
      ...meta,
      definition,
      scope,
      designDocs,
      versions,
      conversationId: meta.conversationId,
    };

    return detail;
  }

  /** Update epic metadata. */
  async updateEpic(projectId: string, epicId: string, updates: {
    title?: string;
    status?: EpicStatus;
    collaborators?: string[];
  }): Promise<EpicDesign | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const meta = this.readEpicMeta(projectDir, epicId);
    if (!meta) return null;

    if (updates.title !== undefined) meta.title = updates.title;
    if (updates.status !== undefined) meta.status = updates.status;
    if (updates.collaborators !== undefined) meta.collaborators = updates.collaborators;
    meta.updatedAt = new Date().toISOString();

    this.writeEpicMeta(projectDir, epicId, meta);

    // Update index entry
    const index = this.readIndex(projectDir);
    const idx = index.epics.findIndex((e) => e.id === epicId);
    if (idx >= 0) {
      const { conversationId: _, ...epicData } = meta;
      index.epics[idx] = epicData;
      this.writeIndex(projectDir, index);
    }

    const { conversationId: _, ...result } = meta;
    return result;
  }

  /** Delete an epic and all its data. */
  async deleteEpic(projectId: string, epicId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const epicDirectory = this.epicDir(projectDir, epicId);
    if (!existsSync(epicDirectory)) return false;

    rmSync(epicDirectory, { recursive: true, force: true });

    // Update index
    const index = this.readIndex(projectDir);
    index.epics = index.epics.filter((e) => e.id !== epicId);
    this.writeIndex(projectDir, index);

    return true;
  }

  /* ── Archive / Restore ─────────────────────────────────────────────── */

  /** Move an epic to the _archive directory. Preserves all data. */
  async archiveEpic(projectId: string, epicId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const epicDirectory = this.epicDir(projectDir, epicId);
    if (!existsSync(epicDirectory)) return false;

    // Update status to archived before moving
    const meta = this.readEpicMeta(projectDir, epicId);
    if (meta) {
      meta.status = "archived";
      meta.updatedAt = new Date().toISOString();
      this.writeEpicMeta(projectDir, epicId, meta);
    }

    // Ensure archive directory exists
    const archiveDirectory = this.archiveDir(projectDir);
    if (!existsSync(archiveDirectory)) mkdirSync(archiveDirectory, { recursive: true });

    // Move epic dir to archive
    const destDir = this.archivedEpicDir(projectDir, epicId);
    try {
      renameSync(epicDirectory, destDir);
    } catch {
      // Cross-device fallback: copy then delete
      cpSync(epicDirectory, destDir, { recursive: true });
      rmSync(epicDirectory, { recursive: true, force: true });
    }

    // Remove from active index
    const index = this.readIndex(projectDir);
    index.epics = index.epics.filter((e) => e.id !== epicId);
    this.writeIndex(projectDir, index);

    return true;
  }

  /** Restore an epic from the _archive directory back to active. */
  async restoreEpic(projectId: string, epicId: string): Promise<EpicDesign | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const archivedDir = this.archivedEpicDir(projectDir, epicId);
    if (!existsSync(archivedDir)) return null;

    // Move back to active epics
    const destDir = this.epicDir(projectDir, epicId);
    try {
      renameSync(archivedDir, destDir);
    } catch {
      cpSync(archivedDir, destDir, { recursive: true });
      rmSync(archivedDir, { recursive: true, force: true });
    }

    // Update status from archived → defining
    const meta = this.readEpicMeta(projectDir, epicId);
    if (!meta) return null;
    meta.status = "defining";
    meta.updatedAt = new Date().toISOString();
    this.writeEpicMeta(projectDir, epicId, meta);

    // Add back to active index
    const index = this.readIndex(projectDir);
    const { conversationId: _, ...epicData } = meta;
    index.epics.push(epicData);
    this.writeIndex(projectDir, index);

    return epicData;
  }

  /** List all archived epics for a project. */
  async listArchivedEpics(projectId: string): Promise<EpicDesign[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];

    const archiveDirectory = this.archiveDir(projectDir);
    if (!existsSync(archiveDirectory)) return [];

    const entries = readdirSync(archiveDirectory, { withFileTypes: true });
    const epics: EpicDesign[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const metaPath = path.join(archiveDirectory, entry.name, "epic.json");
      if (existsSync(metaPath)) {
        try {
          const data = JSON.parse(readFileSync(metaPath, "utf-8"));
          const { conversationId: _, ...epicData } = data;
          epics.push(epicData);
        } catch { /* skip corrupted */ }
      }
    }

    return epics;
  }

  /* ── Definition (markdown I/O) ─────────────────────────────────────── */

  /** Get the definition markdown for an epic. */
  async getDefinition(projectId: string, epicId: string): Promise<string | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const defPath = this.definitionPath(projectDir, epicId);
    if (!existsSync(defPath)) return null;
    return readFileSync(defPath, "utf-8");
  }

  /** Update the definition markdown for an epic. */
  async updateDefinition(projectId: string, epicId: string, content: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const defPath = this.definitionPath(projectDir, epicId);
    const epicDirectory = this.epicDir(projectDir, epicId);
    if (!existsSync(epicDirectory)) return false;

    writeFileSync(defPath, content, "utf-8");

    // Touch updatedAt
    const meta = this.readEpicMeta(projectDir, epicId);
    if (meta) {
      meta.updatedAt = new Date().toISOString();
      this.writeEpicMeta(projectDir, epicId, meta);

      // Update index
      const index = this.readIndex(projectDir);
      const idx = index.epics.findIndex((e) => e.id === epicId);
      if (idx >= 0) {
        index.epics[idx].updatedAt = meta.updatedAt;
        this.writeIndex(projectDir, index);
      }
    }

    return true;
  }

  /* ── Edit Lock Management ──────────────────────────────────────────── */

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
      return (now - lastActivity) < CodaScopeEpicService.LOCK_TTL_MS;
    });
    return lockFile;
  }

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

  /** Release an edit lock. */
  async releaseLock(projectId: string, epicId: string, documentId: string): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const lockFile = this.readLocks(projectDir, epicId);
    const before = lockFile.locks.length;
    lockFile.locks = lockFile.locks.filter((l) => l.documentId !== documentId);
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
   * Heartbeat — refresh lock TTL for active editing (P4).
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
   * Check if a document is currently locked by a human (P4).
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
   * Cleanup all expired locks across all epics (P4).
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

  /* ── Health Computation ────────────────────────────────────────────── */

  /** Compute epic health from metadata. Computed at read-time, never stored. */
  computeHealth(epic: EpicDesign, openAnnotationCount?: number): EpicHealthInfo {
    const now = Date.now();
    const lastActivityAt = epic.updatedAt;
    const lastActivityMs = new Date(lastActivityAt).getTime();
    const daysSinceActivity = (now - lastActivityMs) / (1000 * 60 * 60 * 24);
    const collaboratorCount = epic.collaborators.length;
    const annCount = openAnnotationCount ?? 0;

    let health: EpicHealth;
    let reason: string;

    // 🔴 Blocked: >5 open annotations AND no activity in 3+ days
    if (annCount > 5 && daysSinceActivity >= 3) {
      health = "blocked";
      reason = `${annCount} open annotations, no activity in ${Math.floor(daysSinceActivity)} days`;
    }
    // ⚡ Hot: multiple collaborators with recent activity (< 24h)
    else if (collaboratorCount >= 2 && daysSinceActivity < 1) {
      health = "hot";
      reason = `${collaboratorCount} collaborators active in last 24h`;
    }
    // 🟡 Stale: no edits in 7+ days
    else if (daysSinceActivity >= 7) {
      health = "stale";
      reason = `No edits in ${Math.floor(daysSinceActivity)} days`;
    }
    // 🟢 Active: edits within last 48h
    else if (daysSinceActivity < 2) {
      health = "active";
      reason = "Recently updated";
    }
    // Default to active for everything else
    else {
      health = "active";
      reason = `Last updated ${Math.floor(daysSinceActivity)} days ago`;
    }

    return {
      health,
      reason,
      lastActivityAt,
      openAnnotationCount: annCount,
      activeCollaboratorCount: collaboratorCount,
    };
  }

  /** Get computed health for a specific epic. */
  async getHealth(projectId: string, epicId: string): Promise<EpicHealthInfo | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const meta = this.readEpicMeta(projectDir, epicId);
    if (!meta) return null;

    return this.computeHealth(meta);
  }

  /* ── Scope Management (P1) ──────────────────────────────────────── */

  /** Get the scope for an epic. Returns null if not yet scoped. */
  async getScope(projectId: string, epicId: string): Promise<EpicScope | null> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const p = this.scopePath(projectDir, epicId);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return null;
    }
  }

  /** Set the full scope for an epic. */
  async setScope(projectId: string, epicId: string, scope: EpicScope): Promise<boolean> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const epicDirectory = this.epicDir(projectDir, epicId);
    if (!existsSync(epicDirectory)) return false;

    writeFileSync(this.scopePath(projectDir, epicId), JSON.stringify(scope, null, 2), "utf-8");

    // Touch updatedAt
    const meta = this.readEpicMeta(projectDir, epicId);
    if (meta) {
      meta.updatedAt = new Date().toISOString();
      this.writeEpicMeta(projectDir, epicId, meta);
    }

    return true;
  }

  /** Update a single scope entry by topicId. */
  async updateScopeEntry(projectId: string, epicId: string, topicId: string, changes: Partial<EpicScopeEntry>): Promise<EpicScopeEntry | null> {
    const scope = await this.getScope(projectId, epicId);
    if (!scope) return null;

    const entry = scope.entries.find((e) => e.topicId === topicId);
    if (!entry) return null;

    Object.assign(entry, changes);
    scope.lastScopedAt = new Date().toISOString();
    await this.setScope(projectId, epicId, scope);
    return entry;
  }

  /** Add a new topic to the scope. */
  async addScopeEntry(projectId: string, epicId: string, entry: EpicScopeEntry): Promise<boolean> {
    let scope = await this.getScope(projectId, epicId);
    if (!scope) {
      scope = { entries: [], lastScopedAt: null, lastScopedBy: null };
    }

    // Don't add duplicates
    if (scope.entries.some((e) => e.topicId === entry.topicId)) return false;

    scope.entries.push(entry);
    scope.lastScopedAt = new Date().toISOString();
    scope.lastScopedBy = entry.source;
    return this.setScope(projectId, epicId, scope);
  }

  /** Remove a topic from scope by topicId. */
  async removeScopeEntry(projectId: string, epicId: string, topicId: string): Promise<boolean> {
    const scope = await this.getScope(projectId, epicId);
    if (!scope) return false;

    const before = scope.entries.length;
    scope.entries = scope.entries.filter((e) => e.topicId !== topicId);
    if (scope.entries.length === before) return false;

    scope.lastScopedAt = new Date().toISOString();
    return this.setScope(projectId, epicId, scope);
  }

  /** Apply an approved scope diff. Only applies items the user has accepted. */
  async applyScopeDiff(projectId: string, epicId: string, diff: {
    addedTopicIds: string[];
    removedTopicIds: string[];
    changedTopicIds: string[];
  }, fullDiff: ScopeDiff): Promise<EpicScope | null> {
    let scope = await this.getScope(projectId, epicId);
    if (!scope) {
      scope = { entries: [], lastScopedAt: null, lastScopedBy: null };
    }

    // Apply accepted additions
    for (const entry of fullDiff.added) {
      if (diff.addedTopicIds.includes(entry.topicId)) {
        if (!scope.entries.some((e) => e.topicId === entry.topicId)) {
          scope.entries.push(entry);
        }
      }
    }

    // Apply accepted removals
    for (const topicId of diff.removedTopicIds) {
      if (fullDiff.removed.includes(topicId)) {
        scope.entries = scope.entries.filter((e) => e.topicId !== topicId);
      }
    }

    // Apply accepted depth changes
    for (const change of fullDiff.changed) {
      if (diff.changedTopicIds.includes(change.topicId)) {
        const entry = scope.entries.find((e) => e.topicId === change.topicId);
        if (entry) {
          entry.previousDepth = change.oldTargetDepth;
          entry.targetDepth = change.newTargetDepth;
        }
      }
    }

    scope.lastScopedAt = new Date().toISOString();
    scope.lastScopedBy = "agent";
    await this.setScope(projectId, epicId, scope);
    return scope;
  }
}
