import { describe, expect, it } from "vitest";
import {
  isBarEnd,
  isBlackKeyMidi,
  isBlackKeyRow,
  isMelodyMidiInRange,
  MELODY_MIDI_MAX,
  MELODY_MIDI_MIN,
  MELODY_NOTE_LABELS,
  MELODY_SCALE_MIDI,
  STEPS,
  STEPS_PER_BAR,
} from "./music";

describe("isBarEnd", () => {
  it("marks every fourth step as a bar boundary", () => {
    expect(STEPS / STEPS_PER_BAR).toBe(4);
    expect(isBarEnd(3)).toBe(true);
    expect(isBarEnd(7)).toBe(true);
    expect(isBarEnd(11)).toBe(true);
  });

  it("does not mark other steps", () => {
    expect(isBarEnd(0)).toBe(false);
    expect(isBarEnd(4)).toBe(false);
    expect(isBarEnd(14)).toBe(false);
    expect(isBarEnd(15)).toBe(false);
  });
});

describe("chromatic melody scale", () => {
  it("spans C4 through C5 with sharps", () => {
    expect(MELODY_SCALE_MIDI).toHaveLength(13);
    expect(MELODY_SCALE_MIDI[0]).toBe(MELODY_MIDI_MIN);
    expect(MELODY_SCALE_MIDI.at(-1)).toBe(MELODY_MIDI_MAX);
    expect(MELODY_NOTE_LABELS[0]).toBe("C4");
    expect(MELODY_NOTE_LABELS[1]).toBe("C#4");
    expect(MELODY_NOTE_LABELS.at(-1)).toBe("C5");
  });

  it("marks black-key pitch classes", () => {
    expect(isBlackKeyMidi(61)).toBe(true); // C#4
    expect(isBlackKeyMidi(60)).toBe(false); // C4
    expect(isBlackKeyMidi(64)).toBe(false); // E4
    expect(isBlackKeyRow(1)).toBe(true);
    expect(isBlackKeyRow(0)).toBe(false);
  });

  it("validates in-range MIDI for melody steps", () => {
    expect(isMelodyMidiInRange(60)).toBe(true);
    expect(isMelodyMidiInRange(72)).toBe(true);
    expect(isMelodyMidiInRange(59)).toBe(false);
    expect(isMelodyMidiInRange(73)).toBe(false);
    expect(isMelodyMidiInRange(60.5)).toBe(false);
  });
});
