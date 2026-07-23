import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { EpicDesign } from "../../src/apps/codascope/codaScopeTypes.js";
import { assertSafePathSegment } from "./codaScopePathSafety.js";
import {
  CodaScopePersistence,
  CodaScopePersistenceCorruptError,
  CodaScopePersistenceError,
  codaScopePersistence,
  isPersistenceDomainError,
} from "./codaScopePersistence.js";

export interface EpicsIndex {
  epics: EpicDesign[];
}

export interface EpicMetadata extends EpicDesign {
  conversationId: string | null;
}

export function epicStorageMutationKey(
  projectDir: string,
  persistence: CodaScopePersistence = codaScopePersistence,
): string {
  return persistence.canonicalKey("epic-storage", path.join(projectDir, "epics"));
}

export async function readActiveEpicsIndex(
  persistence: CodaScopePersistence,
  projectDir: string,
  projectId: string,
): Promise<EpicsIndex> {
  try {
    return await readActiveEpicsIndexUnchecked(persistence, projectDir, projectId);
  } catch (error) {
    if (isPersistenceDomainError(error)) throw error;
    throw new CodaScopePersistenceError({ storage: "epic_index", projectId });
  }
}

async function readActiveEpicsIndexUnchecked(
  persistence: CodaScopePersistence,
  projectDir: string,
  projectId: string,
): Promise<EpicsIndex> {
  const epicsDir = path.join(projectDir, "epics");
  const index = await persistence.readJson(path.join(epicsDir, "epics.json"), {
    context: { storage: "epic_index", projectId },
    missing: () => {
      if (activeEpicDirectoryNames(epicsDir).length > 0) {
        throw new CodaScopePersistenceCorruptError({ storage: "epic_index", projectId });
      }
      return { epics: [] };
    },
    validate: validateEpicsIndex,
  });

  const indexedIds = new Set(index.epics.map((epic) => epic.id));
  const directoryIds = activeEpicDirectoryNames(epicsDir);
  if (directoryIds.length !== indexedIds.size
    || directoryIds.some((epicId) => !indexedIds.has(epicId))) {
    throw new CodaScopePersistenceCorruptError({ storage: "epic_index", projectId });
  }

  for (const epic of index.epics) {
    if (epic.projectId !== projectId) {
      throw new CodaScopePersistenceCorruptError({ storage: "epic_index", projectId, epicId: epic.id });
    }
    await readEpicMetadata(persistence, projectDir, projectId, epic.id);
  }
  return index;
}

export function readEpicMetadata(
  persistence: CodaScopePersistence,
  projectDir: string,
  projectId: string,
  epicId: string,
): Promise<EpicMetadata> {
  const safeEpicId = assertSafePathSegment(epicId, "epic ID");
  return persistence.readJson(path.join(projectDir, "epics", safeEpicId, "epic.json"), {
    context: { storage: "epic_metadata", projectId, epicId },
    validate: (value) => validateEpicMetadataAtLocation(value, projectId, epicId),
  });
}

export function validateEpicsIndex(value: unknown): EpicsIndex {
  if (!isRecord(value) || !Array.isArray(value.epics)) throw new Error("invalid epic index");
  const ids = new Set<string>();
  for (const epic of value.epics) {
    validateEpicDesign(epic);
    if (ids.has(epic.id)) throw new Error("duplicate epic ID");
    ids.add(epic.id);
  }
  return value as unknown as EpicsIndex;
}

export function validateEpicMetadata(value: unknown): EpicMetadata {
  validateEpicDesign(value);
  if (!isRecord(value)
    || (value.conversationId !== null && typeof value.conversationId !== "string")) {
    throw new Error("invalid epic metadata");
  }
  return value as unknown as EpicMetadata;
}

export function validateEpicMetadataAtLocation(
  value: unknown,
  projectId: string,
  epicId: string,
): EpicMetadata {
  const metadata = validateEpicMetadata(value);
  if (metadata.projectId !== projectId || metadata.id !== epicId) {
    throw new Error("epic metadata identity does not match storage location");
  }
  return metadata;
}

function activeEpicDirectoryNames(epicsDir: string): string[] {
  if (!existsSync(epicsDir)) return [];
  return readdirSync(epicsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()
      && entry.name !== "_archive"
      && !entry.name.startsWith("."))
    .map((entry) => assertSafePathSegment(entry.name, "epic ID"));
}

function validateEpicDesign(value: unknown): asserts value is EpicDesign {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.projectId !== "string"
    || typeof value.title !== "string"
    || !new Set(["defining", "curating", "designing", "in-review", "approved", "archived"]).has(String(value.status))
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || typeof value.createdBy !== "string"
    || !Array.isArray(value.collaborators)
    || !value.collaborators.every((collaborator) => typeof collaborator === "string")
    || typeof value.currentVersion !== "number"
    || !Number.isSafeInteger(value.currentVersion)
    || value.currentVersion < 0) {
    throw new Error("invalid epic record");
  }
  assertSafePathSegment(value.id, "epic ID");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
