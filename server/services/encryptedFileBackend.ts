/* ── Encrypted File Backend ───────────────────────────────────────────
   AES-256-GCM encrypted file-based secret storage.
   Used as a fallback when no OS keychain (macOS Keychain, Linux secret-tool)
   is available — e.g., headless Linux servers, Docker containers, WSL.

   Storage layout (inside dataDir):
   - .secrets_key   – 32-byte random encryption key (chmod 0600)
   - secrets.enc    – Encrypted JSON blob: <12-byte IV><16-byte tag><ciphertext>

   The key file is auto-generated on first write. Reads from a missing
   store return null (no secrets yet). Corrupt files are treated as empty.
   ──────────────────────────────────────────────────────────────────── */

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SecretBackend } from "./secretBackend.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const KEY_FILENAME = ".secrets_key";
const STORE_FILENAME = "secrets.enc";

interface EncryptedFileBackendOpts {
  dataDir: string;
}

/**
 * Create an encrypted file backend for secret storage.
 *
 * Secrets are stored as AES-256-GCM encrypted JSON in `<dataDir>/secrets.enc`.
 * The encryption key is a 32-byte random value stored at `<dataDir>/.secrets_key`.
 */
export function createEncryptedFileBackend(opts: EncryptedFileBackendOpts): SecretBackend {
  const { dataDir } = opts;
  const keyPath = path.join(dataDir, KEY_FILENAME);
  const storePath = path.join(dataDir, STORE_FILENAME);

  // Serialized write access to prevent concurrent read-modify-write races
  let writeLock: Promise<void> = Promise.resolve();

  // ── Key management ──────────────────────────────────────────────

  /**
   * Read or create the encryption key.
   * Key file is created with mode 0o600 (owner-only read/write).
   */
  function ensureKey(): Buffer {
    try {
      return fs.readFileSync(keyPath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    // Generate a new key
    const key = randomBytes(KEY_BYTES);
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    return key;
  }

  // ── Encryption / Decryption ─────────────────────────────────────

  function encrypt(plaintext: string, key: Buffer): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Layout: [IV (12)] [Auth Tag (16)] [Ciphertext (...)]
    return Buffer.concat([iv, tag, encrypted]);
  }

  function decrypt(blob: Buffer, key: Buffer): string {
    if (blob.length < IV_BYTES + TAG_BYTES) {
      throw new Error("Encrypted data too short");
    }
    const iv = blob.subarray(0, IV_BYTES);
    const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  }

  // ── Store I/O ───────────────────────────────────────────────────

  function readStore(key: Buffer): Record<string, string> {
    try {
      const blob = fs.readFileSync(storePath);
      if (blob.length === 0) return {};
      const json = decrypt(blob, key);
      return JSON.parse(json) as Record<string, string>;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      // Corrupt file — log and treat as empty
      console.warn("[aishell] Warning: secrets.enc could not be decrypted, treating as empty.", error);
      return {};
    }
  }

  function writeStore(store: Record<string, string>, key: Buffer): void {
    const json = JSON.stringify(store);
    const blob = encrypt(json, key);
    fs.writeFileSync(storePath, blob, { mode: 0o600 });
  }

  // ── Backend implementation ──────────────────────────────────────

  return {
    supported: true,
    name: "Encrypted File",

    async read(serviceKey) {
      const key = ensureKey();
      const store = readStore(key);
      return store[serviceKey] ?? null;
    },

    async write(serviceKey, value) {
      writeLock = writeLock.then(() => {
        const key = ensureKey();
        const store = readStore(key);
        store[serviceKey] = value;
        writeStore(store, key);
      });
      return writeLock;
    },

    async delete(serviceKey) {
      writeLock = writeLock.then(() => {
        const key = ensureKey();
        const store = readStore(key);
        if (serviceKey in store) {
          delete store[serviceKey];
          writeStore(store, key);
        }
      });
      return writeLock;
    },

    sourceLabel(serviceKey) {
      return `Encrypted file store item "${serviceKey}"`;
    },
  };
}
