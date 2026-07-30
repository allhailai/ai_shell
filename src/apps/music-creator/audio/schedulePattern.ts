/**
 * Pure schedule builder — project pattern → per-step hits for the audio engine.
 *
 * Ownership:
 * - **Pure data only** — no Tone imports, no Transport, no synth triggers.
 * - `audioEngine.play()` snapshots on Play; `audioEngine.updatePattern()` rebuilds
 *   while Transport runs — both call `buildSchedule` from this module.
 * - Studio / React never call this directly; the engine owns the call site.
 *
 * Semantics (must stay aligned with ARCHITECTURE / plan):
 * - 16 steps; muted tracks contribute nothing
 * - Melody: at most one MIDI note per step, or null (rest)
 * - Adjacent identical melody notes are separate steps — engine retriggers each
 * - Note duration constant is `"16n"` for the engine (exported for one source of truth)
 */

import { DRUM_TRACK_IDS, STEPS } from "../constants";
import type { DrumTrackId, MusicProject } from "../types";

/** Tone time string for one sequencer step — used when triggering notes in 4.3+ */
export const MELODY_NOTE_DURATION = "16n" as const;

/**
 * One sixteenth-note column after mute filtering.
 * `drums` lists lanes that should fire; `melodyMidi` is null for rest or muted melody.
 */
export interface ScheduledStep {
  stepIndex: number;
  drums: DrumTrackId[];
  melodyMidi: number | null;
}

/** Fields `buildSchedule` reads — full `MusicProject` or a Play-time snapshot clone */
export type ScheduleSource = Pick<MusicProject, "drums" | "melody" | "mutes">;

/**
 * Build a fixed-length (STEPS) playback plan from drums, melody, and mutes.
 * Does not clone the project — caller should pass a snapshot if the source may mutate.
 */
export function buildSchedule(project: ScheduleSource): ScheduledStep[] {
  const steps: ScheduledStep[] = [];

  for (let stepIndex = 0; stepIndex < STEPS; stepIndex++) {
    const drums: DrumTrackId[] = [];

    for (const trackId of DRUM_TRACK_IDS) {
      // mutes[trackId] === true means silenced at playback
      if (project.mutes[trackId]) continue;
      if (project.drums[trackId][stepIndex]) {
        drums.push(trackId);
      }
    }

    let melodyMidi: number | null = null;
    if (!project.mutes.melody) {
      const note = project.melody[stepIndex] ?? null;
      melodyMidi = note;
    }

    steps.push({ stepIndex, drums, melodyMidi });
  }

  return steps;
}
