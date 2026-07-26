import { describe, expect, it } from "vitest";
import {
  WORKSPACE_ASSISTANT_SCOPE,
  assistantScopeKey,
  projectAssistantScope,
} from "./codaScopeAssistantScope.js";

describe("CodaScope assistant scope", () => {
  it("uses explicit stable collision-safe keys", () => {
    expect(assistantScopeKey(WORKSPACE_ASSISTANT_SCOPE)).toBe("workspace");
    expect(assistantScopeKey(projectAssistantScope("alpha"))).toBe("project:alpha");
    expect(assistantScopeKey(projectAssistantScope("workspace"))).toBe(
      "project:workspace",
    );
    expect(assistantScopeKey(projectAssistantScope("workspace")))
      .not.toBe(assistantScopeKey(WORKSPACE_ASSISTANT_SCOPE));
  });

  it("validates project IDs through the shared path-safety contract", () => {
    expect(() => projectAssistantScope("../alpha")).toThrow();
    expect(() => assistantScopeKey({
      kind: "project",
      projectId: "/absolute",
    })).toThrow();
  });
});
