import { describe, expect, it } from "vitest";
import type { NoteEntry } from "./codaScopeTypes";
import { compareNoteEntriesByPriority } from "./noteEntrySort";

function entry(
  path: string,
  options: Partial<NoteEntry> = {},
): NoteEntry {
  return {
    path,
    title: path,
    tags: [],
    created: "",
    updated: "",
    wordCount: 0,
    ...options,
  };
}

describe("compareNoteEntriesByPriority", () => {
  it("orders pin status before type and folders before files within each pin group", () => {
    const entries = [
      entry("unpinned-file.md"),
      entry("unpinned-folder", { isFolder: true }),
      entry("pinned-file.md", { pinned: true }),
      entry("pinned-folder", { isFolder: true, pinned: true }),
    ];

    expect(entries.sort(compareNoteEntriesByPriority).map((item) => item.path)).toEqual([
      "pinned-folder",
      "pinned-file.md",
      "unpinned-folder",
      "unpinned-file.md",
    ]);
  });

  it("uses stars and recency only to order files in the same pin group", () => {
    const entries = [
      entry("older.md", { updated: "2026-01-01T00:00:00.000Z" }),
      entry("newer.md", { updated: "2026-02-01T00:00:00.000Z" }),
      entry("starred.md", { updated: "2025-01-01T00:00:00.000Z" }),
    ];

    const starred = new Set(["starred.md"]);
    entries.sort((left, right) => compareNoteEntriesByPriority(
      left,
      right,
      (candidate) => starred.has(candidate.path),
    ));

    expect(entries.map((item) => item.path)).toEqual([
      "starred.md",
      "newer.md",
      "older.md",
    ]);
  });
});
