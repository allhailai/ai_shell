import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodaScopeProjectService } from "./codaScopeProjectService.js";

const roots: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

async function makeProjectWithRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codascope-project-recovery-"));
  roots.push(root);
  const projectsRoot = path.join(root, "projects");
  const repoPath = path.join(root, "source");
  mkdirSync(repoPath, { recursive: true });
  git(repoPath, ["init"]);
  git(repoPath, ["config", "user.email", "test@example.com"]);
  git(repoPath, ["config", "user.name", "CodaScope Test"]);
  writeFileSync(path.join(repoPath, "README.md"), "source\n");
  git(repoPath, ["add", "README.md"]);
  git(repoPath, ["commit", "-m", "initial"]);

  const service = new CodaScopeProjectService(projectsRoot);
  const project = await service.createProject("Core", "");
  const repository = await service.addRepository(project.id, { name: "core", path: repoPath });
  if (!repository) throw new Error("Could not create test repository.");
  return { service, project, repository, repoPath };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CodaScope generated wiki recovery", () => {
  it("previews and stashes only legacy generated wiki artifacts", async () => {
    const { service, project, repository, repoPath } = await makeProjectWithRepository();
    mkdirSync(path.join(repoPath, "wiki"));
    writeFileSync(path.join(repoPath, "wiki", "architecture.md"), "legacy wiki\n");
    writeFileSync(path.join(repoPath, "code_map_core.md"), "legacy map\n");
    mkdirSync(path.join(repoPath, "src"));
    writeFileSync(path.join(repoPath, "src", "working.ts"), "user work\n");

    const preview = await service.previewGeneratedWikiRecovery(project.id, repository.id);
    expect(preview?.changes.map((change) => change.path).sort()).toEqual([
      "code_map_core.md",
      "wiki/architecture.md",
    ]);

    await expect(service.stashGeneratedWikiArtifacts(project.id, repository.id, {
      confirmation: "STASH",
      fingerprint: preview!.fingerprint,
    })).rejects.toMatchObject({ code: "generated_wiki_stash_confirmation_required", status: 400 });

    const result = await service.stashGeneratedWikiArtifacts(project.id, repository.id, {
      confirmation: "STASH GENERATED FILES",
      fingerprint: preview!.fingerprint,
    });
    expect(result.stashRef).toBe("stash@{0}");
    expect(git(repoPath, ["status", "--short"])).toBe("?? src/");
    expect(git(repoPath, ["stash", "list", "-1", "--format=%s"])).toContain("CodaScope recovery: generated wiki files");
  });

  it("refuses a stale recovery preview", async () => {
    const { service, project, repository, repoPath } = await makeProjectWithRepository();
    mkdirSync(path.join(repoPath, "wiki"));
    writeFileSync(path.join(repoPath, "wiki", "first.md"), "first\n");
    const preview = await service.previewGeneratedWikiRecovery(project.id, repository.id);
    writeFileSync(path.join(repoPath, "wiki", "second.md"), "second\n");

    await expect(service.stashGeneratedWikiArtifacts(project.id, repository.id, {
      confirmation: "STASH GENERATED FILES",
      fingerprint: preview!.fingerprint,
    })).rejects.toMatchObject({ code: "generated_wiki_stash_preview_stale", status: 409 });
  });
});
