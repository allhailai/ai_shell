/* ── Platform Detection Service ──────────────────────────────────────
   Resolves OS-specific paths, capabilities, and the shell data directory.

   Data directory resolution (first match wins):
   1. AISHELL_DATA_DIR environment variable
   2. ~/.aishell/  (works on both macOS and Linux)

   Keychain availability:
   - macOS: always available (Keychain via `security` CLI)
   - Linux: available if `secret-tool` is on PATH
   - Other: not available
   ──────────────────────────────────────────────────────────────────── */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Platform = "darwin" | "linux" | "win32" | "unknown";

export interface PlatformInfo {
  /** The Node.js process.platform value, narrowed. */
  platform: Platform;
  /** Absolute path to the shell data directory (created if missing). */
  dataDir: string;
  /** Whether an OS keychain backend is available. */
  keychainAvailable: boolean;
  /** Human-readable label for the keychain (e.g., "macOS Keychain"). */
  keychainLabel: string;
  /** OS username (best-effort). */
  osUsername: string;
}

/**
 * Check whether a CLI tool exists on PATH.
 */
function isCommandAvailable(command: string): boolean {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the OS username with multiple fallbacks.
 */
function resolveOsUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    // os.userInfo() can throw on some systems (e.g., Docker without /etc/passwd)
  }
  return process.env.USER ?? process.env.USERNAME ?? "";
}

/**
 * Resolve and ensure the data directory exists.
 */
function resolveDataDir(): string {
  const envDir = process.env.AISHELL_DATA_DIR?.trim();
  if (envDir) {
    const resolved = path.resolve(envDir);
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  }

  // Default: ~/.aishell/
  const homeDir = os.homedir();
  const defaultDir = path.join(homeDir, ".aishell");
  fs.mkdirSync(defaultDir, { recursive: true });
  return defaultDir;
}

/**
 * Detect platform capabilities.
 *
 * @param overrides - For testing: override platform and command probe.
 */
export function detectPlatform(overrides?: {
  platform?: Platform;
  probe?: (cmd: string) => boolean;
}): PlatformInfo {
  const rawPlatform = overrides?.platform ?? (process.platform as Platform);
  const probe = overrides?.probe ?? isCommandAvailable;
  const platform: Platform =
    rawPlatform === "darwin" || rawPlatform === "linux" || rawPlatform === "win32"
      ? rawPlatform
      : "unknown";

  const dataDir = resolveDataDir();
  const osUsername = resolveOsUsername();

  if (platform === "darwin") {
    return {
      platform,
      dataDir,
      keychainAvailable: true,
      keychainLabel: "macOS Keychain",
      osUsername,
    };
  }

  if (platform === "linux") {
    const hasSecretTool = probe("secret-tool");
    return {
      platform,
      dataDir,
      keychainAvailable: hasSecretTool,
      keychainLabel: hasSecretTool ? "Linux Secret Service (secret-tool)" : "None",
      osUsername,
    };
  }

  return {
    platform,
    dataDir,
    keychainAvailable: false,
    keychainLabel: "None",
    osUsername,
  };
}
