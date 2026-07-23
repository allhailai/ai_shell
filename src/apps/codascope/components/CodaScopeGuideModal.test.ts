import { describe, expect, it } from "vitest";
import { DESIGN_DOCUMENT_GUIDE_COPY } from "./CodaScopeGuideModal.js";

describe("CodaScope design-document guide contract", () => {
  it("presents context-specific documents and archetype examples without a picker promise", () => {
    const copy = [
      DESIGN_DOCUMENT_GUIDE_COPY.description,
      ...DESIGN_DOCUMENT_GUIDE_COPY.archetypes,
      DESIGN_DOCUMENT_GUIDE_COPY.refinement,
    ].join(" ");

    expect(copy).toContain("freeform, context-specific design document");
    expect(copy).toContain("API specifications");
    expect(copy).toContain("system designs");
    expect(copy).toContain("data models");
    expect(copy).toContain("user flows");
    expect(copy).not.toMatch(/template|picker|catalog|selectable/i);
    for (const obsoleteId of ["api-spec", "data-model", "system-design", "user-flow"]) {
      expect(copy).not.toContain(obsoleteId);
    }
  });
});
