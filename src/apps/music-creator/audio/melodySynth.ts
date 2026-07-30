/**
 * Melody voice — single monophonic `Tone.Synth` for the 8×16 pitch grid.
 *
 * Ownership (same rules as `drumSynths.ts`):
 * - Factory only; `audioEngine` (4.3+) owns the instance for the Studio session.
 * - `stop()` keeps this node; `dispose()` destroys it.
 * - Never put the Synth in React state or persist it.
 *
 * Playback semantics (enforced when scheduling in 4.2+):
 * - One MIDI note or rest per step (`MelodyPattern`)
 * - Note length `"16n"`; adjacent identical notes retrigger (no ties)
 * - Rests (`null`) schedule nothing
 */

import { Synth } from "tone";

/**
 * Create the Studio melody voice, routed to the Tone destination.
 * Call after / as part of audio-context start (`Tone.start()` in `play()`).
 */
export function createMelodySynth(): Synth {
  // Soft triangle lead — readable over drums without harsh square buzz
  const synth = new Synth({
    oscillator: { type: "triangle" },
    envelope: {
      attack: 0.005,
      decay: 0.08,
      sustain: 0.2,
      release: 0.08,
    },
    volume: -8,
  }).toDestination();

  return synth;
}
