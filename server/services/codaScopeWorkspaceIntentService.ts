/* ── CodaScope: Workspace Intent and Grant Resolver ─────────────────
   Deterministic, conservative server-side derivation. Neither clients nor
   models can author a WorkspaceTurnReadGrant.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeActiveEntityResolver } from "./codaScopeActiveEntityResolver.js";
import type { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";
import type { CodaScopeEpicKnowledgeService } from "./codaScopeEpicKnowledgeService.js";
import type { CodaScopeEpicService } from "./codaScopeEpicService.js";
import {
  EMPTY_WORKSPACE_TURN_READ_GRANT,
  validateWorkspaceTurnReadGrant,
  type WorkspaceEpicReadCapability,
  type WorkspaceEpicResourceGrant,
  type WorkspaceTurnReadGrant,
} from "./codaScopeWorkspaceReadGrant.js";

export type WorkspaceIntentClass =
  | "wiki_first"
  | "project_planning"
  | "epic"
  | "epic_design"
  | "epic_knowledge"
  | "epic_research";

export interface WorkspaceIntentResolution {
  intent: WorkspaceIntentClass;
  resolvedProjectIds: string[];
  grant: WorkspaceTurnReadGrant;
}

export class CodaScopeWorkspaceIntentService {
  constructor(
    private readonly activeResolver: CodaScopeActiveEntityResolver,
    private readonly epicService: CodaScopeEpicService,
    private readonly designDocService: CodaScopeDesignDocService,
    private readonly epicKnowledgeService: CodaScopeEpicKnowledgeService,
  ) {}

  async resolveTurn(
    message: string,
    explicitlyReferencedProjectIds: readonly string[],
  ): Promise<WorkspaceIntentResolution> {
    const normalizedMessage = normalize(message);
    if (!normalizedMessage) return emptyResolution();

    const activeProjects = await this.activeResolver.listActiveProjects();
    const explicitProjects = [];
    for (const projectId of [...new Set(explicitlyReferencedProjectIds)].sort()) {
      const active = await this.activeResolver.resolveActiveProject(projectId);
      if (!active) return emptyResolution();
      explicitProjects.push(active);
    }

    const mentioned = resolveMentionedProjects(normalizedMessage, activeProjects);
    if (mentioned.ambiguous) return emptyResolution();
    const selectedProjects = deduplicateProjects([
      ...explicitProjects,
      ...mentioned.projects,
    ]);
    const resolvedProjectIds = selectedProjects.map((project) => project.projectId);

    const designIntent = /\bdesign(?:s| docs?| documents?)?\b/.test(normalizedMessage);
    const knowledgeIntent = /\b(?:curated )?knowledge(?: pages?)?\b/.test(normalizedMessage);
    const researchIntent = /\b(?:research|research sources?|sources? from research)\b/.test(
      normalizedMessage,
    );
    const planningIntent = /\b(?:active )?roadmaps?\b/.test(normalizedMessage)
      || /\bcurrently planning\b/.test(normalizedMessage)
      || /\bproject planning\b/.test(normalizedMessage);
    const epicIntent = /\bepics?\b/.test(normalizedMessage);
    const genericImplementation = /\b(?:architecture|architectural|implement|implementation|code)\b/
      .test(normalizedMessage);

    if (
      genericImplementation
      && !planningIntent
      && !epicIntent
      && !designIntent
      && !knowledgeIntent
      && !researchIntent
    ) {
      return {
        intent: "wiki_first",
        resolvedProjectIds,
        grant: EMPTY_WORKSPACE_TURN_READ_GRANT,
      };
    }

    if (planningIntent) {
      if (selectedProjects.length === 0) return emptyResolution(resolvedProjectIds);
      const epicResources = [];
      const discoveryIds = [];
      for (const project of selectedProjects) {
        discoveryIds.push(project.projectId);
        epicResources.push(...await this.resourcesForPlanning(
          project.projectId,
          { designIntent, knowledgeIntent, researchIntent },
        ));
      }
      return {
        intent: intentClass(designIntent, knowledgeIntent, researchIntent, true),
        resolvedProjectIds,
        grant: await validateWorkspaceTurnReadGrant({
          epicDiscoveryProjectIds: discoveryIds,
          epicResources,
        }, this.activeResolver),
      };
    }

    if (!epicIntent && !designIntent && !knowledgeIntent && !researchIntent) {
      return {
        intent: "wiki_first",
        resolvedProjectIds,
        grant: EMPTY_WORKSPACE_TURN_READ_GRANT,
      };
    }

    const searchProjects = selectedProjects.length > 0
      ? selectedProjects
      : activeProjects;
    const matchingEpics = [];
    for (const project of searchProjects) {
      for (const listed of await this.epicService.listEpics(project.projectId)) {
        const active = await this.activeResolver.resolveActiveEpic(
          project.projectId,
          listed.id,
        );
        if (!active) continue;
        if (mentionsEpic(normalizedMessage, active.epic.title, active.epic.id)) {
          matchingEpics.push(active);
        }
      }
    }
    if (matchingEpics.length === 0) return emptyResolution(resolvedProjectIds);

    const isComparison = /\b(?:compare|comparison|versus|vs)\b/.test(normalizedMessage);
    const pluralEpics = /\bepics\b/.test(normalizedMessage);
    if (matchingEpics.length > 1 && !isComparison && !pluralEpics) {
      return emptyResolution(resolvedProjectIds);
    }

    const epicResources = [];
    for (const active of matchingEpics) {
      epicResources.push(await this.resourceForEpic(
        active.project.projectId,
        active.epic.id,
        { designIntent, knowledgeIntent, researchIntent },
      ));
    }
    const effectiveProjectIds = [...new Set([
      ...resolvedProjectIds,
      ...matchingEpics.map((active) => active.project.projectId),
    ])].sort();
    return {
      intent: intentClass(designIntent, knowledgeIntent, researchIntent, false),
      resolvedProjectIds: effectiveProjectIds,
      grant: await validateWorkspaceTurnReadGrant({
        epicDiscoveryProjectIds: [],
        epicResources,
      }, this.activeResolver),
    };
  }

  private async resourcesForPlanning(
    projectId: string,
    flags: IntentFlags,
  ): Promise<WorkspaceEpicResourceGrant[]> {
    const resources = [];
    for (const listed of await this.epicService.listEpics(projectId)) {
      const active = await this.activeResolver.resolveActiveEpic(projectId, listed.id);
      if (!active) continue;
      resources.push(await this.resourceForEpic(projectId, active.epic.id, flags));
    }
    return resources;
  }

  private async resourceForEpic(
    projectId: string,
    epicId: string,
    flags: IntentFlags,
  ): Promise<WorkspaceEpicResourceGrant> {
    const capabilities: WorkspaceEpicReadCapability[] = [
      "metadata",
      "definition",
      "scope",
    ];
    const resource: WorkspaceEpicResourceGrant = {
      projectId,
      epicId,
      capabilities,
    };

    if (flags.designIntent) {
      capabilities.push("designs");
      const designIds = [];
      for (const document of await this.designDocService.listDesignDocs(projectId, epicId)) {
        if (document.archivedAt) continue;
        if (await this.activeResolver.resolveActiveDesign(projectId, epicId, document.id)) {
          designIds.push(document.id);
        }
      }
      resource.designIds = [...new Set(designIds)].sort();
    }
    if (flags.knowledgeIntent) {
      capabilities.push("knowledge");
      resource.knowledgePageIds = [
        ...new Set(
          (await this.epicKnowledgeService.listEpicWikiPages(projectId, epicId))
            .map((page) => page.id),
        ),
      ].sort();
    }
    if (flags.researchIntent) {
      capabilities.push("research");
      resource.researchSourceIds = [
        ...new Set(
          (await this.epicKnowledgeService.listSources(projectId, epicId))
            .filter((source) => source.status === "ready")
            .map((source) => source.id),
        ),
      ].sort();
    }
    return resource;
  }
}

interface IntentFlags {
  designIntent: boolean;
  knowledgeIntent: boolean;
  researchIntent: boolean;
}

function intentClass(
  design: boolean,
  knowledge: boolean,
  research: boolean,
  planning: boolean,
): WorkspaceIntentClass {
  if (design) return "epic_design";
  if (knowledge) return "epic_knowledge";
  if (research) return "epic_research";
  return planning ? "project_planning" : "epic";
}

function emptyResolution(
  resolvedProjectIds: string[] = [],
): WorkspaceIntentResolution {
  return {
    intent: "wiki_first",
    resolvedProjectIds,
    grant: EMPTY_WORKSPACE_TURN_READ_GRANT,
  };
}

function normalize(value: string): string {
  return value.toLocaleLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseMentioned(message: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${message} `.includes(` ${phrase} `);
}

function resolveMentionedProjects(
  message: string,
  projects: Awaited<ReturnType<CodaScopeActiveEntityResolver["listActiveProjects"]>>,
): {
  projects: typeof projects;
  ambiguous: boolean;
} {
  const byName = new Map<string, typeof projects>();
  for (const project of projects) {
    const name = normalize(project.name);
    byName.set(name, [...(byName.get(name) ?? []), project]);
  }

  const result = [];
  for (const project of projects) {
    const idMentioned = phraseMentioned(message, normalize(project.projectId));
    const name = normalize(project.name);
    const nameMentioned = phraseMentioned(message, name)
      || phraseMentioned(message, normalize(`project ${project.name}`));
    if (!idMentioned && !nameMentioned) continue;
    if (nameMentioned && (byName.get(name)?.length ?? 0) > 1 && !idMentioned) {
      return { projects: [], ambiguous: true };
    }
    result.push(project);
  }
  return { projects: deduplicateProjects(result), ambiguous: false };
}

function deduplicateProjects<T extends { projectId: string }>(
  projects: readonly T[],
): T[] {
  return [...new Map(
    projects.map((project) => [project.projectId, project]),
  ).values()].sort((a, b) => a.projectId.localeCompare(b.projectId));
}

function mentionsEpic(message: string, title: string, epicId: string): boolean {
  const normalizedId = normalize(epicId);
  const normalizedTitle = normalize(title);
  const withoutEpic = normalizedTitle
    .replace(/^epic /, "")
    .replace(/ epic$/, "")
    .trim();
  return phraseMentioned(message, normalizedId)
    || phraseMentioned(message, normalizedTitle)
    || phraseMentioned(message, withoutEpic)
    || phraseMentioned(message, `${withoutEpic} epic`)
    || phraseMentioned(message, `${withoutEpic} epics`);
}
