import { describe, expect, it } from "vitest";
import {
  annotationEndMarker,
  annotationStartMarker,
  insertInlineAnnotationAnchors,
  parseInlineAnnotationAnchors,
  removeInlineAnnotationAnchors,
  stripInlineAnnotationMarkers,
} from "./codaScopeNoteAnnotationAnchorService.js";

const idA = "nann_abcdef123456";
const idB = "nann_abcdef654321";

describe("CodaScopeNoteAnnotationAnchorService", () => {
  it("parses a unique paired marker and exposes exact source offsets", () => {
    const source = `Before ${annotationStartMarker(idA)}signed URL${annotationEndMarker(idA)} after`;
    const parsed = parseInlineAnnotationAnchors(source);

    expect(parsed.issuesById).toEqual({});
    expect(parsed.ranges).toHaveLength(1);
    expect(source.slice(parsed.ranges[0].rangeFrom, parsed.ranges[0].rangeTo)).toBe("signed URL");
  });

  it("ignores marker-like text inside fenced and inline code", () => {
    const source = [
      "```md",
      `${annotationStartMarker(idA)}do not parse${annotationEndMarker(idA)}`,
      "```",
      `\`${annotationStartMarker(idB)}also code${annotationEndMarker(idB)}\``,
    ].join("\n");
    const parsed = parseInlineAnnotationAnchors(source);

    expect(parsed.ranges).toEqual([]);
    expect(parsed.markers).toEqual([]);
  });

  it("marks duplicate, unmatched, and crossing markers as invalid", () => {
    const duplicate = `${annotationStartMarker(idA)}one${annotationEndMarker(idA)} ${annotationStartMarker(idA)}two${annotationEndMarker(idA)}`;
    expect(parseInlineAnnotationAnchors(duplicate).issuesById[idA]).toContain("duplicate_marker");

    const unmatched = `${annotationStartMarker(idA)}one`;
    expect(parseInlineAnnotationAnchors(unmatched).issuesById[idA]).toContain("unmatched_marker");

    const crossing = `${annotationStartMarker(idA)}one ${annotationStartMarker(idB)}two${annotationEndMarker(idA)} three${annotationEndMarker(idB)}`;
    const parsedCrossing = parseInlineAnnotationAnchors(crossing);
    expect(parsedCrossing.issuesById[idA]).toContain("crossing_markers");
    expect(parsedCrossing.issuesById[idB]).toContain("crossing_markers");
    expect(parsedCrossing.ranges).toHaveLength(0);
  });

  it("inserts and removes paired markers only around the verified source selection", () => {
    const source = "A signed URL is returned.";
    const from = source.indexOf("signed URL");
    const anchored = insertInlineAnnotationAnchors(source, { id: idA, from, to: from + "signed URL".length, selectedText: "signed URL" });

    expect(parseInlineAnnotationAnchors(anchored).ranges).toHaveLength(1);
    expect(removeInlineAnnotationAnchors(anchored, idA)).toBe(source);
    expect(() => insertInlineAnnotationAnchors(source, { id: idA, from, to: from + 5, selectedText: "wrong" })).toThrow(/no longer matches/i);
  });

  it("strips control syntax for search and word-count helpers without touching code examples", () => {
    const source = `Visible ${annotationStartMarker(idA)}text${annotationEndMarker(idA)}\n\`${annotationStartMarker(idB)}example${annotationEndMarker(idB)}\``;
    const stripped = stripInlineAnnotationMarkers(source);

    expect(stripped).toBe(`Visible text\n\`${annotationStartMarker(idB)}example${annotationEndMarker(idB)}\``);
  });
});
