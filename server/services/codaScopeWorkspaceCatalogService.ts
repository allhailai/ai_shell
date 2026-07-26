/* ── CodaScope: Workspace Catalog Service ────────────────────────────
   Bounded, active-only workspace read model. Public DTOs intentionally omit
   native project/repository locations and repository contents.
   ──────────────────────────────────────────────────────────────────── */

import type { BuildStatus } from "./codaScopeBuildStateService.js";
import {
  CodaScopeBuildStateService,
  type BuildRunKind,
  type WorkspaceBuildAttempt,
} from "./codaScopeBuildStateService.js";
import { CodaScopeCodeMapService } from "./codaScopeCodeMapService.js";
import {
  CodaScopeActiveEntityResolver,
  type ActiveProjectRecord,
} from "./codaScopeActiveEntityResolver.js";
import { CodaScopePathValidationError, assertSafePathSegment } from "./codaScopePathSafety.js";
import { CodaScopeWikiService } from "./codaScopeWikiService.js";
import { CodaScopeWikiStateService } from "./codaScopeWikiStateService.js";
import {
  isSubstantiveWikiTopic,
  isSystemWikiTopicId,
} from "./codaScopeWikiTopicPolicy.js";

export interface WorkspaceProjectOverview {
  projectId: string;
  name: string;
  description: string;
  repositoryCount: number;
  hasWiki: boolean;
  substantiveWikiTopicCount: number;
  currentBuildStatus: BuildStatus;
  lastWikiBuildAt: string | null;
  lastDeepRunAt: string | null;
  lastBuildAttemptAt: string | null;
  lastBuildAttemptStatus: "building" | "complete" | "error" | null;
  lastBuildError: string | null;
}

export interface WorkspaceStatus {
  activeProjectCount: number;
  projectsWithWiki: number;
  projectsBuilding: number;
  lastWikiBuildAt: string | null;
  lastDeepRunAt: string | null;
}

export interface WorkspaceWikiTopicSummary {
  projectId: string;
  projectName: string;
  topicId: string;
  topicTitle: string;
  topicUpdatedAt: string;
  substantive: boolean;
}

export interface WorkspaceWikiTopicRead {
  projectId: string;
  projectName: string;
  topicId: string;
  topicTitle: string;
  topicUpdatedAt: string;
  content: string;
  charCount: number;
  truncated: boolean;
}

export interface WorkspaceWikiSearchResult {
  projectId: string;
  projectName: string;
  topicId: string;
  topicTitle: string;
  snippet: string;
  snippetTruncated: boolean;
  topicUpdatedAt: string;
  lastWikiBuildAt: string | null;
  lastDeepRunAt: string | null;
  lastBuildAttemptAt: string | null;
  lastBuildAttemptStatus: "building" | "complete" | "error" | null;
  freshnessWarning: string | null;
}

export interface WorkspaceWikiSearchResponse {
  query: string;
  searchedProjectCount: number;
  results: WorkspaceWikiSearchResult[];
  truncated: boolean;
}

export interface WorkspaceBuildHistoryEntry {
  projectId: string;
  projectName: string;
  runId: string;
  buildType: BuildRunKind;
  status: "building" | "complete" | "error";
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  publishedWiki: boolean;
}

export interface WorkspaceBuildHistoryResponse {
  projectId: string;
  projectName: string;
  attempts: WorkspaceBuildHistoryEntry[];
  truncated: boolean;
}

export interface WorkspaceCodeMapSummary {
  projectId: string;
  projectName: string;
  codeMapId: string;
  generatedAt: string | null;
}

export interface WorkspaceCodeMapRead extends WorkspaceCodeMapSummary {
  content: string;
  charCount: number;
  truncated: boolean;
}

export interface WorkspaceWikiSearchOptions {
  projectIds?: string[];
  limit?: number;
  perProjectCandidates?: number;
}

export class CodaScopeWorkspaceNotFoundError extends Error {
  readonly status = 404;
  readonly code = "not_found";

  constructor() {
    super("Requested workspace content was not found.");
    this.name = "CodaScopeWorkspaceNotFoundError";
  }
}

export const WORKSPACE_QUERY_MIN_CHARS = 2;
export const WORKSPACE_QUERY_MAX_CHARS = 200;
export const WORKSPACE_PROJECT_FILTER_MAX = 25;
export const WORKSPACE_SEARCH_DEFAULT_LIMIT = 12;
export const WORKSPACE_SEARCH_MAX_LIMIT = 30;
export const WORKSPACE_SEARCH_DEFAULT_PER_PROJECT = 3;
export const WORKSPACE_SEARCH_MAX_PER_PROJECT = 5;
export const WORKSPACE_SNIPPET_MAX_CHARS = 480;
export const WORKSPACE_TOPIC_DEFAULT_MAX_CHARS = 20_000;
export const WORKSPACE_TOPIC_MAX_CHARS = 50_000;
export const WORKSPACE_SEARCH_TOPIC_SCAN_MAX_CHARS = 100_000;
export const WORKSPACE_BUILD_HISTORY_DEFAULT_LIMIT = 20;
export const WORKSPACE_BUILD_HISTORY_MAX_LIMIT = 100;
export const WORKSPACE_CODE_MAP_DEFAULT_MAX_CHARS = 20_000;
export const WORKSPACE_CODE_MAP_MAX_CHARS = 50_000;

interface InternalWikiTopic {
  topicId: string;
  topicTitle: string;
  topicUpdatedAt: string;
  content: string;
  substantive: boolean;
}

interface ProjectSnapshot {
  project: ActiveProjectRecord;
  overview: WorkspaceProjectOverview;
  topics: InternalWikiTopic[];
}

interface RankedSearchResult extends WorkspaceWikiSearchResult {
  score: number;
}

export class CodaScopeWorkspaceCatalogService {
  constructor(
    private readonly activeResolver: CodaScopeActiveEntityResolver,
    private readonly wikiService: CodaScopeWikiService,
    private readonly wikiStateService: CodaScopeWikiStateService,
    private readonly buildStateService: CodaScopeBuildStateService,
    private readonly codeMapService: CodaScopeCodeMapService,
  ) {}

  async getWorkspaceStatus(): Promise<WorkspaceStatus> {
    const projects = await this.listActiveProjects();
    return {
      activeProjectCount: projects.length,
      projectsWithWiki: projects.filter((project) => project.hasWiki).length,
      projectsBuilding: projects.filter((project) => project.currentBuildStatus === "building").length,
      lastWikiBuildAt: latestOf(projects.map((project) => project.lastWikiBuildAt)),
      lastDeepRunAt: latestOf(projects.map((project) => project.lastDeepRunAt)),
    };
  }

  async listActiveProjects(): Promise<WorkspaceProjectOverview[]> {
    const initial = await this.activeResolver.listActiveProjects();
    const overviews: WorkspaceProjectOverview[] = [];
    for (const candidate of initial) {
      // Re-resolve at execution time instead of trusting a prior scan/cache.
      const project = await this.activeResolver.resolveActiveProject(candidate.projectId);
      if (!project) continue;
      overviews.push((await this.loadProjectSnapshot(project)).overview);
    }
    return overviews.sort((a, b) => (
      a.name.localeCompare(b.name)
      || a.projectId.localeCompare(b.projectId)
    ));
  }

  async getProjectOverview(projectId: string): Promise<WorkspaceProjectOverview> {
    const project = await this.requireActiveProject(projectId);
    return (await this.loadProjectSnapshot(project)).overview;
  }

  async listProjectWikiTopics(projectId: string): Promise<WorkspaceWikiTopicSummary[]> {
    const project = await this.requireActiveProject(projectId);
    const topics = await this.loadWikiTopics(project);
    return topics.map((topic) => ({
      projectId: project.projectId,
      projectName: this.publicProjectName(project),
      topicId: topic.topicId,
      topicTitle: topic.topicTitle,
      topicUpdatedAt: topic.topicUpdatedAt,
      substantive: topic.substantive,
    }));
  }

  async readProjectWikiTopic(
    projectId: string,
    topicId: string,
    maxChars = WORKSPACE_TOPIC_DEFAULT_MAX_CHARS,
  ): Promise<WorkspaceWikiTopicRead> {
    const project = await this.requireActiveProject(projectId);
    assertSafePathSegment(topicId, "wiki topic ID");
    assertBoundedInteger(maxChars, 1, WORKSPACE_TOPIC_MAX_CHARS, "wiki topic character limit");
    if (isSystemWikiTopicId(topicId)) throw new CodaScopeWorkspaceNotFoundError();

    const topic = (await this.loadWikiTopics(project))
      .find((candidate) => candidate.topicId === topicId);
    if (!topic) throw new CodaScopeWorkspaceNotFoundError();
    return {
      projectId: project.projectId,
      projectName: this.publicProjectName(project),
      topicId: topic.topicId,
      topicTitle: topic.topicTitle,
      topicUpdatedAt: topic.topicUpdatedAt,
      content: topic.content.slice(0, maxChars),
      charCount: topic.content.length,
      truncated: topic.content.length > maxChars,
    };
  }

  async searchProjectWiki(
    projectId: string,
    query: string,
    options: Omit<WorkspaceWikiSearchOptions, "projectIds"> = {},
  ): Promise<WorkspaceWikiSearchResponse> {
    return this.searchWorkspaceWikis(query, { ...options, projectIds: [projectId] });
  }

  async searchWorkspaceWikis(
    query: string,
    options: WorkspaceWikiSearchOptions = {},
  ): Promise<WorkspaceWikiSearchResponse> {
    const normalizedQuery = validateQuery(query);
    const limit = options.limit ?? WORKSPACE_SEARCH_DEFAULT_LIMIT;
    const perProjectCandidates = options.perProjectCandidates
      ?? WORKSPACE_SEARCH_DEFAULT_PER_PROJECT;
    assertBoundedInteger(limit, 1, WORKSPACE_SEARCH_MAX_LIMIT, "workspace search result limit");
    assertBoundedInteger(
      perProjectCandidates,
      1,
      WORKSPACE_SEARCH_MAX_PER_PROJECT,
      "workspace per-project candidate limit",
    );

    const projects = await this.resolveSearchProjects(options.projectIds);
    const candidates: RankedSearchResult[] = [];
    let truncated = false;

    // Every eligible project is scanned before the global limit is applied.
    for (const initialProject of projects) {
      const project = await this.activeResolver.resolveActiveProject(initialProject.projectId);
      if (!project) {
        if (options.projectIds) throw new CodaScopeWorkspaceNotFoundError();
        continue;
      }
      const snapshot = await this.loadProjectSnapshot(project);
      const projectMatches: RankedSearchResult[] = [];
      for (const topic of snapshot.topics) {
        if (!topic.substantive) continue;
        if (topic.content.length > WORKSPACE_SEARCH_TOPIC_SCAN_MAX_CHARS) truncated = true;
        const ranked = rankTopicMatch(normalizedQuery, topic);
        if (!ranked) continue;
        projectMatches.push({
          projectId: project.projectId,
          projectName: this.publicProjectName(project),
          topicId: topic.topicId,
          topicTitle: topic.topicTitle,
          snippet: ranked.snippet,
          snippetTruncated: ranked.snippetTruncated,
          topicUpdatedAt: topic.topicUpdatedAt,
          lastWikiBuildAt: snapshot.overview.lastWikiBuildAt,
          lastDeepRunAt: snapshot.overview.lastDeepRunAt,
          lastBuildAttemptAt: snapshot.overview.lastBuildAttemptAt,
          lastBuildAttemptStatus: snapshot.overview.lastBuildAttemptStatus,
          freshnessWarning: freshnessWarning(snapshot.overview),
          score: ranked.score,
        });
      }
      projectMatches.sort(compareRankedResults);
      if (projectMatches.length > perProjectCandidates) truncated = true;
      candidates.push(...projectMatches.slice(0, perProjectCandidates));
    }

    candidates.sort(compareRankedResults);
    if (candidates.length > limit) truncated = true;
    return {
      query: normalizedQuery,
      searchedProjectCount: projects.length,
      results: candidates.slice(0, limit).map(({ score: _, ...result }) => result),
      truncated,
    };
  }

  async getRelevantBuildHistory(
    projectId: string,
    limit = WORKSPACE_BUILD_HISTORY_DEFAULT_LIMIT,
  ): Promise<WorkspaceBuildHistoryResponse> {
    assertBoundedInteger(limit, 1, WORKSPACE_BUILD_HISTORY_MAX_LIMIT, "build history limit");
    const project = await this.requireActiveProject(projectId);
    this.buildStateService.registerProjectDir(project.projectId, project.projectDir);
    const history = this.buildStateService.readWorkspaceBuildHistory(project.projectId, limit);
    return {
      projectId: project.projectId,
      projectName: this.publicProjectName(project),
      attempts: history.attempts.map((attempt) => this.publicBuildAttempt(project, attempt)),
      truncated: history.truncated,
    };
  }

  async listProjectCodeMaps(projectId: string): Promise<WorkspaceCodeMapSummary[]> {
    const project = await this.requireActiveProject(projectId);
    return this.codeMapService.listCodeMaps(project.projectId)
      .map(({ repoSlug, meta }) => ({
        projectId: project.projectId,
        projectName: this.publicProjectName(project),
        codeMapId: repoSlug,
        generatedAt: typeof meta?.generatedAt === "string" && isTimestamp(meta.generatedAt)
          ? meta.generatedAt
          : null,
      }))
      .sort((a, b) => a.codeMapId.localeCompare(b.codeMapId));
  }

  async readProjectCodeMap(
    projectId: string,
    codeMapId: string,
    maxChars = WORKSPACE_CODE_MAP_DEFAULT_MAX_CHARS,
  ): Promise<WorkspaceCodeMapRead> {
    const project = await this.requireActiveProject(projectId);
    assertSafePathSegment(codeMapId, "code map ID");
    assertBoundedInteger(maxChars, 1, WORKSPACE_CODE_MAP_MAX_CHARS, "code map character limit");
    const rawContent = this.codeMapService.readCodeMap(project.projectId, codeMapId);
    if (rawContent === null) throw new CodaScopeWorkspaceNotFoundError();

    const content = scrubNativeLocations(rawContent, this.sensitivePaths(project));
    const summary = (await this.listProjectCodeMaps(project.projectId))
      .find((candidate) => candidate.codeMapId === codeMapId);
    return {
      projectId: project.projectId,
      projectName: this.publicProjectName(project),
      codeMapId,
      generatedAt: summary?.generatedAt ?? null,
      content: content.slice(0, maxChars),
      charCount: content.length,
      truncated: content.length > maxChars,
    };
  }

  private async requireActiveProject(projectId: string): Promise<ActiveProjectRecord> {
    assertSafePathSegment(projectId, "project ID");
    const project = await this.activeResolver.resolveActiveProject(projectId);
    if (!project) throw new CodaScopeWorkspaceNotFoundError();
    return project;
  }

  private async resolveSearchProjects(projectIds?: string[]): Promise<ActiveProjectRecord[]> {
    if (projectIds === undefined) return this.activeResolver.listActiveProjects();
    if (!Array.isArray(projectIds) || projectIds.length > WORKSPACE_PROJECT_FILTER_MAX) {
      throw new CodaScopePathValidationError("workspace project filter");
    }

    const deduplicated: string[] = [];
    const seen = new Set<string>();
    for (const projectId of projectIds) {
      if (typeof projectId !== "string") {
        throw new CodaScopePathValidationError("workspace project ID");
      }
      assertSafePathSegment(projectId, "project ID");
      if (!seen.has(projectId)) {
        seen.add(projectId);
        deduplicated.push(projectId);
      }
    }
    if (deduplicated.length === 0) {
      throw new CodaScopePathValidationError("workspace project filter");
    }

    const projects: ActiveProjectRecord[] = [];
    for (const projectId of deduplicated) {
      projects.push(await this.requireActiveProject(projectId));
    }
    return projects.sort((a, b) => (
      a.name.localeCompare(b.name)
      || a.projectId.localeCompare(b.projectId)
    ));
  }

  private async loadWikiTopics(project: ActiveProjectRecord): Promise<InternalWikiTopic[]> {
    const listed = await this.wikiService.listTopics(project.projectId);
    const topics: InternalWikiTopic[] = [];
    const sensitivePaths = this.sensitivePaths(project);
    for (const topic of listed) {
      if (isSystemWikiTopicId(topic.id)) continue;
      const content = await this.wikiService.getTopicContent(project.projectId, topic.id);
      if (content === null) continue;
      topics.push({
        topicId: topic.id,
        topicTitle: scrubNativeLocations(topic.title, sensitivePaths),
        topicUpdatedAt: topic.updatedAt && isTimestamp(topic.updatedAt)
          ? topic.updatedAt
          : project.updatedAt,
        content: scrubNativeLocations(content, sensitivePaths),
        substantive: isSubstantiveWikiTopic(topic.id, content),
      });
    }
    return topics.sort((a, b) => (
      a.topicTitle.localeCompare(b.topicTitle)
      || a.topicId.localeCompare(b.topicId)
    ));
  }

  private async loadProjectSnapshot(project: ActiveProjectRecord): Promise<ProjectSnapshot> {
    const topics = await this.loadWikiTopics(project);
    const substantiveWikiTopicCount = topics.filter((topic) => topic.substantive).length;
    this.buildStateService.registerProjectDir(project.projectId, project.projectDir);
    const history = this.buildStateService.readWorkspaceBuildHistory(
      project.projectId,
      WORKSPACE_BUILD_HISTORY_MAX_LIMIT,
    );
    const wikiState = await this.wikiStateService.getWorkspaceWikiState(project.projectDir);
    const latestAttempt = history.latestAttempt;
    const lastWikiBuildAt = latestOf([
      wikiState?.lastBuildAt ?? null,
      history.lastSuccessfulWikiBuildAt,
    ]);
    const lastDeepRunAt = latestOf([
      wikiState?.lastSyncAt ?? null,
      history.lastSuccessfulDeepRunAt,
    ]);

    return {
      project,
      topics,
      overview: {
        projectId: project.projectId,
        name: this.publicProjectName(project),
        description: scrubNativeLocations(project.description, this.sensitivePaths(project)),
        repositoryCount: project.repositories.length,
        hasWiki: substantiveWikiTopicCount > 0,
        substantiveWikiTopicCount,
        currentBuildStatus: latestAttempt?.status ?? "idle",
        lastWikiBuildAt,
        lastDeepRunAt,
        lastBuildAttemptAt: latestAttempt?.startedAt ?? null,
        lastBuildAttemptStatus: latestAttempt?.status ?? null,
        lastBuildError: latestAttempt?.status === "error"
          ? sanitizePublicText(latestAttempt.error ?? "Build failed.", this.sensitivePaths(project))
          : null,
      },
    };
  }

  private publicBuildAttempt(
    project: ActiveProjectRecord,
    attempt: WorkspaceBuildAttempt,
  ): WorkspaceBuildHistoryEntry {
    return {
      projectId: project.projectId,
      projectName: this.publicProjectName(project),
      runId: attempt.runId,
      buildType: attempt.buildType,
      status: attempt.status,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      error: attempt.status === "error"
        ? sanitizePublicText(attempt.error ?? "Build failed.", this.sensitivePaths(project))
        : null,
      publishedWiki: attempt.publishedWiki,
    };
  }

  private sensitivePaths(project: ActiveProjectRecord): string[] {
    return [
      this.activeResolver.getRoot(),
      project.projectDir,
      ...project.repositories.map((repository) => repository.path),
    ].filter(Boolean);
  }

  private publicProjectName(project: ActiveProjectRecord): string {
    return scrubNativeLocations(project.name, this.sensitivePaths(project));
  }
}

function validateQuery(query: string): string {
  if (typeof query !== "string") throw new CodaScopePathValidationError("workspace search query");
  const normalized = query.trim();
  if (normalized.length < WORKSPACE_QUERY_MIN_CHARS
    || normalized.length > WORKSPACE_QUERY_MAX_CHARS) {
    throw new CodaScopePathValidationError("workspace search query");
  }
  return normalized;
}

function assertBoundedInteger(value: number, min: number, max: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CodaScopePathValidationError(label);
  }
}

function rankTopicMatch(
  query: string,
  topic: InternalWikiTopic,
): { score: number; snippet: string; snippetTruncated: boolean } | null {
  const needle = query.toLowerCase();
  const title = topic.topicTitle.toLowerCase();
  const id = topic.topicId.toLowerCase();
  const scannedContent = topic.content.slice(0, WORKSPACE_SEARCH_TOPIC_SCAN_MAX_CHARS);
  const haystack = scannedContent.toLowerCase();
  const firstContentMatch = haystack.indexOf(needle);
  const titleMatch = title.includes(needle);
  const idMatch = id.includes(needle);
  if (!titleMatch && !idMatch && firstContentMatch < 0) return null;

  let score = 0;
  if (title === needle) score += 1_000;
  else if (titleMatch) score += 500;
  if (id === needle) score += 900;
  else if (idMatch) score += 400;
  if (firstContentMatch >= 0) {
    let occurrences = 0;
    let index = firstContentMatch;
    while (index >= 0 && occurrences < 100) {
      occurrences += 1;
      index = haystack.indexOf(needle, index + needle.length);
    }
    score += 100 + occurrences;
  }

  const snippet = makeSnippet(scannedContent, query, WORKSPACE_SNIPPET_MAX_CHARS);
  return {
    score,
    snippet: snippet.text,
    snippetTruncated: snippet.truncated
      || topic.content.length > WORKSPACE_SEARCH_TOPIC_SCAN_MAX_CHARS,
  };
}

function makeSnippet(
  content: string,
  query: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };

  const match = normalized.toLowerCase().indexOf(query.toLowerCase());
  const center = match >= 0 ? match : 0;
  const start = Math.max(0, Math.min(
    center - Math.floor(maxChars / 3),
    normalized.length - maxChars,
  ));
  const end = Math.min(normalized.length, start + maxChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";
  const available = maxChars - prefix.length - suffix.length;
  return {
    text: `${prefix}${normalized.slice(start, start + available)}${suffix}`,
    truncated: true,
  };
}

function compareRankedResults(a: RankedSearchResult, b: RankedSearchResult): number {
  return b.score - a.score
    || a.projectName.localeCompare(b.projectName)
    || a.projectId.localeCompare(b.projectId)
    || a.topicTitle.localeCompare(b.topicTitle)
    || a.topicId.localeCompare(b.topicId);
}

function freshnessWarning(overview: WorkspaceProjectOverview): string | null {
  if (overview.lastBuildAttemptStatus === "building") {
    return "Analyze or Deep Run is currently building; wiki results may change.";
  }
  if (overview.lastBuildAttemptStatus === "error"
    && overview.lastBuildAttemptAt
    && (!overview.lastWikiBuildAt
      || Date.parse(overview.lastBuildAttemptAt) > Date.parse(overview.lastWikiBuildAt))) {
    return "The latest Analyze or Deep Run attempt failed after the last successful wiki build.";
  }
  if (!overview.lastWikiBuildAt) {
    return "A successful wiki publication timestamp is not available.";
  }
  if (Date.now() - Date.parse(overview.lastWikiBuildAt) > 7 * 24 * 60 * 60 * 1_000) {
    return "The latest successful wiki publication is more than seven days old.";
  }
  return null;
}

function latestOf(values: Array<string | null>): string | null {
  let latest: string | null = null;
  for (const value of values) {
    if (value && (!latest || Date.parse(value) > Date.parse(latest))) latest = value;
  }
  return latest;
}

function scrubConfiguredPaths(content: string, configuredPaths: string[]): string {
  let scrubbed = content;
  const variants = new Set<string>();
  for (const configuredPath of configuredPaths) {
    if (!configuredPath) continue;
    variants.add(configuredPath);
    variants.add(configuredPath.replaceAll("\\", "/"));
    variants.add(configuredPath.replaceAll("/", "\\"));
  }
  for (const configuredPath of [...variants].sort((a, b) => b.length - a.length)) {
    scrubbed = scrubbed.split(configuredPath).join("[redacted location]");
  }
  return scrubbed;
}

function scrubNativeLocations(content: string, configuredPaths: string[]): string {
  return scrubConfiguredPaths(content, configuredPaths)
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, "[redacted location]")
    .replace(/(^|[\s("'`])\/(?:Users|home|opt|private|var|tmp|Volumes|srv|mnt)\/[^\s)"'`]*/g, "$1[redacted location]");
}

function sanitizePublicText(content: string, configuredPaths: string[]): string {
  return scrubNativeLocations(content, configuredPaths).slice(0, 500);
}

function isTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}
