import { describe, expect, it } from "vitest";
import {
  findKeybindingConflicts,
  markdownKeybindingCommands,
  resolveMarkdownEditorBindings,
  visibleKeybindingCommands,
} from "./commandRegistry";
import type { KeybindingProfile } from "./types";

const empty: KeybindingProfile = { schemaVersion: 1, bindings: {} };

describe("Markdown command registry", () => {
  it("contains the public editable multi-cursor commands with expected defaults", () => {
    expect(visibleKeybindingCommands().map((command) => command.id)).toEqual([
      "markdown.addCursorAbove",
      "markdown.addCursorBelow",
      "markdown.selectNextOccurrence",
      "markdown.selectAllOccurrences",
      "markdown.selectAllSearchMatches",
      "markdown.openSearch",
      "markdown.findNext",
      "markdown.findPrevious",
      "markdown.exitMultipleSelections",
    ]);
    expect(markdownKeybindingCommands.every((command) => command.editableOnly)).toBe(true);
    expect(markdownKeybindingCommands.find((command) => command.id === "markdown.addCursorAbove")?.defaultShortcuts).toEqual([{ strokes: ["Mod-Alt-ArrowUp"] }]);
    expect(markdownKeybindingCommands.find((command) => command.id === "markdown.openSearch")?.defaultShortcuts).toEqual([{ strokes: ["Mod-f"] }]);
    expect(markdownKeybindingCommands.find((command) => command.id === "markdown.findNext")?.defaultShortcuts).toEqual([{ strokes: ["F3"] }, { strokes: ["Mod-g"] }]);
  });

  it("detects same-scope conflicts", () => {
    const profile: KeybindingProfile = {
      schemaVersion: 1,
      bindings: { "markdown.addCursorAbove": { mode: "custom", shortcuts: [{ strokes: ["Mod-d"] }] } },
    };
    expect(findKeybindingConflicts(profile)).toEqual([
      expect.objectContaining({ shortcut: { strokes: ["Mod-d"] }, commandIds: expect.arrayContaining(["markdown.addCursorAbove", "markdown.selectNextOccurrence"]) }),
    ]);
  });

  it("places custom assignments before blockers and consumes disabled defaults", () => {
    const reassigned: KeybindingProfile = {
      schemaVersion: 1,
      bindings: {
        "markdown.addCursorAbove": { mode: "custom", shortcuts: [{ strokes: ["Mod-d"] }] },
        "markdown.selectNextOccurrence": { mode: "disabled" },
        "markdown.exitMultipleSelections": { mode: "disabled" },
      },
    };
    const bindings = resolveMarkdownEditorBindings(reassigned);
    const keys = bindings.map((binding) => binding.key);
    expect(keys.filter((key) => key === "Mod-d")).toHaveLength(1);
    expect(keys).toContain("Mod-Alt-ArrowUp");
    const escape = bindings.find((binding) => binding.key === "Escape");
    expect(escape?.run).toBeDefined();
    expect(empty.bindings).toEqual({});
  });

  it("allows in-editor search to be rebound while consuming its old default", () => {
    const profile: KeybindingProfile = {
      schemaVersion: 1,
      bindings: {
        "markdown.openSearch": { mode: "custom", shortcuts: [{ strokes: ["Alt-s"] }] },
      },
    };
    const keys = resolveMarkdownEditorBindings(profile).map((binding) => binding.key);
    expect(keys).toContain("Alt-s");
    expect(keys).toContain("Mod-f");
    expect(keys.filter((key) => key === "Mod-f")).toHaveLength(1);
  });
});
