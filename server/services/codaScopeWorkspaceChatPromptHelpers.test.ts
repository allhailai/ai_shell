import { describe, expect, it } from "vitest";
import {
  WORKSPACE_MANIFEST_MAX_CHARS,
  buildWorkspaceAssistantPrompt,
  buildWorkspaceManifest,
  formatWorkspaceConversationHistory,
  formatWorkspaceCurrentContext,
} from "./codaScopeWorkspaceChatPromptHelpers.js";
import { createWorkspaceMessageContext } from "./codaScopeWorkspaceConversationService.js";

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
    expect(prompt).toMatch(/Project\/source\/workspace catalogs remain read-only/i);
    expect(prompt).toMatch(/only mutation capability is for CodaScope-level notes/i);
    expect(prompt).toMatch(/New CodaScope notes default private/i);
    expect(prompt).toMatch(/Read before editing.*contentHash/is);
    expect(prompt).toMatch(/this note.*validated current note/is);
    expect(prompt).toMatch(/Mutation authority is consumable/i);
    expect(prompt).toMatch(/server-confirmed trusted receipt/i);
    expect(prompt).toMatch(/reads are complete but bounded/i);
    expect(prompt).toMatch(/Permanent deletion, restore, arbitrary moves.*unavailable/is);
    expect(prompt).toContain("MANIFEST");
    expect(prompt).toContain("Compare them");
  });

  it("injects the exact current target while historical provenance grants no implied capability", () => {
    const target = {
      kind: "note-range" as const,
      stableId: "note-1",
      scope: "codascope" as const,
      visibility: "private" as const,
      path: "planning/one.md",
      title: "One",
      selectionStart: 6,
      selectionEnd: 18,
      selectedText: "first\nsecond",
      startLine: 2,
      endLine: 3,
      expectedHash: "a".repeat(32),
    };
    const context = createWorkspaceMessageContext({
      currentNote: {
        stableId: target.stableId,
        scope: target.scope,
        visibility: target.visibility,
        path: target.path,
        title: target.title,
        contentHash: target.expectedHash,
      },
      currentView: { view: "notes", identity: target.stableId },
    });
    const current = formatWorkspaceCurrentContext(context, target);
    expect(current).toContain("Exact current-turn CodaScope note edit target");
    expect(current).toContain("planning/one.md");
    expect(current).toContain("Display line range: 2-3");
    expect(current).toContain("first\nsecond");
    expect(current).toContain("server-held exact target is authoritative");
    expect(current).toContain("Do not rewrite the full note");
    expect(current).toContain("ask one concise question");

    const history = formatWorkspaceConversationHistory([{
      id: "prior",
      role: "user",
      content: "Do that",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: null,
      modelId: null,
      status: "complete",
      context,
      metadata: { noteRangeTarget: target },
    }]);
    expect(history).toContain("historical exact note-range target");
    expect(history).toContain("lines 2-3");
    expect(history).toContain('selected "first second"');
  });
});
