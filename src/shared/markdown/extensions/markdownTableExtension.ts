/* ── Markdown Table Extension ─────────────────────────────────────────
   Rich table rendering for CodeMirror 6 markdown.

   Parses pipe-delimited markdown tables and renders them as HTML tables
   in a widget, hiding the raw source when the cursor is outside the block.

   Adapted from kiss_ai for AI Shell's shared component library.
   ──────────────────────────────────────────────────────────────────── */

import { RangeSetBuilder, StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

// ── Table block parser ──────────────────────────────────────────────

export type TableBlock = {
  from: number;
  to: number;
  startLineNumber: number;
  endLineNumber: number;
  headers: string[];
  rows: string[][];
  alignments: ("left" | "center" | "right" | null)[];
};

function isTableSeparator(text: string): boolean {
  return /^\|?[\s:]*-{3,}[\s:]*(\|[\s:]*-{3,}[\s:]*)*\|?\s*$/.test(text.trim());
}

function parseCells(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutTrailing = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return withoutTrailing.split("|").map((cell) => cell.trim());
}

function parseAlignments(line: string): ("left" | "center" | "right" | null)[] {
  return parseCells(line).map((cell) => {
    const trimmed = cell.replace(/\s/g, "");
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
    if (trimmed.endsWith(":")) return "right";
    if (trimmed.startsWith(":")) return "left";
    return null;
  });
}

export function parseMarkdownTableBlock(doc: Text, lineNumber: number): TableBlock | null {
  if (lineNumber > doc.lines) return null;

  const headerLine = doc.line(lineNumber);
  const headerText = headerLine.text.trim();

  // Must look like a table header row (contains |)
  if (!headerText.includes("|")) return null;

  // Next line must be separator
  if (lineNumber + 1 > doc.lines) return null;
  const separatorLine = doc.line(lineNumber + 1);
  if (!isTableSeparator(separatorLine.text)) return null;

  const headers = parseCells(headerText);
  const alignments = parseAlignments(separatorLine.text);
  const rows: string[][] = [];

  let endLine = separatorLine;
  let currentLine = lineNumber + 2;

  while (currentLine <= doc.lines) {
    const line = doc.line(currentLine);
    const trimmed = line.text.trim();
    if (!trimmed.includes("|") || trimmed === "") break;
    rows.push(parseCells(trimmed));
    endLine = line;
    currentLine++;
  }

  if (endLine === separatorLine && rows.length === 0) {
    endLine = separatorLine;
  }

  return {
    from: headerLine.from,
    to: endLine.to,
    startLineNumber: headerLine.number,
    endLineNumber: endLine.number,
    headers,
    rows,
    alignments,
  };
}

// ── Table widget ────────────────────────────────────────────────────

class TableWidget extends WidgetType {
  constructor(
    private readonly headers: string[],
    private readonly rows: string[][],
    private readonly alignments: ("left" | "center" | "right" | null)[],
    private readonly renderCellDisplay?: ((cell: string, container: HTMLElement) => void) | null,
  ) {
    super();
  }

  eq(other: TableWidget) {
    return (
      JSON.stringify(this.headers) === JSON.stringify(other.headers) &&
      JSON.stringify(this.rows) === JSON.stringify(other.rows)
    );
  }

  private renderCell(container: HTMLElement, text: string) {
    if (this.renderCellDisplay) {
      this.renderCellDisplay(text, container);
      if (!container.childNodes.length) container.textContent = text;
    } else {
      container.textContent = text;
    }
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "shared-md-table-wrapper";
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Scrollable table");

    const table = document.createElement("table");
    table.className = "shared-md-table";

    // Header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (let i = 0; i < this.headers.length; i++) {
      const th = document.createElement("th");
      this.renderCell(th, this.headers[i]);
      const align = this.alignments[i];
      if (align) th.style.textAlign = align;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    for (const row of this.rows) {
      const tr = document.createElement("tr");
      for (let i = 0; i < this.headers.length; i++) {
        const td = document.createElement("td");
        this.renderCell(td, row[i] ?? "");
        const align = this.alignments[i];
        if (align) td.style.textAlign = align;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);

    return wrapper;
  }

  ignoreEvent() { return true; }
}

class EmptyTableWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "shared-md-table-hidden-source";
    return span;
  }
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

function buildTableDecorations(state: EditorState, editable: boolean, renderCellDisplay?: ((cell: string, container: HTMLElement) => void) | null): DecorationSet {
  const doc = state.doc;
  const cursorLines = cursorLineNumbers(state, editable);
  const builder = new RangeSetBuilder<Decoration>();
  let position = 0;

  while (position <= doc.length) {
    const line = doc.lineAt(position);
    const table = parseMarkdownTableBlock(doc, line.number);

    if (table) {
      let cursorInTable = false;
      for (let ln = table.startLineNumber; ln <= table.endLineNumber; ln++) {
        if (cursorLines.has(ln)) { cursorInTable = true; break; }
      }

      if (!cursorInTable) {
        builder.add(table.from, table.from, Decoration.widget({
          block: true, side: -1,
          widget: new TableWidget(table.headers, table.rows, table.alignments, renderCellDisplay),
        }));

        for (let ln = table.startLineNumber; ln <= table.endLineNumber; ln++) {
          const sourceLine = doc.line(ln);
          builder.add(sourceLine.from, sourceLine.from, Decoration.line({ class: "shared-md-table-hidden-line" }));
          builder.add(sourceLine.from, sourceLine.to, Decoration.replace({ widget: new EmptyTableWidget() }));
        }
      }

      position = table.to + 1;
      continue;
    }

    if (line.to >= doc.length) break;
    position = line.to + 1;
  }

  return builder.finish();
}

// ── Extension entry point ───────────────────────────────────────────

export function buildMarkdownTableExtension({ editable, renderCellDisplay }: { editable: boolean; renderCellDisplay?: ((cell: string, container: HTMLElement) => void) | null }): Extension {
  const tableDecorations = StateField.define<DecorationSet>({
    create(state) { return buildTableDecorations(state, editable, renderCellDisplay); },
    update(decorations, transaction) {
      if (transaction.docChanged || transaction.selection) {
        return buildTableDecorations(transaction.state, editable, renderCellDisplay);
      }
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  return tableDecorations;
}
