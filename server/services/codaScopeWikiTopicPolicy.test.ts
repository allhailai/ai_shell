import { describe, expect, it } from "vitest";
import {
  isPlaceholderOnlyWikiText,
  isSubstantiveWikiTopic,
  substantiveWikiText,
} from "./codaScopeWikiTopicPolicy.js";

describe("workspace substantive wiki topic policy", () => {
  it.each([
    ["index page", "index", "# Project\n\nUseful prose.", false],
    ["underscore index", "_index", "# Project\n\nUseful prose.", false],
    ["system page", "_generated", "Useful prose.", false],
    ["empty content", "architecture", "", false],
    ["whitespace", "architecture", " \n\t\n", false],
    ["headings only", "architecture", "# Architecture\n\n## Runtime", false],
    ["comments only", "architecture", "<!-- generated later -->", false],
    ["frontmatter only", "architecture", "---\ntitle: Architecture\n---\n", false],
    ["TODO", "architecture", "# Architecture\n\nTODO", false],
    ["TBD detail", "architecture", "TBD: document the runtime", false],
    ["coming soon", "architecture", "Coming soon.", false],
    ["placeholder boilerplate", "architecture", "This page is under construction.", false],
    ["multi-line placeholders", "architecture", "TODO\n\nDocumentation forthcoming soon.", false],
    ["short prose", "architecture", "Requests are retried once.", true],
    ["short list item", "architecture", "- Uses an append-only event log.", true],
    ["prose after ignored structure", "architecture", "---\ntitle: A\n---\n<!-- note -->\n# A\nRuns in one process.", true],
  ])("%s", (_label, topicId, content, expected) => {
    expect(isSubstantiveWikiTopic(topicId, content)).toBe(expected);
  });

  it("removes structural markdown without imposing a word-count threshold", () => {
    expect(substantiveWikiText("---\ntitle: Auth\n---\n<!-- hidden -->\n# Auth\n\nWorks.")).toBe("Works.");
    expect(isPlaceholderOnlyWikiText("Works.")).toBe(false);
  });
});
