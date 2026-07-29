import { describe, expect, it, vi } from "vitest";
import {
  createAssistantConversationApi,
  isCanonicalAssistantRecordId,
  restoreAssistantMessages,
} from "./assistantConversationApi";
import type {
  AssistantScope,
  Conversation,
  ConversationMessage,
} from "./codaScopeTypes";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const workspaceScope = { kind: "workspace" } as const;
const projectScope = { kind: "project", projectId: "alpha" } as const;
const createdAt = "2026-07-26T10:00:00.000Z";
const updatedAt = "2026-07-26T11:00:00.000Z";

function summary(
  id: string,
  scope?: AssistantScope,
): Record<string, unknown> {
  return {
    id,
    ...(scope ? { scope } : {}),
    title: id,
    summary: "",
    modelId: null,
    createdAt,
    updatedAt,
    messageCount: 0,
  };
}

function workspaceMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "message-1",
    role: "user",
    content: "Hello",
    createdAt,
    updatedAt: null,
    modelId: null,
    status: "complete",
    context: {
      assistantScope: workspaceScope,
      explicitlyReferencedProjectIds: [],
      currentView: { view: "projects" },
    },
    metadata: {},
    ...overrides,
  };
}

function projectMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "message-1",
    role: "user",
    content: "Hello",
    createdAt,
    updatedAt: null,
    modelId: null,
    status: "complete",
    context: {
      view: "dashboard",
      projectName: "Alpha",
      projectId: "alpha",
      noteScope: null,
      noteVisibility: null,
      notePath: null,
    },
    metadata: {},
    ...overrides,
  };
}

function workspaceConversation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    id: "conv-1",
    scope: workspaceScope,
    ownerId: "alan",
    title: "Workspace chat",
    summary: "Summary",
    createdAt,
    updatedAt,
    defaultModelId: "model",
    messages: [],
    ...overrides,
  };
}

function projectConversation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 2,
    id: "conv-1",
    projectId: "alpha",
    ownerId: "alan",
    title: "Project chat",
    summary: "Summary",
    createdAt,
    updatedAt,
    defaultModelId: "model",
    messages: [],
    ...overrides,
  };
}

describe("assistant conversation API boundary", () => {
  it.each([
    "record-1",
    "record.id",
    "record:id",
    "record%20id",
  ])("accepts bounded canonical assistant identity %s", (id) => {
    expect(isCanonicalAssistantRecordId(id)).toBe(true);
  });

  it.each([
    "",
    " record-1",
    "record-1 ",
    ".",
    "..",
    "../record",
    "record\\child",
    "record%2fchild",
    "record%255cchild",
    "C:record",
  ])("rejects malformed assistant identity %j", (id) => {
    expect(isCanonicalAssistantRecordId(id)).toBe(false);
  });

  it("retains valid workspace list scope and sorts by updatedAt", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      scope: workspaceScope,
      conversations: [
        {
          ...summary("older", workspaceScope),
          updatedAt: "2026-07-25T11:00:00.000Z",
        },
        summary("newer", workspaceScope),
      ],
    }));

    const summaries = await createAssistantConversationApi(
      workspaceScope,
      fetchMock,
    ).listConversations();

    expect(summaries.map(({ id, scope }) => ({ id, scope }))).toEqual([
      { id: "newer", scope: workspaceScope },
      { id: "older", scope: workspaceScope },
    ]);
  });

  it.each([
    {
      name: "missing",
      payload: { conversations: [summary("conv-1", workspaceScope)] },
    },
    {
      name: "project",
      payload: {
        scope: projectScope,
        conversations: [summary("conv-1", workspaceScope)],
      },
    },
    {
      name: "malformed",
      payload: {
        scope: { kind: "workspace", projectId: "alpha" },
        conversations: [summary("conv-1", workspaceScope)],
      },
    },
  ])("rejects a $name workspace list envelope scope", async ({ payload }) => {
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload)),
    );
    await expect(api.listConversations()).resolves.toEqual([]);
  });

  it("rejects a wrong-scope workspace summary", async () => {
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        scope: workspaceScope,
        conversations: [summary("conv-1", projectScope)],
      })),
    );
    await expect(api.listConversations()).resolves.toEqual([]);
  });

  it("rejects a complete workspace list when one summary is malformed", async () => {
    const malformed = summary("malformed", workspaceScope);
    delete malformed.summary;
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        scope: workspaceScope,
        conversations: [
          summary("valid", workspaceScope),
          malformed,
        ],
      })),
    );
    await expect(api.listConversations()).resolves.toEqual([]);
  });

  it("rejects a workspace list with a malformed summary identity", async () => {
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        scope: workspaceScope,
        conversations: [summary("../conversation", workspaceScope)],
      })),
    );
    await expect(api.listConversations()).resolves.toEqual([]);
  });

  it("rejects duplicate workspace summary IDs", async () => {
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        scope: workspaceScope,
        conversations: [
          summary("duplicate", workspaceScope),
          summary("duplicate", workspaceScope),
        ],
      })),
    );
    await expect(api.listConversations()).resolves.toEqual([]);
  });

  it("normalizes legacy project summaries to the adapter's exact scope", async () => {
    const api = createAssistantConversationApi(
      projectScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversations: [summary("conv-1")],
      })),
    );
    await expect(api.listConversations()).resolves.toEqual([
      expect.objectContaining({
        id: "conv-1",
        scope: projectScope,
      }),
    ]);
  });

  it.each([
    { scope: { kind: "workspace" } },
    { scope: { kind: "project", projectId: "beta" } },
    { projectId: "beta" },
  ])("rejects conflicting project summary identity %#", async (conflict) => {
    const api = createAssistantConversationApi(
      projectScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversations: [{ ...summary("conv-1"), ...conflict }],
      })),
    );
    await expect(api.listConversations()).resolves.toEqual([]);
  });

  it("validates workspace create, read, and update records and uses workspace URLs", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        conversation: workspaceConversation(),
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        conversation: workspaceConversation(),
      }))
      .mockResolvedValueOnce(jsonResponse({
        conversation: workspaceConversation({ title: "Renamed" }),
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({
        path: "conv-1/images/image.png",
        filename: "image.png",
      }, 201));
    const api = createAssistantConversationApi(workspaceScope, fetchMock);

    await expect(api.createConversation({ modelId: "model" })).resolves
      .toMatchObject({ id: "conv-1", scope: workspaceScope });
    await expect(api.readConversation("conv-1")).resolves
      .toMatchObject({ id: "conv-1", scope: workspaceScope });
    await expect(api.updateConversation("conv-1", { title: "Renamed" }))
      .resolves.toMatchObject({ title: "Renamed", scope: workspaceScope });
    await expect(api.deleteConversation("conv-1")).resolves.toBe(true);
    await expect(api.uploadImage("conv-1", new FormData())).resolves.toEqual({
      path: "conv-1/images/image.png",
      filename: "image.png",
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/codascope/workspace/conversations",
      "/api/codascope/workspace/conversations/conv-1",
      "/api/codascope/workspace/conversations/conv-1",
      "/api/codascope/workspace/conversations/conv-1",
      "/api/codascope/workspace/conversations/conv-1/images",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      modelId: "model",
    });
  });

  it.each([
    { name: "missing scope", conversation: (() => {
      const { scope: _scope, ...record } = workspaceConversation();
      return record;
    })() },
    {
      name: "project scope",
      conversation: workspaceConversation({ scope: projectScope }),
    },
    {
      name: "project identity",
      conversation: workspaceConversation({ projectId: "alpha" }),
    },
  ])("rejects a workspace record with $name", async ({ conversation }) => {
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ conversation })),
    );
    await expect(api.createConversation({})).resolves.toBeNull();
  });

  it.each([
    "",
    "../conversation",
    "conversation%2fchild",
    "x".repeat(256),
  ])("rejects workspace record identity %j", async (id) => {
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: workspaceConversation({ id }),
      })),
    );
    await expect(api.createConversation({})).resolves.toBeNull();
  });

  it.each([
    "",
    "../message",
    "message%255cchild",
    "x".repeat(256),
  ])("rejects workspace message identity %j", async (id) => {
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: workspaceConversation({
          messages: [workspaceMessage({ id })],
        }),
      })),
    );
    await expect(api.readConversation("conv-1")).resolves.toBeNull();
  });

  it("accepts a project record with the adapter project ID and normalizes its scope", async () => {
    const api = createAssistantConversationApi(
      projectScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: projectConversation(),
      })),
    );
    await expect(api.createConversation({})).resolves.toMatchObject({
      id: "conv-1",
      projectId: "alpha",
      scope: projectScope,
    });
  });

  it.each([
    {
      name: "different projectId",
      conversation: projectConversation({ projectId: "beta" }),
    },
    {
      name: "conflicting explicit scope",
      conversation: projectConversation({ scope: workspaceScope }),
    },
  ])("rejects a project record with $name", async ({ conversation }) => {
    const api = createAssistantConversationApi(
      projectScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ conversation })),
    );
    await expect(api.createConversation({})).resolves.toBeNull();
  });

  it("rejects read and update response ID mismatches", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        conversation: workspaceConversation({ id: "other" }),
      }))
      .mockResolvedValueOnce(jsonResponse({
        conversation: workspaceConversation({ id: "other" }),
      }));
    const api = createAssistantConversationApi(workspaceScope, fetchMock);

    await expect(api.readConversation("conv-1")).resolves.toBeNull();
    await expect(api.updateConversation("conv-1", { title: "Renamed" }))
      .resolves.toBeNull();
  });

  it("rejects a complete record when one message is malformed", async () => {
    const malformed = workspaceMessage({ id: "malformed" });
    delete malformed.createdAt;
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: workspaceConversation({
          messages: [
            workspaceMessage({ id: "valid" }),
            malformed,
          ],
        }),
      })),
    );
    await expect(api.readConversation("conv-1")).resolves.toBeNull();
  });

  it("restores strictly validated persisted workspace provenance authoritatively", async () => {
    const sources = [
      {
        kind: "project_wiki",
        retrieval: "search",
        projectId: "zeta",
        projectName: "Zeta",
        topicId: "runtime",
        topicTitle: "Runtime",
        topicUpdatedAt: "2026-07-20T00:00:00.000Z",
        lastWikiBuildAt: null,
      },
      {
        kind: "code_map",
        retrieval: "direct",
        projectId: "alpha",
        projectName: "Alpha",
        codeMapId: "services",
        generatedAt: "2026-07-19T00:00:00.000Z",
        lastWikiBuildAt: "2026-07-21T00:00:00.000Z",
      },
    ];
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: workspaceConversation({
          messages: [workspaceMessage({
            role: "assistant",
            context: {
              assistantScope: workspaceScope,
              explicitlyReferencedProjectIds: [],
              currentView: { view: "projects" },
              retrievedSources: sources,
            },
          })],
        }),
      })),
    );

    const conversation = await api.readConversation("conv-1");
    expect(conversation).not.toBeNull();
    const restored = restoreAssistantMessages(
      conversation!,
      api.endpoints,
    );
    expect(restored).toEqual([
      expect.objectContaining({
        role: "assistant",
        authoritativePersisted: true,
        context: expect.objectContaining({
          retrievedSources: [
            expect.objectContaining({
              kind: "code_map",
              projectId: "alpha",
            }),
            expect.objectContaining({
              kind: "project_wiki",
              projectId: "zeta",
            }),
          ],
        }),
      }),
    ]);
  });

  it.each([
    ["duplicate sources", [
      {
        kind: "project_wiki",
        retrieval: "direct",
        projectId: "alpha",
        projectName: "Alpha",
        topicId: "architecture",
        topicTitle: "Architecture",
        topicUpdatedAt: createdAt,
        lastWikiBuildAt: null,
      },
      {
        kind: "project_wiki",
        retrieval: "direct",
        projectId: "alpha",
        projectName: "Alpha",
        topicId: "architecture",
        topicTitle: "Duplicate",
        topicUpdatedAt: createdAt,
        lastWikiBuildAt: null,
      },
    ]],
    ["extra authority field", [{
      kind: "code_map",
      retrieval: "direct",
      projectId: "alpha",
      projectName: "Alpha",
      codeMapId: "services",
      generatedAt: null,
      lastWikiBuildAt: null,
      repositoryPath: "/private/repository",
    }]],
    ["invalid route identity", [{
      kind: "project_wiki",
      retrieval: "direct",
      projectId: "alpha",
      projectName: "Alpha",
      topicId: "../private",
      topicTitle: "Private",
      topicUpdatedAt: createdAt,
      lastWikiBuildAt: null,
    }]],
    ["oversized display value", [{
      kind: "code_map",
      retrieval: "direct",
      projectId: "alpha",
      projectName: "x".repeat(501),
      codeMapId: "services",
      generatedAt: null,
      lastWikiBuildAt: null,
    }]],
  ])("rejects an entire authoritative record with %s", async (
    _label,
    retrievedSources,
  ) => {
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: workspaceConversation({
          messages: [workspaceMessage({
            role: "assistant",
            context: {
              assistantScope: workspaceScope,
              explicitlyReferencedProjectIds: [],
              currentView: { view: "projects" },
              retrievedSources,
            },
          })],
        }),
      })),
    );
    await expect(api.readConversation("conv-1")).resolves.toBeNull();
  });

  it("strictly retains canonical workspace note actions", async () => {
    const action = {
      type: "note_created",
      attributes: {
        stableId: "note-1",
        scope: "codascope",
        visibility: "private",
        path: "notes/one.md",
        title: "One",
        contentHash: "a".repeat(32),
      },
      description: 'Created CodaScope note "One".',
    };
    const operation = {
      ...action,
      type: "operation_completed",
      attributes: {
        operation: "archive_codascope_note",
        ...action.attributes,
      },
      description: 'Archived CodaScope note "One".',
    };
    const validApi = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: workspaceConversation({
          messages: [workspaceMessage({
            role: "assistant",
            metadata: { actions: [action, operation] },
          })],
        }),
      })),
    );
    await expect(validApi.readConversation("conv-1")).resolves.toMatchObject({
      messages: [{
        metadata: { actions: [action, operation] },
      }],
    });
  });

  it.each([
    ["traversal stable ID", { stableId: "../note" }],
    ["absolute path", { path: "/absolute.md" }],
    ["non-Markdown path", { path: "one.txt" }],
    ["reserved filename", { path: "notes/_index.md" }],
    ["oversized title", { title: "x".repeat(301) }],
    ["invalid hash", { contentHash: "bad" }],
    ["unknown attribute", { actorId: "mallory" }],
  ])("rejects an entire workspace record containing %s", async (
    _label,
    attributePatch,
  ) => {
    const action = {
      type: "note_created",
      attributes: {
        stableId: "note-1",
        scope: "codascope",
        visibility: "private",
        path: "notes/one.md",
        title: "One",
        contentHash: "a".repeat(32),
        ...attributePatch,
      },
      description: 'Created CodaScope note "One".',
    };
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: workspaceConversation({
          messages: [workspaceMessage({
            role: "assistant",
            metadata: { actions: [action] },
          })],
        }),
      })),
    );
    await expect(api.readConversation("conv-1")).resolves.toBeNull();
  });

  it("rejects missing fields, oversized descriptions, and unknown receipt operations", async () => {
    const base = {
      type: "operation_completed",
      attributes: {
        operation: "archive_codascope_note",
        stableId: "note-1",
        scope: "codascope",
        visibility: "private",
        path: "notes/one.md",
        title: "One",
        contentHash: "a".repeat(32),
      },
      description: "Archived note.",
    };
    const missingPath = {
      ...base,
      attributes: Object.fromEntries(
        Object.entries(base.attributes).filter(([key]) => key !== "path"),
      ),
    };
    for (const action of [
      missingPath,
      { ...base, description: "x".repeat(501) },
      {
        ...base,
        attributes: { ...base.attributes, operation: "delete_note" },
      },
    ]) {
      const api = createAssistantConversationApi(
        workspaceScope,
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
          conversation: workspaceConversation({
            messages: [workspaceMessage({
              role: "assistant",
              metadata: { actions: [action] },
            })],
          }),
        })),
      );
      await expect(api.readConversation("conv-1")).resolves.toBeNull();
    }
  });

  it("strictly restores note-range references without making them live state", async () => {
    const workspaceTarget = {
      kind: "note-range",
      stableId: "note-1",
      scope: "codascope",
      visibility: "private",
      path: "notes/one.md",
      title: "One",
      selectionStart: 0,
      selectionEnd: 5,
      selectedText: "first",
      startLine: 1,
      endLine: 1,
      expectedHash: "a".repeat(64),
    };
    const workspaceApi = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: workspaceConversation({
          messages: [workspaceMessage({
            context: {
              assistantScope: workspaceScope,
              explicitlyReferencedProjectIds: [],
              currentView: { view: "notes" },
              currentNote: {
                stableId: "note-1",
                scope: "codascope",
                path: "notes/one.md",
                title: "One",
                visibility: "private",
                contentHash: "a".repeat(64),
              },
            },
            metadata: { noteRangeTarget: workspaceTarget },
          })],
        }),
      })),
    );
    await expect(workspaceApi.readConversation("conv-1")).resolves.toMatchObject({
      messages: [{ metadata: { noteRangeTarget: workspaceTarget } }],
    });

    const projectTarget = {
      ...workspaceTarget,
      stableId: "note-2",
      scope: "project",
      visibility: "shared",
      projectId: "alpha",
      path: "notes/two.md",
      title: "Two",
    };
    const projectApi = createAssistantConversationApi(
      projectScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: projectConversation({
          messages: [projectMessage({
            context: {
              view: "notes",
              projectName: "Alpha",
              projectId: "alpha",
              epicId: null,
              noteScope: "project",
              noteVisibility: "shared",
              notePath: "notes/two.md",
            },
            metadata: { noteRangeTarget: projectTarget },
          })],
        }),
      })),
    );
    await expect(projectApi.readConversation("conv-1")).resolves.toMatchObject({
      messages: [{ metadata: { noteRangeTarget: projectTarget } }],
    });
  });

  it.each([
    {
      label: "extensionless project",
      target: {
        kind: "note-range",
        stableId: "note-project",
        scope: "project",
        visibility: "shared",
        projectId: "alpha",
        path: "plans/current.md",
        title: "Current plan",
        selectionStart: 0,
        selectionEnd: 5,
        selectedText: "first",
        startLine: 1,
        endLine: 1,
        expectedHash: "a".repeat(64),
      },
      context: {
        view: "notes",
        projectName: "Alpha",
        projectId: "alpha",
        epicId: null,
        noteScope: "project",
        noteVisibility: "shared",
        notePath: "plans/current",
      },
    },
    {
      label: "extensionless epic",
      target: {
        kind: "note-range",
        stableId: "note-epic",
        scope: "epic",
        visibility: "shared",
        projectId: "alpha",
        epicId: "epic-1",
        path: "plans/epic.md",
        title: "Epic plan",
        selectionStart: 0,
        selectionEnd: 5,
        selectedText: "first",
        startLine: 1,
        endLine: 1,
        expectedHash: "b".repeat(64),
      },
      context: {
        view: "notes",
        projectName: "Alpha",
        projectId: "alpha",
        epicId: "epic-1",
        noteScope: "epic",
        noteVisibility: "shared",
        notePath: "plans/epic",
      },
    },
    {
      label: "canonical .md project",
      target: {
        kind: "note-range",
        stableId: "note-canonical",
        scope: "project",
        visibility: "private",
        projectId: "alpha",
        path: "plans/canonical.md",
        title: "Canonical plan",
        selectionStart: 0,
        selectionEnd: 5,
        selectedText: "first",
        startLine: 1,
        endLine: 1,
        expectedHash: "c".repeat(64),
      },
      context: {
        view: "notes",
        projectName: "Alpha",
        projectId: "alpha",
        epicId: null,
        noteScope: "project",
        noteVisibility: "private",
        notePath: "plans/canonical.md",
      },
    },
  ])("restores a valid targeted message with a $label route path", async ({
    target,
    context,
  }) => {
    const api = createAssistantConversationApi(
      projectScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: projectConversation({
          messages: [projectMessage({
            context,
            metadata: { noteRangeTarget: target },
          })],
        }),
      })),
    );

    await expect(api.readConversation("conv-1")).resolves.toMatchObject({
      messages: [{ metadata: { noteRangeTarget: target } }],
    });
  });

  it.each([
    {
      label: "different canonical path",
      targetProjectId: "alpha",
      contextProjectId: "alpha",
      targetEpicId: undefined,
      contextEpicId: null,
      scope: "project",
      targetPath: "plans/current.md",
      contextPath: "plans/other",
    },
    {
      label: "cross-project custody",
      targetProjectId: "beta",
      contextProjectId: "beta",
      targetEpicId: undefined,
      contextEpicId: null,
      scope: "project",
      targetPath: "plans/current.md",
      contextPath: "plans/current",
    },
    {
      label: "wrong epic custody",
      targetProjectId: "alpha",
      contextProjectId: "alpha",
      targetEpicId: "epic-1",
      contextEpicId: "epic-2",
      scope: "epic",
      targetPath: "plans/epic.md",
      contextPath: "plans/epic",
    },
  ] as const)("rejects targeted restoration with $label", async ({
    targetProjectId,
    contextProjectId,
    targetEpicId,
    contextEpicId,
    scope,
    targetPath,
    contextPath,
  }) => {
    const target = {
      kind: "note-range",
      stableId: "note-2",
      scope,
      visibility: "shared",
      projectId: targetProjectId,
      ...(targetEpicId ? { epicId: targetEpicId } : {}),
      path: targetPath,
      title: "Two",
      selectionStart: 0,
      selectionEnd: 5,
      selectedText: "first",
      startLine: 1,
      endLine: 1,
      expectedHash: "d".repeat(64),
    };
    const api = createAssistantConversationApi(
      projectScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: projectConversation({
          messages: [projectMessage({
            context: {
              view: "notes",
              projectName: "Project",
              projectId: contextProjectId,
              epicId: contextEpicId,
              noteScope: scope,
              noteVisibility: "shared",
              notePath: contextPath,
            },
            metadata: { noteRangeTarget: target },
          })],
        }),
      })),
    );

    await expect(api.readConversation("conv-1")).resolves.toBeNull();
  });

  it("rejects malformed, assistant-authored, and cross-project note-range metadata", async () => {
    const baseTarget = {
      kind: "note-range",
      stableId: "note-2",
      scope: "project",
      visibility: "shared",
      projectId: "alpha",
      path: "notes/two.md",
      title: "Two",
      selectionStart: 0,
      selectionEnd: 5,
      selectedText: "first",
      startLine: 1,
      endLine: 1,
      expectedHash: "a".repeat(64),
    };
    for (const target of [
      { ...baseTarget, projectId: "beta" },
      { ...baseTarget, selectionEnd: 4 },
    ]) {
      const api = createAssistantConversationApi(
        projectScope,
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
          conversation: projectConversation({
            messages: [projectMessage({
              context: {
                view: "notes",
                projectName: "Alpha",
                projectId: "alpha",
                epicId: null,
                noteScope: "project",
                noteVisibility: "shared",
                notePath: "notes/two.md",
              },
              metadata: { noteRangeTarget: target },
            })],
          }),
        })),
      );
      await expect(api.readConversation("conv-1")).resolves.toBeNull();
    }
    const assistantApi = createAssistantConversationApi(
      projectScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: projectConversation({
          messages: [projectMessage({
            role: "assistant",
            metadata: { noteRangeTarget: baseTarget },
          })],
        }),
      })),
    );
    await expect(assistantApi.readConversation("conv-1")).resolves.toBeNull();
  });

  it("rejects duplicate message IDs", async () => {
    const api = createAssistantConversationApi(
      projectScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: projectConversation({
          messages: [
            projectMessage({ id: "duplicate" }),
            projectMessage({ id: "duplicate", role: "assistant" }),
          ],
        }),
      })),
    );
    await expect(api.readConversation("conv-1")).resolves.toBeNull();
  });

  it("preserves valid system messages in the persisted DTO", async () => {
    const api = createAssistantConversationApi(
      workspaceScope,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        conversation: workspaceConversation({
          messages: [workspaceMessage({
            id: "system-1",
            role: "system",
            content: "Internal context",
          })],
        }),
      })),
    );
    const conversation = await api.readConversation("conv-1");

    expect(conversation?.messages).toEqual([
      expect.objectContaining({
        id: "system-1",
        role: "system",
        content: "Internal context",
      }),
    ]);
    expect(conversation
      ? restoreAssistantMessages(conversation, api.endpoints)
      : null).toEqual([]);
  });

  it.each([
    {
      scope: workspaceScope,
      expected:
        "/api/codascope/workspace/conversations/conv-1/images/image.png",
    },
    {
      scope: projectScope,
      expected:
        "/api/codascope/projects/alpha/conversations/conv-1/images/image.png",
    },
  ])("restores $scope.kind image display URLs", ({ scope, expected }) => {
    const api = createAssistantConversationApi(scope, vi.fn());
    const message: ConversationMessage = {
      id: "message-1",
      role: "user",
      content: "See image",
      createdAt,
      updatedAt: null,
      modelId: null,
      status: "complete",
      context: null,
      metadata: {
        images: [{ path: "ignored/server/path", filename: "image.png" }],
      },
    };
    const withImage: Conversation = scope.kind === "workspace"
      ? {
          id: "conv-1",
          scope,
          ownerId: "alan",
          title: "Workspace chat",
          summary: "Summary",
          createdAt,
          updatedAt,
          defaultModelId: "model",
          messages: [message],
        }
      : {
          id: "conv-1",
          scope,
          ownerId: "alan",
          projectId: scope.projectId,
          title: "Project chat",
          summary: "Summary",
          createdAt,
          updatedAt,
          defaultModelId: "model",
          messages: [message],
        };
    expect(restoreAssistantMessages(withImage, api.endpoints)[0]?.images)
      .toEqual([{ url: expected, filename: "image.png" }]);
  });
});
