import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  CodaScopePathValidationError,
  assertPositiveSafeInteger,
  assertSafeImportedPathMetadata,
  assertSafePathSegment,
  assertStrictDescendant,
  assertVersionIndex,
  isPathValidationError,
  resolveContainedRelativePath,
} from "./codaScopePathSafety.js";

const hostileSegments = [
  "",
  ".",
  "..",
  "../..",
  "a/b",
  "a\\b",
  "/absolute/path",
  "C:\\absolute\\path",
  "C:drive-relative",
  "nul\0byte",
  "a%2fb",
  "a%5Cb",
  "a%252fb",
];

describe("CodaScope filesystem path safety", () => {
  it.each(hostileSegments)("rejects unsafe single segment %j with stable HTTP metadata", (value) => {
    let thrown: unknown;
    try {
      assertSafePathSegment(value, "epic ID");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CodaScopePathValidationError);
    expect(isPathValidationError(thrown)).toBe(true);
    expect(thrown).toMatchObject({ status: 400, code: "invalid_input", message: "Invalid epic ID." });
  });

  it.each(["550e8400-e29b-41d4-a716-446655440000", "epic-with-hyphen", "epic_with_underscore"])(
    "preserves legitimate identifier %s",
    (value) => expect(assertSafePathSegment(value, "epic ID")).toBe(value),
  );

  it("resolves an intentional nested relative path without string-prefix containment", () => {
    const root = path.resolve("/tmp/codascope-path-root");
    expect(resolveContainedRelativePath(root, "folder/note.md", "note path"))
      .toBe(path.join(root, "folder", "note.md"));
    expect(() => resolveContainedRelativePath(root, "../codascope-path-root-sibling/file", "note path"))
      .toThrow("Invalid note path.");
    expect(() => resolveContainedRelativePath(root, "folder\\note.md", "note path"))
      .toThrow("Invalid note path.");
  });

  it("requires destructive targets to be strict descendants", () => {
    const root = path.resolve("/tmp/codascope-projects");
    expect(assertStrictDescendant(root, path.join(root, "project-a"), "project target"))
      .toBe(path.join(root, "project-a"));
    expect(() => assertStrictDescendant(root, root, "project target"))
      .toThrow("Invalid project target.");
    expect(() => assertStrictDescendant(root, path.resolve(root, "..", "outside"), "project target"))
      .toThrow("Invalid project target.");
  });

  it.each([
    ["string", "1"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["fraction", 1.5],
    ["zero", 0],
    ["negative", -1],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s path-backed version numbers", (_name, value) => {
    expect(() => assertPositiveSafeInteger(value, "version number"))
      .toThrow("Invalid version number.");
  });

  it("accepts positive safe version numbers and rejects duplicate indexes", () => {
    expect(assertPositiveSafeInteger(1, "version number")).toBe(1);
    expect(assertPositiveSafeInteger(Number.MAX_SAFE_INTEGER, "version number"))
      .toBe(Number.MAX_SAFE_INTEGER);
    expect(() => assertVersionIndex(
      { versions: [{ number: 1 }, { number: 1 }] },
      "number",
      "design version number",
    )).toThrow("Invalid design version number.");
    expect(() => assertVersionIndex(
      { versions: [{ version: 2 }, { version: 2 }] },
      "version",
      "epic version number",
    )).toThrow("Invalid epic version number.");
  });

  it("rejects malformed imported design and epic version indexes", () => {
    expect(() => assertSafeImportedPathMetadata(
      { versions: null },
      "designs/doc-safe/versions/versions.json",
      "epic",
    )).toThrow("Invalid imported design version number.");
    expect(() => assertSafeImportedPathMetadata(
      { versions: [{ version: 0 }] },
      "versions/versions.json",
      "epic",
    )).toThrow("Invalid imported epic version number.");
  });
});
