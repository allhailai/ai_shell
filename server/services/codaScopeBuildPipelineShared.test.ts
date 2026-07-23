import { describe, expect, it } from "vitest";
import {
  countSubstantiveWikiTopics,
  extractTokenUsage,
} from "./codaScopeBuildPipelineShared.js";

describe("countSubstantiveWikiTopics", () => {
  it("does not treat wiki index files as successful generated topic content", () => {
    expect(countSubstantiveWikiTopics([{ id: "_index" }, { id: "index" }])).toBe(0);
    expect(countSubstantiveWikiTopics([{ id: "_index" }, { id: "index" }, { id: "architecture" }])).toBe(1);
  });

  it("counts every non-index, non-private topic", () => {
    expect(countSubstantiveWikiTopics([
      { id: "index" },
      { id: "_index" },
      { id: "_draft" },
      { id: "architecture" },
      { id: "runtime-flow" },
    ])).toBe(2);
  });
});

describe("extractTokenUsage", () => {
  it("preserves every supported token usage field", () => {
    expect(extractTokenUsage({
      usage: {
        inputTokens: 11,
        outputTokens: 12,
        cacheReadTokens: 13,
        cacheWriteTokens: 14,
        totalTokens: 50,
        reasoningTokens: 15,
      },
    })).toEqual({
      inputTokens: 11,
      outputTokens: 12,
      cacheReadTokens: 13,
      cacheWriteTokens: 14,
      totalTokens: 50,
      reasoningTokens: 15,
    });
  });

  it("returns undefined when usage is missing", () => {
    expect(extractTokenUsage(undefined)).toBeUndefined();
    expect(extractTokenUsage({})).toBeUndefined();
  });
});
