import {
  DEFAULT_PROJECT_NAME,
  DEFAULT_TEMPO,
  DRUM_TRACK_IDS,
  MUTE_TARGET_IDS,
  STEPS,
} from "../constants";
import type {
  DrumPattern,
  MelodyPattern,
  MusicCreatorStoreEnvelope,
  MusicProject,
  MuteTargetId,
} from "../types";
import { STORE_SCHEMA_VERSION } from "../types";

/** All-false 16-step pattern for each drum lane */
export function createEmptyDrumPattern(): DrumPattern {
  const emptyRow = Array.from({ length: STEPS }, () => false);
  return Object.fromEntries(
    DRUM_TRACK_IDS.map((id) => [id, [...emptyRow]]),
  ) as DrumPattern;
}

/** 16 rests — monophonic melody with no notes set */
export function createEmptyMelodyPattern(): MelodyPattern {
  return Array.from({ length: STEPS }, () => null);
}

/** Unmuted by default for every drum lane and melody */
export function createDefaultMutes(): Record<MuteTargetId, boolean> {
  return Object.fromEntries(MUTE_TARGET_IDS.map((id) => [id, false])) as Record<
    MuteTargetId,
    boolean
  >;
}

export interface CreateEmptyProjectOptions {
  name?: string;
  tempo?: number;
  now?: string;
}

/** Blank project factory — defaults match the approved M2 schema */
export function createEmptyProject(
  id: string,
  options: CreateEmptyProjectOptions = {},
): MusicProject {
  const now = options.now ?? new Date().toISOString();

  return {
    id,
    name: options.name ?? DEFAULT_PROJECT_NAME,
    tempo: options.tempo ?? DEFAULT_TEMPO,
    drums: createEmptyDrumPattern(),
    melody: createEmptyMelodyPattern(),
    mutes: createDefaultMutes(),
    createdAt: now,
    updatedAt: now,
  };
}

/** Empty on-disk envelope for a fresh store or post-reset recovery */
export function createEmptyStoreEnvelope(): MusicCreatorStoreEnvelope {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    projects: {},
  };
}
