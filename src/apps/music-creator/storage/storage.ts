import { createEmptyStoreEnvelope } from "../project/createProject";
import { STORAGE_ERROR_MESSAGES } from "../constants/storageMessages";
import type {
  LoadedStore,
  MusicCreatorStoreEnvelope,
  StorageResult,
} from "../types";
import { STORE_SCHEMA_VERSION } from "../types";
import { migrateStore } from "./migrate";
import { validateEnvelopeShape, validateProjectsRecord } from "./validate";

export const STORE_KEY = "music-creator:store";

function storageUnavailable<T>(): StorageResult<T> {
  return {
    ok: false,
    code: "unavailable",
    message: STORAGE_ERROR_MESSAGES.unavailable,
  };
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Load and validate the store from localStorage.
 * Invalid projects are omitted from the returned envelope with warnings;
 * raw localStorage is not modified on load.
 */
export function loadStore(): StorageResult<LoadedStore> {
  const storage = getLocalStorage();
  if (!storage) return storageUnavailable();

  let raw: string | null;
  try {
    raw = storage.getItem(STORE_KEY);
  } catch {
    return storageUnavailable();
  }

  if (raw === null) {
    return {
      ok: true,
      data: {
        envelope: createEmptyStoreEnvelope(),
        warnings: [],
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      ok: false,
      code: "parse_error",
      message: STORAGE_ERROR_MESSAGES.parse_error,
    };
  }

  if (!validateEnvelopeShape(parsed)) {
    return {
      ok: false,
      code: "invalid_envelope",
      message: STORAGE_ERROR_MESSAGES.invalid_envelope,
    };
  }

  const migrated = migrateStore(parsed);
  if (!migrated.ok) return migrated;

  const { projects, warnings } = validateProjectsRecord(
    migrated.data.projects as Record<string, unknown>,
  );

  return {
    ok: true,
    data: {
      envelope: {
        schemaVersion: migrated.data.schemaVersion,
        projects,
      },
      warnings,
    },
  };
}

/** Persist a full store envelope (single atomic setItem replace under STORE_KEY) */
export function saveStore(
  envelope: MusicCreatorStoreEnvelope,
): StorageResult<void> {
  const storage = getLocalStorage();
  if (!storage) return storageUnavailable();

  if (!validateEnvelopeShape(envelope)) {
    return {
      ok: false,
      code: "invalid_envelope",
      message: STORAGE_ERROR_MESSAGES.invalid_envelope,
    };
  }

  if (envelope.schemaVersion > STORE_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "unsupported_version",
      message: STORAGE_ERROR_MESSAGES.unsupported_version,
    };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(envelope);
  } catch {
    return {
      ok: false,
      code: "invalid_envelope",
      message: STORAGE_ERROR_MESSAGES.invalid_envelope,
    };
  }

  try {
    storage.setItem(STORE_KEY, serialized);
    return { ok: true, data: undefined };
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "QuotaExceededError" ||
        error.code === 22 ||
        error.code === 1014)
    ) {
      return {
        ok: false,
        code: "quota_exceeded",
        message: STORAGE_ERROR_MESSAGES.quota_exceeded,
      };
    }

    return storageUnavailable();
  }
}

/** Replace on-disk store with an empty envelope (recovery / reset) */
export function resetStore(): StorageResult<void> {
  return saveStore(createEmptyStoreEnvelope());
}

/** Whether a project id exists in the loaded store (helper for route guards in 2.4) */
export function isProjectInStore(
  envelope: MusicCreatorStoreEnvelope,
  projectId: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(envelope.projects, projectId);
}
