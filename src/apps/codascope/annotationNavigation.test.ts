import { describe, expect, it } from "vitest";
import type { InlineAnnotationAnchorItem } from "../../shared/markdown";
import { getAnnotationAnchorById, getRelativeAnnotationAnchor } from "./annotationNavigation";

const anchors: InlineAnnotationAnchorItem[] = [
  { annotationId: "first", startMarkerFrom: 0, startMarkerTo: 10, endMarkerFrom: 16, endMarkerTo: 26, rangeFrom: 10, rangeTo: 16, count: 1, hasOpen: true },
  { annotationId: "second", startMarkerFrom: 27, startMarkerTo: 37, endMarkerFrom: 45, endMarkerTo: 55, rangeFrom: 37, rangeTo: 45, count: 2, hasOpen: true },
  { annotationId: "third", startMarkerFrom: 56, startMarkerTo: 66, endMarkerFrom: 72, endMarkerTo: 82, rangeFrom: 66, rangeTo: 72, count: 1, hasOpen: false },
];

describe("annotation navigation", () => {
  it("returns only the exact validated marker pair for an annotation", () => {
    expect(getAnnotationAnchorById(anchors, "second")).toBe(anchors[1]);
    expect(getAnnotationAnchorById(anchors, "missing")).toBeUndefined();
  });

  it("moves through validated anchors and wraps at either end", () => {
    expect(getRelativeAnnotationAnchor(anchors, 16, "next")).toBe(anchors[1]);
    expect(getRelativeAnnotationAnchor(anchors, 37, "previous")).toBe(anchors[0]);
    expect(getRelativeAnnotationAnchor(anchors, 72, "next")).toBe(anchors[0]);
    expect(getRelativeAnnotationAnchor(anchors, 10, "previous")).toBe(anchors[2]);
  });
});
