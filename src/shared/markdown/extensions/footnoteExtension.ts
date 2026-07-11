/* ── Footnote Extension ───────────────────────────────────────────────
   ViewPlugin that detects footnote references [^1] and footnote
   definitions [^1]: text, rendering them with interactive behavior.

   Behavior:
   - `[^1]` references: render as superscript number badge when cursor
     is not on the line. On hover, show tooltip with footnote content.
     On click, scroll to the footnote definition.
   - `[^1]: text` definitions: render with styled formatting at the
     document bottom. Click the back-reference arrow to scroll back
     to the reference location.
   - When cursor IS on footnote syntax: reveal raw text for editing.

   Uses `shared-md-` CSS prefix per shell conventions.
   ──────────────────────────────────────────────────────────────────── */

import { type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

// ── Footnote reference regex ────────────────────────────────────────
// Matches [^identifier] but NOT [^identifier]: (which is a definition)
const FOOTNOTE_REF_RE = /\[\^([^\]]+)\](?!:)/g;

// ── Footnote definition regex ───────────────────────────────────────
// Matches [^identifier]: text at the start of a line
const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:\s*(.*)/;

// ── Footnote reference widget (superscript badge) ───────────────────

class FootnoteRefWidget extends WidgetType {
  constructor(
    private readonly id: string,
    private readonly content: string,
    private readonly defPos: number | null,
  ) {
    super();
  }

  eq(other: FootnoteRefWidget) {
    return this.id === other.id && this.content === other.content;
  }

  toDOM(view: EditorView) {
    const badge = document.createElement("sup");
    badge.className = "shared-md-footnote-ref";
    badge.textContent = this.id;
    badge.setAttribute("aria-label", `Footnote ${this.id}`);
    badge.title = this.content || `Footnote ${this.id}`;

    // Tooltip on hover
    if (this.content) {
      const tooltip = document.createElement("span");
      tooltip.className = "shared-md-footnote-tooltip";
      tooltip.textContent = this.content;
      badge.appendChild(tooltip);
    }

    // Click: scroll to definition
    if (this.defPos !== null) {
      const defPos = this.defPos;
      badge.style.cursor = "pointer";
      badge.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const line = view.state.doc.lineAt(defPos);
        view.dispatch({
          effects: EditorView.scrollIntoView(line.from, { y: "center" }),
        });
      });
    }

    return badge;
  }

  ignoreEvent() { return false; }
}

// ── Footnote definition widget (styled back-reference) ──────────────

class FootnoteDefWidget extends WidgetType {
  constructor(
    private readonly id: string,
    private readonly refPos: number | null,
  ) {
    super();
  }

  eq(other: FootnoteDefWidget) {
    return this.id === other.id;
  }

  toDOM(view: EditorView) {
    const container = document.createElement("span");
    container.className = "shared-md-footnote-def-marker";

    const idBadge = document.createElement("span");
    idBadge.className = "shared-md-footnote-def-id";
    idBadge.textContent = this.id;
    container.appendChild(idBadge);

    // Back-reference arrow
    if (this.refPos !== null) {
      const refPos = this.refPos;
      const arrow = document.createElement("span");
      arrow.className = "shared-md-footnote-backref";
      arrow.textContent = "↩";
      arrow.title = "Back to reference";
      arrow.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const line = view.state.doc.lineAt(refPos);
        view.dispatch({
          effects: EditorView.scrollIntoView(line.from, { y: "center" }),
        });
      });
      container.appendChild(arrow);
    }

    return container;
  }

  ignoreEvent() { return false; }
}

// ── Cursor-line detection ───────────────────────────────────────────

function cursorLineNumbers(state: EditorState, editable: boolean): Set<number> {
  if (!editable) return new Set();
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;
    for (let lineNum = fromLine; lineNum <= toLine; lineNum++) {
      lines.add(lineNum);
    }
  }
  return lines;
}

// ── Build footnote maps ─────────────────────────────────────────────

interface FootnoteMap {
  definitions: Map<string, { pos: number; content: string }>;
  references: Map<string, number>; // first occurrence position
}

function buildFootnoteMaps(state: EditorState): FootnoteMap {
  const definitions = new Map<string, { pos: number; content: string }>();
  const references = new Map<string, number>();
  const doc = state.doc;

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    const text = line.text;

    // Check for definitions
    const defMatch = FOOTNOTE_DEF_RE.exec(text);
    if (defMatch) {
      const id = defMatch[1];
      const content = defMatch[2];
      definitions.set(id, { pos: line.from, content });
      continue;
    }

    // Check for references
    FOOTNOTE_REF_RE.lastIndex = 0;
    let refMatch: RegExpExecArray | null;
    while ((refMatch = FOOTNOTE_REF_RE.exec(text)) !== null) {
      const id = refMatch[1];
      if (!references.has(id)) {
        references.set(id, line.from + refMatch.index);
      }
    }
  }

  return { definitions, references };
}

// ── Decoration builder ──────────────────────────────────────────────

type DecorationEntry = { from: number; to: number; decoration: Decoration };

const replaceDecoration = Decoration.replace({});
const footnoteDefLineDecoration = Decoration.line({ class: "shared-md-footnote-def-line" });

function buildFootnoteDecorations(view: EditorView, editable: boolean): DecorationSet {
  const { state } = view;
  const cursorLines = cursorLineNumbers(state, editable);
  const entries: DecorationEntry[] = [];

  // Build the footnote map from the full document
  const { definitions, references } = buildFootnoteMaps(state);

  // No footnotes at all? Skip
  if (definitions.size === 0 && references.size === 0) return Decoration.none;

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const lineText = line.text;
      const lineNum = line.number;

      if (cursorLines.has(lineNum)) {
        if (line.to >= state.doc.length) break;
        pos = line.to + 1;
        continue;
      }

      // ── Footnote definitions: [^id]: text ─────────────────────────
      const defMatch = FOOTNOTE_DEF_RE.exec(lineText);
      if (defMatch) {
        const id = defMatch[1];
        const prefixEnd = line.from + defMatch[0].indexOf(":") + 1;
        const refPos = references.get(id) ?? null;

        // Add definition line styling
        entries.push({
          from: line.from,
          to: line.from,
          decoration: footnoteDefLineDecoration,
        });

        // Replace [^id]: with a styled marker widget
        entries.push({
          from: line.from,
          to: prefixEnd + 1, // include the space after :
          decoration: Decoration.replace({
            widget: new FootnoteDefWidget(id, refPos),
          }),
        });

        if (line.to >= state.doc.length) break;
        pos = line.to + 1;
        continue;
      }

      // ── Footnote references: [^id] ────────────────────────────────
      FOOTNOTE_REF_RE.lastIndex = 0;
      let refMatch: RegExpExecArray | null;
      while ((refMatch = FOOTNOTE_REF_RE.exec(lineText)) !== null) {
        const id = refMatch[1];
        const matchFrom = line.from + refMatch.index;
        const matchTo = matchFrom + refMatch[0].length;

        const def = definitions.get(id);
        const defPos = def?.pos ?? null;
        const content = def?.content ?? "";

        entries.push({
          from: matchFrom,
          to: matchTo,
          decoration: Decoration.replace({
            widget: new FootnoteRefWidget(id, content, defPos),
          }),
        });
      }

      if (line.to >= state.doc.length) break;
      pos = line.to + 1;
    }
  }

  // Sort by position
  entries.sort((a, b) => a.from - b.from || a.to - b.to);

  return Decoration.set(
    entries.map((e) => e.decoration.range(e.from, e.to)),
    true,
  );
}

// ── Extension entry point ───────────────────────────────────────────

export function buildFootnoteExtension({ editable }: { editable: boolean }): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildFootnoteDecorations(view, editable);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged
        ) {
          this.decorations = buildFootnoteDecorations(update.view, editable);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
