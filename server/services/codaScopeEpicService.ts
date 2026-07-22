/* ── CodaScope: Epic Design Service ──────────────────────────────────
   Core CRUD service for epic designs.
   Follows existing service patterns (module singleton, atomic writes,
   project-directory-based storage).

   Responsibilities:
   - Epic CRUD (create, read, update, delete, list)
   - Definition document read/write (markdown file I/O)
   - Edit lock management (via CodaScopeLockService)
   - Storage layout management (creates epics/ directory structure)
   - Epic health computation (derived from timestamps and annotation counts)
   - Integration: initializes knowledge/ and curation/ dirs on creation,
     fires curation reasons on definition changes
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
import { CodaScopeEpicKnowledgeService } from "./codaScopeEpicKnowledgeService.js";
import { CodaScopeCurationService } from "./codaScopeCurationService.js";
import { CodaScopeLockService } from "./codaScopeLockService.js";
import { assertSafePathSegment, assertStrictDescendant } from "./codaScopePathSafety.js";

/* ── Storage Schema ────────────────────────────────────────────────── */

interface EpicsIndex {
  epics: EpicDesign[];
}

interface EpicMetadata extends EpicDesign {
  conversationId: string | null;
}

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeEpicService {
  private root: string;
  private knowledgeService: CodaScopeEpicKnowledgeService;
  private curationService: CodaScopeCurationService;
  private lockService: CodaScopeLockService;

  constructor(root: string) {
    this.root = root;
    this.knowledgeService = new CodaScopeEpicKnowledgeService(root);
    this.curationService = new CodaScopeCurationService(root);
    this.lockService = new CodaScopeLockService(root);
  }

  setRoot(root: string): void {
    this.root = root;
    this.knowledgeService.setRoot(root);
    this.curationService.setRoot(root);
    this.lockService.setRoot(root);
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
    return path.join(this.epicsDir(projectDir), assertSafePathSegment(epicId, "epic ID"));
  }

  private epicMetaPath(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "epic.json");
  }

  private definitionPath(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "definition.md");
  }


  private scopePath(projectDir: string, epicId: string): string {
    return path.join(this.epicDir(projectDir, epicId), "scope.json");
  }

  private archiveDir(projectDir: string): string {
    return path.join(this.epicsDir(projectDir), "_archive");
  }

  private archivedEpicDir(projectDir: string, epicId: string): string {
    return path.join(this.archiveDir(projectDir), assertSafePathSegment(epicId, "epic ID"));
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

    // Initialize knowledge/ and curation/ directory structures
    this.knowledgeService.initializeKnowledgeDir(epicDirectory);
    this.curationService.initializeCurationDir(epicDirectory);

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

    const epicsRoot = this.epicsDir(projectDir);
    const epicDirectory = assertStrictDescendant(
      epicsRoot,
      this.epicDir(projectDir, epicId),
      "epic delete target",
    );
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

    const epicsRoot = this.epicsDir(projectDir);
    const epicDirectory = assertStrictDescendant(
      epicsRoot,
      this.epicDir(projectDir, epicId),
      "epic archive source",
    );
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
    const destDir = assertStrictDescendant(
      archiveDirectory,
      this.archivedEpicDir(projectDir, epicId),
      "epic archive target",
    );
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

    const archiveDirectory = this.archiveDir(projectDir);
    const archivedDir = assertStrictDescendant(
      archiveDirectory,
      this.archivedEpicDir(projectDir, epicId),
      "epic restore source",
    );
    if (!existsSync(archivedDir)) return null;

    // Move back to active epics
    const destDir = assertStrictDescendant(
      this.epicsDir(projectDir),
      this.epicDir(projectDir, epicId),
      "epic restore target",
    );
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

    // Fire curation reason for definition change
    try {
      await this.curationService.addReason(projectId, epicId, {
        type: "definition_changed",
        at: new Date().toISOString(),
        detail: "Epic definition was updated",
      });
    } catch { /* non-fatal — curation dir may not exist for old epics */ }

    return true;
  }

  /* ── Edit Lock Management (delegated to CodaScopeLockService) ────── */

  /** Acquire an edit lock on a document within an epic. */
  async acquireLock(projectId: string, epicId: string, opts: {
    documentId: string;
    lockedBy: string;
  }): Promise<EditLock | { error: string; holder: EditLock }> {
    return this.lockService.acquireLock(projectId, epicId, opts);
  }

  /** Release an edit lock only for its holder. */
  async releaseLock(projectId: string, epicId: string, documentId: string, actorId: string): Promise<boolean> {
    return this.lockService.releaseLock(projectId, epicId, documentId, actorId);
  }

  /** Check current lock status for a document. */
  async getLockStatus(projectId: string, epicId: string): Promise<EditLock[]> {
    return this.lockService.getLockStatus(projectId, epicId);
  }

  /** Heartbeat — refresh lock TTL for active editing. */
  async heartbeatLock(projectId: string, epicId: string, documentId: string, lockedBy: string): Promise<EditLock | null> {
    return this.lockService.heartbeatLock(projectId, epicId, documentId, lockedBy);
  }

  /** Check if a document is currently locked by a human. */
  async isDocumentLockedByHuman(projectId: string, epicId: string, documentId: string): Promise<EditLock | null> {
    return this.lockService.isDocumentLockedByHuman(projectId, epicId, documentId);
  }

  /** Cleanup all expired locks across all epics. */
  async cleanupAllExpiredLocks(projectId: string): Promise<number> {
    return this.lockService.cleanupAllExpiredLocks(projectId);
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
