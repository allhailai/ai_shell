import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  buildPinnedRangeExtension,
  readPinnedEditorRanges,
  setPinnedEditorRange,
} from "./pinnedRangeExtension";

describe("pinned range CodeMirror extension", () => {
  it("sets, maps, and clears a non-document decoration", () => {
    let state = EditorState.create({
      doc: "abcdef",
      extensions: [buildPinnedRangeExtension()],
    });
    expect(readPinnedEditorRanges(state)).toEqual([]);

    state = state.update({
      effects: setPinnedEditorRange.of({ from: 1, to: 4 }),
    }).state;
    expect(readPinnedEditorRanges(state)).toEqual([{ from: 1, to: 4 }]);

    state = state.update({
      changes: { from: 0, insert: "!" },
    }).state;
    expect(readPinnedEditorRanges(state)).toEqual([{ from: 2, to: 5 }]);

    state = state.update({
      effects: setPinnedEditorRange.of(null),
    }).state;
    expect(readPinnedEditorRanges(state)).toEqual([]);
    expect(state.doc.toString()).toBe("!abcdef");
  });
});
