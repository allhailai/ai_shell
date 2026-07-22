import { describe, expect, it } from "vitest";
import { countSubstantiveWikiTopics } from "./codaScopeBuildOrchestrator.js";

describe("countSubstantiveWikiTopics", () => {
  it("does not treat wiki index files as successful generated topic content", () => {
    expect(countSubstantiveWikiTopics([{ id: "_index" }, { id: "index" }])).toBe(0);
    expect(countSubstantiveWikiTopics([{ id: "_index" }, { id: "index" }, { id: "architecture" }])).toBe(1);
  });
});
