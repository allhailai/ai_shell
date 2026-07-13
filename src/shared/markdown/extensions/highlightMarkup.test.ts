import { describe, expect, it } from "vitest";
import { getHighlightApplyEdit, getHighlightClearEdit } from "./highlightMarkup.js";

describe("highlight markup normalization", () => {
  it("recolors multiple highlight colors as one non-nested run", () => {
    const documentText = "==Red=={.red} and ==green=={.green}";
    const edit = getHighlightApplyEdit(documentText, 0, documentText.length, "purple");

    expect(edit.insert).toBe("==Red and green=={.purple}");
  });

  it("recolors an existing run instead of nesting another wrapper", () => {
    const documentText = "==Green text=={.green}";
    const edit = getHighlightApplyEdit(documentText, 3, 8, "orange");

    expect(edit).toMatchObject({
      from: 0,
      to: documentText.length,
      insert: "==Green text=={.orange}",
    });
  });

  it("flattens legacy nested markup when the nested block is selected", () => {
    const documentText = "==Outer ==inner=={.orange} text=={.green}";
    const edit = getHighlightApplyEdit(documentText, 0, documentText.length, "blue");

    expect(edit.insert).toBe("==Outer inner text=={.blue}");
  });

  it("removes all affected highlight wrappers when toggled off", () => {
    const documentText = "==Red=={.red} and ==green=={.green}";
    const edit = getHighlightClearEdit(documentText, 0, documentText.length);

    expect(edit?.insert).toBe("Red and green");
  });
});
