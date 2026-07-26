/* ── CodaScope: Workspace Per-Turn Read Grant ────────────────────────
   Server-validated authorization for active epic/resource reads. Grants
   never arrive through tool arguments and are valid for one agent send.
   ──────────────────────────────────────────────────────────────────── */

import type { CodaScopeActiveEntityResolver } from "./codaScopeActiveEntityResolver.js";
import {
  CodaScopePathValidationError,
  assertSafePathSegment,
} from "./codaScopePathSafety.js";

export const WORKSPACE_EPIC_CAPABILITIES = [
  "metadata",
  "definition",
  "scope",
  "designs",
  "knowledge",
  "research",
] as const;

export type WorkspaceEpicReadCapability =
  (typeof WORKSPACE_EPIC_CAPABILITIES)[number];

export interface WorkspaceEpicResourceGrant {
  projectId: string;
  epicId: string;
  capabilities: readonly WorkspaceEpicReadCapability[];
  designIds?: readonly string[];
  knowledgePageIds?: readonly string[];
  researchSourceIds?: readonly string[];
}

export interface WorkspaceTurnReadGrant {
  epicDiscoveryProjectIds: readonly string[];
  epicResources: readonly WorkspaceEpicResourceGrant[];
}

export const EMPTY_WORKSPACE_TURN_READ_GRANT: WorkspaceTurnReadGrant =
  deepFreezeGrant({
    epicDiscoveryProjectIds: [],
    epicResources: [],
  });

const MAX_DISCOVERY_PROJECTS = 25;
const MAX_EPIC_RESOURCES = 50;
const MAX_RESOURCE_IDS = 50;
const MAX_GRANT_ID_CHARS = 255;
const ROOT_FIELDS = new Set(["epicDiscoveryProjectIds", "epicResources"]);
const RESOURCE_FIELDS = new Set([
  "projectId",
  "epicId",
  "capabilities",
  "designIds",
  "knowledgePageIds",
  "researchSourceIds",
]);
const CAPABILITY_SET = new Set<string>(WORKSPACE_EPIC_CAPABILITIES);

/**
 * Strictly parse, normalize, and active-state-check a prospective grant.
 * Unknown fields/capabilities fail closed. Duplicate epic entries merge into
 * one deterministic immutable authorization record.
 */
export async function validateWorkspaceTurnReadGrant(
  value: unknown,
  activeResolver: CodaScopeActiveEntityResolver,
): Promise<WorkspaceTurnReadGrant> {
  if (!isRecord(value) || hasUnknownFields(value, ROOT_FIELDS)) {
    throw invalidGrant();
  }

  const discoveryInput = requireArray(
    value.epicDiscoveryProjectIds,
    MAX_DISCOVERY_PROJECTS,
  );
  const discoveryIds = normalizeIds(discoveryInput);
  for (const projectId of discoveryIds) {
    if (!await activeResolver.resolveActiveProject(projectId)) throw invalidGrant();
  }

  const resourceInput = requireArray(value.epicResources, MAX_EPIC_RESOURCES);
  const merged = new Map<string, MutableWorkspaceEpicResourceGrant>();
  for (const candidate of resourceInput) {
    if (!isRecord(candidate) || hasUnknownFields(candidate, RESOURCE_FIELDS)) {
      throw invalidGrant();
    }
    if (typeof candidate.projectId !== "string"
      || typeof candidate.epicId !== "string") {
      throw invalidGrant();
    }
    const projectId = assertSafePathSegment(candidate.projectId, "project ID");
    const epicId = assertSafePathSegment(candidate.epicId, "epic ID");
    if (!await activeResolver.resolveActiveEpic(projectId, epicId)) {
      throw invalidGrant();
    }

    const rawCapabilities = requireArray(
      candidate.capabilities,
      WORKSPACE_EPIC_CAPABILITIES.length,
    );
    const capabilities = new Set<WorkspaceEpicReadCapability>();
    for (const capability of rawCapabilities) {
      if (typeof capability !== "string" || !CAPABILITY_SET.has(capability)) {
        throw invalidGrant();
      }
      capabilities.add(capability as WorkspaceEpicReadCapability);
    }

    const designIds = normalizeOptionalIds(candidate.designIds);
    const knowledgePageIds = normalizeOptionalIds(candidate.knowledgePageIds);
    const researchSourceIds = normalizeOptionalIds(candidate.researchSourceIds);
    if (designIds.length > 0 && !capabilities.has("designs")) throw invalidGrant();
    if (knowledgePageIds.length > 0 && !capabilities.has("knowledge")) throw invalidGrant();
    if (researchSourceIds.length > 0 && !capabilities.has("research")) throw invalidGrant();
    for (const designId of designIds) {
      if (!await activeResolver.resolveActiveDesign(projectId, epicId, designId)) {
        throw invalidGrant();
      }
    }

    const key = `${projectId}\u0000${epicId}`;
    const current = merged.get(key) ?? {
      projectId,
      epicId,
      capabilities: new Set<WorkspaceEpicReadCapability>(),
      designIds: new Set<string>(),
      knowledgePageIds: new Set<string>(),
      researchSourceIds: new Set<string>(),
    };
    for (const capability of capabilities) current.capabilities.add(capability);
    for (const id of designIds) current.designIds.add(id);
    for (const id of knowledgePageIds) current.knowledgePageIds.add(id);
    for (const id of researchSourceIds) current.researchSourceIds.add(id);
    merged.set(key, current);
  }

  const epicResources = [...merged.values()]
    .sort((a, b) => (
      a.projectId.localeCompare(b.projectId)
      || a.epicId.localeCompare(b.epicId)
    ))
    .map((entry): WorkspaceEpicResourceGrant => ({
      projectId: entry.projectId,
      epicId: entry.epicId,
      capabilities: WORKSPACE_EPIC_CAPABILITIES
        .filter((capability) => entry.capabilities.has(capability)),
      ...(entry.designIds.size > 0
        ? { designIds: [...entry.designIds].sort() }
        : {}),
      ...(entry.knowledgePageIds.size > 0
        ? { knowledgePageIds: [...entry.knowledgePageIds].sort() }
        : {}),
      ...(entry.researchSourceIds.size > 0
        ? { researchSourceIds: [...entry.researchSourceIds].sort() }
        : {}),
    }));

  return deepFreezeGrant({
    epicDiscoveryProjectIds: discoveryIds,
    epicResources,
  });
}

export class WorkspaceTurnReadGrantHolder {
  current: WorkspaceTurnReadGrant = EMPTY_WORKSPACE_TURN_READ_GRANT;

  replace(grant: WorkspaceTurnReadGrant): void {
    this.current = grant;
  }

  clear(): void {
    this.current = EMPTY_WORKSPACE_TURN_READ_GRANT;
  }
}

export function hasWorkspaceEpicDiscoveryGrant(
  grant: WorkspaceTurnReadGrant,
  projectId: string,
): boolean {
  return grant.epicDiscoveryProjectIds.includes(projectId);
}

export function hasWorkspaceEpicCapability(
  grant: WorkspaceTurnReadGrant,
  projectId: string,
  epicId: string,
  capability: WorkspaceEpicReadCapability,
): boolean {
  return grant.epicResources.some((resource) => (
    resource.projectId === projectId
    && resource.epicId === epicId
    && resource.capabilities.includes(capability)
  ));
}

export function hasWorkspaceResourceGrant(
  grant: WorkspaceTurnReadGrant,
  projectId: string,
  epicId: string,
  capability: "designs" | "knowledge" | "research",
  resourceId: string,
): boolean {
  const field = capability === "designs"
    ? "designIds"
    : capability === "knowledge"
      ? "knowledgePageIds"
      : "researchSourceIds";
  return grant.epicResources.some((resource) => (
    resource.projectId === projectId
    && resource.epicId === epicId
    && resource.capabilities.includes(capability)
    && resource[field]?.includes(resourceId)
  ));
}

interface MutableWorkspaceEpicResourceGrant {
  projectId: string;
  epicId: string;
  capabilities: Set<WorkspaceEpicReadCapability>;
  designIds: Set<string>;
  knowledgePageIds: Set<string>;
  researchSourceIds: Set<string>;
}

function normalizeOptionalIds(value: unknown): string[] {
  if (value === undefined) return [];
  return normalizeIds(requireArray(value, MAX_RESOURCE_IDS));
}

function normalizeIds(values: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length > MAX_GRANT_ID_CHARS) {
      throw invalidGrant();
    }
    ids.add(assertSafePathSegment(value, "workspace grant ID"));
  }
  return [...ids].sort();
}

function requireArray(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) throw invalidGrant();
  return value;
}

function hasUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).some((key) => !allowed.has(key));
}

function deepFreezeGrant(grant: WorkspaceTurnReadGrant): WorkspaceTurnReadGrant {
  for (const resource of grant.epicResources) {
    Object.freeze(resource.capabilities);
    if (resource.designIds) Object.freeze(resource.designIds);
    if (resource.knowledgePageIds) Object.freeze(resource.knowledgePageIds);
    if (resource.researchSourceIds) Object.freeze(resource.researchSourceIds);
    Object.freeze(resource);
  }
  Object.freeze(grant.epicDiscoveryProjectIds);
  Object.freeze(grant.epicResources);
  return Object.freeze(grant);
}

function invalidGrant(): CodaScopePathValidationError {
  return new CodaScopePathValidationError("workspace turn read grant");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
