/* ── CodaScope: Annotation Navigation ────────────────────────────────
   Navigation deliberately accepts only server-validated inline marker pairs.
   It never searches annotation text or guesses from nearby content.
   ──────────────────────────────────────────────────────────────────── */

import type { InlineAnnotationAnchorItem } from "../../shared/markdown";

export function getAnnotationAnchorById(
  anchors: InlineAnnotationAnchorItem[],
  annotationId: string,
): InlineAnnotationAnchorItem | undefined {
  return anchors.find((anchor) => anchor.annotationId === annotationId);
}

export function getRelativeAnnotationAnchor(
  anchors: InlineAnnotationAnchorItem[],
  currentPosition: number,
  direction: "next" | "previous",
): InlineAnnotationAnchorItem | undefined {
  if (anchors.length === 0) return undefined;

  if (direction === "next") {
    return anchors.find((anchor) => anchor.rangeFrom > currentPosition) ?? anchors[0];
  }

  return [...anchors].reverse().find((anchor) => anchor.rangeFrom < currentPosition) ?? anchors[anchors.length - 1];
}
