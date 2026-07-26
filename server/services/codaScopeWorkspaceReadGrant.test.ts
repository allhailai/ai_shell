import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_WORKSPACE_TURN_READ_GRANT,
  WorkspaceTurnReadGrantHolder,
  hasWorkspaceEpicCapability,
  hasWorkspaceEpicDiscoveryGrant,
  hasWorkspaceResourceGrant,
  validateWorkspaceTurnReadGrant,
} from "./codaScopeWorkspaceReadGrant.js";

function activeResolver() {
  return {
    resolveActiveProject: vi.fn(async (projectId: string) => (
      projectId.startsWith("active") ? { projectId } : null
    )),
    resolveActiveEpic: vi.fn(async (projectId: string, epicId: string) => (
      projectId.startsWith("active") && epicId.startsWith("epic-active")
        ? { project: { projectId }, epic: { id: epicId } }
        : null
    )),
    resolveActiveDesign: vi.fn(
      async (projectId: string, epicId: string, designId: string) => (
        projectId.startsWith("active")
        && epicId.startsWith("epic-active")
        && designId.startsWith("design-active")
          ? { project: { projectId }, epic: { id: epicId }, document: { id: designId } }
          : null
      ),
    ),
  };
}

describe("workspace per-turn read grants", () => {
  it("strictly normalizes, merges, freezes, and authorizes explicit resources", async () => {
    const resolver = activeResolver();
    const grant = await validateWorkspaceTurnReadGrant({
      epicDiscoveryProjectIds: ["active-beta", "active-alpha", "active-alpha"],
      epicResources: [
        {
          projectId: "active-alpha",
          epicId: "epic-active-1",
          capabilities: ["definition", "designs"],
          designIds: ["design-active-2", "design-active-1"],
        },
        {
          projectId: "active-alpha",
          epicId: "epic-active-1",
          capabilities: ["knowledge", "research", "definition"],
          knowledgePageIds: ["knowledge-1"],
          researchSourceIds: ["source-1"],
        },
      ],
    }, resolver as any);

    expect(grant.epicDiscoveryProjectIds).toEqual([
      "active-alpha",
      "active-beta",
    ]);
    expect(grant.epicResources).toHaveLength(1);
    expect(grant.epicResources[0].capabilities).toEqual([
      "definition",
      "designs",
      "knowledge",
      "research",
    ]);
    expect(Object.isFrozen(grant)).toBe(true);
    expect(Object.isFrozen(grant.epicResources[0])).toBe(true);
    expect(hasWorkspaceEpicDiscoveryGrant(grant, "active-alpha")).toBe(true);
    expect(hasWorkspaceEpicCapability(
      grant,
      "active-alpha",
      "epic-active-1",
      "definition",
    )).toBe(true);
    expect(hasWorkspaceResourceGrant(
      grant,
      "active-alpha",
      "epic-active-1",
      "designs",
      "design-active-1",
    )).toBe(true);
    expect(hasWorkspaceResourceGrant(
      grant,
      "active-alpha",
      "epic-active-1",
      "designs",
      "design-ungranted",
    )).toBe(false);
  });

  it("fails closed for unknown fields, capabilities, unsafe IDs, and inactive entities", async () => {
    const resolver = activeResolver();
    const base = {
      epicDiscoveryProjectIds: ["active-alpha"],
      epicResources: [],
    };
    await expect(validateWorkspaceTurnReadGrant(
      { ...base, justification: "please" },
      resolver as any,
    )).rejects.toMatchObject({ code: "invalid_input" });
    await expect(validateWorkspaceTurnReadGrant({
      ...base,
      epicResources: [{
        projectId: "active-alpha",
        epicId: "epic-active-1",
        capabilities: ["definition", "mutation"],
      }],
    }, resolver as any)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(validateWorkspaceTurnReadGrant({
      ...base,
      epicResources: [{
        projectId: "active-alpha",
        epicId: "../escape",
        capabilities: ["definition"],
      }],
    }, resolver as any)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(validateWorkspaceTurnReadGrant({
      epicDiscoveryProjectIds: ["archived-project"],
      epicResources: [],
    }, resolver as any)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(validateWorkspaceTurnReadGrant({
      ...base,
      epicResources: [{
        projectId: "active-alpha",
        epicId: "epic-archived",
        capabilities: ["definition"],
      }],
    }, resolver as any)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(validateWorkspaceTurnReadGrant({
      ...base,
      epicResources: [{
        projectId: "active-alpha",
        epicId: "epic-active-1",
        capabilities: ["designs"],
        designIds: ["design-archived"],
      }],
    }, resolver as any)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("clears a stable holder back to the immutable empty grant", async () => {
    const grant = await validateWorkspaceTurnReadGrant({
      epicDiscoveryProjectIds: ["active-alpha"],
      epicResources: [],
    }, activeResolver() as any);
    const holder = new WorkspaceTurnReadGrantHolder();
    expect(holder.current).toBe(EMPTY_WORKSPACE_TURN_READ_GRANT);
    holder.replace(grant);
    expect(holder.current).toBe(grant);
    holder.clear();
    expect(holder.current).toBe(EMPTY_WORKSPACE_TURN_READ_GRANT);
  });
});
