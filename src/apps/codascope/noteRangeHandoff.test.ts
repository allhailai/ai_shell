import { afterEach, describe, expect, it } from "vitest";
import {
  clearNoteRangeHandoff,
  clearNoteRangeHandoffBySource,
  findStrictMatchingNoteRangeAction,
  getNoteRangeHandoff,
  markNoteRangeHandoffInFlight,
  settleNoteRangeHandoff,
  stageNoteRangeHandoff,
} from "./noteRangeHandoff";

const workspace = { kind: "workspace" } as const;
const project = { kind: "project", projectId: "alpha" } as const;

const workspaceTarget = {
  kind: "note-range" as const,
  stableId: "note-1",
  scope: "codascope" as const,
  visibility: "private" as const,
  path: "notes/one.md",
  title: "One",
  selectionStart: 0,
  selectionEnd: 5,
  selectedText: "first",
  startLine: 1,
  endLine: 1,
  expectedHash: "a".repeat(64),
};

const projectTarget = {
  kind: "note-range" as const,
  stableId: "note-2",
  scope: "project" as const,
  visibility: "shared" as const,
  projectId: "alpha",
  path: "notes/two.md",
  title: "Two",
  selectionStart: 6,
  selectionEnd: 12,
  selectedText: "second",
  startLine: 2,
  endLine: 2,
  expectedHash: "b".repeat(64),
};

afterEach(() => {
  clearNoteRangeHandoff(workspace);
  clearNoteRangeHandoff(project);
});

describe("note range handoff custody", () => {
  it("keeps at most one target per scope and never crosses scopes", () => {
    const first = stageNoteRangeHandoff({
      scope: workspace,
      sourceId: "source-1",
      target: workspaceTarget,
    });
    const replacement = stageNoteRangeHandoff({
      scope: workspace,
      sourceId: "source-2",
      target: { ...workspaceTarget, selectedText: "other", selectionEnd: 5 },
    });
    const projectHandoff = stageNoteRangeHandoff({
      scope: project,
      sourceId: "source-3",
      target: projectTarget,
    });

    expect(first).not.toBeNull();
    expect(replacement).not.toBeNull();
    expect(getNoteRangeHandoff(workspace)?.sourceId).toBe("source-2");
    expect(getNoteRangeHandoff(project)).toEqual(projectHandoff);
    expect(stageNoteRangeHandoff({
      scope: workspace,
      sourceId: "wrong-scope",
      target: projectTarget,
    })).toBeNull();
  });

  it("allows one send and records a strict confirmed terminal action", () => {
    const staged = stageNoteRangeHandoff({
      scope: project,
      sourceId: "source-1",
      target: projectTarget,
    })!;
    const inFlight = markNoteRangeHandoffInFlight(
      project,
      staged.handoffId,
    );
    expect(inFlight?.status).toBe("in-flight");
    expect(markNoteRangeHandoffInFlight(project, staged.handoffId)).toBeNull();

    const action = {
      type: "operation_completed" as const,
      attributes: {
        operation: "replace_note_range",
        stableId: "note-2",
        scope: "project",
        visibility: "shared",
        projectId: "alpha",
        path: "notes/two.md",
        title: "Two",
        contentHash: "c".repeat(64),
        startLine: "2",
        endLine: "2",
      },
      description: "Replaced the selected range.",
    };
    const matching = findStrictMatchingNoteRangeAction(projectTarget, [action]);
    expect(matching).toEqual(action);
    expect(settleNoteRangeHandoff({
      scope: project,
      handoffId: staged.handoffId,
      terminalStatus: "error",
      completionAction: matching!,
    })?.status).toBe("completed");
    expect(markNoteRangeHandoffInFlight(project, staged.handoffId)).toBeNull();
  });

  it("clears only the handoff owned by an unmounted source", () => {
    stageNoteRangeHandoff({
      scope: workspace,
      sourceId: "workspace-source",
      target: workspaceTarget,
    });
    stageNoteRangeHandoff({
      scope: project,
      sourceId: "project-source",
      target: projectTarget,
    });
    expect(clearNoteRangeHandoffBySource("workspace-source")).toBe(true);
    expect(getNoteRangeHandoff(workspace)).toBeNull();
    expect(getNoteRangeHandoff(project)).not.toBeNull();
  });
});
