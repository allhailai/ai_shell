import { describe, expect, it, vi } from "vitest";
import {
  isWorkspaceCatalogRequestCurrent,
  loadWorkspaceProjectCatalog,
  normalizeWorkspaceProjectCatalog,
  WORKSPACE_PROJECT_CATALOG_ENDPOINT,
  WORKSPACE_PROJECT_CATALOG_LIMIT,
} from "./workspaceProjectCatalogApi";

function validCatalog(overrides: Record<string, unknown> = {}) {
  return {
    scope: { kind: "workspace" },
    projects: [
      {
        projectId: "zeta",
        name: "Zeta",
        description: "Second",
      },
      {
        projectId: "alpha",
        name: "Alpha",
        description: "First",
      },
    ],
    limit: WORKSPACE_PROJECT_CATALOG_LIMIT,
    truncated: false,
    ...overrides,
  };
}

describe("workspace active-project catalog adapter", () => {
  it("strictly validates and deterministically orders a bounded catalog", () => {
    expect(normalizeWorkspaceProjectCatalog(validCatalog())).toEqual({
      scope: { kind: "workspace" },
      projects: [
        {
          projectId: "alpha",
          name: "Alpha",
          description: "First",
        },
        {
          projectId: "zeta",
          name: "Zeta",
          description: "Second",
        },
      ],
      limit: WORKSPACE_PROJECT_CATALOG_LIMIT,
      truncated: false,
    });
  });

  it.each([
    ["non-object envelope", null],
    ["wrong scope", validCatalog({ scope: { kind: "project", projectId: "alpha" } })],
    ["extra envelope authority", { ...validCatalog(), includeArchived: true }],
    ["wrong limit", validCatalog({ limit: 1 })],
    ["oversized collection", validCatalog({
      projects: Array.from(
        { length: WORKSPACE_PROJECT_CATALOG_LIMIT + 1 },
        (_, index) => ({
          projectId: `project-${index}`,
          name: `Project ${index}`,
          description: "",
        }),
      ),
    })],
    ["duplicate IDs", validCatalog({
      projects: [
        { projectId: "duplicate", name: "One", description: "" },
        { projectId: "duplicate", name: "Two", description: "" },
      ],
    })],
    ["invalid ID", validCatalog({
      projects: [{ projectId: "../alpha", name: "Alpha", description: "" }],
    })],
    ["oversized name", validCatalog({
      projects: [{
        projectId: "alpha",
        name: "x".repeat(301),
        description: "",
      }],
    })],
    ["oversized description", validCatalog({
      projects: [{
        projectId: "alpha",
        name: "Alpha",
        description: "x".repeat(1_001),
      }],
    })],
    ["repository identity", validCatalog({
      projects: [{
        projectId: "alpha",
        name: "Alpha",
        description: "",
        repositories: [],
      }],
    })],
    ["filesystem location", validCatalog({
      projects: [{
        projectId: "alpha",
        name: "Alpha",
        description: "",
        projectPath: "/private/projects/alpha",
      }],
    })],
  ])("rejects the whole response for %s", (_label, value) => {
    expect(normalizeWorkspaceProjectCatalog(value)).toBeNull();
  });

  it("loads only the dedicated workspace endpoint and rejects malformed success", async () => {
    const validFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(validCatalog()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(loadWorkspaceProjectCatalog(validFetch))
      .resolves.toMatchObject({ scope: { kind: "workspace" } });
    expect(validFetch).toHaveBeenCalledWith(
      WORKSPACE_PROJECT_CATALOG_ENDPOINT,
      {},
    );

    const malformedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(validCatalog({
        projects: [{
          projectId: "alpha",
          name: "Alpha",
          description: "",
          repositoryPath: "/private/repository",
        }],
      })), { status: 200 }),
    );
    await expect(loadWorkspaceProjectCatalog(malformedFetch))
      .rejects.toThrow("catalog response was invalid");
  });

  it("rejects stale catalog responses after scope or request changes", () => {
    const request = { scopeKey: "workspace", epoch: 2 };
    expect(isWorkspaceCatalogRequestCurrent(
      request,
      { scopeKey: "workspace", epoch: 2 },
    )).toBe(true);
    expect(isWorkspaceCatalogRequestCurrent(
      request,
      { scopeKey: "project:alpha", epoch: 2 },
    )).toBe(false);
    expect(isWorkspaceCatalogRequestCurrent(
      request,
      { scopeKey: "workspace", epoch: 3 },
    )).toBe(false);
  });
});
