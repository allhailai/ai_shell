import { describe, expect, it, vi } from "vitest";
import { runResearchPipeline } from "./codaScopeResearchOrchestrator";

describe("research SSE failure propagation", () => {
  it("rethrows an orchestrator failure so the route cannot emit done", async () => {
    const sendEvent = vi.fn();
    await expect(runResearchPipeline({
      projectId: "project",
      epicId: "epic",
      modelId: "model",
      actorId: "alice",
      topics: ["security"],
    }, {
      sendEvent,
      sendMessage: vi.fn(),
      isAborted: () => false,
    }, {
      projectSvc: {
        getProjectDir: () => null,
        getProject: vi.fn(async () => { throw new Error("research setup failed"); }),
      },
      epicKnowledgeSvc: {},
      agentSvc: {},
      epicSvc: {},
      curationSvc: {},
      contentSvc: {},
      secretSvc: {},
    } as never)).rejects.toThrow("research setup failed");

    expect(sendEvent).toHaveBeenCalledWith("research-error", {
      error: "research setup failed",
    });
    expect(sendEvent).not.toHaveBeenCalledWith("done", expect.anything());
  });
});
