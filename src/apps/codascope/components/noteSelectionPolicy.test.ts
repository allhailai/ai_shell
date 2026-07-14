import { describe, expect, it } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { canCreateRangeAnnotation } from "./noteSelectionPolicy";

describe("range annotation selection policy", () => {
  it("rejects multiple ranges instead of choosing a primary anchor", () => {
    const multi = EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(4, 6)]);
    expect(canCreateRangeAnnotation(multi)).toBe(false);
    expect(canCreateRangeAnnotation(EditorSelection.create([EditorSelection.range(0, 2)]))).toBe(true);
  });
});
