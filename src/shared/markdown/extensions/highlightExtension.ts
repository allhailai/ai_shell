/* ── Highlight Extension (==text==) ────────────────────────────────────
   Regex-based ViewPlugin that finds ==...== patterns and renders them
   as highlighted text in live preview.

   Intentional: using regex scanner for ==highlight== rather than Lezer
   grammar extension. If this approach hits limitations (e.g., nesting,
   edge cases), migrate to a proper Lezer grammar extension.

   Behavior:
   - When cursor is NOT on the line: hide == markers, apply
     .cm-live-highlight class (yellow background)
   - When cursor IS on the line: reveal raw ==text==
   - Follows the same pattern as bold/italic in livePreviewExtension.ts
   ──────────────────────────────────────────────────────────────────── */

import { type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

// ── Decoration cache ────────────────────────────────────────────────

const highlightMarkDecoration = Decoration.mark({ class: "cm-live-highlight" });
const replaceDecoration = Decoration.replace({});

// ── Regex for ==text== ──────────────────────────────────────────────

const HIGHLIGHT_RE = /==((?:[^=]|=[^=])+)==/g;

// ── Cursor-line detection ───────────────────────────────────────────

function cursorLineNumbers(state: EditorState, editable: boolean): Set<number> {
  if (!editable) return new Set();
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;
    for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber++) {
      lines.add(lineNumber);
    }
  }
  return lines;
}

// ── Decoration builder ──────────────────────────────────────────────

type DecorationEntry = { from: number; to: number; decoration: Decoration };

function buildHighlightDecorations(view: EditorView, editable: boolean): DecorationSet {
  const { state } = view;
  const cursorLines = cursorLineNumbers(state, editable);
  const entries: DecorationEntry[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    let match: RegExpExecArray | null;
    HIGHLIGHT_RE.lastIndex = 0;

    while ((match = HIGHLIGHT_RE.exec(text)) !== null) {
      const matchFrom = from + match.index;
      const matchTo = matchFrom + match[0].length;
      const innerFrom = matchFrom + 2; // after ==
      const innerTo = matchTo - 2; // before ==

      // Check if cursor is on this line
      const line = state.doc.lineAt(matchFrom);
      if (cursorLines.has(line.number)) continue;

      // Apply highlight mark to the inner text
      if (innerFrom < innerTo) {
        entries.push({ from: innerFrom, to: innerTo, decoration: highlightMarkDecoration });
      }

      // Hide the == markers
      entries.push({ from: matchFrom, to: innerFrom, decoration: replaceDecoration });
      entries.push({ from: innerTo, to: matchTo, decoration: replaceDecoration });
    }
  }

  // Sort by position for Decoration.set
  entries.sort((a, b) => a.from - b.from || a.to - b.to);

  return Decoration.set(
    entries.map((e) => e.decoration.range(e.from, e.to)),
    true,
  );
}

// ── Extension entry point ───────────────────────────────────────────

export function buildHighlightExtension({ editable }: { editable: boolean }): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildHighlightDecorations(view, editable);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged
        ) {
          this.decorations = buildHighlightDecorations(update.view, editable);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
