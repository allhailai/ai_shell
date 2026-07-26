import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  appendWorkspaceProjectReference,
  filterWorkspaceProjectReferences,
  moveWorkspaceProjectPickerIndex,
  removeWorkspaceProjectReference,
  WorkspaceProjectReferencePicker,
  WORKSPACE_PROJECT_REFERENCE_MAX,
} from "./WorkspaceProjectReferencePicker";

const projects = [
  { projectId: "alpha", name: "Alpha", description: "Payments" },
  { projectId: "beta", name: "Beta", description: "Alpha in description" },
  { projectId: "gamma", name: "Gamma", description: "" },
];

describe("WorkspaceProjectReferencePicker behavior", () => {
  it("renders a workspace-only active-project loading surface", () => {
    const html = renderToStaticMarkup(createElement(
      WorkspaceProjectReferencePicker,
      {
        scopeKey: "workspace",
        selectedProjectIds: [],
        onSelect: vi.fn(),
        onClose: vi.fn(),
      },
    ));

    expect(html).toContain("Reference an active project");
    expect(html).toContain("Search active projects");
    expect(html).toContain("Loading active projects");
    expect(html).toContain(`0/${WORKSPACE_PROJECT_REFERENCE_MAX}`);
    expect(html).not.toContain("Wiki Pages");
    expect(html).not.toContain("Code Files");
    expect(html).not.toContain("Research Sources");
  });

  it("searches by active project name and suppresses selected duplicates", () => {
    expect(filterWorkspaceProjectReferences(
      projects,
      [],
      "ALP",
    )).toEqual([projects[0]]);
    expect(filterWorkspaceProjectReferences(
      projects,
      ["alpha"],
      "",
    )).toEqual([projects[1], projects[2]]);
    expect(filterWorkspaceProjectReferences(
      projects,
      [],
      "payments",
    )).toEqual([]);
  });

  it("wraps arrow-key navigation deterministically", () => {
    expect(moveWorkspaceProjectPickerIndex(0, 3, 1)).toBe(1);
    expect(moveWorkspaceProjectPickerIndex(2, 3, 1)).toBe(0);
    expect(moveWorkspaceProjectPickerIndex(0, 3, -1)).toBe(2);
    expect(moveWorkspaceProjectPickerIndex(0, 0, -1)).toBe(0);
  });

  it("suppresses duplicates, enforces 25 references, and removes by ID", () => {
    expect(appendWorkspaceProjectReference(
      [projects[0]],
      projects[0],
    )).toEqual([projects[0]]);

    const full = Array.from(
      { length: WORKSPACE_PROJECT_REFERENCE_MAX },
      (_, index) => ({
        projectId: `project-${index}`,
        name: `Project ${index}`,
        description: "",
      }),
    );
    expect(appendWorkspaceProjectReference(full, projects[0])).toEqual(full);
    expect(removeWorkspaceProjectReference(
      [projects[0], projects[1]],
      "alpha",
    )).toEqual([projects[1]]);
  });
});
