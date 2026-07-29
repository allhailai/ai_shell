import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  parseMarkdownTableBlock,
  resolveTableOverflowState,
  tablePanDistance,
} from "./markdownTableExtension";

describe("markdown table overflow", () => {
  it("only exposes navigation in the directions that contain hidden columns", () => {
    expect(resolveTableOverflowState(600, 600, 0)).toEqual({
      overflowing: false,
      canScrollLeft: false,
      canScrollRight: false,
      maxScrollLeft: 0,
    });

    expect(resolveTableOverflowState(600, 2400, 0)).toEqual({
      overflowing: true,
      canScrollLeft: false,
      canScrollRight: true,
      maxScrollLeft: 1800,
    });

    expect(resolveTableOverflowState(600, 2400, 900)).toEqual({
      overflowing: true,
      canScrollLeft: true,
      canScrollRight: true,
      maxScrollLeft: 1800,
    });

    expect(resolveTableOverflowState(600, 2400, 1800)).toEqual({
      overflowing: true,
      canScrollLeft: true,
      canScrollRight: false,
      maxScrollLeft: 1800,
    });
  });

  it("pans most of a viewport while retaining context between positions", () => {
    expect(tablePanDistance(600)).toBe(450);
    expect(tablePanDistance(100)).toBe(160);
  });

  it("continues parsing wide markdown tables into a single block", () => {
    const state = EditorState.create({
      doc: [
        "| First column | Second column | Third column |",
        "| --- | --- | --- |",
        "| Alpha | Beta | Gamma |",
        "| Delta | Epsilon | Zeta |",
        "",
        "After the table",
      ].join("\n"),
    });

    expect(parseMarkdownTableBlock(state.doc, 1)).toMatchObject({
      startLineNumber: 1,
      endLineNumber: 4,
      headers: ["First column", "Second column", "Third column"],
      rows: [
        ["Alpha", "Beta", "Gamma"],
        ["Delta", "Epsilon", "Zeta"],
      ],
    });
  });
});
