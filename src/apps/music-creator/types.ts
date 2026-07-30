/** Current schema; bump when shape changes */
export const STORE_SCHEMA_VERSION = 1;

export type DrumTrackId = "kick" | "snare" | "hatClosed" | "hatOpen";

/** 16 steps; true = hit */
export type DrumPattern = Record<DrumTrackId, boolean[]>;

/** stepIndex -> midi note number, or null = rest (monophonic: one note per column) */
export type MelodyPattern = (number | null)[];

export type MuteTargetId = DrumTrackId | "melody";

export interface MusicProject {
  id: string;
  name: string;
  tempo: number;
  drums: DrumPattern;
  melody: MelodyPattern;
  mutes: Record<MuteTargetId, boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface MusicCreatorStoreEnvelope {
  schemaVersion: number;
  projects: Record<string, MusicProject>;
}

/** Discriminated union — never silently ignore failures */
export type StorageResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: StorageErrorCode; message: string };

export type StorageErrorCode =
  | "parse_error"
  | "invalid_envelope"
  | "unsupported_version"
  | "migration_failed"
  | "quota_exceeded"
  | "unavailable";

/** Returned when envelope parses but some projects fail validation */
export interface ProjectLoadWarning {
  projectId: string;
  code: "invalid_shape" | "missing_fields";
  message: string;
}

/** Successful load — valid projects for UI plus non-fatal warnings; raw storage untouched on load */
export interface LoadedStore {
  envelope: MusicCreatorStoreEnvelope;
  warnings: ProjectLoadWarning[];
}
