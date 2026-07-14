import { describe, expect, it } from "vitest";
import {
  captureKeyboardShortcut,
  formatShortcut,
  normalizeStroke,
  validateShortcut,
} from "./shortcut";

describe("keybinding shortcut normalization", () => {
  it("normalizes aliases into portable CodeMirror strokes", () => {
    expect(normalizeStroke("Command-Option-Up").shortcut).toEqual({ strokes: ["Mod-Alt-ArrowUp"] });
    expect(normalizeStroke("Ctrl-Shift-L").shortcut).toEqual({ strokes: ["Ctrl-Shift-l"] });
  });

  it("rejects bare printable and browser-reserved shortcuts", () => {
    expect(normalizeStroke("d").error).toMatch(/modifier/i);
    expect(normalizeStroke("Mod-r").reserved).toBe(true);
  });

  it("captures platform-aware primary modifiers and formats displays", () => {
    const event = { key: "ArrowUp", metaKey: true, ctrlKey: false, altKey: true, shiftKey: false } as KeyboardEvent;
    const shortcut = captureKeyboardShortcut(event, "mac").shortcut!;
    expect(shortcut).toEqual({ strokes: ["Mod-Alt-ArrowUp"] });
    expect(formatShortcut(shortcut, "mac")).toBe("⌘⌥↑");
    expect(formatShortcut(shortcut, "windows")).toBe("Ctrl+Alt+↑");
  });

  it("models chords while rejecting them until the chord UI exists", () => {
    expect(validateShortcut({ strokes: ["Mod-k", "Mod-c"] }).error).toMatch(/one keystroke/i);
  });
});
