/* ── Insertion Hotzone Extension ──────────────────────────────────────
   CodeMirror 6 extension that renders subtle "+" buttons between
   heading-level sections. Visible on hover, clicking invokes a
   callback for agent-assisted content insertion.
   ──────────────────────────────────────────────────────────────────── */

import { RangeSetBuilder, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

// ── Config ──────────────────────────────────────────────────────────

export interface InsertionHotzoneConfig {
  /** Whether the editor is editable (hotzones only appear in edit mode). */
  editable: boolean;
  /** Called when the "+" button is clicked. afterLine is 1-indexed. */
  onInsertionRequest: (afterLine: number, view: EditorView) => void;
}

// ── Section boundary detection ──────────────────────────────────────

interface SectionBoundary {
  /** The line number AFTER which the "+" should appear (end of previous section). */
  afterLine: number;
  /** Character offset at end of the line after which to insert the widget. */
  position: number;
}

function findSectionBoundaries(state: EditorState): SectionBoundary[] {
  const doc = state.doc;
  const boundaries: SectionBoundary[] = [];
  let inCodeFence = false;

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    const trimmed = line.text.trimStart();

    // Track code fences
    if (/^(`{3,}|~{3,})/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    // Detect heading lines
    if (/^#{1,6}\s/.test(trimmed)) {
      // Add boundary before this heading (after the previous line)
      // Skip if it's the first line — no boundary before the first heading
      if (lineNum > 1) {
        const prevLine = doc.line(lineNum - 1);
        boundaries.push({
          afterLine: lineNum - 1,
          position: prevLine.to,
        });
      }
    }
  }

  // Add boundary after the last line (end of document)
  if (doc.lines > 0) {
    const lastLine = doc.line(doc.lines);
    // Only add if there's actual content
    if (lastLine.text.trim().length > 0 || doc.lines > 1) {
      boundaries.push({
        afterLine: doc.lines,
        position: lastLine.to,
      });
    }
  }

  return boundaries;
}

// ── Hotzone widget ──────────────────────────────────────────────────

class InsertionHotzoneWidget extends WidgetType {
  constructor(
    private readonly afterLine: number,
    private readonly onInsertionRequest: InsertionHotzoneConfig["onInsertionRequest"],
  ) { super(); }

  eq(other: InsertionHotzoneWidget) {
    return this.afterLine === other.afterLine;
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "shared-md-insertion-hotzone";

    const button = document.createElement("button");
    button.className = "shared-md-insertion-hotzone-btn";
    button.type = "button";
    button.title = "Insert section with agent";
    button.textContent = "+";

    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onInsertionRequest(this.afterLine, view);
    });

    wrapper.appendChild(button);
    return wrapper;
  }

  ignoreEvent(event: Event) {
    return event.type !== "mousedown" && event.type !== "click";
  }
}

// ── Decoration builder ──────────────────────────────────────────────

function buildHotzoneDecorations(state: EditorState, config: InsertionHotzoneConfig): DecorationSet {
  if (!config.editable) return Decoration.none;

  const boundaries = findSectionBoundaries(state);
  const builder = new RangeSetBuilder<Decoration>();

  for (const boundary of boundaries) {
    builder.add(boundary.position, boundary.position, Decoration.widget({
      block: true,
      side: 1,
      widget: new InsertionHotzoneWidget(boundary.afterLine, config.onInsertionRequest),
    }));
  }

  return builder.finish();
}

// ── Extension entry point ───────────────────────────────────────────

export function buildInsertionHotzoneExtension(config: InsertionHotzoneConfig): Extension {
  if (!config.editable) return [];

  const hotzoneDecorations = StateField.define<DecorationSet>({
    create(state) { return buildHotzoneDecorations(state, config); },
    update(decorations, transaction) {
      if (transaction.docChanged) {
        return buildHotzoneDecorations(transaction.state, config);
      }
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  return hotzoneDecorations;
}
