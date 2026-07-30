/**
 * Studio playback engine — module singleton between React and Tone.js.
 *
 * Ownership (who calls what):
 * - **Studio** (4.4+) passes a Play-time snapshot + `onStep`; never holds synth refs.
 * - **Router / hub** never import this file — audio is Studio-scoped.
 * - **This module** owns synth nodes, Transport schedule ids, and play state.
 * - **`buildSchedule`** (pure) compiles pattern → hits; this file triggers sounds.
 *
 * Lifecycle:
 * - `load()` — create drum kit + melody synth if missing (after user gesture / `play()`).
 * - `play()` — `Tone.start()`, schedule one repeating 16n callback, `Transport.start()`.
 * - `stop()` — halt Transport, clear **owned** event ids only; **keep** synths for replay.
 * - `dispose()` — `stop()` + destroy synths; call on Studio unmount / project id change (4.5).
 *
 * Never call global `Transport.cancel()` — it removes every app's events on the page.
 */

import { Frequency, getDraw, getTransport, now, start, type Synth } from "tone";
import { isMelodyMidiInRange, STEPS } from "../constants";
import type { DrumTrackId, MusicProject } from "../types";
import { createDrumSynths, type DrumSynthKit } from "./drumSynths";
import { createMelodySynth } from "./melodySynth";
import {
  buildSchedule,
  MELODY_NOTE_DURATION,
  type ScheduleSource,
  type ScheduledStep,
} from "./schedulePattern";

/** Snapshot passed from Studio on Play — pattern fields plus tempo for Transport BPM */
export type PlaySnapshot = ScheduleSource & Pick<MusicProject, "tempo">;

export interface PlayOptions {
  /** Playhead sync — Studio sets `currentStep` from this (~step rate, not 60 FPS) */
  onStep?: (stepIndex: number) => void;
}

/** Fixed pitches / lengths for synthesized drums (not tied to melody scale) */
const DRUM_KICK_NOTE = "C1";
const DRUM_HAT_CLOSED_NOTE = "G5";
const DRUM_HAT_CLOSED_DURATION = "32n";

let drumKit: DrumSynthKit | null = null;
let melodySynth: Synth | null = null;
/** Ids from our `schedule` / `scheduleRepeat` only — cleared with `Transport.clear(id)` */
let ownedEventIds: number[] = [];
let onStepCallback: ((stepIndex: number) => void) | null = null;
/** Live pattern — rebuilt on play and on Studio `updatePattern` while playing */
let activeSchedule: ScheduledStep[] = [];
let stepCounter = 0;
let playing = false;

function ensureSynths(): void {
  if (!drumKit) {
    drumKit = createDrumSynths();
  }
  if (!melodySynth) {
    melodySynth = createMelodySynth();
  }
}

function clearOwnedEvents(): void {
  const transport = getTransport();
  for (const eventId of ownedEventIds) {
    transport.clear(eventId);
  }
  ownedEventIds = [];
}

function triggerDrum(trackId: DrumTrackId, time: number): void {
  if (!drumKit) return;

  switch (trackId) {
    case "kick":
      drumKit.kick.triggerAttackRelease(DRUM_KICK_NOTE, MELODY_NOTE_DURATION, time);
      break;
    case "snare":
      drumKit.snare.triggerAttackRelease(MELODY_NOTE_DURATION, time);
      break;
    case "hatClosed":
      drumKit.hatClosed.triggerAttackRelease(
        DRUM_HAT_CLOSED_NOTE,
        DRUM_HAT_CLOSED_DURATION,
        time,
      );
      break;
    case "hatOpen":
      drumKit.hatOpen.triggerAttackRelease(MELODY_NOTE_DURATION, time);
      break;
  }
}

/** Fire one compiled step at the scheduled audio context time */
function triggerStep(step: ScheduledStep, time: number): void {
  if (!drumKit || !melodySynth) return;

  for (const trackId of step.drums) {
    triggerDrum(trackId, time);
  }

  if (step.melodyMidi !== null) {
    melodySynth.triggerAttackRelease(
      Frequency(step.melodyMidi, "midi").toFrequency(),
      MELODY_NOTE_DURATION,
      time,
    );
  }
}

function notifyStep(stepIndex: number, time: number): void {
  if (!onStepCallback) return;
  // getDraw() aligns UI updates with the audio clock (Transport fires slightly early)
  getDraw().schedule(() => onStepCallback?.(stepIndex), time);
}

export const audioEngine = {
  /**
   * Ensure synth nodes exist. Safe to call before first `play()`; recreates after `dispose()`.
   * Does not start the AudioContext — `play()` calls `Tone.start()` on user gesture.
   */
  load(): void {
    ensureSynths();
  },

  /**
   * Start looping playback from a snapshot (caller should `structuredClone(workingCopy)`).
   * Clears any prior owned schedule, builds fresh events, and starts Transport.
   */
  async play(snapshot: PlaySnapshot, options: PlayOptions = {}): Promise<void> {
    await start();

    if (playing) {
      this.stop();
    }

    ensureSynths();

    const transport = getTransport();
    activeSchedule = buildSchedule(snapshot);

    transport.bpm.value = snapshot.tempo;
    transport.loop = true;
    transport.loopStart = 0;
    transport.loopEnd = "1m";

    onStepCallback = options.onStep ?? null;
    stepCounter = 0;

    const repeatId = transport.scheduleRepeat(
      (time) => {
        const stepIndex = stepCounter % STEPS;
        triggerStep(activeSchedule[stepIndex], time);
        notifyStep(stepIndex, time);
        stepCounter = (stepCounter + 1) % STEPS;
      },
      MELODY_NOTE_DURATION,
      0,
    );

    ownedEventIds.push(repeatId);

    transport.position = 0;
    transport.start();
    playing = true;
  },

  /**
   * Halt playback and clear owned Transport events. Synth nodes stay allocated for reuse.
   */
  stop(): void {
    const transport = getTransport();
    transport.stop();
    clearOwnedEvents();

    transport.loop = false;
    stepCounter = 0;
    playing = false;

    if (onStepCallback) {
      onStepCallback(0);
    }
  },

  /**
   * Tear down synths and callbacks — Studio unmount or project id change (4.5).
   */
  dispose(): void {
    this.stop();

    drumKit?.dispose();
    melodySynth?.dispose();
    drumKit = null;
    melodySynth = null;
    onStepCallback = null;
    activeSchedule = [];
  },

  /**
   * Rebuild the in-memory hit list while Transport keeps running — Studio calls on
   * pattern/mute edits during playback so the next steps reflect the grid.
   */
  updatePattern(source: ScheduleSource): void {
    if (!playing) return;
    activeSchedule = buildSchedule(source);
  },

  /** Live BPM while playing — Studio tempo slider calls this */
  setTempo(bpm: number): void {
    getTransport().bpm.value = bpm;
  },

  isPlaying(): boolean {
    return playing;
  },

  /**
   * One-shot lane audition — user gesture on a drum label. Does not touch Transport
   * or the sequencer pattern.
   */
  async previewDrum(trackId: DrumTrackId): Promise<void> {
    await start();
    ensureSynths();
    triggerDrum(trackId, now());
  },

  /**
   * One-shot pitch audition — user gesture on a melody row label. Does not touch
   * Transport or the sequencer pattern.
   */
  async previewMelody(midi: number): Promise<void> {
    if (!isMelodyMidiInRange(midi)) return;

    await start();
    ensureSynths();
    if (!melodySynth) return;

    melodySynth.triggerAttackRelease(
      Frequency(midi, "midi").toFrequency(),
      MELODY_NOTE_DURATION,
      now(),
    );
  },
};
