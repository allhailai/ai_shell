import { describe, expect, it } from "vitest";
import {
  normalizeCanonicalProjectNoteRangeAction,
} from "./projectNoteRangeMutationActionValidation";

const projectAction = {
  type: "operation_completed",
  attributes: {
    operation: "replace_note_range",
    stableId: "note_123",
    scope: "project",
    visibility: "private",
    projectId: "project_123",
    path: "plan.md",
    title: "Plan",
    contentHash: "b".repeat(64),
    startLine: "2",
    endLine: "4",
  },
  description: "Replaced selected lines.",
};

describe("project note-range completion action validation", () => {
  it("accepts only the exact project and epic attribute variants", () => {
    expect(normalizeCanonicalProjectNoteRangeAction(projectAction))
      .toEqual(projectAction);
    const epic = {
      ...projectAction,
      attributes: {
        ...projectAction.attributes,
        scope: "epic",
        visibility: "shared",
        epicId: "epic_123",
      },
    };
    expect(normalizeCanonicalProjectNoteRangeAction(epic)).toEqual(epic);
    expect(normalizeCanonicalProjectNoteRangeAction({
      ...epic,
      attributes: { ...epic.attributes, unknown: "no" },
    })).toBeNull();
  });

  it("rejects private epic actions, missing epic custody, and invalid lines", () => {
    expect(normalizeCanonicalProjectNoteRangeAction({
      ...projectAction,
      attributes: {
        ...projectAction.attributes,
        scope: "epic",
        visibility: "private",
        epicId: "epic_123",
      },
    })).toBeNull();
    expect(normalizeCanonicalProjectNoteRangeAction({
      ...projectAction,
      attributes: {
        ...projectAction.attributes,
        scope: "epic",
        visibility: "shared",
      },
    })).toBeNull();
    expect(normalizeCanonicalProjectNoteRangeAction({
      ...projectAction,
      attributes: {
        ...projectAction.attributes,
        startLine: "04",
      },
    })).toBeNull();
  });
});
