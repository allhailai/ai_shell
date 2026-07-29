import { describe, expect, it } from "vitest";
import {
  formatHistoryMessage,
  formatProjectNoteRangeTarget,
  formatSelectionContext,
  formatViewContext,
} from "./codaScopeChatPromptHelpers.js";

describe("formatViewContext design-document contract", () => {
  it("describes archetypes and the real creation workflow without a selectable catalog", () => {
    const context = formatViewContext({
      view: "epic",
      epicId: "epic-1",
      epicTitle: "Reliable Scheduling",
      epicTab: "design",
      projectName: "Core",
    });

    expect(context).toContain("design-document archetypes");
    expect(context).toContain("read the current epic and research context");
    expect(context).toContain("draft substantial complete markdown");
    expect(context).toContain("create_design_doc(epicId, title, content)");
    expect(context).toContain("no selectable design-document catalog or picker");
    expect(context).not.toMatch(/available templates|selectable templates/i);
    for (const obsoleteId of ["api-spec", "data-model", "system-design", "user-flow"]) {
      expect(context).not.toContain(obsoleteId);
    }
  });
});

describe("project note-range prompt contract", () => {
  const target = {
    kind: "note-range" as const,
    stableId: "note_123",
    scope: "epic" as const,
    visibility: "shared" as const,
    projectId: "project_123",
    epicId: "epic_123",
    path: "plans/current.md",
    title: "Current plan",
    selectionStart: 2,
    selectionEnd: 14,
    selectedText: "```danger```",
    startLine: 3,
    endLine: 3,
    expectedHash: "a".repeat(64),
  };

  it("describes canonical current authority with a collision-safe fence", () => {
    const prompt = formatProjectNoteRangeTarget(target);
    expect(prompt).toContain("Current plan");
    expect(prompt).toContain("plans/current.md");
    expect(prompt).toContain("epic_123");
    expect(prompt).toContain("Display line range: 3-3");
    expect(prompt).toContain("````markdown\n```danger```\n````");
    expect(prompt).toContain("only `replace_note_range");
    expect(prompt).toContain("offsets, selected text, and full-content hash are authoritative");
    expect(prompt).toContain("“Do that” is sufficient");
    expect(prompt).toContain("clarifying question");
  });

  it("includes historical provenance without turning it into authority", () => {
    const history = formatHistoryMessage({
      role: "user",
      content: "Do that",
      metadata: { noteRangeTarget: target },
    });
    expect(history).toContain("historical note-range provenance only");
    expect(history).toContain("grants no authority");
    expect(history).not.toContain(target.selectedText);
  });

  it("leaves the existing design-document selectionContext formatter unchanged", () => {
    const selection = formatSelectionContext({
      blockId: "block",
      text: "selected design text",
      startLine: 4,
      endLine: 5,
      docId: "doc",
      epicId: "epic",
    });
    expect(selection).toContain("edit_design_doc_section");
    expect(selection).toContain("selected design text");
  });
});
