import { describe, expect, it, vi } from "vitest";
import {
  streamWorkspaceAssistantResponse,
  WorkspaceAssistantCancelledError,
} from "./codaScopeWorkspaceChatOrchestrator.js";
import { EMPTY_WORKSPACE_TURN_READ_GRANT } from "./codaScopeWorkspaceReadGrant.js";
import { createWorkspaceMessageContext } from "./codaScopeWorkspaceConversationService.js";

function fixture() {
  const send = vi.fn((options: any) => {
    options.onMessage({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Answer" }],
      },
    });
    options.onDone(
      { usage: { totalTokens: 4 } },
      [{
        kind: "project_wiki",
        retrieval: "direct",
        projectId: "alpha",
        projectName: "Alpha",
        topicId: "architecture",
        topicTitle: "Architecture",
        topicUpdatedAt: "2026-01-01T00:00:00.000Z",
        lastWikiBuildAt: null,
      }],
    );
  });
  const catalog = {
    getWorkspaceStatus: vi.fn(async () => ({
      activeProjectCount: 1,
      projectsWithWiki: 1,
      projectsBuilding: 0,
      lastWikiBuildAt: null,
      lastDeepRunAt: null,
    })),
    listActiveProjects: vi.fn(async () => [{
      projectId: "alpha",
      name: "Alpha",
      description: "",
      repositoryCount: 1,
      hasWiki: true,
      substantiveWikiTopicCount: 2,
      currentBuildStatus: "idle",
      lastWikiBuildAt: null,
      lastDeepRunAt: null,
      lastBuildAttemptAt: null,
      lastBuildAttemptStatus: null,
      lastBuildError: null,
    }]),
  };
  const intentService = {
    resolveTurn: vi.fn(async () => ({
      intent: "wiki_first",
      resolvedProjectIds: ["alpha"],
      grant: EMPTY_WORKSPACE_TURN_READ_GRANT,
    })),
  };
  return { send, catalog, intentService };
}

describe("workspace chat orchestrator", () => {
  it("assembles one user payload with bounded history/context and returns provenance", async () => {
    const { send, catalog, intentService } = fixture();
    const context = createWorkspaceMessageContext({
      explicitlyReferencedProjectIds: ["alpha"],
      currentView: { view: "wiki", identity: "architecture" },
    });
    const result = await streamWorkspaceAssistantResponse({
      actorId: "alice",
      message: "Compare architecture",
      modelId: "model",
      context,
      history: [{
        id: "prior",
        role: "user",
        content: "Earlier request",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: null,
        modelId: null,
        status: "complete",
        context,
        metadata: {},
      }],
      catalog: catalog as any,
      intentService: intentService as any,
      agentService: { send } as any,
      onMessage: vi.fn(),
    });

    const sent = send.mock.calls[0][0];
    expect(sent).toMatchObject({
      scope: { kind: "workspace" },
      purpose: "workspace-assistant",
      actorId: "alice",
      message: "Compare architecture",
      workspaceReadGrant: EMPTY_WORKSPACE_TURN_READ_GRANT,
    });
    expect(sent.systemPrompt).toContain("Earlier request");
    expect(sent.systemPrompt).toContain("Current view: wiki");
    expect(sent.systemPrompt).not.toContain("Compare architecture");
    expect(result.fullResponse).toBe("Answer");
    expect(result.retrievedSources).toEqual([
      expect.objectContaining({ kind: "project_wiki", topicId: "architecture" }),
    ]);
  });

  it("maps only deliberate agent cancellation to a cancelled outcome", async () => {
    const { catalog, intentService } = fixture();
    const send = vi.fn((options: any) => {
      options.onError(new Error("Agent cancelled by user."));
    });

    await expect(streamWorkspaceAssistantResponse({
      actorId: "alice",
      message: "Question",
      modelId: "model",
      context: createWorkspaceMessageContext(undefined),
      history: [],
      catalog: catalog as any,
      intentService: intentService as any,
      agentService: { send } as any,
      onMessage: vi.fn(),
    })).rejects.toBeInstanceOf(WorkspaceAssistantCancelledError);
  });

  it("sanitizes workspace agent failures", async () => {
    const { catalog, intentService } = fixture();
    const send = vi.fn((options: any) => {
      options.onError(new Error("/private/repository/sdk-secret"));
    });

    await expect(streamWorkspaceAssistantResponse({
      actorId: "alice",
      message: "Question",
      modelId: "model",
      context: createWorkspaceMessageContext(undefined),
      history: [],
      catalog: catalog as any,
      intentService: intentService as any,
      agentService: { send } as any,
      onMessage: vi.fn(),
    })).rejects.toMatchObject({
      message: "Workspace assistant run failed.",
      fullResponse: "",
    });
  });
});
