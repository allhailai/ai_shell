import { describe, expect, it } from "vitest";
import { createMarkdownLink } from "./formattingCommands.js";

describe("createMarkdownLink", () => {
  it("uses selected URL text for the destination and leaves the title empty", () => {
    const url = "https://claude.com/blog/how-kepler-built-verifiable-ai-for-financial-services-with-claude";

    expect(createMarkdownLink(url)).toBe(`[](${url})`);
  });

  it("keeps the editable placeholder when there is no selection", () => {
    expect(createMarkdownLink("")).toBe("[text](url)");
  });
});
