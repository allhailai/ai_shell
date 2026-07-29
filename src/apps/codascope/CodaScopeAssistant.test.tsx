import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  segments: ["notes", "private", "roadmap"] as string[],
  navigate: vi.fn(),
}));
const conversationState = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../shell/useAppSubRoute", () => ({
  useAppSubRoute: () => ({
    segments: routeState.segments,
    subPath: routeState.segments.join("/"),
    getParam: () => null,
    setParam: vi.fn(),
    navigate: routeState.navigate,
    replace: vi.fn(),
  }),
}));

vi.mock("./useCodaScopeStore", () => ({
  useCodaScopeStore: () => ({
    activeProjectId: null,
    projects: [{ id: "alpha", name: "Alpha" }],
    wikiTopics: [],
    epics: [],
  }),
}));

vi.mock("./hooks/useAssistantStream", () => ({
  useAssistantStream: () => ({
    streaming: false,
    streamingContent: "",
    streamMessage: vi.fn(),
    cancelStream: vi.fn(),
    detachActiveRun: vi.fn(),
  }),
}));

vi.mock("./hooks/useConversationManager", () => ({
  useConversationManager: () => ({
    api: {
      endpoints: {
        displayImage: vi.fn(),
      },
      uploadImage: vi.fn(),
    },
    conversations: [],
    activeConversationId: null,
    setActiveConversationId: vi.fn(),
    activeTitle: "New conversation",
    setActiveTitle: vi.fn(),
    messages: conversationState.messages,
    setMessages: vi.fn(),
    loadConversationList: vi.fn(),
    createNewConversation: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    switchConversation: vi.fn(),
  }),
}));

vi.mock("./hooks/useEpicContext", () => ({
  useEpicContext: () => ({
    currentEpicId: null,
    currentEpic: null,
    epicKnowledge: {
      sourceCount: 0,
      wikiPageCount: 0,
      curationReasonCount: 0,
      wikiPageTitles: [],
    },
    curationStatus: { running: false, step: "" },
  }),
}));

vi.mock("../../shell/hooks", () => ({
  useCommandBus: () => ({
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
  }),
}));

vi.mock("./components/ModelPicker", () => ({
  ModelPicker: () => createElement("div", null, "Model picker"),
  useModelPicker: () => ({
    models: [],
    selectedModelId: "model",
    selectModel: vi.fn(),
    loading: false,
  }),
}));

vi.mock("../../shared/rich-chat-input/RichChatInput", () => ({
  RichChatInput: (props: { placeholder: string }) =>
    createElement("textarea", { placeholder: props.placeholder }),
}));

vi.mock("./assistantNoteContext", () => ({
  useRootNoteContext: () => ({
    stableId: "note-1",
    scope: "codascope",
    path: "roadmap.md",
    title: "Roadmap",
    visibility: "private",
    contentHash: "hash",
  }),
}));

vi.mock("./views/ProjectDashboard", () => ({
  openDeepRunModal: vi.fn(),
}));

import { CodaScopeAssistant } from "./CodaScopeAssistant";
import {
  clearNoteRangeHandoff,
  stageNoteRangeHandoff,
} from "./noteRangeHandoff";

const workspaceTarget = {
  kind: "note-range" as const,
  stableId: "note-1",
  scope: "codascope" as const,
  visibility: "private" as const,
  path: "roadmap.md",
  title: "Roadmap",
  selectionStart: 0,
  selectionEnd: 17,
  selectedText: "Do this precisely",
  startLine: 1,
  endLine: 1,
  expectedHash: "a".repeat(64),
};

describe("CodaScopeAssistant scope rendering", () => {
  beforeEach(() => {
    clearNoteRangeHandoff({ kind: "workspace" });
    clearNoteRangeHandoff({ kind: "project", projectId: "alpha" });
    routeState.segments = ["notes", "private", "roadmap"];
    routeState.navigate.mockReset();
    conversationState.messages = [];
  });

  it("renders the workspace assistant and root-note context without activeProjectId", () => {
    const html = renderToStaticMarkup(createElement(CodaScopeAssistant));
    expect(html).toContain("Workspace Assistant");
    expect(html).toContain("Notes by directive");
    expect(html).toContain("Reference active projects");
    expect(html).toContain("focused read-only knowledge");
    expect(html).toContain("only when you explicitly ask");
    expect(html).toContain("Roadmap");
    expect(html).toContain("Private");
    expect(html).toContain("Workspace Overview");
    expect(html).toContain("Message the Workspace Assistant...");
    expect(html).toContain("@ active projects");
    expect(html).not.toContain("Select a project");
    expect(html).not.toContain("Wiki Pages");
    expect(html).not.toContain("Code Files");
  });

  it("renders a persisted created-note card on reload without automatic navigation", () => {
    conversationState.messages = [{
      id: "assistant-server-id",
      role: "assistant",
      content: "Created.",
      status: "complete",
      metadata: {
        actions: [{
          type: "note_created",
          attributes: {
            stableId: "note-1",
            scope: "codascope",
            visibility: "private",
            path: "historical.md",
            title: "Historical title",
            contentHash: "a".repeat(64),
          },
          description: "Created a CodaScope note.",
        }],
      },
    }];

    const html = renderToStaticMarkup(createElement(CodaScopeAssistant));
    expect(html).toContain("Note created");
    expect(html).toContain("CodaScope Notes");
    expect(html).toContain("Loading current note details");
    expect(routeState.navigate).not.toHaveBeenCalled();
  });

  it("renders persisted workspace provenance but not local unverified sources", () => {
    conversationState.messages = [{
      id: "assistant-server-id",
      role: "assistant",
      content: "Architecture answer.",
      status: "complete",
      authoritativePersisted: true,
      context: {
        assistantScope: { kind: "workspace" },
        explicitlyReferencedProjectIds: ["alpha"],
        currentView: { view: "projects" },
        retrievedSources: [{
          kind: "project_wiki",
          retrieval: "search",
          projectId: "alpha",
          projectName: "Alpha",
          topicId: "architecture",
          topicTitle: "Architecture",
          topicUpdatedAt: "2026-07-20T00:00:00.000Z",
          lastWikiBuildAt: "2026-07-21T00:00:00.000Z",
        }],
      },
      metadata: {},
    }];

    const persistedHtml = renderToStaticMarkup(createElement(CodaScopeAssistant));
    expect(persistedHtml).toContain("Retrieved sources");
    expect(persistedHtml).toContain("Project wiki");
    expect(persistedHtml).toContain("Architecture");

    conversationState.messages = [{
      ...conversationState.messages[0],
      authoritativePersisted: false,
    }];
    const localHtml = renderToStaticMarkup(createElement(CodaScopeAssistant));
    expect(localHtml).not.toContain("Retrieved sources");
  });

  it("keeps project assistant rendering available on project routes", () => {
    routeState.segments = ["project", "alpha", "dashboard"];
    const html = renderToStaticMarkup(createElement(CodaScopeAssistant));
    expect(html).toContain("CodaScope Assistant");
    expect(html).toContain("Explore Codebase");
    expect(html).toContain("@ to add context");
    expect(html).not.toContain("Notes by directive");
  });

  it("renders a reliably staged target and suppresses unrelated generic prompts", () => {
    stageNoteRangeHandoff({
      scope: { kind: "workspace" },
      sourceId: "editor-source",
      target: workspaceTarget,
    });

    const html = renderToStaticMarkup(createElement(CodaScopeAssistant));
    expect(html).toContain("Editing selection");
    expect(html).toContain("The agent will edit only this selection.");
    expect(html).toContain("Do this");
    expect(html).toContain("Describe the change to this selection…");
    expect(html).not.toContain("Workspace Overview");
    expect(html).not.toContain("Compare Documentation");
  });

  it.each([false, true])(
    "renders the selection reference for %s authoritative user metadata without restaging it",
    (authoritativePersisted) => {
      conversationState.messages = [{
        id: authoritativePersisted ? "user-server-id" : "user-local-id",
        role: "user",
        content: "Tighten this.",
        status: "complete",
        authoritativePersisted,
        metadata: { noteRangeTarget: workspaceTarget },
      }];

      const html = renderToStaticMarkup(createElement(CodaScopeAssistant));
      expect(html).toContain("Selected range from Roadmap");
      expect(html).toContain("Do this precisely");
      expect(html).not.toContain("Editing selection");
      expect(html).toContain("Message the Workspace Assistant...");
    },
  );
});
