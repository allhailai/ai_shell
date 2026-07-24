import { describe, expect, it } from "vitest";
import { normalizeMarkdownLinkHref } from "./linkDestination";

describe("normalizeMarkdownLinkHref", () => {
  it("turns a www destination into an external HTTPS URL", () => {
    expect(normalizeMarkdownLinkHref("www.cnn.com")).toBe("https://www.cnn.com");
  });

  it("preserves supported absolute and relative destinations", () => {
    expect(normalizeMarkdownLinkHref("https://example.com/docs")).toBe("https://example.com/docs");
    expect(normalizeMarkdownLinkHref("/codascope/project/demo")).toBe("/codascope/project/demo");
    expect(normalizeMarkdownLinkHref("#section")).toBe("#section");
    expect(normalizeMarkdownLinkHref("mailto:person@example.com")).toBe("mailto:person@example.com");
  });

  it("rejects unsafe protocols", () => {
    expect(normalizeMarkdownLinkHref("javascript:alert(1)")).toBe("");
    expect(normalizeMarkdownLinkHref("data:text/html,unsafe")).toBe("");
  });
});
