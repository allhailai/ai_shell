import { describe, expect, it } from "vitest";
import {
  WORKSPACE_MANIFEST_MAX_CHARS,
  buildWorkspaceAssistantPrompt,
  buildWorkspaceManifest,
} from "./codaScopeWorkspaceChatPromptHelpers.js";

const status = {
  activeProjectCount: 3,
  projectsWithWiki: 2,
  projectsBuilding: 1,
  lastWikiBuildAt: "2026-07-25T10:00:00.000Z",
  lastDeepRunAt: "2026-07-24T09:00:00.000Z",
};

function project(projectId: string, name: string, description = "Description") {
  return {
    projectId,
    name,
    description,
    repositoryCount: 2,
    hasWiki: true,
    substantiveWikiTopicCount: 5,
    currentBuildStatus: "idle" as const,
    lastWikiBuildAt: "2026-07-25T10:00:00.000Z",
    lastDeepRunAt: "2026-07-24T09:00:00.000Z",
    lastBuildAttemptAt: "2026-07-25T10:00:00.000Z",
    lastBuildAttemptStatus: "complete" as const,
    lastBuildError: null,
  };
}

describe("workspace manifest", () => {
  it("is deterministic, bounded, progressive, and path-free", () => {
    const projects = [
      project("zeta", "Zeta", "Checkout /opt/company/zeta and C:\\repos\\zeta"),
      project("alpha", "Alpha"),
      project("beta", "Beta"),
    ];
    const first = buildWorkspaceManifest({
      status,
      projects,
      maxProjects: 2,
    });
    const second = buildWorkspaceManifest({
      status,
      projects: [...projects].reverse(),
      maxProjects: 2,
    });

    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(WORKSPACE_MANIFEST_MAX_CHARS);
    expect(first).toContain("Project summaries truncated: yes");
    expect(first).toContain("use `list_projects`");
    expect(first.indexOf("Alpha [alpha]")).toBeLessThan(first.indexOf("Beta [beta]"));
    expect(first).not.toContain("Zeta [zeta]");
    expect(first).not.toContain("/opt/company/zeta");
    expect(first).not.toContain("C:\\repos\\zeta");
    expect(first).not.toMatch(/repository name|source content/i);
  });

  it("preserves distinct wiki, Deep Run, and current build state", () => {
    const manifest = buildWorkspaceManifest({
      status,
      projects: [project("alpha", "Alpha")],
    });
    expect(manifest).toContain("Projects with substantive wiki: 2");
    expect(manifest).toContain(
      "Latest successful wiki publication: 2026-07-25T10:00:00.000Z",
    );
    expect(manifest).toContain(
      "Latest successful Deep Run: 2026-07-24T09:00:00.000Z",
    );
    expect(manifest).toContain("latest attempt: complete");
    expect(manifest).toContain("Project summaries truncated: no");
  });
});

describe("workspace prompt", () => {
  it("requires wiki-first provenance/freshness and refuses repository source access", () => {
    const prompt = buildWorkspaceAssistantPrompt("MANIFEST", "Compare them");
    expect(prompt).toContain("CodaScope Workspace Assistant");
    expect(prompt).toMatch(/progressive retrieval/i);
    expect(prompt).toMatch(/search project wikis first/i);
    expect(prompt).toMatch(/Attribute every factual claim by project and wiki topic/i);
    expect(prompt).toMatch(/freshness|timestamps/i);
    expect(prompt).toMatch(/Preserve disagreements/i);
    expect(prompt).toMatch(/stale/i);
    expect(prompt).toMatch(/Repository source contents are unavailable/i);
    expect(prompt).toMatch(/Never claim.*source files/i);
    expect(prompt).toMatch(/server-generated grant/i);
    expect(prompt).toMatch(/Archived projects, epics, and designs are unavailable/i);
    expect(prompt).toMatch(/No project-side mutation/i);
    expect(prompt).toMatch(/note behavior is intentionally deferred/i);
    expect(prompt).toContain("MANIFEST");
    expect(prompt).toContain("Compare them");
  });
});
