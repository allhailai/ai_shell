/* ── CodaScope: Workspace Read Tools ─────────────────────────────────
   Active-only, path-scrubbed workspace discovery plus server-granted epic
   reads. This builder is intentionally independent of every project tool tier.
   ──────────────────────────────────────────────────────────────────── */

import type { SDKCustomTool, SDKJsonValue } from "@cursor/sdk";
import type { WorkspaceToolServices } from "../codaScopeWorkspaceToolDefinitions.js";
import {
  WORKSPACE_BUILD_HISTORY_DEFAULT_LIMIT,
  WORKSPACE_CODE_MAP_DEFAULT_MAX_CHARS,
  WORKSPACE_SEARCH_DEFAULT_LIMIT,
  WORKSPACE_SEARCH_DEFAULT_PER_PROJECT,
  WORKSPACE_TOPIC_DEFAULT_MAX_CHARS,
  type WorkspaceProjectOverview,
} from "../codaScopeWorkspaceCatalogService.js";
import {
  hasWorkspaceEpicCapability,
  hasWorkspaceEpicDiscoveryGrant,
  hasWorkspaceResourceGrant,
  type WorkspaceEpicReadCapability,
  type WorkspaceTurnReadGrantHolder,
} from "../codaScopeWorkspaceReadGrant.js";
import type { WorkspaceProvenanceCollectorHolder } from "../codaScopeWorkspaceProvenance.js";

const WORKSPACE_CATALOG_MAX_ITEMS = 50;
const WORKSPACE_PROJECT_CATALOG_MAX_ITEMS = 100;
const WORKSPACE_PROJECT_DESCRIPTION_MAX_CHARS = 2_000;
const WORKSPACE_DEEP_DEFAULT_MAX_CHARS = 20_000;
const WORKSPACE_DEEP_MAX_CHARS = 50_000;
const WORKSPACE_METADATA_TEXT_MAX_CHARS = 500;
const WORKSPACE_UNAVAILABLE = "Requested workspace content is unavailable.";
const WORKSPACE_UNAUTHORIZED =
  "This deeper workspace read is not authorized for the current turn.";

type ToolArgs = Record<string, unknown>;

export function buildWorkspaceReadTools(
  services: WorkspaceToolServices,
  grantHolder: WorkspaceTurnReadGrantHolder,
  provenanceHolder?: WorkspaceProvenanceCollectorHolder,
): Record<string, SDKCustomTool> {
  const {
    activeResolver,
    catalog,
    epic: epicService,
    designDoc: designDocService,
    epicKnowledge: epicKnowledgeService,
  } = services;

  const automatic = <T>(read: () => Promise<T>): Promise<string> =>
    controlledRead(async () => JSON.stringify(await read()));

  const requireEpic = async (
    projectId: string,
    epicId: string,
    capability: WorkspaceEpicReadCapability,
  ) => {
    if (!hasWorkspaceEpicCapability(
      grantHolder.current,
      projectId,
      epicId,
      capability,
    )) {
      throw new WorkspaceGrantRefusal();
    }
    const active = await activeResolver.resolveActiveEpic(projectId, epicId);
    if (!active) throw new WorkspaceContentUnavailable();
    return active;
  };

  const requireResource = async (
    projectId: string,
    epicId: string,
    capability: "designs" | "knowledge" | "research",
    resourceId: string,
  ) => {
    if (!hasWorkspaceResourceGrant(
      grantHolder.current,
      projectId,
      epicId,
      capability,
      resourceId,
    )) {
      throw new WorkspaceGrantRefusal();
    }
    await requireEpic(projectId, epicId, capability);
  };

  const sanitizeSerialized = async (
    projectId: string,
    value: unknown,
  ): Promise<string> => {
    const serialized = JSON.stringify(value);
    const sanitized = await catalog.sanitizeProjectText(
      projectId,
      serialized,
      WORKSPACE_DEEP_MAX_CHARS,
    );
    if (sanitized.truncated) throw new WorkspaceContentUnavailable();
    return sanitized.content;
  };

  return {
    get_workspace_status: {
      description:
        "Get compact active-workspace counts and distinct wiki, build, and Deep Run status.",
      inputSchema: emptySchema(),
      execute: async () => automatic(() => catalog.getWorkspaceStatus()),
    },

    list_projects: {
      description:
        "List active projects with descriptions, repository counts, wiki state, and build freshness. Repository identities and paths are never returned.",
      inputSchema: emptySchema(),
      execute: async () => controlledRead(async () => {
        const projects = await catalog.listActiveProjects();
        return JSON.stringify({
          projects: projects.slice(0, WORKSPACE_PROJECT_CATALOG_MAX_ITEMS)
            .map(publicProjectOverview),
          truncated: projects.length > WORKSPACE_PROJECT_CATALOG_MAX_ITEMS,
        });
      }),
    },

    get_project_overview: {
      description:
        "Get an active project's exact workspace overview. Requires an explicit projectId.",
      inputSchema: objectSchema({
        projectId: stringProperty("Active project ID"),
      }, ["projectId"]),
      execute: async (args) => controlledRead(async () => JSON.stringify(
        publicProjectOverview(await catalog.getProjectOverview(
          requiredString(args, "projectId"),
        )),
      )),
    },

    list_project_wiki_topics: {
      description:
        "List active, non-system wiki topics for one explicit active project.",
      inputSchema: objectSchema({
        projectId: stringProperty("Active project ID"),
      }, ["projectId"]),
      execute: async (args) => controlledRead(async () => {
        const topics = await catalog.listProjectWikiTopics(
          requiredString(args, "projectId"),
        );
        return JSON.stringify({
          topics: topics.slice(0, WORKSPACE_PROJECT_CATALOG_MAX_ITEMS),
          truncated: topics.length > WORKSPACE_PROJECT_CATALOG_MAX_ITEMS,
        });
      }),
    },

    read_project_wiki_topic: {
      description:
        "Read one bounded active project wiki topic with project/topic provenance and freshness.",
      inputSchema: objectSchema({
        projectId: stringProperty("Active project ID"),
        topicId: stringProperty("Wiki topic ID"),
        maxChars: integerProperty(
          "Maximum content characters",
          1,
          WORKSPACE_DEEP_MAX_CHARS,
        ),
      }, ["projectId", "topicId"]),
      execute: async (args) => controlledRead(async () => {
        const result = await catalog.readProjectWikiTopic(
          requiredString(args, "projectId"),
          requiredString(args, "topicId"),
          optionalInteger(args, "maxChars", WORKSPACE_TOPIC_DEFAULT_MAX_CHARS),
        );
        const overview = await catalog.getProjectOverview(result.projectId);
        provenanceHolder?.collect({
          kind: "project_wiki",
          retrieval: "direct",
          projectId: result.projectId,
          projectName: result.projectName,
          topicId: result.topicId,
          topicTitle: result.topicTitle,
          topicUpdatedAt: result.topicUpdatedAt,
          lastWikiBuildAt: overview.lastWikiBuildAt,
        });
        return JSON.stringify(result);
      }),
    },

    search_project_wiki: {
      description:
        "Search one explicit active project's wiki with bounded, provenance-rich results.",
      inputSchema: objectSchema({
        projectId: stringProperty("Active project ID"),
        query: queryProperty(),
        limit: integerProperty("Maximum results", 1, 30),
        perProjectCandidates: integerProperty("Maximum candidates", 1, 5),
      }, ["projectId", "query"]),
      execute: async (args) => controlledRead(async () => {
        const result = await catalog.searchProjectWiki(
          requiredString(args, "projectId"),
          requiredString(args, "query"),
          {
            limit: optionalInteger(args, "limit", WORKSPACE_SEARCH_DEFAULT_LIMIT),
            perProjectCandidates: optionalInteger(
              args,
              "perProjectCandidates",
              WORKSPACE_SEARCH_DEFAULT_PER_PROJECT,
            ),
          },
        );
        for (const source of result.results) {
          provenanceHolder?.collect({
            kind: "project_wiki",
            retrieval: "search",
            projectId: source.projectId,
            projectName: source.projectName,
            topicId: source.topicId,
            topicTitle: source.topicTitle,
            topicUpdatedAt: source.topicUpdatedAt,
            lastWikiBuildAt: source.lastWikiBuildAt,
          });
        }
        return JSON.stringify(result);
      }),
    },

    search_project_wikis: {
      description:
        "Search active project wikis across the workspace. Optional projectIds narrow the bounded cross-project search.",
      inputSchema: objectSchema({
        query: queryProperty(),
        projectIds: {
          type: "array",
          description: "Optional active project IDs",
          items: { type: "string", minLength: 1, maxLength: 255 },
          maxItems: 25,
        },
        limit: integerProperty("Maximum global results", 1, 30),
        perProjectCandidates: integerProperty(
          "Maximum candidates per project",
          1,
          5,
        ),
      }, ["query"]),
      execute: async (args) => controlledRead(async () => {
        const result = await catalog.searchWorkspaceWikis(
          requiredString(args, "query"),
          {
            ...(args.projectIds === undefined
              ? {}
              : { projectIds: requiredStringArray(args, "projectIds") }),
            limit: optionalInteger(args, "limit", WORKSPACE_SEARCH_DEFAULT_LIMIT),
            perProjectCandidates: optionalInteger(
              args,
              "perProjectCandidates",
              WORKSPACE_SEARCH_DEFAULT_PER_PROJECT,
            ),
          },
        );
        for (const source of result.results) {
          provenanceHolder?.collect({
            kind: "project_wiki",
            retrieval: "search",
            projectId: source.projectId,
            projectName: source.projectName,
            topicId: source.topicId,
            topicTitle: source.topicTitle,
            topicUpdatedAt: source.topicUpdatedAt,
            lastWikiBuildAt: source.lastWikiBuildAt,
          });
        }
        return JSON.stringify(result);
      }),
    },

    get_project_build_history: {
      description:
        "Get bounded Analyze and Deep Run history for one explicit active project.",
      inputSchema: objectSchema({
        projectId: stringProperty("Active project ID"),
        limit: integerProperty("Maximum build attempts", 1, 100),
      }, ["projectId"]),
      execute: async (args) => automatic(() => catalog.getRelevantBuildHistory(
        requiredString(args, "projectId"),
        optionalInteger(args, "limit", WORKSPACE_BUILD_HISTORY_DEFAULT_LIMIT),
      )),
    },

    list_project_code_maps: {
      description:
        "List path-scrubbed code maps for one explicit active project. Source files and repository identities are unavailable.",
      inputSchema: objectSchema({
        projectId: stringProperty("Active project ID"),
      }, ["projectId"]),
      execute: async (args) => controlledRead(async () => {
        const codeMaps = await catalog.listProjectCodeMaps(
          requiredString(args, "projectId"),
        );
        return JSON.stringify({
          codeMaps: codeMaps.slice(0, WORKSPACE_PROJECT_CATALOG_MAX_ITEMS),
          truncated: codeMaps.length > WORKSPACE_PROJECT_CATALOG_MAX_ITEMS,
        });
      }),
    },

    read_project_code_map: {
      description:
        "Read one bounded, path-scrubbed code map for an explicit active project.",
      inputSchema: objectSchema({
        projectId: stringProperty("Active project ID"),
        codeMapId: stringProperty("Code map ID"),
        maxChars: integerProperty(
          "Maximum content characters",
          1,
          WORKSPACE_DEEP_MAX_CHARS,
        ),
      }, ["projectId", "codeMapId"]),
      execute: async (args) => controlledRead(async () => {
        const result = await catalog.readProjectCodeMap(
          requiredString(args, "projectId"),
          requiredString(args, "codeMapId"),
          optionalInteger(
            args,
            "maxChars",
            WORKSPACE_CODE_MAP_DEFAULT_MAX_CHARS,
          ),
        );
        const overview = await catalog.getProjectOverview(result.projectId);
        provenanceHolder?.collect({
          kind: "code_map",
          retrieval: "direct",
          projectId: result.projectId,
          projectName: result.projectName,
          codeMapId: result.codeMapId,
          generatedAt: result.generatedAt,
          lastWikiBuildAt: overview.lastWikiBuildAt,
        });
        return JSON.stringify(result);
      }),
    },

    list_active_epics: {
      description:
        "List active epic metadata for an explicitly granted active project.",
      inputSchema: objectSchema({
        projectId: stringProperty("Granted active project ID"),
      }, ["projectId"]),
      execute: async (args) => controlledRead(async () => {
        const projectId = requiredString(args, "projectId");
        if (!hasWorkspaceEpicDiscoveryGrant(grantHolder.current, projectId)) {
          throw new WorkspaceGrantRefusal();
        }
        if (!await activeResolver.resolveActiveProject(projectId)) {
          throw new WorkspaceContentUnavailable();
        }
        const listed = await epicService.listEpics(projectId);
        const epics = [];
        let truncated = false;
        for (const candidate of listed) {
          const active = await activeResolver.resolveActiveEpic(
            projectId,
            candidate.id,
          );
          if (!active) continue;
          if (epics.length >= WORKSPACE_CATALOG_MAX_ITEMS) {
            truncated = true;
            continue;
          }
          epics.push(publicEpic(active.epic));
        }
        if (!await activeResolver.resolveActiveProject(projectId)) {
          throw new WorkspaceContentUnavailable();
        }
        return sanitizeSerialized(projectId, {
          projectId,
          epics,
          truncated,
        });
      }),
    },

    get_active_epic_overview: {
      description:
        "Read active epic metadata when the current server grant includes metadata.",
      inputSchema: epicSchema(),
      execute: async (args) => controlledRead(async () => {
        const { projectId, epicId } = epicArgs(args);
        const active = await requireEpic(projectId, epicId, "metadata");
        const health = await epicService.getHealth(projectId, epicId);
        const revalidated = await activeResolver.resolveActiveEpic(projectId, epicId);
        if (!revalidated) throw new WorkspaceContentUnavailable();
        return sanitizeSerialized(projectId, {
          projectId,
          epic: publicEpic(active.epic),
          health: health ? {
            health: health.health,
            reason: clip(health.reason),
            lastActivityAt: health.lastActivityAt,
            openAnnotationCount: health.openAnnotationCount,
            activeCollaboratorCount: health.activeCollaboratorCount,
          } : null,
        });
      }),
    },

    read_epic_definition: {
      description:
        "Read bounded active epic definition markdown when the current server grant includes definition.",
      inputSchema: contentEpicSchema(),
      execute: async (args) => controlledRead(async () => {
        const { projectId, epicId } = epicArgs(args);
        await requireEpic(projectId, epicId, "definition");
        const content = await epicService.getDefinition(projectId, epicId);
        if (content === null
          || !await activeResolver.resolveActiveEpic(projectId, epicId)) {
          throw new WorkspaceContentUnavailable();
        }
        const sanitized = await catalog.sanitizeProjectText(
          projectId,
          content,
          optionalInteger(args, "maxChars", WORKSPACE_DEEP_DEFAULT_MAX_CHARS),
        );
        return JSON.stringify({ projectId, epicId, ...sanitized });
      }),
    },

    read_epic_scope: {
      description:
        "Read an active epic scope when the current server grant includes scope.",
      inputSchema: epicSchema(),
      execute: async (args) => controlledRead(async () => {
        const { projectId, epicId } = epicArgs(args);
        await requireEpic(projectId, epicId, "scope");
        const scope = await epicService.getScope(projectId, epicId);
        if (!await activeResolver.resolveActiveEpic(projectId, epicId)) {
          throw new WorkspaceContentUnavailable();
        }
        return sanitizeSerialized(projectId, { projectId, epicId, scope });
      }),
    },

    list_active_design_docs: {
      description:
        "List active, non-archived design documents when the current server grant includes designs.",
      inputSchema: epicSchema(),
      execute: async (args) => controlledRead(async () => {
        const { projectId, epicId } = epicArgs(args);
        await requireEpic(projectId, epicId, "designs");
        const listed = await designDocService.listDesignDocs(projectId, epicId);
        const activeDocs = [];
        let truncated = false;
        for (const document of listed
          .filter((candidate) => !candidate.archivedAt)
          .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))) {
          if (!await activeResolver.resolveActiveDesign(
            projectId,
            epicId,
            document.id,
          )) continue;
          if (activeDocs.length >= WORKSPACE_CATALOG_MAX_ITEMS) {
            truncated = true;
            continue;
          }
          activeDocs.push(publicDesign(document));
        }
        if (!await activeResolver.resolveActiveEpic(projectId, epicId)) {
          throw new WorkspaceContentUnavailable();
        }
        return sanitizeSerialized(projectId, {
          projectId,
          epicId,
          documents: activeDocs,
          truncated,
        });
      }),
    },

    read_active_design_doc: {
      description:
        "Read one bounded active design document when its exact ID is present in the current server grant.",
      inputSchema: objectSchema({
        projectId: stringProperty("Granted active project ID"),
        epicId: stringProperty("Granted active epic ID"),
        designId: stringProperty("Granted active design document ID"),
        maxChars: integerProperty(
          "Maximum content characters",
          1,
          WORKSPACE_DEEP_MAX_CHARS,
        ),
      }, ["projectId", "epicId", "designId"]),
      execute: async (args) => controlledRead(async () => {
        const { projectId, epicId } = epicArgs(args);
        const designId = requiredString(args, "designId");
        await requireResource(projectId, epicId, "designs", designId);
        if (!await activeResolver.resolveActiveDesign(
          projectId,
          epicId,
          designId,
        )) throw new WorkspaceContentUnavailable();
        const result = await designDocService.getDesignDoc(
          projectId,
          epicId,
          designId,
        );
        if (!result || !await activeResolver.resolveActiveDesign(
          projectId,
          epicId,
          designId,
        )) throw new WorkspaceContentUnavailable();
        const sanitized = await catalog.sanitizeProjectText(
          projectId,
          result.content,
          optionalInteger(args, "maxChars", WORKSPACE_DEEP_DEFAULT_MAX_CHARS),
        );
        return sanitizeSerialized(projectId, {
          projectId,
          epicId,
          document: publicDesign(result.doc),
          content: sanitized.content,
          charCount: sanitized.charCount,
          truncated: sanitized.truncated,
        });
      }),
    },

    list_epic_knowledge_pages: {
      description:
        "List bounded curated knowledge pages for an active epic when the current server grant includes knowledge.",
      inputSchema: epicSchema(),
      execute: async (args) => controlledRead(async () => {
        const { projectId, epicId } = epicArgs(args);
        await requireEpic(projectId, epicId, "knowledge");
        const listed = await epicKnowledgeService.listEpicWikiPages(
          projectId,
          epicId,
        );
        if (!await activeResolver.resolveActiveEpic(projectId, epicId)) {
          throw new WorkspaceContentUnavailable();
        }
        const sorted = listed
          .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
        return sanitizeSerialized(projectId, {
          projectId,
          epicId,
          pages: sorted.slice(0, WORKSPACE_CATALOG_MAX_ITEMS).map((page) => ({
            id: page.id,
            title: clip(page.title),
            createdAt: page.createdAt,
            updatedAt: page.updatedAt,
            wordCount: page.wordCount,
            sourceRefs: page.sourceRefs.slice(0, WORKSPACE_CATALOG_MAX_ITEMS),
          })),
          truncated: sorted.length > WORKSPACE_CATALOG_MAX_ITEMS,
        });
      }),
    },

    read_epic_knowledge_page: {
      description:
        "Read one bounded curated epic knowledge page when its exact ID is present in the current server grant.",
      inputSchema: resourceContentSchema("knowledgePageId", "Granted knowledge page ID"),
      execute: async (args) => controlledRead(async () => {
        const { projectId, epicId } = epicArgs(args);
        const pageId = requiredString(args, "knowledgePageId");
        await requireResource(projectId, epicId, "knowledge", pageId);
        const before = await epicKnowledgeService.listEpicWikiPages(projectId, epicId);
        if (!before.some((page) => page.id === pageId)) {
          throw new WorkspaceContentUnavailable();
        }
        const content = await epicKnowledgeService.readEpicWikiPage(
          projectId,
          epicId,
          pageId,
        );
        const after = await epicKnowledgeService.listEpicWikiPages(projectId, epicId);
        if (content === null
          || !after.some((page) => page.id === pageId)
          || !await activeResolver.resolveActiveEpic(projectId, epicId)) {
          throw new WorkspaceContentUnavailable();
        }
        const sanitized = await catalog.sanitizeProjectText(
          projectId,
          content,
          optionalInteger(args, "maxChars", WORKSPACE_DEEP_DEFAULT_MAX_CHARS),
        );
        return JSON.stringify({ projectId, epicId, pageId, ...sanitized });
      }),
    },

    list_epic_research_sources: {
      description:
        "List bounded research source metadata for an active epic when the current server grant includes research.",
      inputSchema: epicSchema(),
      execute: async (args) => controlledRead(async () => {
        const { projectId, epicId } = epicArgs(args);
        await requireEpic(projectId, epicId, "research");
        const listed = await epicKnowledgeService.listSources(projectId, epicId);
        if (!await activeResolver.resolveActiveEpic(projectId, epicId)) {
          throw new WorkspaceContentUnavailable();
        }
        const sorted = listed.sort((a, b) => (
          b.addedAt.localeCompare(a.addedAt) || a.id.localeCompare(b.id)
        ));
        return sanitizeSerialized(projectId, {
          projectId,
          epicId,
          sources: sorted.slice(0, WORKSPACE_CATALOG_MAX_ITEMS)
            .map(publicResearchSource),
          truncated: sorted.length > WORKSPACE_CATALOG_MAX_ITEMS,
        });
      }),
    },

    read_epic_research_source: {
      description:
        "Read bounded processed research markdown when its exact source ID is present in the current server grant.",
      inputSchema: resourceContentSchema("researchSourceId", "Granted research source ID"),
      execute: async (args) => controlledRead(async () => {
        const { projectId, epicId } = epicArgs(args);
        const sourceId = requiredString(args, "researchSourceId");
        await requireResource(projectId, epicId, "research", sourceId);
        const source = await epicKnowledgeService.getSource(
          projectId,
          epicId,
          sourceId,
        );
        if (!source) throw new WorkspaceContentUnavailable();
        const content = await epicKnowledgeService.getSourceContent(
          projectId,
          epicId,
          sourceId,
        );
        const current = await epicKnowledgeService.getSource(
          projectId,
          epicId,
          sourceId,
        );
        if (!content.markdown
          || !current
          || !await activeResolver.resolveActiveEpic(projectId, epicId)) {
          throw new WorkspaceContentUnavailable();
        }
        const sanitized = await catalog.sanitizeProjectText(
          projectId,
          content.markdown,
          optionalInteger(args, "maxChars", WORKSPACE_DEEP_DEFAULT_MAX_CHARS),
        );
        return sanitizeSerialized(projectId, {
          projectId,
          epicId,
          source: publicResearchSource(current),
          content: sanitized.content,
          charCount: sanitized.charCount,
          truncated: sanitized.truncated,
        });
      }),
    },
  };
}

class WorkspaceGrantRefusal extends Error {}
class WorkspaceContentUnavailable extends Error {}

async function controlledRead(read: () => Promise<string>): Promise<string> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof WorkspaceGrantRefusal) return WORKSPACE_UNAUTHORIZED;
    return WORKSPACE_UNAVAILABLE;
  }
}

function publicProjectOverview(project: WorkspaceProjectOverview) {
  return {
    ...project,
    description: project.description.slice(
      0,
      WORKSPACE_PROJECT_DESCRIPTION_MAX_CHARS,
    ),
    descriptionTruncated:
      project.description.length > WORKSPACE_PROJECT_DESCRIPTION_MAX_CHARS,
  };
}

function publicEpic(epic: {
  id: string;
  projectId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  collaborators: string[];
  currentVersion: number;
}) {
  return {
    id: epic.id,
    projectId: epic.projectId,
    title: clip(epic.title),
    status: epic.status,
    createdAt: epic.createdAt,
    updatedAt: epic.updatedAt,
    createdBy: clip(epic.createdBy),
    collaborators: epic.collaborators.slice(0, WORKSPACE_CATALOG_MAX_ITEMS)
      .map(clip),
    currentVersion: epic.currentVersion,
  };
}

function publicDesign(document: {
  id: string;
  epicId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  wordCount: number;
  blockCount: number;
  annotationCount: number;
  directiveCount: number;
  pinnedAt?: string;
}) {
  return {
    id: document.id,
    epicId: document.epicId,
    title: clip(document.title),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    createdBy: clip(document.createdBy),
    wordCount: document.wordCount,
    blockCount: document.blockCount,
    annotationCount: document.annotationCount,
    directiveCount: document.directiveCount,
    ...(document.pinnedAt ? { pinnedAt: document.pinnedAt } : {}),
  };
}

function publicResearchSource(source: {
  id: string;
  type: string;
  origin: string;
  url?: string;
  filename: string;
  contentType: string;
  title: string;
  status: string;
  addedAt: string;
  processedAt?: string;
  sizeBytesOriginal: number;
  sizeBytesMarkdown?: number;
  topicAssociations: string[];
}) {
  return {
    id: source.id,
    type: source.type,
    origin: source.origin,
    ...(source.url ? { url: clip(source.url) } : {}),
    filename: clip(source.filename),
    contentType: clip(source.contentType),
    title: clip(source.title),
    status: source.status,
    addedAt: source.addedAt,
    ...(source.processedAt ? { processedAt: source.processedAt } : {}),
    sizeBytesOriginal: source.sizeBytesOriginal,
    ...(source.sizeBytesMarkdown === undefined
      ? {}
      : { sizeBytesMarkdown: source.sizeBytesMarkdown }),
    topicAssociations: source.topicAssociations
      .slice(0, WORKSPACE_CATALOG_MAX_ITEMS)
      .map(clip),
  };
}

function clip(value: string): string {
  return value.slice(0, WORKSPACE_METADATA_TEXT_MAX_CHARS);
}

function epicArgs(args: ToolArgs): { projectId: string; epicId: string } {
  return {
    projectId: requiredString(args, "projectId"),
    epicId: requiredString(args, "epicId"),
  };
}

function requiredString(args: ToolArgs, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 255) {
    throw new WorkspaceContentUnavailable();
  }
  return value;
}

function requiredStringArray(args: ToolArgs, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)
    || value.length > 25
    || value.some((item) => (
      typeof item !== "string"
      || item.length === 0
      || item.length > 255
    ))) {
    throw new WorkspaceContentUnavailable();
  }
  return value as string[];
}

function optionalInteger(args: ToolArgs, key: string, fallback: number): number {
  const value = args[key];
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value)) throw new WorkspaceContentUnavailable();
  return value as number;
}

function emptySchema() {
  return objectSchema({}, []);
}

function epicSchema() {
  return objectSchema({
    projectId: stringProperty("Granted active project ID"),
    epicId: stringProperty("Granted active epic ID"),
  }, ["projectId", "epicId"]);
}

function contentEpicSchema() {
  return objectSchema({
    projectId: stringProperty("Granted active project ID"),
    epicId: stringProperty("Granted active epic ID"),
    maxChars: integerProperty(
      "Maximum content characters",
      1,
      WORKSPACE_DEEP_MAX_CHARS,
    ),
  }, ["projectId", "epicId"]);
}

function resourceContentSchema(resourceKey: string, description: string) {
  return objectSchema({
    projectId: stringProperty("Granted active project ID"),
    epicId: stringProperty("Granted active epic ID"),
    [resourceKey]: stringProperty(description),
    maxChars: integerProperty(
      "Maximum content characters",
      1,
      WORKSPACE_DEEP_MAX_CHARS,
    ),
  }, ["projectId", "epicId", resourceKey]);
}

function stringProperty(description: string) {
  return {
    type: "string",
    description,
    minLength: 1,
    maxLength: 255,
  };
}

function queryProperty() {
  return {
    type: "string",
    description: "Search query",
    minLength: 2,
    maxLength: 200,
  };
}

function integerProperty(
  description: string,
  minimum: number,
  maximum: number,
) {
  return {
    type: "integer",
    description,
    minimum,
    maximum,
  };
}

function objectSchema(
  properties: Record<string, SDKJsonValue>,
  required: string[],
): Record<string, SDKJsonValue> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}
