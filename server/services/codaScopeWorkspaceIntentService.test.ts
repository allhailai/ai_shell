import { describe, expect, it, vi } from "vitest";
import { CodaScopeWorkspaceIntentService } from "./codaScopeWorkspaceIntentService.js";

const projects = [
  project("alpha", "Alpha"),
  project("beta", "Beta"),
];
const epics = {
  alpha: [
    epic("alpha", "payments", "Payments"),
    epic("alpha", "authentication", "Authentication"),
    epic("alpha", "archived-auth", "Archived Authentication", "archived"),
  ],
  beta: [
    epic("beta", "authentication", "Authentication"),
  ],
};

function project(projectId: string, name: string) {
  return {
    projectId,
    name,
    description: "",
    repositories: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    projectDir: `/private/${projectId}`,
  };
}

function epic(
  projectId: string,
  id: string,
  title: string,
  status = "designing",
) {
  return {
    id,
    projectId,
    title,
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "alice",
    collaborators: [],
    currentVersion: 0,
  };
}

function fixture(options: {
  projects?: typeof projects;
  inactiveProjects?: string[];
} = {}) {
  const activeProjects = options.projects ?? projects;
  const inactive = new Set(options.inactiveProjects ?? []);
  const activeResolver = {
    listActiveProjects: vi.fn(async () => activeProjects),
    resolveActiveProject: vi.fn(async (projectId: string) => (
      inactive.has(projectId)
        ? null
        : activeProjects.find((candidate) => candidate.projectId === projectId) ?? null
    )),
    resolveActiveEpic: vi.fn(async (projectId: string, epicId: string) => {
      if (inactive.has(projectId)) return null;
      const projectRecord = activeProjects.find(
        (candidate) => candidate.projectId === projectId,
      );
      const epicRecord = (epics[projectId as keyof typeof epics] ?? [])
        .find((candidate) => candidate.id === epicId && candidate.status !== "archived");
      return projectRecord && epicRecord
        ? { project: projectRecord, epic: epicRecord }
        : null;
    }),
    resolveActiveDesign: vi.fn(async (
      projectId: string,
      epicId: string,
      designId: string,
    ) => (
      projectId === "alpha"
      && epicId === "payments"
      && designId === "payments-api"
        ? {
            project: projects[0],
            epic: epics.alpha[0],
            document: { id: designId },
          }
        : null
    )),
  };
  const epicService = {
    listEpics: vi.fn(async (projectId: string) =>
      epics[projectId as keyof typeof epics] ?? [],
    ),
  };
  const designDocService = {
    listDesignDocs: vi.fn(async (projectId: string, epicId: string) => (
      projectId === "alpha" && epicId === "payments"
        ? [
            { id: "payments-api", title: "Payments API" },
            {
              id: "archived-design",
              title: "Old",
              archivedAt: "2026-01-01T00:00:00.000Z",
            },
          ]
        : []
    )),
  };
  const epicKnowledgeService = {
    listEpicWikiPages: vi.fn(async () => [
      { id: "curated-page", title: "Curated" },
    ]),
    listSources: vi.fn(async () => [
      { id: "ready-source", status: "ready" },
      { id: "pending-source", status: "pending" },
    ]),
  };
  const service = new CodaScopeWorkspaceIntentService(
    activeResolver as any,
    epicService as any,
    designDocService as any,
    epicKnowledgeService as any,
  );
  return {
    service,
    activeResolver,
    epicService,
    designDocService,
    epicKnowledgeService,
  };
}

describe("CodaScopeWorkspaceIntentService", () => {
  it.each([
    [
      "Compare the active roadmaps of Alpha and Beta.",
      ["alpha", "beta"],
    ],
    [
      "What is Project Alpha currently planning?",
      ["alpha"],
    ],
  ])("derives active planning grants for %s", async (message, projectIds) => {
    const { service } = fixture();
    const result = await service.resolveTurn(message, []);

    expect(result.intent).toBe("project_planning");
    expect(result.grant.epicDiscoveryProjectIds).toEqual(projectIds);
    expect([...new Set(result.grant.epicResources.map((item) => item.projectId))])
      .toEqual(projectIds);
    expect(result.grant.epicResources.every((item) =>
      item.capabilities.join(",") === "metadata,definition,scope",
    )).toBe(true);
    expect(result.grant.epicResources.some((item) => item.epicId === "archived-auth"))
      .toBe(false);
  });

  it("derives exact active design IDs for an explicit epic-design request", async () => {
    const { service, designDocService } = fixture();
    const result = await service.resolveTurn(
      "Read the payments epic and summarize its designs.",
      [],
    );

    expect(result.intent).toBe("epic_design");
    expect(result.grant.epicResources).toEqual([expect.objectContaining({
      projectId: "alpha",
      epicId: "payments",
      capabilities: ["metadata", "definition", "scope", "designs"],
      designIds: ["payments-api"],
    })]);
    expect(designDocService.listDesignDocs).toHaveBeenCalledWith(
      "alpha",
      "payments",
    );
  });

  it("compares same-named active epics across projects without granting designs", async () => {
    const { service } = fixture();
    const result = await service.resolveTurn(
      "Compare the authentication epics.",
      [],
    );

    expect(result.intent).toBe("epic");
    expect(result.grant.epicResources.map((item) => [
      item.projectId,
      item.epicId,
    ])).toEqual([
      ["alpha", "authentication"],
      ["beta", "authentication"],
    ]);
    expect(result.grant.epicResources.every((item) =>
      !item.capabilities.includes("designs"),
    )).toBe(true);
  });

  it.each([
    "Compare Alpha and Beta's architecture.",
    "How do these projects implement authentication?",
  ])("keeps generic implementation questions wiki-first: %s", async (message) => {
    const { service, epicService } = fixture();
    const result = await service.resolveTurn(message, []);

    expect(result.intent).toBe("wiki_first");
    expect(result.grant).toMatchObject({
      epicDiscoveryProjectIds: [],
      epicResources: [],
    });
    expect(epicService.listEpics).not.toHaveBeenCalled();
  });

  it("resolves possessive project names without widening a generic wiki-first grant", async () => {
    const { service } = fixture();
    const result = await service.resolveTurn(
      "Compare Alpha and Beta's architecture.",
      [],
    );
    expect(result.resolvedProjectIds).toEqual(["alpha", "beta"]);
    expect(result.grant.epicResources).toEqual([]);
  });

  it("fails closed for ambiguous project names and missing epic references", async () => {
    const duplicateProjects = [
      project("alpha-one", "Alpha"),
      project("alpha-two", "Alpha"),
    ];
    const { service } = fixture({ projects: duplicateProjects });

    expect((await service.resolveTurn(
      "What is Project Alpha currently planning?",
      [],
    )).grant.epicResources).toEqual([]);
    expect((await service.resolveTurn(
      "Read the missing epic and summarize its designs.",
      [],
    )).grant.epicResources).toEqual([]);
  });

  it("fails closed when explicit project references are inactive", async () => {
    const { service } = fixture({ inactiveProjects: ["beta"] });
    const result = await service.resolveTurn(
      "Compare the active roadmaps.",
      ["alpha", "beta"],
    );
    expect(result.grant.epicDiscoveryProjectIds).toEqual([]);
    expect(result.grant.epicResources).toEqual([]);
  });

  it("grants knowledge and ready research IDs only when explicitly requested", async () => {
    const { service } = fixture();
    const result = await service.resolveTurn(
      "Read the payments epic knowledge and research sources.",
      ["alpha"],
    );

    expect(result.grant.epicResources).toEqual([expect.objectContaining({
      projectId: "alpha",
      epicId: "payments",
      capabilities: [
        "metadata",
        "definition",
        "scope",
        "knowledge",
        "research",
      ],
      knowledgePageIds: ["curated-page"],
      researchSourceIds: ["ready-source"],
    })]);
  });
});
