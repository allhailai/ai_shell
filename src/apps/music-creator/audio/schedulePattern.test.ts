import { describe, expect, it } from "vitest";
import { DRUM_TRACK_IDS, MELODY_SCALE_MIDI, STEPS } from "../constants";
import { createEmptyProject } from "../project/createProject";
import { buildSchedule, MELODY_NOTE_DURATION } from "./schedulePattern";

describe("buildSchedule", () => {
  it("returns STEPS empty columns for a blank project", () => {
    const project = createEmptyProject("sched-empty", {
      now: "2026-07-27T12:00:00.000Z",
    });

    const schedule = buildSchedule(project);

    expect(schedule).toHaveLength(STEPS);
    for (let i = 0; i < STEPS; i++) {
      expect(schedule[i]).toEqual({
        stepIndex: i,
        drums: [],
        melodyMidi: null,
      });
    }
  });

  it("includes unmuted drum hits on the matching step", () => {
    const project = createEmptyProject("sched-drums", {
      now: "2026-07-27T12:00:00.000Z",
    });
    project.drums.kick[0] = true;
    project.drums.kick[4] = true;
    project.drums.snare[4] = true;

    const schedule = buildSchedule(project);

    expect(schedule[0].drums).toEqual(["kick"]);
    expect(schedule[4].drums).toEqual(["kick", "snare"]);
    expect(schedule[1].drums).toEqual([]);
  });

  it("omits drum hits when that lane is muted", () => {
    const project = createEmptyProject("sched-mute-drum", {
      now: "2026-07-27T12:00:00.000Z",
    });
    project.drums.kick[0] = true;
    project.drums.hatClosed[0] = true;
    project.mutes.kick = true;

    const schedule = buildSchedule(project);

    expect(schedule[0].drums).toEqual(["hatClosed"]);
  });

  it("places melody MIDI on the step when unmuted", () => {
    const project = createEmptyProject("sched-melody", {
      now: "2026-07-27T12:00:00.000Z",
    });
    const note = MELODY_SCALE_MIDI[4]; // E4
    project.melody[3] = note;
    project.melody[4] = note; // adjacent same pitch — still two separate steps

    const schedule = buildSchedule(project);

    expect(schedule[3].melodyMidi).toBe(note);
    expect(schedule[4].melodyMidi).toBe(note);
    expect(schedule[5].melodyMidi).toBeNull();
  });

  it("clears melody when the melody track is muted", () => {
    const project = createEmptyProject("sched-mute-melody", {
      now: "2026-07-27T12:00:00.000Z",
    });
    project.melody[2] = MELODY_SCALE_MIDI[0];
    project.mutes.melody = true;

    const schedule = buildSchedule(project);

    expect(schedule[2].melodyMidi).toBeNull();
  });

  it("lists drum tracks in DRUM_TRACK_IDS order when several fire together", () => {
    const project = createEmptyProject("sched-order", {
      now: "2026-07-27T12:00:00.000Z",
    });
    for (const trackId of DRUM_TRACK_IDS) {
      project.drums[trackId][7] = true;
    }

    expect(buildSchedule(project)[7].drums).toEqual([...DRUM_TRACK_IDS]);
  });
});

describe("MELODY_NOTE_DURATION", () => {
  it("is one sixteenth note for engine triggers", () => {
    expect(MELODY_NOTE_DURATION).toBe("16n");
  });
});
