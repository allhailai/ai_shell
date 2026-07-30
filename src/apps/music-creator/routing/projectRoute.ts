import type { MusicCreatorStoreEnvelope } from "../types";
import { isProjectInStore } from "../storage/storage";

const SESSION_PROJECTS_KEY = "music-creator:session-project-ids";

function readSessionProjectIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SESSION_PROJECTS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    return new Set();
  }
}

function writeSessionProjectIds(ids: Set<string>): void {
  try {
    sessionStorage.setItem(SESSION_PROJECTS_KEY, JSON.stringify([...ids]));
  } catch {
    // sessionStorage unavailable — in-memory fallback for this tab only
  }
}

/** Tracks project ids opened from the hub so studio deep links survive refresh. */
export function registerSessionProjectId(projectId: string): void {
  const ids = readSessionProjectIds();
  ids.add(projectId);
  writeSessionProjectIds(ids);
}

/**
 * Whether a studio URL project id is known for routing.
 * Checks persisted store first; session registry is a fallback for ids opened this tab.
 */
export function isKnownProjectId(
  projectId: string,
  envelope?: MusicCreatorStoreEnvelope | null,
): boolean {
  if (envelope && isProjectInStore(envelope, projectId)) return true;
  return readSessionProjectIds().has(projectId);
}
