import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  buildLivePreviewDecorations,
  findMarkdownLinkPreviews,
} from "./livePreviewExtension";

function stateFor(doc: string, cursor: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown()],
  });
}

function replacementRanges(state: EditorState, editable = true): Array<[number, number]> {
  const decorations = buildLivePreviewDecorations({
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
  }, editable);
  const ranges: Array<[number, number]> = [];
  decorations.between(0, state.doc.length, (from, to, decoration) => {
    if (decoration.spec.widget) ranges.push([from, to]);
  });
  return ranges;
}

describe("Markdown link live preview", () => {
  it("recognizes a scheme-less www destination as an external link", () => {
    const state = stateFor("[Foo](www.cnn.com)", 0);

    expect(findMarkdownLinkPreviews(state)).toEqual([{
      from: 0,
      to: 18,
      label: "Foo",
      destination: "www.cnn.com",
      href: "https://www.cnn.com",
    }]);
  });

  it("keeps the active line editable and renders the link after the cursor leaves", () => {
    const doc = "[Foo](www.cnn.com)\nNext line";
    const activeLinkState = stateFor(doc, 2);
    const inactiveLinkState = stateFor(doc, doc.indexOf("Next"));

    expect(replacementRanges(activeLinkState)).not.toContainEqual([0, 18]);
    expect(replacementRanges(inactiveLinkState)).toContainEqual([0, 18]);
  });

  it("renders every parsed link in a read-only editor", () => {
    const state = stateFor("[Foo](www.cnn.com)", 2);

    expect(replacementRanges(state, false)).toContainEqual([0, 18]);
  });

  it("does not turn unsafe destinations into live link widgets", () => {
    const state = stateFor("[Unsafe](javascript:alert(1))", 0);

    expect(findMarkdownLinkPreviews(state)).toEqual([]);
  });
});
