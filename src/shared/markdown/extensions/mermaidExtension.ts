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
  height?: number;  // parsed from {height=N} in fence metadata
};

export function parseMermaidBlock(doc: Text, lineNumber: number): MermaidBlock | null {
  if (lineNumber > doc.lines) return null;

  const openLine = doc.line(lineNumber);
  const openText = openLine.text.trimStart();
  const fenceMatch = openText.match(/^(`{3,}|~{3,})\s*mermaid\s*(?:\{height=(\d+)\})?\s*$/);
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

  const parsedHeight = fenceMatch[2] ? parseInt(fenceMatch[2], 10) : undefined;

  return {
    from: openLine.from,
    to: endLine.to,
    startLineNumber: openLine.number,
    endLineNumber: endLine.number,
    source: sourceLines.join("\n"),
    height: parsedHeight && parsedHeight > 0 ? parsedHeight : undefined,
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

// ── Adaptive sizing helper ──────────────────────────────────────────

function computeAdaptiveMaxHeight(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 500;
  const ratio = width / height;
  if (ratio > 2)   return 300;  // very wide (sequence diagrams)
  if (ratio > 1)   return 400;  // landscape
  if (ratio > 0.8) return 500;  // roughly square
  return 600;                    // tall/portrait (ER diagrams, flowcharts)
}

// ── Resize handle helper ────────────────────────────────────────────

/**
 * Scales the SVG inside a mermaid container to fit a given height.
 * Uses CSS transform: scale() so the entire diagram is visible (just smaller).
 */
function scaleMermaidToHeight(container: HTMLElement, targetHeight: number): void {
  const svgEl = container.querySelector<SVGSVGElement>("svg");
  if (!svgEl) return;

  const vb = svgEl.viewBox?.baseVal;
  const naturalHeight = vb?.height || svgEl.getAttribute("height")?.replace("px", "") || 0;
  const naturalWidth = vb?.width || svgEl.getAttribute("width")?.replace("px", "") || 0;
  const natH = typeof naturalHeight === "string" ? parseFloat(naturalHeight) : naturalHeight;
  const natW = typeof naturalWidth === "string" ? parseFloat(naturalWidth) : naturalWidth;

  if (natH <= 0) return;

  const cs = getComputedStyle(container);
  const padTop = parseFloat(cs.paddingTop) || 0;
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const availableHeight = targetHeight - padTop - padBottom;

  const containerWidth = container.clientWidth || container.parentElement?.clientWidth || natW;
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const padRight = parseFloat(cs.paddingRight) || 0;
  const availableWidth = containerWidth - padLeft - padRight;

  const scaleByHeight = availableHeight / natH;
  const scaleByWidth = availableWidth / natW;
  const scale = Math.min(scaleByHeight, scaleByWidth, 1);

  const diagram = container.querySelector<HTMLElement>(".shared-md-mermaid-diagram");
  if (diagram) {
    diagram.style.transform = `scale(${scale})`;
    diagram.style.transformOrigin = "top center";
    container.style.height = `${Math.ceil(natH * scale + padTop + padBottom)}px`;
  }
}

function attachResizeHandle(container: HTMLElement): void {
  const handle = document.createElement("div");
  handle.className = "shared-md-mermaid-resize-handle";
  handle.title = "Drag to resize";
  container.appendChild(handle);

  let startY = 0;
  let startHeight = 0;

  const onMouseMove = (e: MouseEvent) => {
    e.preventDefault();
    const delta = e.clientY - startY;
    const newHeight = Math.max(60, startHeight + delta);
    scaleMermaidToHeight(container, newHeight);
  };

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.body.style.userSelect = "";
    container.classList.remove("shared-md-mermaid-resizing");
  };

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startY = e.clientY;
    startHeight = container.offsetHeight;
    document.body.style.userSelect = "none";
    container.classList.add("shared-md-mermaid-resizing");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

// ── Mermaid widget ──────────────────────────────────────────────────

class MermaidWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly explicitHeight?: number,
  ) { super(); }

  eq(other: MermaidWidget) {
    return this.source === other.source && this.explicitHeight === other.explicitHeight;
  }

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

      // Create resizable container
      const resizable = document.createElement("div");
      resizable.className = "shared-md-mermaid-resizable";

      const diagram = document.createElement("div");
      diagram.className = "shared-md-mermaid-diagram";
      diagram.innerHTML = svg;

      resizable.appendChild(diagram);
      wrapper.appendChild(resizable);

      // Determine target height and scale diagram to fit
      const svgEl = diagram.querySelector("svg");
      let targetHeight: number;
      if (this.explicitHeight) {
        targetHeight = this.explicitHeight;
      } else if (svgEl) {
        const bbox = svgEl.getBBox?.();
        const vb = svgEl.viewBox?.baseVal;
        const w = bbox?.width || vb?.width || svgEl.clientWidth || 0;
        const h = bbox?.height || vb?.height || svgEl.clientHeight || 0;
        targetHeight = computeAdaptiveMaxHeight(w, h);
      } else {
        targetHeight = 500;
      }

      scaleMermaidToHeight(resizable, targetHeight);
      attachResizeHandle(resizable);
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
          widget: new MermaidWidget(block.source, block.height),
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
