/* ── Mermaid Extension ────────────────────────────────────────────────
   Mermaid diagram live-preview extension for CodeMirror 6.

   Detects fenced ```mermaid code blocks, hides the raw source when
   the cursor is not inside the block, and renders the diagram as
   inline SVG using the mermaid library (loaded from CDN on first use).

   Adapted from kiss_ai for AI Shell's shared component library.
   ──────────────────────────────────────────────────────────────────── */

import { RangeSetBuilder, StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

// ── Mermaid block parser ────────────────────────────────────────────

export type MermaidBlock = {
  from: number;
  to: number;
  startLineNumber: number;
  endLineNumber: number;
  source: string;
};

export function parseMermaidBlock(doc: Text, lineNumber: number): MermaidBlock | null {
  if (lineNumber > doc.lines) return null;

  const openLine = doc.line(lineNumber);
  const openText = openLine.text.trimStart();
  const fenceMatch = openText.match(/^(`{3,}|~{3,})\s*mermaid\s*$/);
  if (!fenceMatch) return null;

  const fenceChar = fenceMatch[1][0];
  const fenceLen = fenceMatch[1].length;
  const sourceLines: string[] = [];
  let endLine = openLine;
  let currentLineNumber = lineNumber + 1;

  while (currentLineNumber <= doc.lines) {
    const line = doc.line(currentLineNumber);
    const trimmed = line.text.trimStart();
    const closePattern = new RegExp(`^${fenceChar === "`" ? "`" : "~"}{${fenceLen},}\\s*$`);
    if (closePattern.test(trimmed)) {
      endLine = line;
      break;
    }
    sourceLines.push(line.text);
    endLine = line;
    currentLineNumber += 1;
  }

  if (endLine === openLine || (currentLineNumber > doc.lines && endLine.text.trimStart().match(/^(`{3,}|~{3,})\s*$/) === null)) {
    return null;
  }

  return {
    from: openLine.from,
    to: endLine.to,
    startLineNumber: openLine.number,
    endLineNumber: endLine.number,
    source: sourceLines.join("\n"),
  };
}

// ── Mermaid CDN loader ──────────────────────────────────────────────

let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;
let mermaidApi: typeof import("mermaid")["default"] | null = null;
let renderCounter = 0;

async function loadMermaid() {
  if (mermaidApi) return mermaidApi;
  if (!mermaidPromise) {
    mermaidPromise = (async () => {
      const mod = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
      const api = mod.default;
      api.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
        fontFamily: "var(--font-sans)",
      });
      mermaidApi = api;
      return api;
    })();
  }
  return mermaidPromise;
}

// ── Mermaid widget ──────────────────────────────────────────────────

class MermaidWidget extends WidgetType {
  constructor(private readonly source: string) { super(); }

  eq(other: MermaidWidget) { return this.source === other.source; }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "shared-md-mermaid-wrapper";

    const placeholder = document.createElement("div");
    placeholder.className = "shared-md-mermaid-placeholder";
    placeholder.textContent = "Rendering diagram…";
    wrapper.appendChild(placeholder);

    void this.renderDiagram(wrapper, placeholder);
    return wrapper;
  }

  private async renderDiagram(wrapper: HTMLElement, placeholder: HTMLElement) {
    try {
      const api = await loadMermaid();
      const id = `shared-md-mermaid-${++renderCounter}`;
      const { svg } = await api.render(id, this.source);

      placeholder.remove();
      const container = document.createElement("div");
      container.className = "shared-md-mermaid-diagram";
      container.innerHTML = svg;

      const svgEl = container.querySelector("svg");
      if (svgEl) {
        svgEl.style.maxWidth = "100%";
        svgEl.style.height = "auto";
      }
      wrapper.appendChild(container);
    } catch (error) {
      placeholder.remove();
      const errorContainer = document.createElement("div");
      errorContainer.className = "shared-md-mermaid-error";

      const errorLabel = document.createElement("span");
      errorLabel.className = "shared-md-mermaid-error-label";
      errorLabel.textContent = "Mermaid error";

      const errorMessage = document.createElement("span");
      errorMessage.className = "shared-md-mermaid-error-message";
      errorMessage.textContent = error instanceof Error ? error.message : "Failed to render diagram";

      errorContainer.appendChild(errorLabel);
      errorContainer.appendChild(errorMessage);
      wrapper.appendChild(errorContainer);
    }
  }

  ignoreEvent() { return true; }
}

class EmptyMermaidWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "shared-md-mermaid-hidden-source";
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

function buildMermaidDecorations(state: EditorState, editable: boolean): DecorationSet {
  const doc = state.doc;
  const cursorLines = cursorLineNumbers(state, editable);
  const builder = new RangeSetBuilder<Decoration>();
  let position = 0;

  while (position <= doc.length) {
    const line = doc.lineAt(position);
    const block = parseMermaidBlock(doc, line.number);

    if (block) {
      let cursorInBlock = false;
      for (let ln = block.startLineNumber; ln <= block.endLineNumber; ln++) {
        if (cursorLines.has(ln)) { cursorInBlock = true; break; }
      }

      if (!cursorInBlock && block.source.trim().length > 0) {
        builder.add(block.from, block.from, Decoration.widget({
          block: true, side: -1,
          widget: new MermaidWidget(block.source),
        }));

        for (let ln = block.startLineNumber; ln <= block.endLineNumber; ln++) {
          const sourceLine = doc.line(ln);
          builder.add(sourceLine.from, sourceLine.from, Decoration.line({ class: "shared-md-mermaid-hidden-line" }));
          builder.add(sourceLine.from, sourceLine.to, Decoration.replace({ widget: new EmptyMermaidWidget() }));
        }
      }

      position = block.to + 1;
      continue;
    }

    if (line.to >= doc.length) break;
    position = line.to + 1;
  }

  return builder.finish();
}

// ── Extension entry point ───────────────────────────────────────────

export function buildMermaidExtension({ editable }: { editable: boolean }): Extension {
  const mermaidDecorations = StateField.define<DecorationSet>({
    create(state) { return buildMermaidDecorations(state, editable); },
    update(decorations, transaction) {
      if (transaction.docChanged || transaction.selection) {
        return buildMermaidDecorations(transaction.state, editable);
      }
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  return mermaidDecorations;
}
