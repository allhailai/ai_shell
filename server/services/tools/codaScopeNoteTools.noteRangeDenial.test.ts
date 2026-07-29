import { describe, expect, it } from "vitest";
import { buildNoteWriteTools } from "./codaScopeNoteTools.js";
import { ProjectNoteRangeGrantHolder } from "../codaScopeProjectNoteRangeGrant.js";

const target = {
  kind: "note-range" as const,
  stableId: "note_123",
  scope: "project" as const,
  visibility: "shared" as const,
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

describe("whole-note tool denial during a project note-range turn", () => {
  it("fails create_note and edit_note closed while the target remains active", async () => {
    const holder = new ProjectNoteRangeGrantHolder();
    holder.replace(target);
    const tools = buildNoteWriteTools(
      target.projectId,
      { note: {} } as any,
      undefined,
      "alice",
      holder,
    );
    await expect(tools.create_note.execute({
      scope: "project",
      visibility: "shared",
      path: "other.md",
    }, {} as any)).resolves.toContain("unavailable");
    await expect(tools.edit_note.execute({
      scope: "project",
      visibility: "shared",
      path: "plan.md",
      content: "whole body",
    }, {} as any)).resolves.toContain("unavailable");

    holder.reserve()?.commit();
    await expect(tools.edit_note.execute({
      scope: "project",
      visibility: "shared",
      path: "plan.md",
      content: "whole body",
    }, {} as any)).resolves.toContain("unavailable");
  });

  it("preserves existing whole-note behavior without a range target", async () => {
    const holder = new ProjectNoteRangeGrantHolder();
    const tools = buildNoteWriteTools(
      target.projectId,
      { note: {} } as any,
      undefined,
      "alice",
      holder,
    );
    await expect(tools.create_note.execute({}, {} as any))
      .resolves.toBe("scope, visibility, and path are required.");
    await expect(tools.edit_note.execute({}, {} as any))
      .resolves.toBe("scope, visibility, path, and content are required.");
  });
});
