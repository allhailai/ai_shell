import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { CodaScopeProjectService } from "./codaScopeProjectService.js";
import { CodaScopeEpicService } from "./codaScopeEpicService.js";
import { CodaScopeNoteService } from "./codaScopeNoteService.js";
import { CodaScopeNoteAnnotationService } from "./codaScopeNoteAnnotationService.js";
import { CodaScopeNoteLinkIndexService } from "./codaScopeNoteLinkIndexService.js";
import { CodaScopeNoteAuditService } from "./codaScopeNoteAuditService.js";
import {
  CodaScopeProjectNoteRangeService,
  ProjectNoteRangeConflictError,
  ProjectNoteRangeInvalidError,
} from "./codaScopeProjectNoteRangeService.js";
import {
  annotationStartMarker,
} from "./codaScopeNoteAnnotationAnchorService.js";
import type { CanonicalProjectNoteRangeTarget } from "../../src/apps/codascope/projectNoteRangeTargetValidation.js";

const projectId = "project_123";
let root = "";
let projectSvc: CodaScopeProjectService;
let epicSvc: CodaScopeEpicService;
let noteSvc: CodaScopeNoteService;
let service: CodaScopeProjectNoteRangeService;

beforeEach(() => {
  root = path.join(
    os.tmpdir(),
    `project-note-range-${crypto.randomBytes(6).toString("hex")}`,
  );
  const projectDir = path.join(root, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
    id: projectId,
    name: "Project",
    description: "",
    repositories: [],
  }));
  projectSvc = new CodaScopeProjectService(root);
  epicSvc = new CodaScopeEpicService(root);
  noteSvc = new CodaScopeNoteService(root);
  const annotationSvc = new CodaScopeNoteAnnotationService(noteSvc);
  service = new CodaScopeProjectNoteRangeService(
    projectSvc,
    epicSvc,
    noteSvc,
    annotationSvc,
    new CodaScopeNoteLinkIndexService(noteSvc),
    new CodaScopeNoteAuditService(root),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function createTarget(options: {
  visibility?: "private" | "shared";
  actorId?: string;
  body?: string;
  selectedText?: string;
  path?: string;
} = {}): Promise<CanonicalProjectNoteRangeTarget> {
  const visibility = options.visibility ?? "shared";
  const actorId = options.actorId ?? "alice";
  const body = options.body ?? "first\n😀 selected\nlast";
  const selectedText = options.selectedText ?? "😀 selected";
  const notePath = options.path ?? "plans/current.md";
  await noteSvc.createNote(
    "project",
    visibility,
    { projectId, userId: actorId },
    notePath,
    body,
  );
  const note = await noteSvc.readNote(
    "project",
    visibility,
    { projectId, userId: actorId },
    notePath,
  );
  if (!note) throw new Error("fixture note missing");
  const parsed = noteSvc.parseFrontmatter(note.content);
  const selectionStart = parsed.body.indexOf(selectedText);
  const selectionEnd = selectionStart + selectedText.length;
  return {
    kind: "note-range",
    stableId: note.frontmatter.id,
    scope: "project",
    visibility,
    projectId,
    path: notePath,
    title: note.frontmatter.title,
    selectionStart,
    selectionEnd,
    selectedText,
    startLine: 2,
    endLine: 2,
    expectedHash: note.contentHash,
  };
}

describe("CodaScopeProjectNoteRangeService", () => {
  it("canonicalizes project shared/private context with one explicit .md rule", async () => {
    const target = await createTarget();
    await expect(service.canonicalizeTarget({
      actorId: "alice",
      routeProjectId: projectId,
      currentContext: {
        view: "notes",
        projectId,
        noteScope: "project",
        noteVisibility: "shared",
        notePath: "plans/current",
        epicId: null,
      },
      target,
    })).resolves.toEqual(target);

    const privateTarget = await createTarget({
      visibility: "private",
      actorId: "bob",
    });
    await expect(service.canonicalizeTarget({
      actorId: "bob",
      routeProjectId: projectId,
      currentContext: {
        view: "notes",
        projectId,
        noteScope: "project",
        noteVisibility: "private",
        notePath: "plans/current.md",
      },
      target: privateTarget,
    })).resolves.toEqual(privateTarget);
  });

  it("canonicalizes shared epic notes and rejects private epic targets", async () => {
    const epic = await epicSvc.createEpic(projectId, {
      title: "Epic",
      createdBy: "alice",
    });
    const body = "one\ntwo\nthree";
    await noteSvc.createNote(
      "epic",
      "shared",
      { projectId, epicId: epic.id, userId: "alice" },
      "epic-plan.md",
      body,
    );
    const note = await noteSvc.readNote(
      "epic",
      "shared",
      { projectId, epicId: epic.id, userId: "alice" },
      "epic-plan.md",
    );
    if (!note) throw new Error("fixture epic note missing");
    const target: CanonicalProjectNoteRangeTarget = {
      kind: "note-range",
      stableId: note.frontmatter.id,
      scope: "epic",
      visibility: "shared",
      projectId,
      epicId: epic.id,
      path: "epic-plan.md",
      title: note.frontmatter.title,
      selectionStart: 4,
      selectionEnd: 7,
      selectedText: "two",
      startLine: 2,
      endLine: 2,
      expectedHash: note.contentHash,
    };
    await expect(service.canonicalizeTarget({
      actorId: "alice",
      routeProjectId: projectId,
      currentContext: {
        view: "notes",
        projectId,
        epicId: epic.id,
        noteScope: "epic",
        noteVisibility: "shared",
        notePath: "epic-plan",
      },
      target,
    })).resolves.toEqual(target);

    await expect(service.canonicalizeTarget({
      actorId: "alice",
      routeProjectId: projectId,
      currentContext: {
        view: "notes",
        projectId,
        epicId: epic.id,
        noteScope: "epic",
        noteVisibility: "private",
        notePath: "epic-plan",
      },
      target: { ...target, visibility: "private" },
    })).rejects.toBeInstanceOf(ProjectNoteRangeInvalidError);
  });

  it("rejects every canonical identity/range mismatch and split surrogate offsets", async () => {
    const target = await createTarget();
    for (const forged of [
      { ...target, projectId: "other_project" },
      { ...target, scope: "epic", epicId: "epic_other" },
      { ...target, visibility: "private" },
      { ...target, path: "other.md" },
      { ...target, stableId: "other_note" },
      { ...target, title: "Other" },
      { ...target, expectedHash: "f".repeat(64) },
      {
        ...target,
        selectionStart: target.selectionStart + 1,
        selectionEnd: target.selectionEnd,
        selectedText: target.selectedText.slice(1),
      },
      { ...target, selectedText: "different!", selectionEnd: target.selectionStart + 10 },
      { ...target, startLine: 1 },
    ]) {
      await expect(service.revalidateTarget("alice", forged))
        .rejects.toBeInstanceOf(ProjectNoteRangeInvalidError);
    }
  });

  it("replaces only the exact body range, supports empty/multiline text, and detects conflicts", async () => {
    const target = await createTarget();
    const updated = await service.replaceExactRange(
      "alice",
      target,
      "replacement\nline",
    );
    expect(updated.contentHash).not.toBe(target.expectedHash);
    const saved = await noteSvc.readNote(
      "project",
      "shared",
      { projectId, userId: "alice" },
      target.path,
    );
    expect(noteSvc.parseFrontmatter(saved!.content).body)
      .toBe("first\nreplacement\nline\nlast");
    expect(saved!.frontmatter.id).toBe(target.stableId);

    await expect(service.replaceExactRange("alice", target, ""))
      .rejects.toBeInstanceOf(ProjectNoteRangeInvalidError);

    const freshTarget = await createTarget({
      body: "first\ndelete me\nlast",
      selectedText: "delete me",
      path: "plans/delete.md",
    });
    await expect(service.replaceExactRange("alice", freshTarget, ""))
      .resolves.toMatchObject({ stableId: freshTarget.stableId });

    const conflictTarget = await createTarget({
      body: "first\nstale me\nlast",
      selectedText: "stale me",
      path: "plans/stale.md",
    });
    const current = await noteSvc.readNote(
      "project",
      "shared",
      { projectId, userId: "alice" },
      conflictTarget.path,
    );
    await noteSvc.updateNote(
      "project",
      "shared",
      { projectId, userId: "alice" },
      conflictTarget.path,
      current!.content.replace("stale me", "changed"),
      current!.contentHash,
    );
    await expect(service.replaceExactRange("alice", conflictTarget, "new"))
      .rejects.toBeInstanceOf(ProjectNoteRangeInvalidError);
    expect(ProjectNoteRangeConflictError).toBeDefined();
  });

  it("isolates private actors and rejects annotation-marker crossings", async () => {
    const privateTarget = await createTarget({
      visibility: "private",
      actorId: "alice",
    });
    await expect(service.revalidateTarget("bob", privateTarget))
      .rejects.toBeInstanceOf(ProjectNoteRangeInvalidError);

    const marker = annotationStartMarker("nann_123456789abc");
    const crossing = await createTarget({
      body: `first\n${marker}\nlast`,
      selectedText: marker,
      path: "plans/marker.md",
    });
    await expect(service.replaceExactRange("alice", crossing, "removed"))
      .rejects.toBeInstanceOf(ProjectNoteRangeInvalidError);
  });
});
