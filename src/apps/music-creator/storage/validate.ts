import {
  DRUM_TRACK_IDS,
  isMelodyMidiInRange,
  MUTE_TARGET_IDS,
  STEPS,
  TEMPO_MAX,
  TEMPO_MIN,
} from "../constants";
import type {
  DrumPattern,
  MelodyPattern,
  MusicCreatorStoreEnvelope,
  MusicProject,
  MuteTargetId,
  ProjectLoadWarning,
} from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isBooleanStepRow(value: unknown): value is boolean[] {
  return (
    Array.isArray(value) &&
    value.length === STEPS &&
    value.every((step) => typeof step === "boolean")
  );
}

function validateDrumPattern(value: unknown): DrumPattern | null {
  if (!isRecord(value)) return null;

  const pattern = {} as DrumPattern;
  for (const trackId of DRUM_TRACK_IDS) {
    const row = value[trackId];
    if (!isBooleanStepRow(row)) return null;
    pattern[trackId] = [...row];
  }

  return pattern;
}

function validateMelodyPattern(value: unknown): MelodyPattern | null {
  if (!Array.isArray(value) || value.length !== STEPS) return null;

  const melody: MelodyPattern = [];
  for (const step of value) {
    if (step === null) {
      melody.push(null);
      continue;
    }
    if (typeof step !== "number" || !isMelodyMidiInRange(step)) return null;
    melody.push(step);
  }

  return melody;
}

function validateMutes(value: unknown): Record<MuteTargetId, boolean> | null {
  if (!isRecord(value)) return null;

  const mutes = {} as Record<MuteTargetId, boolean>;
  for (const targetId of MUTE_TARGET_IDS) {
    const muted = value[targetId];
    if (typeof muted !== "boolean") return null;
    mutes[targetId] = muted;
  }

  return mutes;
}

/** Root envelope shape before per-project validation */
export function validateEnvelopeShape(
  value: unknown,
): value is MusicCreatorStoreEnvelope {
  if (!isRecord(value)) return false;
  if (typeof value.schemaVersion !== "number") return false;
  if (!isRecord(value.projects)) return false;
  return true;
}

/**
 * Validate a single project entry. Returns a warning if invalid.
 * Record key is used in warnings (may differ from embedded project.id).
 */
export function validateProject(
  projectId: string,
  value: unknown,
): { ok: true; project: MusicProject } | { ok: false; warning: ProjectLoadWarning } {
  if (!isRecord(value)) {
    return {
      ok: false,
      warning: {
        projectId,
        code: "invalid_shape",
        message: "Project entry is not an object",
      },
    };
  }

  const missing: string[] = [];
  if (!isNonEmptyString(value.id)) missing.push("id");
  if (!isNonEmptyString(value.name)) missing.push("name");
  if (typeof value.tempo !== "number") missing.push("tempo");
  if (!isIsoDateString(value.createdAt)) missing.push("createdAt");
  if (!isIsoDateString(value.updatedAt)) missing.push("updatedAt");

  if (missing.length > 0) {
    return {
      ok: false,
      warning: {
        projectId,
        code: "missing_fields",
        message: `Missing or invalid fields: ${missing.join(", ")}`,
      },
    };
  }

  const id = value.id as string;
  const name = value.name as string;
  const tempo = value.tempo as number;
  const createdAt = value.createdAt as string;
  const updatedAt = value.updatedAt as string;

  if (tempo < TEMPO_MIN || tempo > TEMPO_MAX) {
    return {
      ok: false,
      warning: {
        projectId,
        code: "invalid_shape",
        message: `Tempo must be between ${TEMPO_MIN} and ${TEMPO_MAX}`,
      },
    };
  }

  const drums = validateDrumPattern(value.drums);
  if (!drums) {
    return {
      ok: false,
      warning: {
        projectId,
        code: "invalid_shape",
        message: "Invalid drum pattern",
      },
    };
  }

  const melody = validateMelodyPattern(value.melody);
  if (!melody) {
    return {
      ok: false,
      warning: {
        projectId,
        code: "invalid_shape",
        message: "Invalid melody pattern",
      },
    };
  }

  const mutes = validateMutes(value.mutes);
  if (!mutes) {
    return {
      ok: false,
      warning: {
        projectId,
        code: "invalid_shape",
        message: "Invalid mutes",
      },
    };
  }

  const project: MusicProject = {
    id,
    name,
    tempo,
    drums,
    melody,
    mutes,
    createdAt,
    updatedAt,
  };

  if (project.id !== projectId) {
    // Record key must match embedded id — prevents orphan/hijacked entries in the envelope.
    return {
      ok: false,
      warning: {
        projectId,
        code: "invalid_shape",
        message: "Project id does not match store key",
      },
    };
  }

  return { ok: true, project };
}

/**
 * Filter to validated projects; collect warnings for invalid entries.
 * Caller (loadStore) returns this subset only — disk is not repaired automatically.
 */
export function validateProjectsRecord(
  projects: Record<string, unknown>,
): { projects: Record<string, MusicProject>; warnings: ProjectLoadWarning[] } {
  const valid: Record<string, MusicProject> = {};
  const warnings: ProjectLoadWarning[] = [];

  for (const [projectId, rawProject] of Object.entries(projects)) {
    const result = validateProject(projectId, rawProject);
    if (result.ok) {
      valid[projectId] = result.project;
    } else {
      warnings.push(result.warning);
    }
  }

  return { projects: valid, warnings };
}
