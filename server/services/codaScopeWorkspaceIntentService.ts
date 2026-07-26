/* ── CodaScope: Workspace Intent and Grant Resolver ─────────────────
   Deterministic, conservative server-side derivation. Neither clients nor
   models can author a WorkspaceTurnReadGrant.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeActiveEntityResolver } from "./codaScopeActiveEntityResolver.js";
import type { CodaScopeDesignDocService } from "./codaScopeDesignDocService.js";
import type { CodaScopeEpicKnowledgeService } from "./codaScopeEpicKnowledgeService.js";
import type { CodaScopeEpicService } from "./codaScopeEpicService.js";
import type {
  CodaScopeWorkspaceNoteService,
  WorkspaceCurrentNoteIdentity,
} from "./codaScopeWorkspaceNoteService.js";
import {
  deriveWorkspaceTurnNoteGrant,
  EMPTY_WORKSPACE_TURN_NOTE_GRANT,
  type WorkspaceTurnNoteGrant,
} from "./codaScopeWorkspaceNoteGrant.js";
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
  noteGrant: WorkspaceTurnNoteGrant;
}

export interface WorkspaceNoteIntentContext {
  actorId: string;
  currentNote?: WorkspaceCurrentNoteIdentity | null;
}

export class CodaScopeWorkspaceIntentService {
  constructor(
    private readonly activeResolver: CodaScopeActiveEntityResolver,
    private readonly epicService: CodaScopeEpicService,
    private readonly designDocService: CodaScopeDesignDocService,
    private readonly epicKnowledgeService: CodaScopeEpicKnowledgeService,
    private readonly workspaceNoteService?: CodaScopeWorkspaceNoteService,
  ) {}

  async resolveTurn(
    message: string,
    explicitlyReferencedProjectIds: readonly string[],
    noteContext?: WorkspaceNoteIntentContext,
  ): Promise<WorkspaceIntentResolution> {
    const noteGrant = this.workspaceNoteService
      ? await deriveWorkspaceTurnNoteGrant({
          actorId: noteContext?.actorId,
          message,
          currentNote: noteContext?.currentNote,
          noteService: this.workspaceNoteService,
        })
      : EMPTY_WORKSPACE_TURN_NOTE_GRANT;
    const language = analyzeMessage(message);
    const normalizedMessage = language.all;
    if (!normalizedMessage) return emptyResolution(noteGrant);

    const activeProjects = await this.activeResolver.listActiveProjects();
    const explicitProjects = [];
    for (const projectId of [...new Set(explicitlyReferencedProjectIds)].sort()) {
      const active = await this.activeResolver.resolveActiveProject(projectId);
      if (!active) return emptyResolution(noteGrant);
      if (projectMentionPolarity(language, active).negative) continue;
      explicitProjects.push(active);
    }

    const mentioned = resolveMentionedProjects(language, activeProjects);
    if (mentioned.ambiguous) return emptyResolution(noteGrant);
    const selectedProjects = deduplicateProjects([
      ...explicitProjects,
      ...mentioned.projects,
    ]);
    const resolvedProjectIds = selectedProjects.map((project) => project.projectId);

    const designIntent = affirmedSignal(
      language,
      /\bdesign(?:s| docs?| documents?)?\b/,
    );
    const knowledgeIntent = affirmedSignal(
      language,
      /\b(?:curated )?knowledge(?: pages?)?\b/,
    );
    const researchIntent = affirmedSignal(
      language,
      /\b(?:research|research sources?|sources? from research)\b/,
    );
    const planningIntent = affirmedSignal(
      language,
      /\b(?:(?:active )?roadmaps?|currently planning|project planning)\b/,
    );
    const epicIntent = affirmedSignal(language, /\bepics?\b/);
    const genericImplementation = affirmedSignal(
      language,
      /\b(?:architecture|architectural|implement|implementation|code)\b/,
    );

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
        noteGrant,
      };
    }

    if (planningIntent) {
      if (selectedProjects.length === 0) {
        return emptyResolution(noteGrant, resolvedProjectIds);
      }
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
        noteGrant,
      };
    }

    if (!epicIntent && !designIntent && !knowledgeIntent && !researchIntent) {
      return {
        intent: "wiki_first",
        resolvedProjectIds,
        grant: EMPTY_WORKSPACE_TURN_READ_GRANT,
        noteGrant,
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
        if (affirmativelyMentionsEpic(language, active.epic.title, active.epic.id)) {
          matchingEpics.push(active);
        }
      }
    }
    if (matchingEpics.length === 0) {
      return emptyResolution(noteGrant, resolvedProjectIds);
    }

    const isComparison = /\b(?:compare|comparison|versus|vs)\b/.test(normalizedMessage);
    const pluralEpics = /\bepics\b/.test(normalizedMessage);
    if (matchingEpics.length > 1 && !isComparison && !pluralEpics) {
      return emptyResolution(noteGrant, resolvedProjectIds);
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
      noteGrant,
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
  noteGrant: WorkspaceTurnNoteGrant,
  resolvedProjectIds: string[] = [],
): WorkspaceIntentResolution {
  return {
    intent: "wiki_first",
    resolvedProjectIds,
    grant: EMPTY_WORKSPACE_TURN_READ_GRANT,
    noteGrant,
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

interface MessagePolarity {
  all: string;
  positive: string[];
  negative: string[];
}

function analyzeMessage(value: string): MessagePolarity {
  const expanded = value.toLocaleLowerCase()
    .replace(/\b(?:don[’']?t|dont)\b/g, "do not")
    .replace(/\b(?:doesn[’']?t|doesnt)\b/g, "does not")
    .replace(/\b(?:didn[’']?t|didnt)\b/g, "did not")
    .replace(/\b(?:can[’']?t|cant|cannot)\b/g, "can not")
    .replace(/\b(?:won[’']?t|wont)\b/g, "will not")
    .replace(/\b(?:shouldn[’']?t|shouldnt)\b/g, "should not")
    .replace(/\b(?:isn[’']?t|isnt)\b/g, "is not")
    .replace(/\b(?:aren[’']?t|arent)\b/g, "are not")
    .replace(/\b(?:wasn[’']?t|wasnt)\b/g, "was not")
    .replace(/\b(?:weren[’']?t|werent)\b/g, "were not")
    .replace(/\b(?:mustn[’']?t|mustnt)\b/g, "must not")
    .replace(/\b(?:needn[’']?t|neednt)\b/g, "need not");
  const positive: string[] = [];
  const negative: string[] = [];
  const clauses = expanded.split(
    /[;,.!?]+|\b(?:but|instead|however)\b/,
  );
  const denial = /\b(?:do not|does not|did not|can not|will not|should not|is not|are not|was not|were not|must not|need not|not|never|without|ignore|ignoring|ignored|skip|skipping|avoid|avoiding|exclude|excluding|except|rather than|no)\b/;

  for (const clause of clauses) {
    const normalizedClause = normalize(clause);
    if (!normalizedClause) continue;
    if (!denial.test(normalizedClause)) {
      positive.push(normalizedClause);
      continue;
    }
    // A denial makes the whole bounded clause non-authorizing. This also
    // catches postfix forms such as "research is not needed" without trying
    // to recover a broader positive interpretation from the same clause.
    negative.push(normalizedClause);
  }

  return {
    all: normalize(expanded),
    positive,
    negative,
  };
}

function affirmedSignal(
  language: MessagePolarity,
  pattern: RegExp,
): boolean {
  const positive = language.positive.some((text) => pattern.test(text));
  const negative = language.negative.some((text) => pattern.test(text));
  return positive && !negative;
}

function phrasePolarity(
  language: MessagePolarity,
  phrases: readonly string[],
): { positive: boolean; negative: boolean } {
  const mentioned = (text: string) => phrases.some(
    (phrase) => phraseMentioned(text, phrase),
  );
  return {
    positive: language.positive.some(mentioned),
    negative: language.negative.some(mentioned),
  };
}

function projectMentionPolarity(
  language: MessagePolarity,
  project: { projectId: string; name: string },
): { idPositive: boolean; namePositive: boolean; negative: boolean } {
  const id = normalize(project.projectId);
  const name = normalize(project.name);
  const idPolarity = phrasePolarity(language, [id]);
  const namePolarity = phrasePolarity(language, [
    name,
    normalize(`project ${project.name}`),
  ]);
  return {
    idPositive: idPolarity.positive,
    namePositive: namePolarity.positive,
    negative: idPolarity.negative || namePolarity.negative,
  };
}

function resolveMentionedProjects(
  language: MessagePolarity,
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
    const polarity = projectMentionPolarity(language, project);
    if (polarity.negative) continue;
    const idMentioned = polarity.idPositive;
    const name = normalize(project.name);
    const nameMentioned = polarity.namePositive;
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

function affirmativelyMentionsEpic(
  language: MessagePolarity,
  title: string,
  epicId: string,
): boolean {
  const normalizedId = normalize(epicId);
  const normalizedTitle = normalize(title);
  const withoutEpic = normalizedTitle
    .replace(/^epic /, "")
    .replace(/ epic$/, "")
    .trim();
  const polarity = phrasePolarity(language, [
    normalizedId,
    normalizedTitle,
    withoutEpic,
    `${withoutEpic} epic`,
    `${withoutEpic} epics`,
  ]);
  return polarity.positive && !polarity.negative;
}
