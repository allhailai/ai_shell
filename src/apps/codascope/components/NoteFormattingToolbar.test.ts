import { describe, expect, it } from "vitest";
import { getTextColorApplyEdit, getTextColorClearEdit } from "./NoteFormattingToolbar.js";

describe("getTextColorClearEdit", () => {
  it("removes a text-color wrapper and selects the normalized text", () => {
    const documentText = 'Before <span style="color:#ec4899">pink text</span> after';
    const textStart = documentText.indexOf("pink text");
    const edit = getTextColorClearEdit(documentText, textStart, textStart + "pink".length);

    expect(edit).toEqual({
      from: documentText.indexOf("<span"),
      to: documentText.indexOf("</span>") + "</span>".length,
      insert: "pink text",
      selectionFrom: documentText.indexOf("<span"),
      selectionTo: documentText.indexOf("<span") + "pink text".length,
    });
  });

  it("does nothing when the selection is not inside colored text", () => {
    expect(getTextColorClearEdit("plain text", 0, 5)).toBeNull();
  });

  it("unwraps a color-only span when the raw markup is selected", () => {
    const documentText = '<span style="color:#ef4444">Bar</span>';

    expect(getTextColorClearEdit(documentText, 0, documentText.length)).toEqual({
      from: 0,
      to: documentText.length,
      insert: "Bar",
      selectionFrom: 0,
      selectionTo: 3,
    });
  });

  it("preserves non-color span attributes and style declarations", () => {
    const documentText = '<span class="emphasis" style="color:#ec4899; font-weight: bold">pink</span>';
    const textStart = documentText.indexOf("pink");

    expect(getTextColorClearEdit(documentText, textStart, textStart + 4)).toMatchObject({
      insert: '<span class="emphasis" style="font-weight: bold">pink</span>',
    });
  });
});

describe("getTextColorApplyEdit", () => {
  it("replaces nested colors with one chosen-color span", () => {
    const documentText = '<span style="color:#22c55e"><span style="color:#f97316">Bar </span></span>';
    const edit = getTextColorApplyEdit(documentText, 0, documentText.length, "#3b82f6");

    expect(edit.insert).toBe('<span style="color:#3b82f6">Bar </span>');
    expect(edit.insert.match(/color:/g)).toHaveLength(1);
  });

  it("normalizes all colors in a multi-color selection before applying one color", () => {
    const documentText = '<span style="color:#ef4444">Red</span> and <span style="color:#22c55e">green</span>';
    const edit = getTextColorApplyEdit(documentText, 0, documentText.length, "#a855f7");

    expect(edit.insert).toBe('<span style="color:#a855f7">Red and green</span>');
  });
});
