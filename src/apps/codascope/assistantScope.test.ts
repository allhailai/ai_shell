import { describe, expect, it } from "vitest";
import {
  buildWorkspaceMessageContext,
  canUseProjectMentions,
  getAssistantRestorationKey,
  getAssistantScopeKey,
  resolveAssistantScope,
  rootNoteMatchesRoute,
} from "./assistantScope";
import { createAssistantEndpointAdapter } from "./assistantConversationApi";

describe("assistant scope resolution", () => {
  it.each([
    { segments: ["project", "alpha", "dashboard"], projectId: "alpha" },
    { segments: ["project", "alpha", "wiki", "auth"], projectId: "alpha" },
    {
      segments: ["project", "alpha", "notes", "codascope", "shared"],
      projectId: "alpha",
    },
    {
      segments: ["project", "alpha", "epic", "epic-1", "design"],
      projectId: "alpha",
    },
  ])("resolves $segments as project scope", ({ segments, projectId }) => {
    expect(resolveAssistantScope(segments)).toEqual({
      kind: "project",
      projectId,
    });
  });

  it.each([
    { segments: [] },
    { segments: ["projects"] },
    { segments: ["notes", "shared"] },
    { segments: ["notes", "private", "planning", "roadmap"] },
    { segments: ["settings"] },
  ])("resolves non-project route $segments as workspace scope", ({ segments }) => {
    expect(resolveAssistantScope(segments)).toEqual({ kind: "workspace" });
  });

  it("uses stable, separate scope and restoration keys", () => {
    expect(getAssistantScopeKey({ kind: "workspace" })).toBe("workspace");
    expect(getAssistantScopeKey({ kind: "project", projectId: "alpha" }))
      .toBe("project:alpha");
    expect(getAssistantRestorationKey({ kind: "workspace" }))
      .toBe("codascope:lastConv:workspace");
    expect(getAssistantRestorationKey({
      kind: "project",
      projectId: "alpha",
    })).toBe("codascope:lastConv:alpha");
  });
});

describe("assistant endpoint adapter", () => {
  it.each([
    {
      scope: { kind: "workspace" } as const,
      base: "/api/codascope/workspace/conversations",
      cancel: "/api/codascope/workspace/assistant/cancel",
    },
    {
      scope: { kind: "project", projectId: "alpha" } as const,
      base: "/api/codascope/projects/alpha/conversations",
      cancel: "/api/codascope/projects/alpha/assistant/cancel",
    },
  ])("builds every $scope.kind operation", ({ scope, base, cancel }) => {
    const endpoints = createAssistantEndpointAdapter(scope);
    expect(endpoints.listConversations()).toBe(base);
    expect(endpoints.createConversation()).toBe(base);
    expect(endpoints.readConversation("conv-1")).toBe(`${base}/conv-1`);
    expect(endpoints.updateConversation("conv-1")).toBe(`${base}/conv-1`);
    expect(endpoints.deleteConversation("conv-1")).toBe(`${base}/conv-1`);
    expect(endpoints.sendMessage("conv-1"))
      .toBe(`${base}/conv-1/messages`);
    expect(endpoints.uploadImage("conv-1"))
      .toBe(`${base}/conv-1/images`);
    expect(endpoints.displayImage("conv-1", "image.png"))
      .toBe(`${base}/conv-1/images/image.png`);
    expect(endpoints.cancelRun()).toBe(cancel);
  });

  it("preserves the legacy project URL family exactly", () => {
    const endpoints = createAssistantEndpointAdapter({
      kind: "project",
      projectId: "project-with-dashes",
    });
    expect(endpoints.sendMessage("2026_01_conv"))
      .toBe(
        "/api/codascope/projects/project-with-dashes/conversations/2026_01_conv/messages",
      );
  });
});

describe("workspace message context", () => {
  const note = {
    stableId: "note-1",
    scope: "codascope" as const,
    path: "planning/roadmap.md",
    title: "Roadmap",
    visibility: "private" as const,
    contentHash: "sha256:abc",
  };

  it("snapshots matching root-note metadata without a note body", () => {
    const context = buildWorkspaceMessageContext(
      ["notes", "private", "planning", "roadmap"],
      note,
    );
    expect(context).toEqual({
      assistantScope: { kind: "workspace" },
      currentNote: note,
      explicitlyReferencedProjectIds: [],
      currentView: {
        view: "notes",
        identity: "codascope:private:planning/roadmap",
        label: "Roadmap",
      },
    });
    expect(JSON.stringify(context)).not.toContain("body");
  });

  it("does not carry stale note metadata to another route", () => {
    expect(rootNoteMatchesRoute(note, ["projects"])).toBe(false);
    expect(buildWorkspaceMessageContext(["projects"], note)).toEqual({
      assistantScope: { kind: "workspace" },
      explicitlyReferencedProjectIds: [],
      currentView: {
        view: "projects",
        identity: "projects",
        label: "Projects",
      },
    });
  });

  it("suppresses project mentions in workspace scope", () => {
    expect(canUseProjectMentions({ kind: "workspace" })).toBe(false);
    expect(canUseProjectMentions({
      kind: "project",
      projectId: "alpha",
    })).toBe(true);
  });
});
