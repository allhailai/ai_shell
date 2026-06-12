/* ── Secret Backend Interface ─────────────────────────────────────────
   Pluggable storage abstraction for secrets.

   Implementations:
   - KeychainBackend: macOS Keychain / Linux secret-tool (implemented)
   - EncryptedFileBackend: AES-256-GCM encrypted file (future)
   - VaultBackend: HashiCorp Vault integration (future)

   Service key convention: "aishell:<scope>:<key>"
   - Global:  "aishell:global:openai_org_id"
   - App:     "aishell:app:arcade:high_score_key"
   - User:    "aishell:user:sean:personal_api_key"
   ──────────────────────────────────────────────────────────────────── */

/**
 * Metadata about a stored secret (never exposes the actual value).
 */
export interface SecretMetadata {
  key: string;
  scope: string;
  hasValue: boolean;
  updatedAt?: string;
  source: string;
}

/**
 * Platform capability information.
 */
export interface SecretPlatformStatus {
  backendName: string;
  supported: boolean;
  platform: string;
}

/**
 * Pluggable secret storage backend.
 *
 * Implementations read/write individual secret values by a service key.
 * The service key encodes scope information (global, app, user).
 */
export interface SecretBackend {
  /** Whether this backend is functional on the current platform. */
  readonly supported: boolean;

  /** Human-readable backend name (e.g., "macOS Keychain"). */
  readonly name: string;

  /**
   * Read a secret value by service key.
   * Returns null if the secret doesn't exist.
   */
  read(serviceKey: string): Promise<string | null>;

  /**
   * Write (create or update) a secret value.
   * Throws if the backend is not supported.
   */
  write(serviceKey: string, value: string): Promise<void>;

  /**
   * Delete a secret by service key.
   * No-op if the secret doesn't exist.
   */
  delete(serviceKey: string): Promise<void>;

  /**
   * Human-readable label describing where this secret is stored.
   */
  sourceLabel(serviceKey: string): string;
}
