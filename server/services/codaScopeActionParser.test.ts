/* ── CodaScope: Action Parser Tests ───────────────────────────────────
   Unit tests for codaScopeActionParser.ts — validates tag extraction,
   attribute parsing, stripping, and edge cases.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect } from "vitest";
import { extractActions, stripActionTags, VALID_ACTION_TYPES } from "./codaScopeActionParser.js";

describe("extractActions", () => {
  it("extracts a single valid action", () => {
    const text = `
Here is my analysis.

<codascope_action type="build_wiki_page" topic="auth-flow">
  Build a wiki page for the authentication flow module
</codascope_action>
`;
    const actions = extractActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("build_wiki_page");
    expect(actions[0].attributes.topic).toBe("auth-flow");
    expect(actions[0].description).toBe("Build a wiki page for the authentication flow module");
  });

  it("extracts multiple actions from one response", () => {
    const text = `
<codascope_action type="build_wiki_page" topic="auth">
  Build auth page
</codascope_action>

Some text in between.

<codascope_action type="run_quality_scan">
  Run a quality scan
</codascope_action>
`;
    const actions = extractActions(text);
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe("build_wiki_page");
    expect(actions[1].type).toBe("run_quality_scan");
  });

  it("skips actions with invalid/unknown types", () => {
    const text = `
<codascope_action type="delete_everything">
  This should not be parsed
</codascope_action>

<codascope_action type="build_wiki_page" topic="valid">
  This should be parsed
</codascope_action>
`;
    const actions = extractActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("build_wiki_page");
  });

  it("skips actions without a type attribute", () => {
    const text = `
<codascope_action topic="orphan">
  No type specified
</codascope_action>
`;
    const actions = extractActions(text);
    expect(actions).toHaveLength(0);
  });

  it("handles quoted, single-quoted, and unquoted attributes", () => {
    const text = `
<codascope_action type="navigate" view='wiki' topic=auth-flow>
  Navigate to wiki page
</codascope_action>
`;
    const actions = extractActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].attributes.view).toBe("wiki");
    expect(actions[0].attributes.topic).toBe("auth-flow");
  });

  it("removes type from attributes object (promoted to top-level)", () => {
    const text = `
<codascope_action type="explore_codebase">
  Explore the codebase
</codascope_action>
`;
    const actions = extractActions(text);
    expect(actions[0].attributes).not.toHaveProperty("type");
  });

  it("returns empty array for empty string", () => {
    expect(extractActions("")).toEqual([]);
  });

  it("returns empty array for text with no tags", () => {
    expect(extractActions("Hello, this is just normal text.")).toEqual([]);
  });

  it("handles multiline descriptions", () => {
    const text = `
<codascope_action type="build_wiki_page" topic="api-layer">
  Build a wiki page for the API layer.
  Include endpoint definitions and middleware chain.
</codascope_action>
`;
    const actions = extractActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].description).toContain("Include endpoint definitions");
  });

  it("all valid action types are recognized", () => {
    for (const type of VALID_ACTION_TYPES) {
      const text = `<codascope_action type="${type}">desc</codascope_action>`;
      const actions = extractActions(text);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe(type);
    }
  });
});

describe("stripActionTags", () => {
  it("removes action tags and collapses whitespace", () => {
    const text = `Here is some text.

<codascope_action type="build_wiki_page" topic="auth">
  Build a wiki page
</codascope_action>

More text after.`;

    const result = stripActionTags(text);
    expect(result).not.toContain("codascope_action");
    expect(result).toContain("Here is some text.");
    expect(result).toContain("More text after.");
    // Should not have triple+ newlines
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("returns empty string for empty input", () => {
    expect(stripActionTags("")).toBe("");
  });

  it("returns text unchanged when no tags present", () => {
    const text = "Just some regular text.";
    expect(stripActionTags(text)).toBe(text);
  });

  it("strips multiple tags", () => {
    const text = `
<codascope_action type="navigate" view="wiki">Go to wiki</codascope_action>
Hello
<codascope_action type="run_quality_scan">Scan</codascope_action>
`;
    const result = stripActionTags(text);
    expect(result).toBe("Hello");
  });
});
