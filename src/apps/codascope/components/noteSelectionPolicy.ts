import type { EditorSelection } from "@codemirror/state";

/**
 * A range annotation maps to exactly one durable marker pair. Do not infer a
 * primary range while multi-cursor editing is active.
 */
export function canCreateRangeAnnotation(selection: EditorSelection): boolean {
  return selection.ranges.length === 1 && !selection.main.empty;
}
