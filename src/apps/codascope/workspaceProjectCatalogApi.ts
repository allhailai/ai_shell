import { isCanonicalAssistantRecordId } from "./assistantConversationApi";

export const WORKSPACE_PROJECT_CATALOG_ENDPOINT =
  "/api/codascope/workspace/projects";
export const WORKSPACE_PROJECT_CATALOG_LIMIT = 100;
export const WORKSPACE_PROJECT_NAME_MAX_CHARS = 300;
export const WORKSPACE_PROJECT_DESCRIPTION_MAX_CHARS = 1_000;

export interface WorkspaceProjectReference {
  projectId: string;
  name: string;
  description: string;
}

export interface WorkspaceProjectCatalog {
  scope: { kind: "workspace" };
  projects: WorkspaceProjectReference[];
  limit: number;
  truncated: boolean;
}

export async function loadWorkspaceProjectCatalog(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<WorkspaceProjectCatalog> {
  const response = await fetchImpl(WORKSPACE_PROJECT_CATALOG_ENDPOINT, {
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error("Active projects could not be loaded.");
  }
  const catalog = normalizeWorkspaceProjectCatalog(await response.json());
  if (!catalog) {
    throw new Error("The active-project catalog response was invalid.");
  }
  return catalog;
}

export function normalizeWorkspaceProjectCatalog(
  value: unknown,
): WorkspaceProjectCatalog | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      "scope",
      "projects",
      "limit",
      "truncated",
    ])
    || !isRecord(value.scope)
    || !hasOnlyKeys(value.scope, ["kind"])
    || value.scope.kind !== "workspace"
    || value.limit !== WORKSPACE_PROJECT_CATALOG_LIMIT
    || typeof value.truncated !== "boolean"
    || !Array.isArray(value.projects)
    || value.projects.length > WORKSPACE_PROJECT_CATALOG_LIMIT) {
    return null;
  }

  const ids = new Set<string>();
  const projects: WorkspaceProjectReference[] = [];
  for (const candidate of value.projects) {
    if (!isRecord(candidate)
      || !hasOnlyKeys(candidate, ["projectId", "name", "description"])
      || !isCanonicalAssistantRecordId(candidate.projectId)
      || !isBoundedDisplayText(
        candidate.name,
        WORKSPACE_PROJECT_NAME_MAX_CHARS,
        false,
      )
      || !isBoundedDisplayText(
        candidate.description,
        WORKSPACE_PROJECT_DESCRIPTION_MAX_CHARS,
        true,
      )
      || ids.has(candidate.projectId)) {
      return null;
    }
    ids.add(candidate.projectId);
    projects.push({
      projectId: candidate.projectId,
      name: candidate.name,
      description: candidate.description,
    });
  }

  projects.sort((a, b) => (
    a.name.localeCompare(b.name)
    || a.projectId.localeCompare(b.projectId)
  ));
  return {
    scope: { kind: "workspace" },
    projects,
    limit: WORKSPACE_PROJECT_CATALOG_LIMIT,
    truncated: value.truncated,
  };
}

export function isWorkspaceCatalogRequestCurrent(
  request: { scopeKey: string; epoch: number },
  current: { scopeKey: string; epoch: number },
): boolean {
  return request.scopeKey === current.scopeKey
    && request.epoch === current.epoch;
}

function isBoundedDisplayText(
  value: unknown,
  maxLength: number,
  allowEmpty: boolean,
): value is string {
  return typeof value === "string"
    && value.length <= maxLength
    && (allowEmpty || value.trim().length > 0)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
