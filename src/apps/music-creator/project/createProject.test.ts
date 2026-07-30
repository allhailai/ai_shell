import { describe, expect, it } from "vitest";
import {
  STEPS,
  DEFAULT_PROJECT_NAME,
  DEFAULT_TEMPO,
  DRUM_TRACK_IDS,
  MUTE_TARGET_IDS,
} from "../constants";
import {
  createDefaultMutes,
  createEmptyDrumPattern,
  createEmptyMelodyPattern,
  createEmptyProject,
  createEmptyStoreEnvelope,
} from "./createProject";
import { STORE_SCHEMA_VERSION } from "../types";

describe("createEmptyDrumPattern", () => {
  it("returns four 16-step rows of false", () => {
    const pattern = createEmptyDrumPattern();

    for (const trackId of DRUM_TRACK_IDS) {
      expect(pattern[trackId]).toHaveLength(STEPS);
      expect(pattern[trackId].every((step) => step === false)).toBe(true);
    }
  });
});

describe("createEmptyMelodyPattern", () => {
  it("returns 16 rests", () => {
    const melody = createEmptyMelodyPattern();

    expect(melody).toHaveLength(STEPS);
    expect(melody.every((step) => step === null)).toBe(true);
  });
});

describe("createDefaultMutes", () => {
  it("unmutes every drum lane and melody", () => {
    const mutes = createDefaultMutes();

    for (const targetId of MUTE_TARGET_IDS) {
      expect(mutes[targetId]).toBe(false);
    }
  });
});

describe("createEmptyProject", () => {
  const fixedNow = "2026-07-24T12:00:00.000Z";

  it("uses plan defaults for a new project", () => {
    const project = createEmptyProject("proj-1", { now: fixedNow });

    expect(project.id).toBe("proj-1");
    expect(project.name).toBe(DEFAULT_PROJECT_NAME);
    expect(project.tempo).toBe(DEFAULT_TEMPO);
    expect(project.createdAt).toBe(fixedNow);
    expect(project.updatedAt).toBe(fixedNow);
    expect(project.drums.kick).toHaveLength(STEPS);
    expect(project.melody).toHaveLength(STEPS);
    expect(project.mutes.melody).toBe(false);
  });

  it("accepts optional name and tempo overrides", () => {
    const project = createEmptyProject("proj-2", {
      name: "My Loop",
      tempo: 140,
      now: fixedNow,
    });

    expect(project.name).toBe("My Loop");
    expect(project.tempo).toBe(140);
  });
});

describe("createEmptyStoreEnvelope", () => {
  it("returns schema v1 with no projects", () => {
    const envelope = createEmptyStoreEnvelope();

    expect(envelope).toEqual({
      schemaVersion: STORE_SCHEMA_VERSION,
      projects: {},
    });
  });
});
