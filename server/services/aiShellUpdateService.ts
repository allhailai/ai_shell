/* ── AIShell Update Service ───────────────────────────────────────────
   Git operations for self-update: check for updates, pull, and restart.

   Ported from KissAI's kissAiUpdate.js, adapted for AIShell's
   flat TypeScript repo layout (no web/ nesting).
   ──────────────────────────────────────────────────────────────────── */

import { execFile, spawn } from "node:child_process";
import path from "node:path";

// ── Helpers ─────────────────────────────────────────────────────────

function execFileText(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve(String(stdout || stderr).trim());
    });
  });
}

function normalizeCommandOutput(output: string | undefined | null): string {
  return String(output ?? "").trim();
}

function truncateOutput(output: string): string {
  const normalized = normalizeCommandOutput(output);
  return normalized.length > 4000
    ? `${normalized.slice(0, 4000)}\n...`
    : normalized;
}

// ── Types ───────────────────────────────────────────────────────────

interface HttpError extends Error {
  status: number;
  code: string;
}

type HttpErrorFactory = (
  message: string,
  status: number,
  code: string,
) => HttpError;

export interface UpdateCheckResult {
  status: "up_to_date" | "update_available";
  updateAvailable: boolean;
  localRevision: string;
  remoteRevision: string;
  upstream: string;
}

export interface UpdateAndRestartResult {
  status: "up_to_date" | "updated";
  restarting: boolean;
  beforeRevision: string;
  afterRevision: string;
  pullOutput: string;
}

// ── Service factory ─────────────────────────────────────────────────

interface CreateUpdateServiceOpts {
  /** Root of the ai_shell repo (where .git, package.json, server/ all live) */
  REPO_ROOT: string;
  /** Express server port (for the restart script) */
  PORT: number;
  /** httpError factory from server/index.ts */
  httpError: HttpErrorFactory;
}

export function createAiShellUpdateService({
  REPO_ROOT,
  PORT,
  httpError,
}: CreateUpdateServiceOpts) {
  const SCRIPTS_ROOT = path.resolve(REPO_ROOT, "scripts");

  async function git(args: string[]): Promise<string> {
    return execFileText("git", args, { cwd: REPO_ROOT });
  }

  async function currentShortRevision(ref: string): Promise<string> {
    return normalizeCommandOutput(await git(["rev-parse", "--short", ref]));
  }

  // ── Precondition checks ─────────────────────────────────────────

  async function ensureGitCheckout(): Promise<void> {
    try {
      const insideWorkTree = normalizeCommandOutput(
        await git(["rev-parse", "--is-inside-work-tree"]),
      );
      if (insideWorkTree !== "true") {
        throw httpError(
          "ai_shell is not a Git checkout, so the app cannot update it automatically.",
          409,
          "aishell_not_git_checkout",
        );
      }
    } catch (error: unknown) {
      if ((error as HttpError)?.code === "aishell_not_git_checkout") throw error;
      throw httpError(
        "ai_shell is not a Git checkout, so the app cannot update it automatically.",
        409,
        "aishell_not_git_checkout",
      );
    }
  }

  async function ensureCleanWorkingTree(): Promise<void> {
    const status = normalizeCommandOutput(
      await git(["status", "--porcelain"]),
    );
    if (!status) return;

    // Ignore package-lock.json — it regenerates differently across npm versions
    // and platforms. The update flow runs `npm install` after pulling, which
    // reconciles the lockfile automatically.
    const significantChanges = status
      .split("\n")
      .filter((line) => !line.trimStart().endsWith("package-lock.json"))
      .filter(Boolean);
    if (!significantChanges.length) return;

    throw httpError(
      "ai_shell has local file changes. Save or clear those changes before getting the latest version.",
      409,
      "aishell_working_tree_dirty",
    );
  }

  async function upstreamBranch(): Promise<string> {
    try {
      const upstream = normalizeCommandOutput(
        await git([
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          "@{u}",
        ]),
      );
      if (upstream) return upstream;
    } catch {
      // Handled below with a user-facing error.
    }

    throw httpError(
      "ai_shell is not connected to a remote branch for updates. Set the Git upstream (e.g. git branch --set-upstream-to=origin/main).",
      409,
      "aishell_upstream_missing",
    );
  }

  async function fetchUpstream(upstream: string): Promise<void> {
    const [remoteName] = upstream.split("/");
    if (!remoteName) {
      throw httpError(
        "ai_shell is not connected to a remote branch for updates. Set the Git upstream.",
        409,
        "aishell_upstream_missing",
      );
    }

    try {
      await git(["fetch", "--prune", remoteName]);
    } catch {
      throw httpError(
        "Could not check for the latest AIShell version. Check the Git repository connection.",
        500,
        "aishell_update_check_failed",
      );
    }
  }

  // ── Public API ──────────────────────────────────────────────────

  async function checkUpdate(): Promise<UpdateCheckResult> {
    await ensureGitCheckout();
    await ensureCleanWorkingTree();

    const upstream = await upstreamBranch();
    await fetchUpstream(upstream);

    const localRevision = await currentShortRevision("HEAD");
    const remoteRevision = await currentShortRevision(upstream);

    return {
      status:
        localRevision === remoteRevision ? "up_to_date" : "update_available",
      updateAvailable: localRevision !== remoteRevision,
      localRevision,
      remoteRevision,
      upstream,
    };
  }

  async function updateAndRestart(): Promise<UpdateAndRestartResult> {
    await ensureGitCheckout();
    await ensureCleanWorkingTree();

    const beforeRevision = await currentShortRevision("HEAD");
    let pullOutput = "";

    try {
      pullOutput = truncateOutput(await git(["pull", "--ff-only"]));
    } catch (pullErr: unknown) {
      const detail =
        pullErr instanceof Error ? pullErr.message : String(pullErr);
      throw httpError(
        `Could not pull the latest ai_shell files: ${detail}`,
        500,
        "aishell_update_failed",
      );
    }

    const afterRevision = await currentShortRevision("HEAD");

    if (beforeRevision === afterRevision) {
      return {
        status: "up_to_date",
        restarting: false,
        beforeRevision,
        afterRevision,
        pullOutput,
      };
    }

    // Spawn the restart script as a fully detached process.
    // It will wait for this process to exit, run npm install, then start npm run dev.
    const scriptPath = path.join(SCRIPTS_ROOT, "restart.sh");
    const apiPort = String(PORT);

    const child = spawn(
      "bash",
      [scriptPath, REPO_ROOT, apiPort, String(process.pid)],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    child.unref();

    // Schedule self-exit shortly after the HTTP response is sent.
    setTimeout(() => process.exit(0), 500);

    return {
      status: "updated",
      restarting: true,
      beforeRevision,
      afterRevision,
      pullOutput,
    };
  }

  return {
    checkUpdate,
    updateAndRestart,
  };
}
