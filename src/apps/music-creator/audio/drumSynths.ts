/**
 * Drum synth factories — Tone.js nodes for the four sequencer lanes.
 *
 * Ownership (read before wiring Play):
 * - These factories **create** nodes; they do not schedule Transport events.
 * - `audioEngine` (phase 4.3+) owns the kit for the Studio session: call
 *   `createDrumSynths()` from `load()`, keep the kit across `stop()`, and
 *   call `kit.dispose()` from `audioEngine.dispose()` on Studio unmount /
 *   project id change.
 * - Never store Tone nodes in React state or `localStorage` — only this module
 *   graph (and later `audioEngine`) holds them.
 *
 * MVP uses synthesized drums only (no samples / fetch). Connected to the
 * shared destination; volumes are modest so four lanes + melody stay usable.
 */

import { MembraneSynth, MetalSynth, NoiseSynth } from "tone";

/** One playable node per drum lane — keys match `MusicProject.drums` / `DrumTrackId` */
export interface DrumSynthKit {
  kick: MembraneSynth;
  snare: NoiseSynth;
  hatClosed: MetalSynth;
  hatOpen: NoiseSynth;
  /** Dispose every lane synth — call from `audioEngine.dispose()`, not on Stop */
  dispose: () => void;
}

/**
 * Build a fresh four-lane drum kit routed to the Tone destination.
 * Safe to call only after a user gesture has started the audio context
 * (`Tone.start()` — done in `audioEngine.play()` in a later phase).
 */
export function createDrumSynths(): DrumSynthKit {
  // Kick — louder in the mix; pitched membrane with short pitch sweep
  const kick = new MembraneSynth({
    pitchDecay: 0.04,
    octaves: 5,
    oscillator: { type: "sine" },
    envelope: {
      attack: 0.001,
      decay: 0.4,
      sustain: 0.01,
      release: 0.20,
    },
    volume: -2,
  }).toDestination();

  // Snare — tight white-noise crack (short decay so it stays distinct from open hat)
  const snare = new NoiseSynth({
    noise: { type: "white" },
    envelope: {
      attack: 0.001,
      decay: 0.18,
      sustain: 0,
      release: 0.03,
    },
    volume: -8,
  }).toDestination();

  // Closed hi-hat — metallic, very short decay
  const hatClosed = new MetalSynth({
    envelope: {
      attack: 0.001,
      decay: 0.08,
      release: 0.02,
    },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
    volume: -18,
  }).toDestination();

  // Open hi-hat — softer pink noise, longer tail (clearly different from snare crack)
  const hatOpen = new NoiseSynth({
    noise: { type: "pink" },
    envelope: {
      attack: 0.001,
      decay: 0.55,
      sustain: 0.02,
      release: 0.25,
    },
    volume: -11,
  }).toDestination();

  return {
    kick,
    snare,
    hatClosed,
    hatOpen,
    dispose() {
      kick.dispose();
      snare.dispose();
      hatClosed.dispose();
      hatOpen.dispose();
    },
  };
}
