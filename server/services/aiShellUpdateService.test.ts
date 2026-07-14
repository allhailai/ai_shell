import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAiShellUpdateService } from "./aiShellUpdateService.js";

const roots: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeService() {
  const root = mkdtempSync(path.join(os.tmpdir(), "aishell-update-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const dataDir = path.join(root, "data");
  mkdirSync(repo, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "AIShell Test"]);
  writeFileSync(path.join(repo, "README.md"), "original\n", "utf8");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "initial"]);

  const httpError = (message: string, status: number, code: string) => {
    const error = new Error(message) as Error & { status: number; code: string };
    error.status = status;
    error.code = code;
    return error;
  };
  return {
    repo,
    dataDir,
    service: createAiShellUpdateService({ REPO_ROOT: repo, DATA_DIR: dataDir, PORT: 5175, httpError }),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("AiShell update recovery", () => {
  it("reviews, stashes, and restores tracked and untracked changes with an external audit trail", async () => {
    const { repo, dataDir, service } = makeService();
    writeFileSync(path.join(repo, "README.md"), "changed\n", "utf8");
    writeFileSync(path.join(repo, "untracked.txt"), "untracked\n", "utf8");

    const before = await service.getWorktreeStatus();
    expect(before.hasBlockingChanges).toBe(true);
    expect(before.changes.map((change) => change.path).sort()).toEqual(["README.md", "untracked.txt"]);

    await expect(service.stashWorkingTree({
      actor: "admin",
      confirmation: "STASH",
      statusFingerprint: before.fingerprint,
    })).rejects.toMatchObject({ code: "aishell_stash_confirmation_required", status: 400 });

    const stashed = await service.stashWorkingTree({
      actor: "admin",
      confirmation: "stash",
      statusFingerprint: before.fingerprint,
    });
    expect(stashed.worktree.changes).toEqual([]);
    expect(stashed.auditRecorded).toBe(true);
    expect((await service.listRecoveryStashes()).map((stash) => stash.id)).toContain(stashed.stash.id);
    expect(readFileSync(path.join(dataDir, "audit", "system-operations.jsonl"), "utf8"))
      .toContain("update.stash.completed");

    await expect(service.restoreRecoveryStash({
      actor: "admin",
      confirmation: "restore",
      stashId: "not-a-stash",
    })).rejects.toMatchObject({ code: "aishell_invalid_stash", status: 400 });

    const restored = await service.restoreRecoveryStash({
      actor: "admin",
      confirmation: "restore",
      stashId: stashed.stash.id,
    });
    expect(restored.worktree.hasBlockingChanges).toBe(true);
    expect(readFileSync(path.join(repo, "README.md"), "utf8")).toBe("changed\n");
    expect(readFileSync(path.join(repo, "untracked.txt"), "utf8")).toBe("untracked\n");
    expect(readFileSync(path.join(dataDir, "audit", "system-operations.jsonl"), "utf8"))
      .toContain("update.restore.completed");
  });

  it("rejects a stash when the reviewed working tree has changed", async () => {
    const { repo, service } = makeService();
    writeFileSync(path.join(repo, "README.md"), "first change\n", "utf8");
    const reviewed = await service.getWorktreeStatus();
    writeFileSync(path.join(repo, "another.txt"), "new change\n", "utf8");

    await expect(service.stashWorkingTree({
      actor: "admin",
      confirmation: "stash",
      statusFingerprint: reviewed.fingerprint,
    })).rejects.toMatchObject({ code: "aishell_worktree_changed", status: 409 });
  });
});
