import { describe, expect, it, vi } from "vitest";
import { buildProjectNoteRangeTools } from "./codaScopeProjectNoteRangeTools.js";
import { ProjectNoteRangeGrantHolder } from "../codaScopeProjectNoteRangeGrant.js";
import {
  ProjectNoteRangeActionCollectorHolder,
} from "../codaScopeProjectNoteRangeMutationActions.js";
import type { CanonicalProjectNoteRangeTarget } from "../../../src/apps/codascope/projectNoteRangeTargetValidation.js";

const target: CanonicalProjectNoteRangeTarget = {
  kind: "note-range",
  stableId: "note_123",
  scope: "epic",
  visibility: "shared",
  projectId: "project_123",
  epicId: "epic_123",
  path: "plan.md",
  title: "Plan",
  selectionStart: 4,
  selectionEnd: 8,
  selectedText: "plan",
  startLine: 2,
  endLine: 2,
  expectedHash: "a".repeat(64),
};

describe("replace_note_range project tool", () => {
  it("accepts only replacementMarkdown and emits one strict server action", async () => {
    const grantHolder = new ProjectNoteRangeGrantHolder();
    const actionHolder = new ProjectNoteRangeActionCollectorHolder();
    grantHolder.replace(target);
    const replaceExactRange = vi.fn().mockResolvedValue({
      stableId: target.stableId,
      scope: target.scope,
      visibility: target.visibility,
      projectId: target.projectId,
      epicId: target.epicId,
      path: target.path,
      title: target.title,
      contentHash: "b".repeat(64),
    });
    const tool = buildProjectNoteRangeTools({
      actorId: "alice",
      service: { replaceExactRange } as any,
      grantHolder,
      actionHolder,
    }).replace_note_range;

    await expect(tool.execute({
      replacementMarkdown: "",
      stableId: "forged",
    }, {} as any)).resolves.toContain("arguments are invalid");
    expect(replaceExactRange).not.toHaveBeenCalled();

    await expect(tool.execute({ replacementMarkdown: "" }, {} as any))
      .resolves.toContain('"ok":true');
    expect(replaceExactRange).toHaveBeenCalledWith("alice", target, "");
    expect(actionHolder.current.drain()).toEqual([{
      type: "operation_completed",
      attributes: {
        operation: "replace_note_range",
        stableId: target.stableId,
        scope: "epic",
        visibility: "shared",
        projectId: target.projectId,
        epicId: target.epicId,
        path: target.path,
        title: target.title,
        contentHash: "b".repeat(64),
        startLine: "2",
        endLine: "2",
      },
      description: 'Replaced selected lines 2-2 in note "Plan".',
    }]);
    await expect(tool.execute({ replacementMarkdown: "again" }, {} as any))
      .resolves.toContain("No active project note-range grant");
    expect(replaceExactRange).toHaveBeenCalledTimes(1);
  });

  it("releases both reservations after an unconfirmed failure", async () => {
    const grantHolder = new ProjectNoteRangeGrantHolder();
    const actionHolder = new ProjectNoteRangeActionCollectorHolder();
    grantHolder.replace(target);
    const replaceExactRange = vi.fn()
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce({
        stableId: target.stableId,
        scope: target.scope,
        visibility: target.visibility,
        projectId: target.projectId,
        epicId: target.epicId,
        path: target.path,
        title: target.title,
        contentHash: "c".repeat(64),
      });
    const tool = buildProjectNoteRangeTools({
      actorId: "alice",
      service: { replaceExactRange } as any,
      grantHolder,
      actionHolder,
    }).replace_note_range;

    await expect(tool.execute({ replacementMarkdown: "first" }, {} as any))
      .resolves.toContain("could not be confirmed");
    expect(actionHolder.current.drain()).toEqual([]);
    await expect(tool.execute({ replacementMarkdown: "second" }, {} as any))
      .resolves.toContain('"ok":true');
  });
});
