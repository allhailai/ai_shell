import { describe, expect, it, vi } from "vitest";

vi.mock("./codaScopeCommandLoader.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./codaScopeCommandLoader.js")>();
  return { ...original, loadCommandOrSkill: () => "Agent prompt" };
});

import { runResearchPipeline } from "./codaScopeResearchOrchestrator.js";
import { runCurationPipeline } from "./codaScopeCurationOrchestrator.js";

const callbacks = {
  sendEvent: vi.fn(),
  sendMessage: vi.fn(),
  isAborted: () => false,
};

function agentService(send: ReturnType<typeof vi.fn>) {
  return { send };
}

describe("epic annotation actor propagation through nested orchestrators", () => {
  it("passes the research initiating actor to agentSvc.send", async () => {
    const send = vi.fn((options: Record<string, any>) => {
      options.onMessage({
        type: "assistant",
        message: { content: [{ type: "text", text: '{"queries":[]}' }] },
      });
      options.onDone({});
    });
    await runResearchPipeline(
      { projectId: "project", epicId: "epic", modelId: "model", actorId: "alice", topics: ["security"] },
      callbacks,
      {
        agentSvc: agentService(send) as never,
        projectSvc: {
          getProject: async () => ({ name: "Project", repositories: [] }),
          getProjectDir: () => "/tmp/project",
        } as never,
        epicSvc: {
          getEpic: async () => ({ title: "Epic", definition: "# Epic", scope: { entries: [] } }),
        } as never,
        epicKnowledgeSvc: {
          initializeKnowledgeDir: vi.fn(),
          getEpicDirForInit: () => "/tmp/project/epics/epic",
          listEpicWikiPages: async () => [],
          listSources: async () => [],
          addResearchLogEntry: async () => ({}),
        } as never,
        curationSvc: {} as never,
        contentSvc: {} as never,
        secretSvc: {} as never,
      },
    );

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ purpose: "research", actorId: "alice" }));
  });

  it("passes the curation initiating actor to agentSvc.send", async () => {
    const send = vi.fn((options: Record<string, any>) => {
      options.onMessage({ type: "assistant", message: { content: [{ type: "text", text: "Curated" }] } });
      options.onDone({});
    });
    await runCurationPipeline(
      { projectId: "project", epicId: "epic", modelId: "model", actorId: "alice" },
      callbacks,
      {
        agentSvc: agentService(send) as never,
        projectSvc: {
          getProject: async () => ({ name: "Project", repositories: [] }),
          getProjectDir: () => "/tmp/project",
        } as never,
        wikiSvc: { listTopics: async () => [] } as never,
        epicSvc: {
          getEpic: async () => ({ title: "Epic", status: "designing", definition: "# Epic", scope: { entries: [] } }),
        } as never,
        epicKnowledgeSvc: {
          listEpicWikiPages: async () => [],
          listSources: async () => [],
        } as never,
        curationSvc: {
          clearReasons: async () => [],
          createLog: async () => ({ curationId: "curation" }),
          updateLog: vi.fn(async () => undefined),
        } as never,
        codeMapSvc: {} as never,
      },
    );

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ purpose: "curation", actorId: "alice" }));
  });
});
