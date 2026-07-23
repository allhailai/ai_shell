import { describe, expect, it } from "vitest";
import { formatViewContext } from "./codaScopeChatPromptHelpers.js";

describe("formatViewContext design-document contract", () => {
  it("describes archetypes and the real creation workflow without a selectable catalog", () => {
    const context = formatViewContext({
      view: "epic",
      epicId: "epic-1",
      epicTitle: "Reliable Scheduling",
      epicTab: "design",
      projectName: "Core",
    });

    expect(context).toContain("design-document archetypes");
    expect(context).toContain("read the current epic and research context");
    expect(context).toContain("draft substantial complete markdown");
    expect(context).toContain("create_design_doc(epicId, title, content)");
    expect(context).toContain("no selectable design-document catalog or picker");
    expect(context).not.toMatch(/available templates|selectable templates/i);
    for (const obsoleteId of ["api-spec", "data-model", "system-design", "user-flow"]) {
      expect(context).not.toContain(obsoleteId);
    }
  });
});
