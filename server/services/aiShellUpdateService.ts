/* ── AIShell Update Service ───────────────────────────────────────────
   Git operations for self-update and the admin recovery workflow.
   ──────────────────────────────────────────────────────────────────── */

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import path from "node:path";

const UPDATE_IGNORED_PATHS = new Set(["package-lock.json"]);
const RECOVERY_STASH_PREFIX = "AIShell admin recovery";
const STASH_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

function execFileText(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<string> {
  return execFileOutput(command, args, options).then(normalizeCommandOutput);
}

function execFileOutput(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve(String(stdout || stderr));
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

function fingerprintFor(porcelain: string): string {
  return createHash("sha256").update(porcelain).digest("hex");
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

export interface WorktreeChange {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  blocksUpdate: boolean;
}

export interface WorktreeStatusResult {
  branch: string | null;
  revision: string;
  changes: WorktreeChange[];
  hasBlockingChanges: boolean;
  fingerprint: string;
}

export interface RecoveryStash {
  id: string;
  createdAt: string;
  summary: string;
}

export interface StashWorkingTreeInput {
  actor: string;
  confirmation: unknown;
  statusFingerprint: unknown;
}

export interface RestoreStashInput {
  actor: string;
  confirmation: unknown;
  stashId: unknown;
}

interface CreateUpdateServiceOpts {
  /** Root of the ai_shell repo (where .git, package.json, server/ all live). */
  REPO_ROOT: string;
  /** Mutable AIShell data root. It must be outside the Git checkout. */
  DATA_DIR: string;
  /** Express server port (for the restart script). */
  PORT: number;
  /** httpError factory from server/index.ts. */
  httpError: HttpErrorFactory;
}

interface SystemAuditEvent {
  timestamp: string;
  action: "update.stash.requested" | "update.stash.completed" | "update.stash.failed" | "update.restore.requested" | "update.restore.completed" | "update.restore.failed";
  actor: string;
  revision: string;
  branch: string | null;
  stashId?: string;
  changeCount?: number;
}

function parsePorcelain(porcelain: string): WorktreeChange[] {
  const records = porcelain.split("\0");
  const changes: WorktreeChange[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;

    const indexStatus = record[0] ?? " ";
    const worktreeStatus = record[1] ?? " ";
    const path = record.slice(3);
    const renamedOrCopied = indexStatus === "R" || indexStatus === "C";
    const originalPath = renamedOrCopied ? records[++index] || undefined : undefined;

    changes.push({
      path,
      ...(originalPath ? { originalPath } : {}),
      indexStatus,
      worktreeStatus,
      blocksUpdate: !UPDATE_IGNORED_PATHS.has(path) && !path.endsWith("/package-lock.json"),
    });
  }

  return changes;
}

// ── Service factory ─────────────────────────────────────────────────

export function createAiShellUpdateService({
  REPO_ROOT,
  DATA_DIR,
  PORT,
  httpError,
}: CreateUpdateServiceOpts) {
  const SCRIPTS_ROOT = path.resolve(REPO_ROOT, "scripts");
  const RUNTIME_DIR = path.join(DATA_DIR, "runtime");
  const AUDIT_LOG_PATH = path.join(DATA_DIR, "audit", "system-operations.jsonl");
  let operationQueue: Promise<unknown> = Promise.resolve();

  async function withOperationLock<T>(operation: () => Promise<T>): Promise<T> {
    const queued = operationQueue.catch(() => undefined).then(operation);
    operationQueue = queued;
    return queued;
  }

  async function git(args: string[]): Promise<string> {
    return execFileText("git", args, { cwd: REPO_ROOT });
  }

  async function gitRaw(args: string[]): Promise<string> {
    return execFileOutput("git", args, { cwd: REPO_ROOT });
  }

  async function currentShortRevision(ref: string): Promise<string> {
    return normalizeCommandOutput(await git(["rev-parse", "--short", ref]));
  }

  async function currentBranch(): Promise<string | null> {
    try {
      return normalizeCommandOutput(await git(["branch", "--show-current"])) || null;
    } catch {
      return null;
    }
  }

  function appendAudit(event: SystemAuditEvent): void {
    mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true, mode: 0o700 });
    appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(event)}\n`, { encoding: "utf-8", mode: 0o600 });
  }

  function recordAuditBeforeMutation(event: SystemAuditEvent): void {
    try {
      appendAudit(event);
    } catch {
      throw httpError(
        "Could not record this recovery action in the system audit log. No Git changes were made.",
        500,
        "aishell_audit_unavailable",
      );
    }
  }

  function recordAuditCompletion(event: SystemAuditEvent): boolean {
    try {
      appendAudit(event);
      return true;
    } catch {
      console.error("[aishell] Recovery action succeeded but its completion could not be recorded in the system audit log.");
      return false;
    }
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

  async function describeWorktree(): Promise<WorktreeStatusResult> {
    await ensureGitCheckout();
    const porcelain = await gitRaw(["status", "--porcelain=v1", "-z"]);
    const changes = parsePorcelain(porcelain);
    return {
      branch: await currentBranch(),
      revision: await currentShortRevision("HEAD"),
      changes,
      hasBlockingChanges: changes.some((change) => change.blocksUpdate),
      fingerprint: fingerprintFor(porcelain),
    };
  }

  async function ensureCleanWorkingTree(): Promise<void> {
    const worktree = await describeWorktree();
    if (!worktree.hasBlockingChanges) return;

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

  async function listRecoveryStashesInternal(): Promise<RecoveryStash[]> {
    const output = await gitRaw(["stash", "list", "--format=%H%x00%ct%x00%gs"]);
    const stashes: RecoveryStash[] = [];

    for (const line of output.split("\n")) {
      const [id, timestampSeconds, summary] = line.split("\0");
      if (!id || !STASH_OID.test(id) || !summary?.includes(RECOVERY_STASH_PREFIX)) continue;
      const timestamp = Number(timestampSeconds);
      if (!Number.isFinite(timestamp)) continue;
      stashes.push({
        id,
        createdAt: new Date(timestamp * 1000).toISOString(),
        summary,
      });
    }

    return stashes;
  }

  // ── Public API ──────────────────────────────────────────────────

  async function getWorktreeStatus(): Promise<WorktreeStatusResult> {
    return withOperationLock(describeWorktree);
  }

  async function listRecoveryStashes(): Promise<RecoveryStash[]> {
    return withOperationLock(async () => {
      await ensureGitCheckout();
      return listRecoveryStashesInternal();
    });
  }

  async function stashWorkingTree(input: StashWorkingTreeInput) {
    return withOperationLock(async () => {
      if (input.confirmation !== "stash") {
        throw httpError('Type "stash" exactly to confirm this action.', 400, "aishell_stash_confirmation_required");
      }

      const before = await describeWorktree();
      if (!before.hasBlockingChanges) {
        throw httpError("There are no update-blocking local changes to stash.", 409, "aishell_nothing_to_stash");
      }
      if (input.statusFingerprint !== before.fingerprint) {
        throw httpError("Local changes changed after review. Review them again before stashing.", 409, "aishell_worktree_changed");
      }

      const timestamp = new Date().toISOString();
      const message = `${RECOVERY_STASH_PREFIX} | actor=${input.actor} | at=${timestamp}`;
      const auditBase = {
        timestamp,
        actor: input.actor,
        revision: before.revision,
        branch: before.branch,
        changeCount: before.changes.length,
      };
      recordAuditBeforeMutation({ ...auditBase, action: "update.stash.requested" });

      try {
        await git(["stash", "push", "--include-untracked", "--message", message]);
      } catch (error) {
        recordAuditCompletion({ ...auditBase, action: "update.stash.failed" });
        throw httpError(
          `Could not stash the local AIShell changes: ${error instanceof Error ? error.message : String(error)}`,
          500,
          "aishell_stash_failed",
        );
      }

      const stash = (await listRecoveryStashesInternal()).find((candidate) => candidate.summary.includes(message));
      if (!stash) {
        throw httpError(
          "Git created a stash, but AIShell could not identify it for recovery. Do not retry; inspect Git stash directly.",
          500,
          "aishell_stash_unidentified",
        );
      }

      const after = await describeWorktree();
      const auditRecorded = recordAuditCompletion({
        ...auditBase,
        action: "update.stash.completed",
        stashId: stash.id,
      });

      return { stash, worktree: after, auditRecorded };
    });
  }

  async function restoreRecoveryStash(input: RestoreStashInput) {
    return withOperationLock(async () => {
      if (input.confirmation !== "restore") {
        throw httpError('Type "restore" exactly to confirm this action.', 400, "aishell_restore_confirmation_required");
      }
      if (typeof input.stashId !== "string" || !STASH_OID.test(input.stashId)) {
        throw httpError("The selected recovery stash is invalid.", 400, "aishell_invalid_stash");
      }

      const before = await describeWorktree();
      if (before.changes.length > 0) {
        throw httpError("Restore requires a completely clean working tree. Stash or clear current changes first.", 409, "aishell_restore_worktree_dirty");
      }

      const stash = (await listRecoveryStashesInternal()).find((candidate) => candidate.id === input.stashId);
      if (!stash) {
        throw httpError("That AIShell recovery stash is no longer available.", 404, "aishell_stash_not_found");
      }

      const timestamp = new Date().toISOString();
      const auditBase = {
        timestamp,
        actor: input.actor,
        revision: before.revision,
        branch: before.branch,
        stashId: stash.id,
      };
      recordAuditBeforeMutation({ ...auditBase, action: "update.restore.requested" });

      try {
        await git(["stash", "apply", "--index", stash.id]);
      } catch (error) {
        recordAuditCompletion({ ...auditBase, action: "update.restore.failed" });
        throw httpError(
          `Could not restore the selected AIShell stash: ${error instanceof Error ? error.message : String(error)}`,
          409,
          "aishell_restore_failed",
        );
      }

      const worktree = await describeWorktree();
      const auditRecorded = recordAuditCompletion({ ...auditBase, action: "update.restore.completed" });
      return { stash, worktree, auditRecorded };
    });
  }

  async function checkUpdate(): Promise<UpdateCheckResult> {
    return withOperationLock(async () => {
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
    });
  }

  async function updateAndRestart(): Promise<UpdateAndRestartResult> {
    return withOperationLock(async () => {
      await ensureGitCheckout();
      await ensureCleanWorkingTree();

      const beforeRevision = await currentShortRevision("HEAD");
      let pullOutput = "";

      try {
        pullOutput = truncateOutput(await git(["pull", "--ff-only"]));
      } catch (pullErr: unknown) {
        const detail = pullErr instanceof Error ? pullErr.message : String(pullErr);
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

      const scriptPath = path.join(SCRIPTS_ROOT, "restart.sh");
      const apiPort = String(PORT);
      const child = spawn(
        "bash",
        [scriptPath, REPO_ROOT, RUNTIME_DIR, apiPort, String(process.pid)],
        { detached: true, stdio: "ignore" },
      );
      child.unref();

      setTimeout(() => process.exit(0), 500);

      return {
        status: "updated",
        restarting: true,
        beforeRevision,
        afterRevision,
        pullOutput,
      };
    });
  }

  return {
    checkUpdate,
    getWorktreeStatus,
    listRecoveryStashes,
    restoreRecoveryStash,
    stashWorkingTree,
    updateAndRestart,
  };
}
