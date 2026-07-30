import type { MusicProject } from "../types";
import { DRUM_TRACK_IDS, STEPS } from "../constants/music";
import type { MuteTargetId } from "../types";

const MUTE_TARGETS: readonly MuteTargetId[] = [
  ...DRUM_TRACK_IDS,
  "melody",
] as const;

export interface ProjectMutationOptions {
  now?: string;
}

/**
 * True when Studio editable fields match — used for dirty indicator and leave guard.
 * Compares trimmed name, tempo, drums, melody, mutes; ignores id/timestamps.
 */
export function areStudioEditsEqual(a: MusicProject, b: MusicProject): boolean {
  if (a.name.trim() !== b.name.trim()) return false;
  if (a.tempo !== b.tempo) return false;

  for (const targetId of MUTE_TARGETS) {
    if (a.mutes[targetId] !== b.mutes[targetId]) return false;
  }

  for (const trackId of DRUM_TRACK_IDS) {
    const laneA = a.drums[trackId];
    const laneB = b.drums[trackId];
    for (let step = 0; step < STEPS; step += 1) {
      if (laneA[step] !== laneB[step]) return false;
    }
  }

  for (let step = 0; step < STEPS; step += 1) {
    if (a.melody[step] !== b.melody[step]) return false;
  }

  return true;
}

/** Deep-clone a project under a new id with `" (copy)"` name suffix */
export function duplicateProject(
  source: MusicProject,
  newId: string,
  options: ProjectMutationOptions = {},
): MusicProject {
  const now = options.now ?? new Date().toISOString();

  return {
    id: newId,
    name: `${source.name} (copy)`,
    tempo: source.tempo,
    drums: structuredClone(source.drums),
    melody: [...source.melody], // primitives/null — slice copy is enough
    mutes: { ...source.mutes },
    createdAt: now,
    updatedAt: now,
  };
}

/** Return a copy with an updated display name and fresh updatedAt */
export function renameProject(
  project: MusicProject,
  name: string,
  options: ProjectMutationOptions = {},
): MusicProject {
  const now = options.now ?? new Date().toISOString();

  return {
    ...project,
    name,
    updatedAt: now,
  };
}

/** Studio explicit Save — clone project body, trim name, touch updatedAt */
export function commitStudioProject(
  project: MusicProject,
  options: ProjectMutationOptions = {},
): MusicProject {
  const now = options.now ?? new Date().toISOString();

  return {
    ...structuredClone(project),
    name: project.name.trim(),
    updatedAt: now,
  };
}
