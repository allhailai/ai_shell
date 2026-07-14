import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { buildImagePreviewDecorations } from "./imagePreviewExtension.js";

describe("image preview block decorations", () => {
  it("uses one block replacement for a standalone image so vertical cursor layout stays contiguous", () => {
    const doc = "Before\n\n![Preview](https://example.test/image.png)\n\nAfter";
    const state = EditorState.create({ doc });
    const imageFrom = doc.indexOf("![Preview]");
    const imageTo = imageFrom + "![Preview](https://example.test/image.png)".length;
    const ranges: Array<{ from: number; to: number; block?: boolean }> = [];

    buildImagePreviewDecorations(state, { editable: true }).between(0, state.doc.length, (from, to, decoration) => {
      ranges.push({ from, to, block: decoration.spec.block });
    });

    expect(ranges).toEqual([{ from: imageFrom, to: imageTo, block: true }]);
  });

  it("reveals the Markdown source while the cursor is on the image line", () => {
    const doc = "Before\n![Preview](https://example.test/image.png)\nAfter";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.indexOf("![Preview]") },
    });
    const ranges: unknown[] = [];

    buildImagePreviewDecorations(state, { editable: true }).between(0, state.doc.length, () => {
      ranges.push(true);
    });

    expect(ranges).toEqual([]);
  });
});
