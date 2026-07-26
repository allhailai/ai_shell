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

describe("CodaScopeAssistant scope rendering", () => {
  beforeEach(() => {
    routeState.segments = ["notes", "private", "roadmap"];
    routeState.navigate.mockReset();
    conversationState.messages = [];
  });

  it("renders the workspace assistant and root-note context without activeProjectId", () => {
    const html = renderToStaticMarkup(createElement(CodaScopeAssistant));
    expect(html).toContain("Workspace Assistant");
    expect(html).toContain("Notes by directive");
    expect(html).toContain("Project knowledge stays read-only");
    expect(html).toContain("only when you explicitly ask");
    expect(html).toContain("Roadmap");
    expect(html).toContain("Private");
    expect(html).toContain("Workspace Overview");
    expect(html).toContain("Message the Workspace Assistant...");
    expect(html).not.toContain("Select a project");
    expect(html).not.toContain("@ to add context");
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

  it("keeps project assistant rendering available on project routes", () => {
    routeState.segments = ["project", "alpha", "dashboard"];
    const html = renderToStaticMarkup(createElement(CodaScopeAssistant));
    expect(html).toContain("CodaScope Assistant");
    expect(html).toContain("Explore Codebase");
    expect(html).toContain("@ to add context");
    expect(html).not.toContain("Notes by directive");
  });
});
