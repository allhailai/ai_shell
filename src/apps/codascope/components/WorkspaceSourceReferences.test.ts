import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  AssistantChatMessage,
  AssistantScope,
  WorkspaceRetrievedSourceReference,
} from "../codaScopeTypes";

vi.mock("../../../shell/useAppSubRoute", () => ({
  useAppSubRoute: () => ({
    segments: [],
    subPath: "",
    getParam: vi.fn(),
    setParam: vi.fn(),
    navigate: vi.fn(),
    replace: vi.fn(),
  }),
}));

import {
  WorkspaceSourceReferences,
  workspaceSourceRoute,
  WORKSPACE_SOURCE_DISPLAY_LIMIT,
} from "./WorkspaceSourceReferences";

const workspaceScope: AssistantScope = { kind: "workspace" };
const wikiSource: WorkspaceRetrievedSourceReference = {
  kind: "project_wiki",
  retrieval: "search",
  projectId: "alpha",
  projectName: "Alpha",
  topicId: "architecture",
  topicTitle: "Architecture",
  topicUpdatedAt: "2026-07-20T12:34:00.000Z",
  lastWikiBuildAt: "2026-07-21T10:00:00.000Z",
};
const codeMapSource: WorkspaceRetrievedSourceReference = {
  kind: "code_map",
  retrieval: "direct",
  projectId: "beta",
  projectName: "Beta",
  codeMapId: "services",
  generatedAt: "2026-07-19T08:00:00.000Z",
  lastWikiBuildAt: null,
};

function persistedMessage(
  sources: WorkspaceRetrievedSourceReference[] = [
    wikiSource,
    codeMapSource,
  ],
): AssistantChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "Answer",
    status: "complete",
    authoritativePersisted: true,
    context: {
      assistantScope: { kind: "workspace" },
      explicitlyReferencedProjectIds: [],
      currentView: { view: "projects" },
      retrievedSources: sources,
    },
    metadata: {},
  };
}

describe("WorkspaceSourceReferences", () => {
  it("renders distinct persisted wiki and code-map provenance with freshness", () => {
    const html = renderToStaticMarkup(createElement(
      WorkspaceSourceReferences,
      { scope: workspaceScope, message: persistedMessage() },
    ));

    expect(html).toContain("Retrieved sources");
    expect(html).toContain("Project wiki");
    expect(html).toContain("Code map");
    expect(html).toContain("Alpha");
    expect(html).toContain("Architecture");
    expect(html).toContain("Beta");
    expect(html).toContain("Code map services");
    expect(html).toContain("Topic updated");
    expect(html).toContain("Generated");
    expect(html).toContain("Last successful wiki build");
    expect(html).toContain('dateTime="2026-07-20T12:34:00.000Z"');
    expect(html).toContain("2026-07-20 12:34 UTC");
    expect(html).toContain("Open source");
    expect(html).not.toContain("repositoryPath");
    expect(html).not.toContain("projectPath");
  });

  it.each([
    ["project scope", { kind: "project", projectId: "alpha" } as AssistantScope, persistedMessage()],
    ["user message", workspaceScope, { ...persistedMessage(), role: "user" as const }],
    ["unverified local message", workspaceScope, {
      ...persistedMessage(),
      authoritativePersisted: false,
    }],
    ["error message", workspaceScope, {
      ...persistedMessage(),
      status: "error" as const,
    }],
    ["message without sources", workspaceScope, persistedMessage([])],
  ])("does not render for %s", (_label, scope, message) => {
    expect(renderToStaticMarkup(createElement(
      WorkspaceSourceReferences,
      { scope, message },
    ))).toBe("");
  });

  it("bounds a large persisted source display", () => {
    const sources = Array.from(
      { length: WORKSPACE_SOURCE_DISPLAY_LIMIT + 3 },
      (_, index): WorkspaceRetrievedSourceReference => ({
        ...codeMapSource,
        projectId: `project-${String(index).padStart(2, "0")}`,
        projectName: `Project ${index}`,
        codeMapId: `map-${index}`,
      }),
    );
    const html = renderToStaticMarkup(createElement(
      WorkspaceSourceReferences,
      { scope: workspaceScope, message: persistedMessage(sources) },
    ));

    expect((html.match(/class="codascope-workspace-source-open"/g) ?? []))
      .toHaveLength(
      WORKSPACE_SOURCE_DISPLAY_LIMIT,
    );
    expect(html).toContain("3 additional persisted sources");
  });

  it("builds only canonical routes with individually encoded segments", () => {
    expect(workspaceSourceRoute({
      ...wikiSource,
      projectId: "project #1",
      topicId: "topic?one",
    })).toBe("project/project%20%231/wiki/topic%3Fone");
    expect(workspaceSourceRoute({
      ...codeMapSource,
      projectId: "project #1",
    })).toBe("project/project%20%231/dashboard");
    expect(workspaceSourceRoute({
      ...wikiSource,
      topicId: "../private",
    })).toBeNull();
    expect(workspaceSourceRoute({
      ...codeMapSource,
      codeMapId: "/private/repository",
    })).toBeNull();
  });
});
