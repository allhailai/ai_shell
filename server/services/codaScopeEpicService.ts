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

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
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
} from "../../src/apps/codascope/codaScopeTypes.js";
import { CodaScopeEpicKnowledgeService } from "./codaScopeEpicKnowledgeService.js";
import { CodaScopeCurationService } from "./codaScopeCurationService.js";
import { CodaScopeLockService } from "./codaScopeLockService.js";
import { assertSafePathSegment, assertStrictDescendant } from "./codaScopePathSafety.js";
import {
  CodaScopeDesignDocService,
  type CompanionPublication,
} from "./codaScopeDesignDocService.js";
import { CodaScopeVersionService } from "./codaScopeVersionService.js";
import {
  CodaScopePersistence,
  CodaScopePersistenceCorruptError,
  CodaScopePersistenceError,
  codaScopePersistence,
  isPersistenceDomainError,
} from "./codaScopePersistence.js";
import {
  epicStorageMutationKey,
  readActiveEpicsIndex,
  readEpicMetadata,
  validateEpicMetadataAtLocation,
  validateEpicsIndex,
  type EpicMetadata,
  type EpicsIndex,
} from "./codaScopeEpicStorage.js";

export interface CodaScopeEpicLifecycleFileSystem {
  mkdir(directory: string, options: { recursive: true }): Promise<unknown>;
  rename(source: string, target: string): Promise<void>;
  rm(target: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
}

const epicLifecycleFileSystem: CodaScopeEpicLifecycleFileSystem = { mkdir, rename, rm };

export type DefinitionCompanionMutation<T> =
  | { kind: "noop"; value: T }
  | {
    kind: "commit";
    content: string;
    publish: () => Promise<CompanionPublication<T>>;
  };

export type DefinitionCompanionMutationResult<T> =
  | { content: string; companion: T }
  | null;

/* ── Service ────────────────────────────────────────────────────────── */

export class CodaScopeEpicService {
  private root: string;
  private knowledgeService: CodaScopeEpicKnowledgeService;
  private curationService: CodaScopeCurationService;
  private lockService: CodaScopeLockService;
  private designDocService: CodaScopeDesignDocService;
  private versionService: CodaScopeVersionService;

  constructor(
    root: string,
    private readonly persistence: CodaScopePersistence = codaScopePersistence,
    private readonly lifecycleFs: CodaScopeEpicLifecycleFileSystem = epicLifecycleFileSystem,
  ) {
    this.root = root;
    this.knowledgeService = new CodaScopeEpicKnowledgeService(root);
    this.curationService = new CodaScopeCurationService(root);
    this.lockService = new CodaScopeLockService(root);
    this.designDocService = new CodaScopeDesignDocService(root, persistence);
    this.versionService = new CodaScopeVersionService(root, persistence);
  }

  setRoot(root: string): void {
    this.root = root;
    this.knowledgeService.setRoot(root);
    this.curationService.setRoot(root);
    this.lockService.setRoot(root);
    this.designDocService.setRoot(root);
    this.versionService.setRoot(root);
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

  private readIndex(projectDir: string, projectId: string): Promise<EpicsIndex> {
    return readActiveEpicsIndex(this.persistence, projectDir, projectId);
  }

  private writeIndex(projectDir: string, index: EpicsIndex): Promise<void> {
    validateEpicsIndex(index);
    return this.persistence.writeJson(
      this.indexPath(projectDir),
      index,
      { storage: "epic_index" },
    );
  }

  private readEpicMeta(projectDir: string, projectId: string, epicId: string): Promise<EpicMetadata> {
    return readEpicMetadata(this.persistence, projectDir, projectId, epicId);
  }

  private writeEpicMeta(projectDir: string, projectId: string, epicId: string, meta: EpicMetadata): Promise<void> {
    validateEpicMetadataAtLocation(meta, projectId, epicId);
    return this.persistence.writeJson(
      this.epicMetaPath(projectDir, epicId),
      meta,
      { storage: "epic_metadata", projectId, epicId },
    );
  }

  private mutationKey(projectDir: string): string {
    return epicStorageMutationKey(projectDir, this.persistence);
  }

  private async withEpicMutation<T>(
    projectDir: string,
    context: { projectId: string; epicId?: string; operation: string },
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await this.persistence.withMutation(this.mutationKey(projectDir), operation);
    } catch (error) {
      if (isPersistenceDomainError(error)) throw error;
      throw new CodaScopePersistenceError({ storage: "epic_lifecycle", ...context });
    }
  }

  private readRequiredDefinition(projectDir: string, projectId: string, epicId: string): string {
    try {
      return readFileSync(this.definitionPath(projectDir, epicId), "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new CodaScopePersistenceCorruptError({ storage: "epic_definition", projectId, epicId });
      }
      throw new CodaScopePersistenceError({ storage: "epic_definition", projectId, epicId });
    }
  }

  private readScopeFile(projectDir: string, epicId: string): Promise<EpicScope | null> {
    const scopePath = this.scopePath(projectDir, epicId);
    if (!existsSync(scopePath)) return Promise.resolve(null);
    return this.persistence.readJson(scopePath, {
      context: { storage: "epic_scope", epicId },
      validate: validateEpicScope,
    });
  }

  private async setScopeUnlocked(projectDir: string, projectId: string, epicId: string, scope: EpicScope): Promise<boolean> {
    validateEpicScope(scope);
    const index = await this.readIndex(projectDir, projectId);
    if (!index.epics.some((epic) => epic.id === epicId)) return false;
    const epicDirectory = this.epicDir(projectDir, epicId);
    if (!existsSync(epicDirectory)) return false;
    const metaPath = this.epicMetaPath(projectDir, epicId);
    const meta = await this.readEpicMeta(projectDir, projectId, epicId);
    const scopePath = this.scopePath(projectDir, epicId);
    const previousScope = existsSync(scopePath) ? readFileSync(scopePath) : null;
    await this.persistence.writeJson(scopePath, scope, { storage: "epic_scope", epicId });
    meta.updatedAt = new Date().toISOString();
    try {
      await this.writeEpicMeta(projectDir, projectId, epicId, meta);
    } catch (error) {
      if (previousScope) {
        await this.persistence.writeFile(scopePath, previousScope, { storage: "epic_scope", epicId });
      } else {
        await this.lifecycleFs.rm(scopePath, { force: true });
      }
      throw error;
    }
    return true;
  }

  /* ── CRUD ──────────────────────────────────────────────────────────── */

  /** List all epics for a project (with computed health). */
  async listEpics(projectId: string): Promise<(EpicDesign & { health: EpicHealthInfo })[]> {
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return [];
    const index = await this.readIndex(projectDir, projectId);
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

    return this.withEpicMutation(projectDir, { projectId, operation: "create" }, async () => {
      const index = await this.readIndex(projectDir, projectId);
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
      const epicsRoot = this.epicsDir(projectDir);
      const finalDirectory = this.epicDir(projectDir, id);
      const stagingDirectory = assertStrictDescendant(
        epicsRoot,
        path.join(epicsRoot, `.${id}.create.${crypto.randomUUID()}`),
        "epic creation staging directory",
      );
      await this.lifecycleFs.mkdir(stagingDirectory, { recursive: true });
      try {
        const meta: EpicMetadata = { ...epic, conversationId: null };
        await this.persistence.writeJson(
          path.join(stagingDirectory, "epic.json"),
          meta,
          { storage: "epic_metadata", epicId: id },
        );
        writeFileSync(path.join(stagingDirectory, "definition.md"), "", "utf-8");
        this.knowledgeService.initializeKnowledgeDir(stagingDirectory);
        this.curationService.initializeCurationDir(stagingDirectory);
        await this.lifecycleFs.rename(stagingDirectory, finalDirectory);
        index.epics.push(epic);
        try {
          await this.writeIndex(projectDir, index);
        } catch (error) {
          await this.lifecycleFs.rm(finalDirectory, { recursive: true, force: true });
          throw error;
        }
        return epic;
      } catch (error) {
        await this.lifecycleFs.rm(stagingDirectory, { recursive: true, force: true });
        throw error;
      }
    });
  }

  /** Get full epic detail (assembled read model). */
  async getEpic(projectId: string, epicId: string): Promise<EpicDesignDetail | null> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const index = await this.readIndex(projectDir, projectId);
    if (!index.epics.some((epic) => epic.id === epicId)) return null;
    const meta = await this.readEpicMeta(projectDir, projectId, epicId);

    const definition = this.readRequiredDefinition(projectDir, projectId, epicId);

    // Read scope if present
    const scopeFilePath = this.scopePath(projectDir, epicId);
    const scope = existsSync(scopeFilePath)
      ? await this.persistence.readJson(scopeFilePath, {
        context: { storage: "epic_scope", epicId },
        validate: validateEpicScope,
      })
      : null;
    const epicDirectory = this.epicDir(projectDir, epicId);
    const designDocs = await this.designDocService.readDesignsIndex(epicDirectory);
    const versions = await this.versionService.readVersionsIndex(epicDirectory);

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
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return this.withEpicMutation(projectDir, { projectId, epicId, operation: "update" }, async () => {
      const index = await this.readIndex(projectDir, projectId);
      const idx = index.epics.findIndex((epic) => epic.id === epicId);
      if (idx < 0) return null;
      const meta = await this.readEpicMeta(projectDir, projectId, epicId);
      const previousMeta = readFileSync(this.epicMetaPath(projectDir, epicId));
      if (updates.title !== undefined) meta.title = updates.title;
      if (updates.status !== undefined) meta.status = updates.status;
      if (updates.collaborators !== undefined) meta.collaborators = updates.collaborators;
      meta.updatedAt = new Date().toISOString();
      await this.writeEpicMeta(projectDir, projectId, epicId, meta);
      const { conversationId: _, ...epicData } = meta;
      index.epics[idx] = epicData;
      try {
        await this.writeIndex(projectDir, index);
      } catch (error) {
        await this.persistence.writeFile(
          this.epicMetaPath(projectDir, epicId),
          previousMeta,
          { storage: "epic_metadata", epicId },
        );
        throw error;
      }
      return epicData;
    });
  }

  /** Delete an epic and all its data. */
  async deleteEpic(projectId: string, epicId: string): Promise<boolean> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    return this.withEpicMutation(projectDir, { projectId, epicId, operation: "delete" }, async () => {
      const index = await this.readIndex(projectDir, projectId);
      const indexPosition = index.epics.findIndex((epic) => epic.id === epicId);
      const epicsRoot = this.epicsDir(projectDir);
      const epicDirectory = assertStrictDescendant(epicsRoot, this.epicDir(projectDir, epicId), "epic delete target");
      if (!existsSync(epicDirectory)) return false;
      if (indexPosition < 0) throw new CodaScopePersistenceCorruptError({ storage: "epic_index", epicId });
      const tombstone = assertStrictDescendant(
        epicsRoot,
        path.join(epicsRoot, `.${epicId}.delete.${crypto.randomUUID()}`),
        "epic delete tombstone",
      );
      await this.lifecycleFs.rename(epicDirectory, tombstone);
      index.epics.splice(indexPosition, 1);
      try {
        await this.writeIndex(projectDir, index);
      } catch (error) {
        try {
          if (existsSync(tombstone) && !existsSync(epicDirectory)) await this.lifecycleFs.rename(tombstone, epicDirectory);
        } catch {
          throw new CodaScopePersistenceError({ storage: "epic_index", epicId, recovery: "operator_required" });
        }
        throw error;
      }
      try {
        await this.lifecycleFs.rm(tombstone, { recursive: true });
      } catch {
        throw new CodaScopePersistenceError({
          storage: "epic_delete",
          epicId,
          recovery: "orphan_tombstone",
        });
      }
      return true;
    });
  }

  /* ── Archive / Restore ─────────────────────────────────────────────── */

  /** Move an epic to the _archive directory. Preserves all data. */
  async archiveEpic(projectId: string, epicId: string): Promise<boolean> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    return this.withEpicMutation(projectDir, { projectId, epicId, operation: "archive" }, async () => {
      const index = await this.readIndex(projectDir, projectId);
      const position = index.epics.findIndex((epic) => epic.id === epicId);
      const epicsRoot = this.epicsDir(projectDir);
      const epicDirectory = assertStrictDescendant(epicsRoot, this.epicDir(projectDir, epicId), "epic archive source");
      if (!existsSync(epicDirectory)) return false;
      if (position < 0) throw new CodaScopePersistenceCorruptError({ storage: "epic_index", epicId });
      const meta = await this.readEpicMeta(projectDir, projectId, epicId);
      const previousMeta = readFileSync(this.epicMetaPath(projectDir, epicId));
      const archiveDirectory = this.archiveDir(projectDir);
      const archiveDirectoryExisted = existsSync(archiveDirectory);
      const destDir = assertStrictDescendant(archiveDirectory, this.archivedEpicDir(projectDir, epicId), "epic archive target");
      if (existsSync(destDir)) throw new CodaScopePersistenceCorruptError({ storage: "epic_archive", epicId });

      meta.status = "archived";
      meta.updatedAt = new Date().toISOString();
      await this.writeEpicMeta(projectDir, projectId, epicId, meta);
      try {
        await this.lifecycleFs.mkdir(archiveDirectory, { recursive: true });
        await this.lifecycleFs.rename(epicDirectory, destDir);
        index.epics.splice(position, 1);
        await this.writeIndex(projectDir, index);
      } catch (error) {
        try {
          if (existsSync(destDir) && !existsSync(epicDirectory)) await this.lifecycleFs.rename(destDir, epicDirectory);
          await this.persistence.writeFile(
            this.epicMetaPath(projectDir, epicId),
            previousMeta,
            { storage: "epic_metadata", epicId },
          );
          if (!archiveDirectoryExisted && existsSync(archiveDirectory)) {
            await this.lifecycleFs.rm(archiveDirectory, { recursive: true, force: true });
          }
        } catch {
          throw new CodaScopePersistenceError({ storage: "epic_archive", epicId, recovery: "operator_required" });
        }
        throw error;
      }
      return true;
    });
  }

  /** Restore an epic from the _archive directory back to active. */
  async restoreEpic(projectId: string, epicId: string): Promise<EpicDesign | null> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    return this.withEpicMutation(projectDir, { projectId, epicId, operation: "restore" }, async () => {
      const index = await this.readIndex(projectDir, projectId);
      if (index.epics.some((epic) => epic.id === epicId)) {
        throw new CodaScopePersistenceCorruptError({ storage: "epic_index", epicId });
      }
      const archiveDirectory = this.archiveDir(projectDir);
      const archivedDir = assertStrictDescendant(archiveDirectory, this.archivedEpicDir(projectDir, epicId), "epic restore source");
      if (!existsSync(archivedDir)) return null;
      const destDir = assertStrictDescendant(this.epicsDir(projectDir), this.epicDir(projectDir, epicId), "epic restore target");
      if (existsSync(destDir)) throw new CodaScopePersistenceCorruptError({ storage: "epic_archive", epicId });
      const archivedMetaPath = path.join(archivedDir, "epic.json");
      const meta = await this.persistence.readJson(archivedMetaPath, {
        context: { storage: "epic_metadata", projectId, epicId },
        validate: (value) => validateEpicMetadataAtLocation(value, projectId, epicId),
      });
      const previousMeta = readFileSync(archivedMetaPath);
      meta.status = "defining";
      meta.updatedAt = new Date().toISOString();
      await this.persistence.writeJson(archivedMetaPath, meta, { storage: "epic_metadata", epicId });
      try {
        await this.lifecycleFs.rename(archivedDir, destDir);
        const { conversationId: _, ...epicData } = meta;
        index.epics.push(epicData);
        await this.writeIndex(projectDir, index);
        return epicData;
      } catch (error) {
        try {
          if (existsSync(destDir) && !existsSync(archivedDir)) await this.lifecycleFs.rename(destDir, archivedDir);
          await this.persistence.writeFile(archivedMetaPath, previousMeta, { storage: "epic_metadata", epicId });
        } catch {
          throw new CodaScopePersistenceError({ storage: "epic_archive", epicId, recovery: "operator_required" });
        }
        throw error;
      }
    });
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
      assertSafePathSegment(entry.name, "epic ID");
      const metaPath = path.join(archiveDirectory, entry.name, "epic.json");
      const data = await this.persistence.readJson(metaPath, {
        context: { storage: "epic_metadata", projectId, epicId: entry.name },
        validate: (value) => validateEpicMetadataAtLocation(value, projectId, entry.name),
      });
      const { conversationId: _, ...epicData } = data;
      epics.push(epicData);
    }

    return epics;
  }

  /* ── Definition (markdown I/O) ─────────────────────────────────────── */

  /** Get the definition markdown for an epic. */
  async getDefinition(projectId: string, epicId: string): Promise<string | null> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const index = await this.readIndex(projectDir, projectId);
    if (!index.epics.some((epic) => epic.id === epicId)) return null;
    return this.readRequiredDefinition(projectDir, projectId, epicId);
  }

  /** Update the definition markdown for an epic. */
  async updateDefinition(projectId: string, epicId: string, content: string): Promise<boolean> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    const saved = await this.withEpicMutation(
      projectDir,
      { projectId, epicId, operation: "update_definition" },
      async () => {
      const index = await this.readIndex(projectDir, projectId);
      const idx = index.epics.findIndex((epic) => epic.id === epicId);
      const epicDirectory = this.epicDir(projectDir, epicId);
      if (!existsSync(epicDirectory)) return false;
      if (idx < 0) throw new CodaScopePersistenceCorruptError({ storage: "epic_index", epicId });
      const meta = await this.readEpicMeta(projectDir, projectId, epicId);
      const defPath = this.definitionPath(projectDir, epicId);
      const previousDefinition = Buffer.from(this.readRequiredDefinition(projectDir, projectId, epicId));
      const previousMeta = readFileSync(this.epicMetaPath(projectDir, epicId));
      await this.persistence.writeFile(defPath, content, { storage: "epic_definition", epicId });
      meta.updatedAt = new Date().toISOString();
      try {
        await this.writeEpicMeta(projectDir, projectId, epicId, meta);
        index.epics[idx].updatedAt = meta.updatedAt;
        await this.writeIndex(projectDir, index);
      } catch (error) {
        try {
          await this.persistence.writeFile(
            this.epicMetaPath(projectDir, epicId),
            previousMeta,
            { storage: "epic_metadata", epicId },
          );
          await this.persistence.writeFile(defPath, previousDefinition, { storage: "epic_definition", epicId });
        } catch {
          throw new CodaScopePersistenceError({ storage: "epic_definition", epicId, recovery: "operator_required" });
        }
        throw error;
      }
      return true;
      },
    );
    if (!saved) return false;

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

  /**
   * Transform the current definition and publish one companion sidecar under
   * the canonical definition ordering: project epic storage -> directive
   * sidecar. This ordering matches every normal definition writer and keeps
   * the sidecar outside the epic lifecycle queue until the document lock is
   * already held.
   */
  async mutateDefinitionWithCompanion<T>(
    projectId: string,
    epicId: string,
    companionMutationKey: string,
    prepare: (currentContent: string) => Promise<DefinitionCompanionMutation<T>>,
  ): Promise<DefinitionCompanionMutationResult<T>> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const transaction = await this.persistence.withMutation(this.mutationKey(projectDir), () => (
      this.persistence.withMutation(companionMutationKey, async () => {
        const index = await this.readIndex(projectDir, projectId);
        const idx = index.epics.findIndex((epic) => epic.id === epicId);
        const epicDirectory = this.epicDir(projectDir, epicId);
        if (!existsSync(epicDirectory)) return null;
        if (idx < 0) {
          throw new CodaScopePersistenceCorruptError({
            storage: "epic_index",
            projectId,
            epicId,
          });
        }
        const meta = await this.readEpicMeta(projectDir, projectId, epicId);
        const definition = this.readRequiredDefinition(projectDir, projectId, epicId);
        const prepared = await prepare(definition);
        if (prepared.kind === "noop") {
          return {
            changed: false,
            result: { content: definition, companion: prepared.value },
          };
        }

        const defPath = this.definitionPath(projectDir, epicId);
        const metaPath = this.epicMetaPath(projectDir, epicId);
        const indexPath = this.indexPath(projectDir);
        let previousDefinition: Buffer;
        let previousMeta: Buffer;
        let previousIndex: Buffer;
        try {
          previousDefinition = readFileSync(defPath);
          previousMeta = readFileSync(metaPath);
          previousIndex = readFileSync(indexPath);
        } catch {
          throw new CodaScopePersistenceError({
            storage: "epic_definition",
            projectId,
            epicId,
          });
        }

        try {
          await this.persistence.writeFile(
            defPath,
            prepared.content,
            { storage: "epic_definition", projectId, epicId },
          );
          meta.updatedAt = new Date().toISOString();
          await this.writeEpicMeta(projectDir, projectId, epicId, meta);
          index.epics[idx].updatedAt = meta.updatedAt;
          await this.writeIndex(projectDir, index);
          const publication = await prepared.publish();
          return {
            changed: true,
            result: { content: prepared.content, companion: publication.value },
          };
        } catch (error) {
          try {
            await this.persistence.writeFile(
              defPath,
              previousDefinition,
              { storage: "epic_definition", projectId, epicId },
            );
            await this.persistence.writeFile(
              metaPath,
              previousMeta,
              { storage: "epic_metadata", projectId, epicId },
            );
            await this.persistence.writeFile(
              indexPath,
              previousIndex,
              { storage: "epic_index", projectId },
            );
          } catch {
            throw new CodaScopePersistenceError({
              storage: "epic_directive_transaction",
              projectId,
              epicId,
              recovery: "operator_required",
            });
          }
          throw error;
        }
      })
    ));
    if (!transaction) return null;
    if (transaction.changed) {
      try {
        await this.curationService.addReason(projectId, epicId, {
          type: "definition_changed",
          at: new Date().toISOString(),
          detail: "Epic definition was updated",
        });
      } catch { /* non-fatal — curation dir may not exist for old epics */ }
    }
    return transaction.result;
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
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const index = await this.readIndex(projectDir, projectId);
    if (!index.epics.some((epic) => epic.id === epicId)) return null;
    const meta = await this.readEpicMeta(projectDir, projectId, epicId);
    return this.computeHealth(meta);
  }

  /* ── Scope Management (P1) ──────────────────────────────────────── */

  /** Get the scope for an epic. Returns null if not yet scoped. */
  async getScope(projectId: string, epicId: string): Promise<EpicScope | null> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;

    const index = await this.readIndex(projectDir, projectId);
    if (!index.epics.some((epic) => epic.id === epicId)) return null;
    return this.readScopeFile(projectDir, epicId);
  }

  /** Set the full scope for an epic. */
  async setScope(projectId: string, epicId: string, scope: EpicScope): Promise<boolean> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;

    return this.withEpicMutation(
      projectDir,
      { projectId, epicId, operation: "set_scope" },
      () => this.setScopeUnlocked(projectDir, projectId, epicId, scope),
    );
  }

  /** Update a single scope entry by topicId. */
  async updateScopeEntry(projectId: string, epicId: string, topicId: string, changes: Partial<EpicScopeEntry>): Promise<EpicScopeEntry | null> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;
    return this.withEpicMutation(projectDir, { projectId, epicId, operation: "update_scope" }, async () => {
      const scope = await this.readScopeFile(projectDir, epicId);
      if (!scope) return null;
      const entry = scope.entries.find((candidate) => candidate.topicId === topicId);
      if (!entry) return null;
      Object.assign(entry, changes);
      scope.lastScopedAt = new Date().toISOString();
      await this.setScopeUnlocked(projectDir, projectId, epicId, scope);
      return entry;
    });
  }

  /** Add a new topic to the scope. */
  async addScopeEntry(projectId: string, epicId: string, entry: EpicScopeEntry): Promise<boolean> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;
    return this.withEpicMutation(projectDir, { projectId, epicId, operation: "add_scope" }, async () => {
      const scope = await this.readScopeFile(projectDir, epicId)
        ?? { entries: [], lastScopedAt: null, lastScopedBy: null };
      if (scope.entries.some((candidate) => candidate.topicId === entry.topicId)) return false;
      scope.entries.push(entry);
      scope.lastScopedAt = new Date().toISOString();
      scope.lastScopedBy = entry.source;
      return this.setScopeUnlocked(projectDir, projectId, epicId, scope);
    });
  }

  /** Remove a topic from scope by topicId. */
  async removeScopeEntry(projectId: string, epicId: string, topicId: string): Promise<boolean> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return false;
    return this.withEpicMutation(projectDir, { projectId, epicId, operation: "remove_scope" }, async () => {
      const scope = await this.readScopeFile(projectDir, epicId);
      if (!scope) return false;
      const before = scope.entries.length;
      scope.entries = scope.entries.filter((entry) => entry.topicId !== topicId);
      if (scope.entries.length === before) return false;
      scope.lastScopedAt = new Date().toISOString();
      return this.setScopeUnlocked(projectDir, projectId, epicId, scope);
    });
  }

  /** Apply an approved scope diff. Only applies items the user has accepted. */
  async applyScopeDiff(projectId: string, epicId: string, diff: {
    addedTopicIds: string[];
    removedTopicIds: string[];
    changedTopicIds: string[];
  }, fullDiff: ScopeDiff): Promise<EpicScope | null> {
    assertSafePathSegment(epicId, "epic ID");
    const projectDir = this.projectDir(projectId);
    if (!projectDir) return null;
    return this.withEpicMutation(projectDir, { projectId, epicId, operation: "apply_scope_diff" }, async () => {
    let scope = await this.readScopeFile(projectDir, epicId);
    if (!scope) scope = { entries: [], lastScopedAt: null, lastScopedBy: null };

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
    await this.setScopeUnlocked(projectDir, projectId, epicId, scope);
    return scope;
    });
  }
}

function validateEpicScope(value: unknown): EpicScope {
  if (!isRecord(value)
    || !Array.isArray(value.entries)
    || (value.lastScopedAt !== null && typeof value.lastScopedAt !== "string")
    || (value.lastScopedBy !== null && typeof value.lastScopedBy !== "string")) {
    throw new Error("invalid epic scope");
  }
  const topicIds = new Set<string>();
  const depths = new Set(["none", "stub", "outline", "developed", "comprehensive"]);
  for (const entry of value.entries) {
    if (!isRecord(entry)
      || typeof entry.topicId !== "string"
      || typeof entry.topicTitle !== "string"
      || (entry.type !== "existing-wiki" && entry.type !== "new")
      || (entry.source !== "agent" && entry.source !== "user")
      || typeof entry.included !== "boolean"
      || (entry.previousDepth !== undefined && !depths.has(String(entry.previousDepth)))
      || (entry.targetDepth !== undefined && !depths.has(String(entry.targetDepth)))
      || (entry.currentDepth !== undefined && !depths.has(String(entry.currentDepth)))
      || (entry.enrichedAt !== undefined && typeof entry.enrichedAt !== "string")
      || (entry.enrichmentRunId !== undefined && typeof entry.enrichmentRunId !== "string")
      || topicIds.has(entry.topicId)) {
      throw new Error("invalid epic scope entry");
    }
    topicIds.add(entry.topicId);
  }
  return value as unknown as EpicScope;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
