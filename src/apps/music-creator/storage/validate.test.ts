import { describe, expect, it } from "vitest";
import { MELODY_SCALE_MIDI, STEPS } from "../constants";
import { createEmptyProject } from "../project/createProject";
import { STORE_SCHEMA_VERSION } from "../types";
import {
  validateEnvelopeShape,
  validateProject,
  validateProjectsRecord,
} from "./validate";

describe("validateEnvelopeShape", () => {
  it("accepts a well-formed envelope", () => {
    expect(
      validateEnvelopeShape({
        schemaVersion: STORE_SCHEMA_VERSION,
        projects: {},
      }),
    ).toBe(true);
  });

  it("rejects non-objects and missing fields", () => {
    expect(validateEnvelopeShape(null)).toBe(false);
    expect(validateEnvelopeShape([])).toBe(false);
    expect(validateEnvelopeShape({ schemaVersion: 1 })).toBe(false);
    expect(validateEnvelopeShape({ projects: {} })).toBe(false);
    expect(validateEnvelopeShape({ schemaVersion: "1", projects: {} })).toBe(
      false,
    );
    expect(
      validateEnvelopeShape({ schemaVersion: 1, projects: [] }),
    ).toBe(false);
  });
});

describe("validateProject", () => {
  it("accepts a valid project", () => {
    const project = createEmptyProject("proj-valid", {
      now: "2026-07-24T12:00:00.000Z",
    });

    const result = validateProject("proj-valid", project);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project).toEqual(project);
    }
  });

  it("warns on missing required fields", () => {
    const result = validateProject("proj-bad", { name: "No id" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.warning.code).toBe("missing_fields");
      expect(result.warning.projectId).toBe("proj-bad");
      expect(result.warning.message).toContain("id");
    }
  });

  it("warns when tempo is out of range", () => {
    const project = createEmptyProject("proj-tempo", {
      now: "2026-07-24T12:00:00.000Z",
    });
    project.tempo = 999;

    const result = validateProject("proj-tempo", project);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.warning.code).toBe("invalid_shape");
      expect(result.warning.message).toContain("Tempo");
    }
  });

  it("warns when drum pattern shape is invalid", () => {
    const project = createEmptyProject("proj-drums", {
      now: "2026-07-24T12:00:00.000Z",
    });
    project.drums.kick = project.drums.kick.slice(0, STEPS - 1);

    const result = validateProject("proj-drums", project);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.warning.code).toBe("invalid_shape");
      expect(result.warning.message).toContain("drum");
    }
  });

  it("warns when melody contains a note outside the grid range", () => {
    const project = createEmptyProject("proj-melody", {
      now: "2026-07-24T12:00:00.000Z",
    });
    project.melody[0] = 999;

    const result = validateProject("proj-melody", project);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.warning.code).toBe("invalid_shape");
      expect(result.warning.message).toContain("melody");
    }
  });

  it("accepts melody notes from the chromatic grid", () => {
    const project = createEmptyProject("proj-melody-ok", {
      now: "2026-07-24T12:00:00.000Z",
    });
    project.melody[0] = MELODY_SCALE_MIDI[0];
    project.melody[1] = MELODY_SCALE_MIDI[1]; // C#4

    const result = validateProject("proj-melody-ok", project);

    expect(result.ok).toBe(true);
  });

  it("warns when embedded id does not match the store key", () => {
    const project = createEmptyProject("embedded-id", {
      now: "2026-07-24T12:00:00.000Z",
    });

    const result = validateProject("store-key", project);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.warning.code).toBe("invalid_shape");
      expect(result.warning.message).toContain("id does not match");
    }
  });
});

describe("validateProjectsRecord", () => {
  it("keeps valid projects and collects warnings for invalid entries", () => {
    const valid = createEmptyProject("good", {
      now: "2026-07-24T12:00:00.000Z",
    });

    const { projects, warnings } = validateProjectsRecord({
      good: valid,
      bad: { name: "missing id" },
    });

    expect(Object.keys(projects)).toEqual(["good"]);
    expect(projects.good).toEqual(valid);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.projectId).toBe("bad");
  });
});
