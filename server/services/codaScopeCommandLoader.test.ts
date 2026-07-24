/* ── CodaScope: Command Loader Tests ─────────────────────────────────
   Unit tests for codaScopeCommandLoader.ts — validates variable
   substitution, template loading, and the command/skill resolution chain.
   ──────────────────────────────────────────────────────────────────── */

import { describe, it, expect } from "vitest";
import { buildBaseVars, substituteVars, loadCommandTemplate, loadCommandOrSkill } from "./codaScopeCommandLoader.js";

describe("substituteVars", () => {
  it("replaces known variables", () => {
    const template = "Hello {{NAME}}, welcome to {{PROJECT}}.";
    const result = substituteVars(template, { NAME: "Alice", PROJECT: "CodaScope" });
    expect(result).toBe("Hello Alice, welcome to CodaScope.");
  });

  it("preserves unknown variables as-is", () => {
    const template = "{{KNOWN}} and {{UNKNOWN}}";
    const result = substituteVars(template, { KNOWN: "resolved" });
    expect(result).toBe("resolved and {{UNKNOWN}}");
  });

  it("handles empty vars object", () => {
    const template = "{{A}} {{B}}";
    const result = substituteVars(template, {});
    expect(result).toBe("{{A}} {{B}}");
  });

  it("handles template with no variables", () => {
    const template = "Just plain text.";
    const result = substituteVars(template, { FOO: "bar" });
    expect(result).toBe("Just plain text.");
  });

  it("handles empty template", () => {
    expect(substituteVars("", { A: "B" })).toBe("");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const template = "{{X}} and {{X}} again";
    const result = substituteVars(template, { X: "value" });
    expect(result).toBe("value and value again");
  });

  it("only matches word characters in variable names", () => {
    // {{NOT-VALID}} should not match (hyphen not a word char)
    const template = "{{VALID}} and {{NOT-VALID}}";
    const result = substituteVars(template, { VALID: "yes" });
    expect(result).toBe("yes and {{NOT-VALID}}");
  });

  it("handles multiline templates", () => {
    const template = "Line 1: {{A}}\nLine 2: {{B}}\nLine 3: {{C}}";
    const result = substituteVars(template, { A: "alpha", B: "beta", C: "gamma" });
    expect(result).toBe("Line 1: alpha\nLine 2: beta\nLine 3: gamma");
  });
});

describe("loadCommandTemplate", () => {
  it("returns a string for known framework commands", () => {
    const template = loadCommandTemplate("do_chat");
    expect(template).not.toBeNull();
    expect(typeof template).toBe("string");
    expect(template!.length).toBeGreaterThan(0);
  });

  it("returns null for non-existent commands", () => {
    const template = loadCommandTemplate("do_nonexistent_command_xyz");
    expect(template).toBeNull();
  });

  it("template contains expected variable placeholders", () => {
    const template = loadCommandTemplate("do_chat");
    if (template) {
      // do_chat.md should have at least USER_MESSAGE placeholder
      expect(template).toContain("{{USER_MESSAGE}}");
    }
  });

  it("describes design-document archetypes and the executable creation workflow", () => {
    const prompt = loadCommandTemplate("do_chat");
    expect(prompt).not.toBeNull();

    expect(prompt).toContain("document archetypes");
    expect(prompt).toContain("Read the current epic definition and scope");
    expect(prompt).toContain("Draft substantial, complete markdown");
    expect(prompt).toContain("create_design_doc(epicId, title, content)");
    expect(prompt).toContain("explicit creation request authorizes this write tool");
    expect(prompt).not.toMatch(/available templates|selectable templates/i);
    for (const obsoleteId of ["api-spec", "data-model", "system-design", "user-flow"]) {
      expect(prompt).not.toContain(obsoleteId);
    }
  });

  it("keeps the full-document editing prompt hash-protected", () => {
    const prompt = loadCommandTemplate("do_chat");
    expect(prompt).not.toBeNull();

    expect(prompt).toContain("read_design_doc(epicId, docId)");
    expect(prompt).toContain("exact current `contentHash`");
    expect(prompt).toContain(
      "edit_design_doc(epicId, docId, content, editSummary, expectedContentHash)",
    );
    expect(prompt).toContain("pass the exact `contentHash` from the read that supplied");
    expect(prompt).toMatch(
      /concurrent-modification conflict,\s+re-read the document and reconsider/i,
    );
    expect(prompt).not.toContain(
      "edit_design_doc(epicId, docId, content, editSummary)",
    );
  });
});

describe("loadCommandOrSkill", () => {
  it("loads framework command when no project override exists", () => {
    // Use a temp dir that definitely has no skills/ subdirectory
    const result = loadCommandOrSkill("do_chat", "/tmp/nonexistent-project-dir", {
      USER_MESSAGE: "Hello",
      PROJECT_MANIFEST: "manifest",
      CONVERSATION_HISTORY: "history",
      VIEW_CONTEXT: "context",
    });
    expect(result).not.toBeNull();
    expect(result).toContain("Hello"); // USER_MESSAGE was substituted
  });

  it("returns null for unknown command with no project override", () => {
    const result = loadCommandOrSkill("do_totally_unknown_xyz", "/tmp/nonexistent", {});
    expect(result).toBeNull();
  });
});

describe("buildBaseVars", () => {
  it("does not expose configured repository filesystem paths to build prompts", () => {
    const vars = buildBaseVars({
      projectName: "Core",
      projectDir: "/tmp/codascope-project-context",
      repositories: [{ name: "core", path: "/private/source-repositories/core" }],
    });

    expect(vars.REPOSITORIES).toContain("core");
    expect(vars.REPOSITORIES).not.toContain("/private/source-repositories/core");
  });
});
