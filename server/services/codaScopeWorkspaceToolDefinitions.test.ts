import { describe, expect, it, vi } from "vitest";
import { getWorkspaceTools } from "./codaScopeWorkspaceToolDefinitions.js";
import {
  WorkspaceTurnReadGrantHolder,
  type WorkspaceTurnReadGrant,
} from "./codaScopeWorkspaceReadGrant.js";
import { WorkspaceProvenanceCollectorHolder } from "./codaScopeWorkspaceProvenance.js";
import { WorkspaceTurnNoteGrantHolder } from "./codaScopeWorkspaceNoteGrant.js";
import { WorkspaceMutationActionCollectorHolder } from "./codaScopeWorkspaceMutationActions.js";

const EXPECTED_WORKSPACE_TOOLS = [
  "get_workspace_status",
  "list_projects",
  "get_project_overview",
  "list_project_wiki_topics",
  "read_project_wiki_topic",
  "search_project_wiki",
  "search_project_wikis",
  "get_project_build_history",
  "list_project_code_maps",
  "read_project_code_map",
  "list_active_epics",
  "get_active_epic_overview",
  "read_epic_definition",
  "read_epic_scope",
  "list_active_design_docs",
  "read_active_design_doc",
  "list_epic_knowledge_pages",
  "read_epic_knowledge_page",
  "list_epic_research_sources",
  "read_epic_research_source",
].sort();

function services() {
  const activeProject = {
    projectId: "project",
    name: "Project",
    description: "",
    repositories: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    projectDir: "/private/project",
  };
  const activeEpic = {
    project: activeProject,
    epic: {
      id: "epic",
      projectId: "project",
      title: "Epic",
      status: "designing",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "alice",
      collaborators: ["alice"],
      currentVersion: 0,
    },
  };
  return {
    activeResolver: {
      resolveActiveProject: vi.fn(async (projectId: string) => (
        projectId === "project" ? activeProject : null
      )),
      resolveActiveEpic: vi.fn(async (projectId: string, epicId: string) => (
        projectId === "project" && epicId === "epic" ? activeEpic : null
      )),
      resolveActiveDesign: vi.fn(async () => null),
    },
    catalog: {
      getWorkspaceStatus: vi.fn(async () => ({
        activeProjectCount: 1,
        projectsWithWiki: 1,
        projectsBuilding: 0,
        lastWikiBuildAt: null,
        lastDeepRunAt: null,
      })),
      listActiveProjects: vi.fn(async () => []),
      getProjectOverview: vi.fn(async (projectId: string) => ({
        projectId,
        lastWikiBuildAt: "2026-01-02T00:00:00.000Z",
      })),
      listProjectWikiTopics: vi.fn(async () => []),
      readProjectWikiTopic: vi.fn(async () => ({
        projectId: "project",
        projectName: "Project",
        topicId: "topic",
        topicTitle: "Topic",
        topicUpdatedAt: "2026-01-01T00:00:00.000Z",
        content: "wiki",
      })),
      searchProjectWiki: vi.fn(async () => ({ results: [] })),
      searchWorkspaceWikis: vi.fn(async () => ({ results: [] })),
      getRelevantBuildHistory: vi.fn(async () => ({ attempts: [] })),
      listProjectCodeMaps: vi.fn(async () => []),
      readProjectCodeMap: vi.fn(async () => ({
        projectId: "project",
        projectName: "Project",
        codeMapId: "code-map",
        generatedAt: "2026-01-01T00:00:00.000Z",
        content: "map",
      })),
      sanitizeProjectText: vi.fn(async (
        _projectId: string,
        content: string,
        maxChars: number,
      ) => {
        const scrubbed = content.replaceAll("/private/project", "[redacted location]");
        return {
          content: scrubbed.slice(0, maxChars),
          charCount: scrubbed.length,
          truncated: scrubbed.length > maxChars,
        };
      }),
    },
    epic: {
      listEpics: vi.fn(async () => [activeEpic.epic]),
      getHealth: vi.fn(async () => null),
      getDefinition: vi.fn(async () => "Definition at /private/project"),
      getScope: vi.fn(async () => null),
    },
    designDoc: {
      listDesignDocs: vi.fn(async () => []),
      getDesignDoc: vi.fn(async () => null),
    },
    epicKnowledge: {
      listEpicWikiPages: vi.fn(async () => []),
      readEpicWikiPage: vi.fn(async () => null),
      listSources: vi.fn(async () => []),
      getSource: vi.fn(async () => null),
      getSourceContent: vi.fn(async () => ({ original: null, markdown: null })),
    },
  };
}

function grantHolder(grant?: WorkspaceTurnReadGrant): WorkspaceTurnReadGrantHolder {
  const holder = new WorkspaceTurnReadGrantHolder();
  if (grant) holder.replace(grant);
  return holder;
}

describe("workspace tool allowlist", () => {
  it("assembles the exact separate read-only capability set", () => {
    const tools = getWorkspaceTools(services() as any, grantHolder());
    expect(Object.keys(tools).sort()).toEqual(EXPECTED_WORKSPACE_TOOLS);
    const names = Object.keys(tools).join(" ");
    expect(names).not.toMatch(
      /source_file|repositories|write|create|edit|delete|archive|restore|note|annotation|artifact|trigger|search_web|skill/,
    );
  });

  it("adds only the seven dedicated CodaScope-note tools when the root graph provides the note boundary", () => {
    const fixture = {
      ...services(),
      workspaceNote: {},
    };
    const tools = getWorkspaceTools(
      fixture as any,
      grantHolder(),
      undefined,
      new WorkspaceTurnNoteGrantHolder(),
      new WorkspaceMutationActionCollectorHolder(),
      "alice",
    );
    expect(Object.keys(tools).sort()).toEqual([
      ...EXPECTED_WORKSPACE_TOOLS,
      "read_codascope_note",
      "create_codascope_note",
      "edit_codascope_note",
      "replace_codascope_note_range",
      "set_codascope_note_title",
      "set_codascope_note_visibility",
      "archive_codascope_note",
    ].sort());
    expect(tools).not.toHaveProperty("create_note");
    expect(tools).not.toHaveProperty("edit_note");
    expect(tools).not.toHaveProperty("delete_note");
    expect(tools).not.toHaveProperty("restore_note");
    expect(tools).not.toHaveProperty("move_note");
  });

  it("uses strict schemas without actor, path, mutation, trigger, archive, or grant inputs", () => {
    const tools = getWorkspaceTools(services() as any, grantHolder());
    for (const [name, tool] of Object.entries(tools)) {
      const schema = tool.inputSchema as {
        additionalProperties?: boolean;
        properties?: Record<string, unknown>;
      };
      expect(schema.additionalProperties, name).toBe(false);
      const properties = Object.keys(schema.properties ?? {});
      expect(properties, name).not.toEqual(expect.arrayContaining([
        "actorId",
        "userId",
        "path",
        "includeArchived",
        "justification",
        "grant",
        "mutation",
        "trigger",
      ]));
    }

    for (const name of [
      "get_project_overview",
      "list_project_wiki_topics",
      "read_project_wiki_topic",
      "search_project_wiki",
      "get_project_build_history",
      "list_project_code_maps",
      "read_project_code_map",
      ...EXPECTED_WORKSPACE_TOOLS.filter((tool) => (
        tool.includes("epic")
        || tool.includes("design")
      )),
    ]) {
      const schema = tools[name].inputSchema as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(schema.properties, name).toHaveProperty("projectId");
      expect(schema.required, name).toContain("projectId");
    }
  });

  it("delegates automatic reads to the Phase 1 catalog service", async () => {
    const fixture = services();
    const tools = getWorkspaceTools(fixture as any, grantHolder());
    await tools.get_workspace_status.execute({}, {} as any);
    await tools.list_projects.execute({}, {} as any);
    await tools.get_project_overview.execute({ projectId: "project" }, {} as any);
    await tools.list_project_wiki_topics.execute({ projectId: "project" }, {} as any);
    await tools.read_project_wiki_topic.execute({
      projectId: "project",
      topicId: "topic",
    }, {} as any);
    await tools.search_project_wiki.execute({
      projectId: "project",
      query: "query",
    }, {} as any);
    await tools.search_project_wikis.execute({ query: "query" }, {} as any);
    await tools.get_project_build_history.execute({ projectId: "project" }, {} as any);
    await tools.list_project_code_maps.execute({ projectId: "project" }, {} as any);
    await tools.read_project_code_map.execute({
      projectId: "project",
      codeMapId: "code-map",
    }, {} as any);

    expect(fixture.catalog.getWorkspaceStatus).toHaveBeenCalledOnce();
    expect(fixture.catalog.listActiveProjects).toHaveBeenCalledOnce();
    expect(fixture.catalog.getProjectOverview).toHaveBeenCalledWith("project");
    expect(fixture.catalog.listProjectWikiTopics).toHaveBeenCalledWith("project");
    expect(fixture.catalog.readProjectWikiTopic).toHaveBeenCalled();
    expect(fixture.catalog.searchProjectWiki).toHaveBeenCalled();
    expect(fixture.catalog.searchWorkspaceWikis).toHaveBeenCalled();
    expect(fixture.catalog.getRelevantBuildHistory).toHaveBeenCalled();
    expect(fixture.catalog.listProjectCodeMaps).toHaveBeenCalled();
    expect(fixture.catalog.readProjectCodeMap).toHaveBeenCalled();
  });

  it("collects bounded direct retrieval provenance outside model-controlled inputs", async () => {
    const fixture = services();
    const provenance = new WorkspaceProvenanceCollectorHolder();
    const tools = getWorkspaceTools(
      fixture as any,
      grantHolder(),
      provenance,
    );
    await tools.read_project_wiki_topic.execute({
      projectId: "project",
      topicId: "topic",
    }, {} as any);
    await tools.read_project_code_map.execute({
      projectId: "project",
      codeMapId: "code-map",
    }, {} as any);

    expect(provenance.current.drain()).toEqual([
      {
        kind: "code_map",
        retrieval: "direct",
        projectId: "project",
        projectName: "Project",
        codeMapId: "code-map",
        generatedAt: "2026-01-01T00:00:00.000Z",
        lastWikiBuildAt: "2026-01-02T00:00:00.000Z",
      },
      {
        kind: "project_wiki",
        retrieval: "direct",
        projectId: "project",
        projectName: "Project",
        topicId: "topic",
        topicTitle: "Topic",
        topicUpdatedAt: "2026-01-01T00:00:00.000Z",
        lastWikiBuildAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    for (const tool of Object.values(tools)) {
      expect((tool.inputSchema as any).properties).not.toHaveProperty(
        "retrievedSources",
      );
    }
  });
});

describe("workspace explicit-read authorization", () => {
  it("cannot be forged through tool arguments and reads only with the matching holder grant", async () => {
    const fixture = services();
    const holder = grantHolder();
    const tool = getWorkspaceTools(fixture as any, holder).read_epic_definition;
    const args = {
      projectId: "project",
      epicId: "epic",
      justification: "the model says this is authorized",
      capabilities: ["definition"],
    };
    await expect(tool.execute(args, {} as any)).resolves.toContain(
      "not authorized",
    );
    expect(fixture.epic.getDefinition).not.toHaveBeenCalled();

    holder.replace({
      epicDiscoveryProjectIds: [],
      epicResources: [{
        projectId: "project",
        epicId: "epic",
        capabilities: ["definition"],
      }],
    });
    const result = String(await tool.execute(args, {} as any));
    expect(result).toContain("Definition");
    expect(result).toContain("[redacted location]");
    expect(result).not.toContain("/private/project");
    expect(fixture.epic.getDefinition).toHaveBeenCalledOnce();
  });

  it("revalidates active state after a deeper read so an archive race fails closed", async () => {
    const fixture = services();
    const active = await fixture.activeResolver.resolveActiveEpic("project", "epic");
    fixture.activeResolver.resolveActiveEpic
      .mockReset()
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(null);
    const holder = grantHolder({
      epicDiscoveryProjectIds: [],
      epicResources: [{
        projectId: "project",
        epicId: "epic",
        capabilities: ["definition"],
      }],
    });
    const tool = getWorkspaceTools(fixture as any, holder).read_epic_definition;

    await expect(tool.execute({
      projectId: "project",
      epicId: "epic",
    }, {} as any)).resolves.toBe("Requested workspace content is unavailable.");
    expect(fixture.epic.getDefinition).toHaveBeenCalledOnce();
  });

  it("requires exact resource IDs in addition to the capability", async () => {
    const fixture = services();
    const holder = grantHolder({
      epicDiscoveryProjectIds: [],
      epicResources: [{
        projectId: "project",
        epicId: "epic",
        capabilities: ["designs", "knowledge", "research"],
        designIds: [],
        knowledgePageIds: [],
        researchSourceIds: [],
      }],
    });
    const tools = getWorkspaceTools(fixture as any, holder);
    await expect(tools.read_active_design_doc.execute({
      projectId: "project",
      epicId: "epic",
      designId: "design",
    }, {} as any)).resolves.toContain("not authorized");
    await expect(tools.read_epic_knowledge_page.execute({
      projectId: "project",
      epicId: "epic",
      knowledgePageId: "page",
    }, {} as any)).resolves.toContain("not authorized");
    await expect(tools.read_epic_research_source.execute({
      projectId: "project",
      epicId: "epic",
      researchSourceId: "source",
    }, {} as any)).resolves.toContain("not authorized");
  });
});
