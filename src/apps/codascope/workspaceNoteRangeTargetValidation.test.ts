import { describe, expect, it } from "vitest";
import {
  normalizeCanonicalWorkspaceNoteRangeTarget,
  WORKSPACE_NOTE_RANGE_MAX_SELECTED_TEXT,
} from "./workspaceNoteRangeTargetValidation";

const canonical = {
  kind: "note-range",
  stableId: "note-1",
  scope: "codascope",
  visibility: "private",
  path: "planning/one.md",
  title: "One",
  selectionStart: 10,
  selectionEnd: 17,
  selectedText: "one\ntwo",
  startLine: 2,
  endLine: 3,
  expectedHash: "a".repeat(32),
};

describe("workspace note range target validation", () => {
  it("normalizes the exact bounded discriminated contract", () => {
    expect(normalizeCanonicalWorkspaceNoteRangeTarget(canonical)).toEqual(
      canonical,
    );
  });

  it.each([
    ["unknown field", { ...canonical, ownerId: "mallory" }],
    ["unknown kind", { ...canonical, kind: "project-note-range" }],
    ["empty selection", {
      ...canonical,
      selectionEnd: canonical.selectionStart,
      selectedText: "",
      endLine: canonical.startLine,
    }],
    ["inconsistent offsets", { ...canonical, selectionEnd: 18 }],
    ["inconsistent lines", { ...canonical, endLine: 2 }],
    ["fractional offset", { ...canonical, selectionStart: 10.5 }],
    ["oversized selection", {
      ...canonical,
      selectionStart: 0,
      selectionEnd: WORKSPACE_NOTE_RANGE_MAX_SELECTED_TEXT + 1,
      selectedText: "x".repeat(WORKSPACE_NOTE_RANGE_MAX_SELECTED_TEXT + 1),
      startLine: 1,
      endLine: 1,
    }],
    ["invalid hash", { ...canonical, expectedHash: "stale" }],
  ])("rejects %s", (_label, value) => {
    expect(normalizeCanonicalWorkspaceNoteRangeTarget(value)).toBeNull();
  });
});
