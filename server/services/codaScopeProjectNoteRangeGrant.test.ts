import { describe, expect, it } from "vitest";
import { ProjectNoteRangeGrantHolder } from "./codaScopeProjectNoteRangeGrant.js";
import type { CanonicalProjectNoteRangeTarget } from "../../src/apps/codascope/projectNoteRangeTargetValidation.js";

const target: CanonicalProjectNoteRangeTarget = {
  kind: "note-range",
  stableId: "note_123",
  scope: "project",
  visibility: "shared",
  projectId: "project_123",
  path: "plan.md",
  title: "Plan",
  selectionStart: 0,
  selectionEnd: 4,
  selectedText: "plan",
  startLine: 1,
  endLine: 1,
  expectedHash: "a".repeat(64),
};

describe("ProjectNoteRangeGrantHolder", () => {
  it("installs a fresh one-success grant and remains active after consumption", () => {
    const holder = new ProjectNoteRangeGrantHolder();
    holder.replace(target);
    expect(holder.hasActiveTarget()).toBe(true);
    const reservation = holder.reserve();
    expect(reservation?.target).toEqual(target);
    expect(holder.reserve()).toBeNull();
    reservation?.commit();
    expect(holder.reserve()).toBeNull();
    expect(holder.hasActiveTarget()).toBe(true);
  });

  it("releases failed attempts and clears all authority on reuse", () => {
    const holder = new ProjectNoteRangeGrantHolder();
    holder.replace(target);
    holder.reserve()?.release();
    expect(holder.reserve()).not.toBeNull();
    holder.clear();
    expect(holder.hasActiveTarget()).toBe(false);
    expect(holder.reserve()).toBeNull();
    holder.replace({ ...target, stableId: "note_456" });
    expect(holder.reserve()?.target.stableId).toBe("note_456");
  });
});
