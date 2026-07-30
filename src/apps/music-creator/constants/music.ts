import type { DrumTrackId, MuteTargetId } from "../types";

/** Sequencer and schema defaults — used by factories, validation, and Studio grids */

export const STEPS = 16;

/** Visual / musical grouping — 16 steps = 4 bars of 4 sixteenths */
export const STEPS_PER_BAR = 4;

/** True on the last step of each bar (0-indexed: 3, 7, 11) — bar divider after this column, not after the final step */
export function isBarEnd(stepIndex: number): boolean {
  return stepIndex < STEPS - 1 && (stepIndex + 1) % STEPS_PER_BAR === 0;
}

export const DEFAULT_TEMPO = 120;
export const DEFAULT_PROJECT_NAME = "Untitled";
export const TEMPO_MIN = 60;
export const TEMPO_MAX = 180;

export const DRUM_TRACK_IDS: readonly DrumTrackId[] = [
  "kick",
  "snare",
  "hatClosed",
  "hatOpen",
] as const;

/** Human-readable lane names for grid labels and StepCell aria-labels */
export const DRUM_TRACK_LABELS: Record<DrumTrackId, string> = {
  kick: "Kick",
  snare: "Snare",
  hatClosed: "Closed hi-hat",
  hatOpen: "Open hi-hat",
};

/** Chromatic melody range — C4 through C5 inclusive (sharps, not flats) */
export const MELODY_MIDI_MIN = 60;
export const MELODY_MIDI_MAX = 72;

const CHROMATIC_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/** Pitch classes that map to piano black keys (sharps in this app) */
const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

function midiToSharpLabel(midi: number): string {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${CHROMATIC_NAMES[pitchClass]}${octave}`;
}

/** Row order for the melody grid — low to high MIDI (C4 → C5) */
export const MELODY_SCALE_MIDI: readonly number[] = Array.from(
  { length: MELODY_MIDI_MAX - MELODY_MIDI_MIN + 1 },
  (_, index) => MELODY_MIDI_MIN + index,
);

/** Row labels aligned with MELODY_SCALE_MIDI — sharps for black-key rows */
export const MELODY_NOTE_LABELS: readonly string[] = MELODY_SCALE_MIDI.map(midiToSharpLabel);

/** Whether a MIDI note is a black-key row in the grid (C#, D#, F#, G#, A#) */
export function isBlackKeyMidi(midi: number): boolean {
  const pitchClass = ((midi % 12) + 12) % 12;
  return BLACK_KEY_PITCH_CLASSES.has(pitchClass);
}

/** Row-index helper — indexes MELODY_SCALE_MIDI */
export function isBlackKeyRow(rowIndex: number): boolean {
  const midi = MELODY_SCALE_MIDI[rowIndex];
  return midi !== undefined && isBlackKeyMidi(midi);
}

/** Validation helper — melody steps must land on a grid row */
export function isMelodyMidiInRange(midi: number): boolean {
  return (
    Number.isInteger(midi) &&
    midi >= MELODY_MIDI_MIN &&
    midi <= MELODY_MIDI_MAX
  );
}

export const MUTE_TARGET_IDS = [...DRUM_TRACK_IDS, "melody"] as const;

/** Display names for mute toggles — drums reuse lane labels; melody is separate */
export const MUTE_TARGET_LABELS: Record<MuteTargetId, string> = {
  kick: DRUM_TRACK_LABELS.kick,
  snare: DRUM_TRACK_LABELS.snare,
  hatClosed: DRUM_TRACK_LABELS.hatClosed,
  hatOpen: DRUM_TRACK_LABELS.hatOpen,
  melody: "Melody",
};
