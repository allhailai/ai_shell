/* ── Highlight Extension (==text== and ==text=={.color}) ──────────────
   Regex-based ViewPlugin that finds ==...== and ==...=={.colorname}
   patterns and renders them as highlighted text in live preview.

   Intentional: using regex scanner for ==highlight== rather than Lezer
   grammar extension. If this approach hits limitations (e.g., nesting,
   edge cases), migrate to a proper Lezer grammar extension.

   Behavior:
   - When cursor is NOT on the line: hide == markers (and {.color}
     suffix if present), apply highlight class
   - When cursor IS on the line: reveal raw ==text== or ==text=={.red}
   - Default (no color suffix) → .cm-live-highlight (yellow)
   - With color suffix → .cm-live-highlight-{colorname} (e.g., red, green)
   - Follows the same pattern as bold/italic in livePreviewExtension.ts
   ──────────────────────────────────────────────────────────────────── */

import { type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

// ── Decoration cache ────────────────────────────────────────────────

const highlightMarkDecoration = Decoration.mark({ class: "cm-live-highlight" });
const replaceDecoration = Decoration.replace({});

// Cache for color-specific mark decorations
const colorDecorationCache = new Map<string, Decoration>();

function getColorDecoration(colorName: string): Decoration {
  let dec = colorDecorationCache.get(colorName);
  if (!dec) {
    dec = Decoration.mark({ class: `cm-live-highlight-${colorName}` });
    colorDecorationCache.set(colorName, dec);
  }
  return dec;
}

// ── Regex for ==text== and ==text=={.colorname} ─────────────────────

const HIGHLIGHT_RE = /==((?:[^=]|=[^=])+)==(?:\{\.(\w+)\})?/g;

// ── Document color detection ────────────────────────────────────────

/**
 * Scans the entire document content and returns a set of color names
 * used in highlight syntax (e.g., "red", "green" from `{.red}`, `{.green}`).
 */
export function detectHighlightColors(docContent: string): Set<string> {
  const colors = new Set<string>();
  const re = /==(?:[^=]|=[^=])+=={\.(\w+)}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(docContent)) !== null) {
    colors.add(match[1]);
  }
  return colors;
}

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
      const fullMatch = match[0]; // e.g., "==text=={.red}" or "==text=="
      const innerText = match[1]; // e.g., "text"
      const colorName = match[2]; // e.g., "red" or undefined

      const matchFrom = from + match.index;
      const matchTo = matchFrom + fullMatch.length;
      const innerFrom = matchFrom + 2; // after ==
      const innerTo = innerFrom + innerText.length; // before ==
      const closingMarkerEnd = innerTo + 2; // after closing ==

      // Check if cursor is on this line
      const line = state.doc.lineAt(matchFrom);
      if (cursorLines.has(line.number)) continue;

      // Determine which highlight decoration to use
      const markDec = colorName ? getColorDecoration(colorName) : highlightMarkDecoration;

      // Apply highlight mark to the inner text
      if (innerFrom < innerTo) {
        entries.push({ from: innerFrom, to: innerTo, decoration: markDec });
      }

      // Hide the opening == markers
      entries.push({ from: matchFrom, to: innerFrom, decoration: replaceDecoration });

      // Hide the closing == markers
      entries.push({ from: innerTo, to: closingMarkerEnd, decoration: replaceDecoration });

      // Hide the {.colorname} suffix if present
      if (colorName && closingMarkerEnd < matchTo) {
        entries.push({ from: closingMarkerEnd, to: matchTo, decoration: replaceDecoration });
      }
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
