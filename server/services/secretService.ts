/* ── Secret Service (Three-Scope) ─────────────────────────────────────
   Centralized secret management with three scopes:

   1. Global:    Available to all apps, all users.  Admin-writable.
   2. App-scoped: Only the owning app can read.     App/admin-writable.
   3. User-scoped: Only the owning user can read.   User/admin-writable.

   Priority resolution (env vars override backend):
   - Global:  AISHELL_SECRET_<KEY> → backend "aishell:global:<key>"
   - App:     AISHELL_SECRET_<APPID>_<KEY> → backend "aishell:app:<appId>:<key>"
   - User:    backend "aishell:user:<username>:<key>" (no env override)
   ──────────────────────────────────────────────────────────────────── */

import type { SecretBackend, SecretMetadata, SecretPlatformStatus } from "./secretBackend.js";

export interface SecretService {
  // ── Global secrets ────────────────────────────────────────────────
  getGlobal(key: string): Promise<string | null>;
  setGlobal(key: string, value: string): Promise<void>;
  deleteGlobal(key: string): Promise<void>;

  // ── App-scoped secrets ────────────────────────────────────────────
  getAppSecret(appId: string, key: string): Promise<string | null>;
  setAppSecret(appId: string, key: string, value: string): Promise<void>;
  deleteAppSecret(appId: string, key: string): Promise<void>;

  // ── User-scoped secrets ───────────────────────────────────────────
  getUserSecret(username: string, key: string): Promise<string | null>;
  setUserSecret(username: string, key: string, value: string): Promise<void>;
  deleteUserSecret(username: string, key: string): Promise<void>;

  // ── Platform info ─────────────────────────────────────────────────
  getStatus(): SecretPlatformStatus;
}

interface SecretServiceOpts {
  backend: SecretBackend;
}

// ── Service key builders ────────────────────────────────────────────

function globalKey(key: string): string {
  return `aishell:global:${key}`;
}

function appKey(appId: string, key: string): string {
  return `aishell:app:${appId}:${key}`;
}

function userKey(username: string, key: string): string {
  return `aishell:user:${username}:${key}`;
}

// ── Environment variable resolution ─────────────────────────────────

function envKeyGlobal(key: string): string {
  return `AISHELL_SECRET_${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

function envKeyApp(appId: string, key: string): string {
  const normalizedAppId = appId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const normalizedKey = key.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `AISHELL_SECRET_${normalizedAppId}_${normalizedKey}`;
}

function readEnv(envVar: string): string | null {
  const value = process.env[envVar];
  return value !== undefined && value !== "" ? value : null;
}

// ── Validation ──────────────────────────────────────────────────────

const KEY_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
const APP_ID_PATTERN = /^[a-z0-9-]{1,50}$/;

function validateKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`Invalid secret key "${key}". Must be 1-100 alphanumeric characters, underscores, or hyphens.`);
  }
}

function validateAppId(appId: string): void {
  if (!APP_ID_PATTERN.test(appId)) {
    throw new Error(`Invalid app ID "${appId}". Must be lowercase alphanumeric with hyphens.`);
  }
}

// ── Factory ─────────────────────────────────────────────────────────

export function createSecretService(opts: SecretServiceOpts): SecretService {
  const { backend } = opts;

  return {
    // ── Global ────────────────────────────────────────────────────

    async getGlobal(key) {
      validateKey(key);

      // Environment variable takes priority
      const envValue = readEnv(envKeyGlobal(key));
      if (envValue !== null) return envValue;

      return backend.read(globalKey(key));
    },

    async setGlobal(key, value) {
      validateKey(key);
      await backend.write(globalKey(key), value);
    },

    async deleteGlobal(key) {
      validateKey(key);
      await backend.delete(globalKey(key));
    },

    // ── App-scoped ────────────────────────────────────────────────

    async getAppSecret(appId, key) {
      validateAppId(appId);
      validateKey(key);

      // Environment variable takes priority
      const envValue = readEnv(envKeyApp(appId, key));
      if (envValue !== null) return envValue;

      return backend.read(appKey(appId, key));
    },

    async setAppSecret(appId, key, value) {
      validateAppId(appId);
      validateKey(key);
      await backend.write(appKey(appId, key), value);
    },

    async deleteAppSecret(appId, key) {
      validateAppId(appId);
      validateKey(key);
      await backend.delete(appKey(appId, key));
    },

    // ── User-scoped ───────────────────────────────────────────────

    async getUserSecret(username, key) {
      validateKey(key);
      return backend.read(userKey(username, key));
    },

    async setUserSecret(username, key, value) {
      validateKey(key);
      await backend.write(userKey(username, key), value);
    },

    async deleteUserSecret(username, key) {
      validateKey(key);
      await backend.delete(userKey(username, key));
    },

    // ── Status ────────────────────────────────────────────────────

    getStatus() {
      return {
        backendName: backend.name,
        supported: backend.supported,
        platform: process.platform,
      };
    },
  };
}
