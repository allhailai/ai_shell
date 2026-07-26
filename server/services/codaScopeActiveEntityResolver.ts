/* ── CodaScope: Active Entity Resolver ───────────────────────────────
   Strict, active-only resolution for workspace read services. This boundary
   deliberately does not change the legacy project-facing service behavior.
   ──────────────────────────────────────────────────────────────────── */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type {
  CodaScopeRepo,
  EpicDesign,
  EpicDesignDoc,
} from "../../src/apps/codascope/codaScopeTypes.js";
import { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";
import {
  CodaScopePersistence,
  CodaScopePersistenceCorruptError,
  CodaScopePersistenceError,
  codaScopePersistence,
} from "./codaScopePersistence.js";
import { assertSafePathSegment } from "./codaScopePathSafety.js";
import { readActiveEpicsIndex } from "./codaScopeEpicStorage.js";

export interface ActiveProjectRecord {
  projectId: string;
  name: string;
  description: string;
  repositories: CodaScopeRepo[];
  createdAt: string;
  updatedAt: string;
  projectDir: string;
}

export interface ActiveEpicRecord {
  project: ActiveProjectRecord;
  epic: EpicDesign;
}

export interface ActiveDesignRecord extends ActiveEpicRecord {
  document: EpicDesignDoc;
}

interface StrictProjectMetadata {
  id: string;
  name: string;
  description: string;
  repositories: CodaScopeRepo[];
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}

export class CodaScopeActiveEntityResolver {
  constructor(
    private readonly root: string,
    private readonly designDocService: CodaScopeDesignDocService,
    private readonly persistence: CodaScopePersistence = codaScopePersistence,
  ) {}

  getRoot(): string {
    return this.root;
  }

  /**
   * Enumerate and strictly validate every authoritative project record before
   * filtering archives. Corruption or duplicate IDs therefore cannot be
   * reinterpreted as an empty/partial workspace.
   */
  async listActiveProjects(): Promise<ActiveProjectRecord[]> {
    if (!existsSync(this.root)) return [];

    let entries;
    try {
      entries = readdirSync(this.root, { withFileTypes: true });
    } catch {
      throw new CodaScopePersistenceError({ storage: "project_catalog" });
    }

    const records: Array<{ metadata: StrictProjectMetadata; projectDir: string }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const projectDir = path.join(this.root, entry.name);
      const metadataPath = path.join(projectDir, "project.json");
      if (!existsSync(metadataPath)) continue;

      const metadata = await this.persistence.readJson(metadataPath, {
        context: { storage: "project_metadata" },
        validate: validateProjectMetadata,
      });
      records.push({ metadata, projectDir });
    }

    const ids = new Set<string>();
    for (const { metadata } of records) {
      if (ids.has(metadata.id)) {
        throw new CodaScopePersistenceCorruptError({
          storage: "project_catalog",
          projectId: metadata.id,
        });
      }
      ids.add(metadata.id);
    }

    return records
      .filter(({ metadata }) => metadata.archived !== true)
      .map(({ metadata, projectDir }) => ({
        projectId: metadata.id,
        name: metadata.name,
        description: metadata.description,
        repositories: metadata.repositories.map((repository) => ({ ...repository })),
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        projectDir,
      }))
      .sort((a, b) => (
        a.name.localeCompare(b.name)
        || a.projectId.localeCompare(b.projectId)
      ));
  }

  /** Resolve an explicitly validated project while re-reading active state. */
  async resolveActiveProject(projectId: string): Promise<ActiveProjectRecord | null> {
    assertSafePathSegment(projectId, "project ID");
    const projects = await this.listActiveProjects();
    return projects.find((project) => project.projectId === projectId) ?? null;
  }

  /** Resolve only through the authoritative active epic index. */
  async resolveActiveEpic(projectId: string, epicId: string): Promise<ActiveEpicRecord | null> {
    assertSafePathSegment(epicId, "epic ID");
    const project = await this.resolveActiveProject(projectId);
    if (!project) return null;

    const index = await readActiveEpicsIndex(
      this.persistence,
      project.projectDir,
      project.projectId,
    );
    const epic = index.epics.find((candidate) => candidate.id === epicId);
    if (!epic || epic.status === "archived") return null;
    return { project, epic };
  }

  /** Resolve an active design and treat archived records exactly like absence. */
  async resolveActiveDesign(
    projectId: string,
    epicId: string,
    documentId: string,
  ): Promise<ActiveDesignRecord | null> {
    assertSafePathSegment(documentId, "document ID");
    const activeEpic = await this.resolveActiveEpic(projectId, epicId);
    if (!activeEpic) return null;

    const epicDir = path.join(
      activeEpic.project.projectDir,
      "epics",
      activeEpic.epic.id,
    );
    const documents = await this.designDocService.readDesignsIndex(epicDir);
    if (documents.some((document) => document.epicId !== activeEpic.epic.id)) {
      throw new CodaScopePersistenceCorruptError({
        storage: "design_index",
        projectId,
        epicId,
      });
    }

    const document = documents.find((candidate) => candidate.id === documentId);
    if (!document || document.archivedAt) return null;
    return { ...activeEpic, document };
  }
}

function validateProjectMetadata(value: unknown): StrictProjectMetadata {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.name !== "string"
    || typeof value.description !== "string"
    || !Array.isArray(value.repositories)
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || (value.archived !== undefined && typeof value.archived !== "boolean")
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)) {
    throw new Error("invalid project metadata");
  }

  assertSafePathSegment(value.id, "project ID");
  const repositoryIds = new Set<string>();
  const repositories = value.repositories.map((repository) => {
    if (!isRecord(repository)
      || typeof repository.id !== "string"
      || typeof repository.name !== "string"
      || typeof repository.path !== "string"
      || (repository.branch !== undefined && typeof repository.branch !== "string")) {
      throw new Error("invalid repository metadata");
    }
    assertSafePathSegment(repository.id, "repository ID");
    if (repositoryIds.has(repository.id)) throw new Error("duplicate repository ID");
    repositoryIds.add(repository.id);
    return {
      id: repository.id,
      name: repository.name,
      path: repository.path,
      ...(repository.branch !== undefined ? { branch: repository.branch } : {}),
    };
  });

  return {
    id: value.id,
    name: value.name,
    description: value.description,
    repositories,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.archived !== undefined ? { archived: value.archived } : {}),
  };
}

function isTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
