import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet,
} from "@codemirror/view";

export interface PinnedEditorRange {
  from: number;
  to: number;
}

export const setPinnedEditorRange = StateEffect.define<PinnedEditorRange | null>();

const pinnedRangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setPinnedEditorRange)) continue;
      const range = effect.value;
      next = range && range.to > range.from
        ? Decoration.set([
            Decoration.mark({
              class: "codascope-notes-agent-selection",
            }).range(range.from, range.to),
          ])
        : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function buildPinnedRangeExtension(): Extension {
  return pinnedRangeField;
}

/** Read-only inspection helper for lifecycle tests and editor diagnostics. */
export function readPinnedEditorRanges(
  state: EditorState,
): PinnedEditorRange[] {
  const decorations = state.field(pinnedRangeField, false);
  if (!decorations) return [];
  const ranges: PinnedEditorRange[] = [];
  decorations.between(0, state.doc.length, (from, to) => {
    ranges.push({ from, to });
  });
  return ranges;
}
