/* ── Focus Mode Extension ─────────────────────────────────────────────
   ViewPlugin that dims all document blocks except the one containing
   the cursor, creating a distraction-free "focus mode" writing
   experience.

   Behavior:
   - Controlled by a StateField (`focusModeField`) that toggles on/off
   - When enabled: adds `cm-focus-dimmed` class to every line NOT in the
     active block. Active block = contiguous group of non-blank lines
     containing the cursor.
   - CSS applies `opacity: 0.3` to dimmed lines with a smooth transition.
   - When disabled: no decorations applied.
   - Toggle via `toggleFocusMode` command (can bind to ⌘+Shift+F).

   Uses `shared-md-` CSS prefix per shell conventions.
   ──────────────────────────────────────────────────────────────────── */

import { StateField, StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

// ── State effect to toggle focus mode ────────────────────────────────

export const toggleFocusModeEffect = StateEffect.define<boolean>();

// ── State field tracking on/off ─────────────────────────────────────

export const focusModeField = StateField.define<boolean>({
  create() { return false; },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(toggleFocusModeEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

// ── Command to toggle focus mode ────────────────────────────────────

export function toggleFocusMode(view: EditorView): boolean {
  const current = view.state.field(focusModeField);
  view.dispatch({ effects: toggleFocusModeEffect.of(!current) });
  return true;
}

/** Check whether focus mode is currently enabled. */
export function isFocusModeOn(view: EditorView): boolean {
  return view.state.field(focusModeField);
}

// ── Decoration: line class for dimmed lines ─────────────────────────

const dimmedLineDecoration = Decoration.line({ class: "shared-md-focus-dimmed" });

// ── Active block detection ──────────────────────────────────────────
// An "active block" is the contiguous group of non-blank lines around
// the cursor. Blank lines (whitespace-only) act as block separators.

function getActiveBlockRange(
  view: EditorView,
): { fromLine: number; toLine: number } | null {
  const { state } = view;
  const { head } = state.selection.main;
  const doc = state.doc;
  const cursorLine = doc.lineAt(head);
  const cursorLineNum = cursorLine.number;

  // Expand upward from cursor line to find block start
  let startLine = cursorLineNum;
  while (startLine > 1) {
    const prevLine = doc.line(startLine - 1);
    if (prevLine.text.trim().length === 0) break;
    startLine--;
  }

  // Expand downward from cursor line to find block end
  let endLine = cursorLineNum;
  const totalLines = doc.lines;
  while (endLine < totalLines) {
    const nextLine = doc.line(endLine + 1);
    if (nextLine.text.trim().length === 0) break;
    endLine++;
  }

  return { fromLine: startLine, toLine: endLine };
}

// ── Decoration builder ──────────────────────────────────────────────

function buildFocusDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const enabled = state.field(focusModeField);
  if (!enabled) return Decoration.none;

  const activeBlock = getActiveBlockRange(view);
  if (!activeBlock) return Decoration.none;

  const decorations: { from: number; decoration: Decoration }[] = [];

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const lineNum = line.number;

      // Dim lines outside the active block
      if (lineNum < activeBlock.fromLine || lineNum > activeBlock.toLine) {
        decorations.push({ from: line.from, decoration: dimmedLineDecoration });
      }

      if (line.to >= state.doc.length) break;
      pos = line.to + 1;
    }
  }

  return Decoration.set(
    decorations.map((d) => d.decoration.range(d.from)),
    true,
  );
}

// ── Extension entry point ───────────────────────────────────────────

export function buildFocusModeExtension(): Extension {
  return [
    focusModeField,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildFocusDecorations(view);
        }
        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged ||
            update.startState.field(focusModeField) !== update.state.field(focusModeField)
          ) {
            this.decorations = buildFocusDecorations(update.view);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ];
}
