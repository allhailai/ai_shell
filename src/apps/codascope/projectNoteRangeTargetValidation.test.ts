import { describe, expect, it } from "vitest";
import {
  normalizeCanonicalProjectNoteRangeTarget,
  PROJECT_NOTE_RANGE_MAX_SELECTED_TEXT,
} from "./projectNoteRangeTargetValidation";

const projectTarget = {
  kind: "note-range",
  stableId: "note_123",
  scope: "project",
  visibility: "shared",
  projectId: "project_123",
  path: "plans/current.md",
  title: "Current plan",
  selectionStart: 4,
  selectionEnd: 9,
  selectedText: "alpha",
  startLine: 1,
  endLine: 1,
  expectedHash: "a".repeat(64),
} as const;

describe("project note-range target validation", () => {
  it("normalizes exact project and epic variants without trimming content", () => {
    expect(normalizeCanonicalProjectNoteRangeTarget(projectTarget))
      .toEqual(projectTarget);
    const epic = {
      ...projectTarget,
      scope: "epic",
      visibility: "shared",
      epicId: "epic_123",
      selectedText: " alpha ",
      selectionEnd: projectTarget.selectionStart + 7,
    } as const;
    expect(normalizeCanonicalProjectNoteRangeTarget(epic)?.selectedText)
      .toBe(" alpha ");
  });

  it("enforces exact fields and separate project/epic visibility shapes", () => {
    expect(normalizeCanonicalProjectNoteRangeTarget({
      ...projectTarget,
      extraAuthority: true,
    })).toBeNull();
    expect(normalizeCanonicalProjectNoteRangeTarget({
      ...projectTarget,
      epicId: "epic_123",
    })).toBeNull();
    expect(normalizeCanonicalProjectNoteRangeTarget({
      ...projectTarget,
      scope: "epic",
      visibility: "private",
      epicId: "epic_123",
    })).toBeNull();
    expect(normalizeCanonicalProjectNoteRangeTarget({
      ...projectTarget,
      scope: "epic",
    })).toBeNull();
  });

  it("enforces nonempty bounded UTF-16 ranges and display lines", () => {
    for (const candidate of [
      { ...projectTarget, selectedText: "", selectionEnd: 4 },
      { ...projectTarget, selectionEnd: projectTarget.selectionStart },
      { ...projectTarget, selectionEnd: 8 },
      {
        ...projectTarget,
        selectedText: "x".repeat(PROJECT_NOTE_RANGE_MAX_SELECTED_TEXT + 1),
        selectionEnd:
          projectTarget.selectionStart
          + PROJECT_NOTE_RANGE_MAX_SELECTED_TEXT
          + 1,
      },
      {
        ...projectTarget,
        selectedText: "a\nb",
        selectionEnd: projectTarget.selectionStart + 3,
        startLine: 2,
        endLine: 2,
      },
    ]) {
      expect(normalizeCanonicalProjectNoteRangeTarget(candidate)).toBeNull();
    }

    const emoji = {
      ...projectTarget,
      selectionEnd: projectTarget.selectionStart + 2,
      selectedText: "😀",
    };
    expect(normalizeCanonicalProjectNoteRangeTarget(emoji)).toEqual(emoji);
  });
});
