import { describe, expect, it } from "vitest";
import {
  WorkspaceMutationActionCollector,
  validateWorkspaceMutationAction,
  validateWorkspaceMutationActions,
} from "./codaScopeWorkspaceMutationActions.js";

const canonicalCreated = {
  type: "note_created",
  attributes: {
    stableId: "note-1",
    scope: "codascope",
    visibility: "private",
    path: "notes/one.md",
    title: "One",
    contentHash: "a".repeat(32),
  },
  description: 'Created CodaScope note "One".',
};

describe("workspace mutation action validation", () => {
  it("accepts only canonical creation and exact note mutation operations", () => {
    expect(validateWorkspaceMutationAction(canonicalCreated)).toEqual(
      canonicalCreated,
    );
    for (const operation of [
      "edit_codascope_note",
      "set_codascope_note_title",
      "set_codascope_note_visibility",
      "archive_codascope_note",
    ]) {
      expect(validateWorkspaceMutationAction({
        ...canonicalCreated,
        type: "operation_completed",
        attributes: { operation, ...canonicalCreated.attributes },
      })).toMatchObject({
        type: "operation_completed",
        attributes: { operation },
      });
    }
    expect(validateWorkspaceMutationAction({
      ...canonicalCreated,
      type: "operation_completed",
      attributes: {
        operation: "replace_codascope_note_range",
        ...canonicalCreated.attributes,
        startLine: "2",
        endLine: "3",
      },
    })).toMatchObject({
      type: "operation_completed",
      attributes: {
        operation: "replace_codascope_note_range",
        startLine: "2",
        endLine: "3",
      },
    });
  });

  it.each([
    ["traversal stable ID", { attributes: { ...canonicalCreated.attributes, stableId: "../note" } }],
    ["absolute path", { attributes: { ...canonicalCreated.attributes, path: "/notes/one.md" } }],
    ["non-Markdown path", { attributes: { ...canonicalCreated.attributes, path: "notes/one.txt" } }],
    ["reserved filename", { attributes: { ...canonicalCreated.attributes, path: "notes/_index.md" } }],
    ["hidden system filename", { attributes: { ...canonicalCreated.attributes, path: "notes/.hidden.md" } }],
    ["oversized stable ID", { attributes: { ...canonicalCreated.attributes, stableId: "x".repeat(256) } }],
    ["oversized path", { attributes: { ...canonicalCreated.attributes, path: `${"x".repeat(998)}.md` } }],
    ["oversized title", { attributes: { ...canonicalCreated.attributes, title: "x".repeat(301) } }],
    ["newline title", { attributes: { ...canonicalCreated.attributes, title: "One\nTwo" } }],
    ["invalid hash", { attributes: { ...canonicalCreated.attributes, contentHash: "not-a-hash" } }],
    ["missing field", { attributes: without(canonicalCreated.attributes, "path") }],
    ["unknown attribute", { attributes: { ...canonicalCreated.attributes, actorId: "mallory" } }],
    ["oversized description", { description: "x".repeat(501) }],
  ])("rejects %s", (_label, patch) => {
    expect(() => validateWorkspaceMutationAction({
      ...canonicalCreated,
      ...patch,
    })).toThrow("Invalid workspace mutation action");
  });

  it("rejects unknown operations and incomplete operation receipts", () => {
    for (const attributes of [
      { operation: "delete_note", ...canonicalCreated.attributes },
      { ...canonicalCreated.attributes },
    ]) {
      expect(() => validateWorkspaceMutationAction({
        ...canonicalCreated,
        type: "operation_completed",
        attributes,
      })).toThrow("Invalid workspace mutation action");
    }
    for (const attributes of [
      {
        operation: "replace_codascope_note_range",
        ...canonicalCreated.attributes,
      },
      {
        operation: "replace_codascope_note_range",
        ...canonicalCreated.attributes,
        startLine: "4",
        endLine: "3",
      },
    ]) {
      expect(() => validateWorkspaceMutationAction({
        ...canonicalCreated,
        type: "operation_completed",
        attributes,
      })).toThrow("Invalid workspace mutation action");
    }
  });

  it("rejects an entire collection containing one malformed action", () => {
    expect(() => validateWorkspaceMutationActions([
      canonicalCreated,
      {
        ...canonicalCreated,
        attributes: { ...canonicalCreated.attributes, path: "../bad.md" },
      },
    ])).toThrow("Invalid workspace mutation actions");
  });

  it("reserves capacity before mutation and never silently accepts a 26th slot", () => {
    const collector = new WorkspaceMutationActionCollector();
    const reservations = Array.from({ length: 25 }, () => collector.reserve());
    expect(reservations.every(Boolean)).toBe(true);
    expect(collector.reserve()).toBeNull();
    reservations.forEach((reservation, index) => {
      reservation?.commitNoteCreated({
        ...canonicalCreated.attributes,
        stableId: `note-${index + 1}`,
        scope: "codascope",
        visibility: "private",
        path: `notes/${index + 1}.md`,
        title: `Note ${index + 1}`,
      });
    });
    expect(collector.drain()).toHaveLength(25);
  });
});

function without(
  value: Record<string, string>,
  field: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  );
}
