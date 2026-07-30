import type { StorageErrorCode } from "../types";

/**
 * User-facing copy for StorageResult.error codes.
 * Used by storage I/O (load/save) and hub recovery UI — one message per code.
 */
export const STORAGE_ERROR_MESSAGES: Record<StorageErrorCode, string> = {
  parse_error: "Saved projects could not be read (invalid JSON).",
  invalid_envelope: "Saved projects have an invalid format.",
  unsupported_version:
    "Saved projects use a newer schema than this app supports.",
  migration_failed: "Saved projects could not be migrated.",
  quota_exceeded: "Storage quota exceeded — free space or delete projects",
  unavailable: "localStorage is not available in this browser.",
};

/**
 * Load failures where resetStore (wipe to empty envelope) is a reasonable recovery.
 * unavailable cannot be fixed by reset.
 */
export const RECOVERABLE_LOAD_ERROR_CODES: readonly StorageErrorCode[] = [
  "parse_error",
  "invalid_envelope",
  "unsupported_version",
  "migration_failed",
] as const;

export function isRecoverableLoadError(code: StorageErrorCode): boolean {
  return RECOVERABLE_LOAD_ERROR_CODES.includes(code);
}
