/* ── Keychain Backend ─────────────────────────────────────────────────
   OS-native secret storage via macOS Keychain and Linux secret-tool.
   Ported from Kiss AI's secretStore.js to TypeScript.

   macOS:  Uses `security find-generic-password` / `add-generic-password`
   Linux:  Uses `secret-tool lookup` / `secret-tool store` (libsecret)
   Other:  read() returns null, write()/delete() throw
   ──────────────────────────────────────────────────────────────────── */

import { execFile, execFileSync, spawn } from "node:child_process";
import type { SecretBackend } from "./secretBackend.js";

/**
 * Execute a command and resolve with trimmed stdout.
 */
function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve(String(stdout || stderr).trim());
    });
  });
}

/**
 * Execute a command and pipe data to its stdin.
 * Used by `secret-tool store` which reads the secret value from stdin.
 */
function execWithStdin(command: string, args: string[], stdinData: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(String(stdout || stderr).trim());
    });

    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

interface KeychainBackendOpts {
  platform: string;
  osUsername: string;
  /** For testing: override command availability probe. */
  probe?: (cmd: string) => boolean;
}

export function createKeychainBackend(opts: KeychainBackendOpts): SecretBackend {
  const { platform, osUsername } = opts;

  // ── macOS implementation ────────────────────────────────────────

  if (platform === "darwin") {
    return {
      supported: true,
      name: "macOS Keychain",

      async read(serviceKey) {
        try {
          const value = await execFileText("security", [
            "find-generic-password",
            "-a", osUsername,
            "-s", serviceKey,
            "-w",
          ]);
          return value || null;
        } catch {
          return null;
        }
      },

      async write(serviceKey, value) {
        await execFileText("security", [
          "add-generic-password",
          "-U",
          "-a", osUsername,
          "-s", serviceKey,
          "-w", value,
        ]);
      },

      async delete(serviceKey) {
        try {
          await execFileText("security", [
            "delete-generic-password",
            "-a", osUsername,
            "-s", serviceKey,
          ]);
        } catch {
          // Item may not exist — that's fine
        }
      },

      sourceLabel(serviceKey) {
        return `macOS Keychain item "${serviceKey}"`;
      },
    };
  }

  // ── Linux implementation ────────────────────────────────────────

  if (platform === "linux") {
    let hasSecretTool = false;
    try {
      const probe = opts.probe;
      if (probe) {
        hasSecretTool = probe("secret-tool");
      } else {
        try {
          execFileSync("which", ["secret-tool"], { stdio: "ignore" });
          hasSecretTool = true;
        } catch {
          hasSecretTool = false;
        }
      }
    } catch {
      hasSecretTool = false;
    }

    if (hasSecretTool) {
      return {
        supported: true,
        name: "Linux Secret Service (secret-tool)",

        async read(serviceKey) {
          try {
            const value = await execFileText("secret-tool", [
              "lookup",
              "service", serviceKey,
            ]);
            return value || null;
          } catch {
            return null;
          }
        },

        async write(serviceKey, value) {
          await execWithStdin("secret-tool", [
            "store",
            "--label", `aishell ${serviceKey}`,
            "service", serviceKey,
          ], value);
        },

        async delete(serviceKey) {
          try {
            await execFileText("secret-tool", [
              "clear",
              "service", serviceKey,
            ]);
          } catch {
            // Item may not exist
          }
        },

        sourceLabel(serviceKey) {
          return `Linux secret-tool item "${serviceKey}"`;
        },
      };
    }
  }

  // ── Unsupported platform ────────────────────────────────────────

  return {
    supported: false,
    name: "None",

    async read() {
      return null;
    },

    async write() {
      throw new Error(
        `Secret storage is not supported on platform "${platform}". ` +
        "No OS keychain backend is available. Set secrets via AISHELL_SECRET_* environment variables.",
      );
    },

    async delete() {
      // No-op on unsupported platforms
    },

    sourceLabel(serviceKey) {
      return `OS credential store item "${serviceKey}"`;
    },
  };
}
