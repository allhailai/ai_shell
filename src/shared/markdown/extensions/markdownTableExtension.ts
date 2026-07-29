/* ── Markdown Table Extension ─────────────────────────────────────────
   Rich table rendering for CodeMirror 6 markdown.

   Parses pipe-delimited markdown tables and renders them as HTML tables
   in a widget, hiding the raw source when the cursor is outside the block.

   Adapted from kiss_ai for AI Shell's shared component library.
   ──────────────────────────────────────────────────────────────────── */

import { RangeSetBuilder, StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

// ── Table block parser ──────────────────────────────────────────────

const TABLE_SCROLL_EDGE_TOLERANCE = 2;
const TABLE_PAN_MINIMUM = 160;
const TABLE_PAN_VIEWPORT_FRACTION = 0.75;

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

export type TableOverflowState = {
  overflowing: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  maxScrollLeft: number;
};

/**
 * Resolve scroll affordance state with a small tolerance for fractional
 * layout pixels and browser scroll rounding.
 */
export function resolveTableOverflowState(
  clientWidth: number,
  scrollWidth: number,
  scrollLeft: number,
): TableOverflowState {
  const safeClientWidth = Math.max(0, clientWidth);
  const safeScrollWidth = Math.max(0, scrollWidth);
  const maxScrollLeft = Math.max(0, safeScrollWidth - safeClientWidth);
  const overflowing = maxScrollLeft > TABLE_SCROLL_EDGE_TOLERANCE;
  const normalizedScrollLeft = Math.min(maxScrollLeft, Math.max(0, scrollLeft));

  return {
    overflowing,
    canScrollLeft: overflowing && normalizedScrollLeft > TABLE_SCROLL_EDGE_TOLERANCE,
    canScrollRight: overflowing
      && normalizedScrollLeft < maxScrollLeft - TABLE_SCROLL_EDGE_TOLERANCE,
    maxScrollLeft,
  };
}

export function tablePanDistance(clientWidth: number): number {
  return Math.max(
    TABLE_PAN_MINIMUM,
    Math.round(Math.max(0, clientWidth) * TABLE_PAN_VIEWPORT_FRACTION),
  );
}

// ── Table widget ────────────────────────────────────────────────────

const tableWidgetCleanup = new WeakMap<HTMLElement, () => void>();

function createPanIcon(direction: "left" | "right"): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const shaft = document.createElementNS(namespace, "path");
  shaft.setAttribute("d", direction === "left" ? "M13 8H3" : "M3 8h10");
  const point = document.createElementNS(namespace, "path");
  point.setAttribute("d", direction === "left" ? "M7 4 3 8l4 4" : "M9 4l4 4-4 4");
  svg.append(shaft, point);
  return svg;
}

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
    const container = document.createElement("div");
    container.className = "shared-md-table-container";

    const toolbar = document.createElement("div");
    toolbar.className = "shared-md-table-toolbar";
    toolbar.hidden = true;

    const toolbarHint = document.createElement("span");
    toolbarHint.className = "shared-md-table-toolbar-hint";
    toolbarHint.textContent = "Wide table · Scroll horizontally";
    toolbar.appendChild(toolbarHint);

    const navigation = document.createElement("div");
    navigation.className = "shared-md-table-navigation";
    navigation.setAttribute("role", "group");
    navigation.setAttribute("aria-label", "Table navigation");

    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className = "shared-md-table-pan-button";
    previousButton.setAttribute("aria-label", "Scroll table left");
    previousButton.title = "Scroll table left";
    previousButton.appendChild(createPanIcon("left"));

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "shared-md-table-pan-button";
    nextButton.setAttribute("aria-label", "Scroll table right");
    nextButton.title = "Scroll table right";
    nextButton.appendChild(createPanIcon("right"));

    navigation.append(previousButton, nextButton);
    toolbar.appendChild(navigation);

    const wrapper = document.createElement("div");
    wrapper.className = "shared-md-table-wrapper";
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute(
      "aria-label",
      "Scrollable table. Use the table navigation buttons or scroll horizontally to view more columns.",
    );

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

    const updateOverflowState = () => {
      const state = resolveTableOverflowState(
        wrapper.clientWidth,
        wrapper.scrollWidth,
        wrapper.scrollLeft,
      );

      toolbar.hidden = !state.overflowing;
      previousButton.disabled = !state.canScrollLeft;
      nextButton.disabled = !state.canScrollRight;
      container.classList.toggle("shared-md-table-container--overflowing", state.overflowing);
      container.classList.toggle("shared-md-table-container--can-scroll-left", state.canScrollLeft);
      container.classList.toggle("shared-md-table-container--can-scroll-right", state.canScrollRight);
    };

    const pan = (direction: -1 | 1) => {
      wrapper.scrollBy({
        left: direction * tablePanDistance(wrapper.clientWidth),
        behavior: "smooth",
      });
    };
    const panLeft = () => pan(-1);
    const panRight = () => pan(1);

    previousButton.addEventListener("click", panLeft);
    nextButton.addEventListener("click", panRight);
    wrapper.addEventListener("scroll", updateOverflowState, { passive: true });

    const ownerWindow = container.ownerDocument.defaultView;
    const resizeObserver = ownerWindow?.ResizeObserver
      ? new ownerWindow.ResizeObserver(updateOverflowState)
      : null;
    resizeObserver?.observe(wrapper);
    resizeObserver?.observe(table);

    const animationFrame = ownerWindow?.requestAnimationFrame(updateOverflowState);
    updateOverflowState();

    container.append(toolbar, wrapper);
    tableWidgetCleanup.set(container, () => {
      previousButton.removeEventListener("click", panLeft);
      nextButton.removeEventListener("click", panRight);
      wrapper.removeEventListener("scroll", updateOverflowState);
      resizeObserver?.disconnect();
      if (animationFrame !== undefined) ownerWindow?.cancelAnimationFrame(animationFrame);
    });

    return container;
  }

  destroy(dom: HTMLElement) {
    tableWidgetCleanup.get(dom)?.();
    tableWidgetCleanup.delete(dom);
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
