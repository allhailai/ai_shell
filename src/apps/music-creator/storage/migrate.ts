import { STORAGE_ERROR_MESSAGES } from "../constants/storageMessages";
import type { MusicCreatorStoreEnvelope, StorageResult } from "../types";
import { STORE_SCHEMA_VERSION } from "../types";

/**
 * Migrate a parsed envelope to the current schema version.
 * Only v1 exists today — add migration steps here when STORE_SCHEMA_VERSION bumps.
 */
export function migrateStore(
  envelope: MusicCreatorStoreEnvelope,
): StorageResult<MusicCreatorStoreEnvelope> {
  if (envelope.schemaVersion > STORE_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "unsupported_version",
      message: STORAGE_ERROR_MESSAGES.unsupported_version,
    };
  }

  if (envelope.schemaVersion === STORE_SCHEMA_VERSION) {
    return { ok: true, data: envelope };
  }

  return {
    ok: false,
    code: "migration_failed",
    message: STORAGE_ERROR_MESSAGES.migration_failed,
  };
}
