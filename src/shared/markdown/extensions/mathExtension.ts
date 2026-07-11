/* ── Math Extension (KaTeX) ───────────────────────────────────────────
   ViewPlugin that detects $$...$$ (block math) and $...$ (inline math)
   patterns and renders them via KaTeX when the cursor is not on them.

   Behavior:
   - Scans visible ranges for math delimiters via regex
   - $$...$$ (block math): full-width centered rendering
   - $...$  (inline math): inline rendering within text flow
   - When cursor IS on the math block: reveal raw LaTeX source
   - When cursor IS NOT on the math block: render via KaTeX widget
   - KaTeX is lazy-loaded (~300KB) only when math syntax is detected
   - If KaTeX fails to load or parse, shows a styled error message

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

// ── Lazy KaTeX loader ───────────────────────────────────────────────
// We store the KaTeX module and its CSS load promise here so we only
// load once per session, and only when math syntax is first detected.

let katexModule: typeof import("katex") | null = null;
let katexLoading: Promise<typeof import("katex")> | null = null;
let katexCSSLoaded = false;

async function loadKaTeX(): Promise<typeof import("katex")> {
  if (katexModule) return katexModule;
  if (katexLoading) return katexLoading;

  katexLoading = (async () => {
    // Load KaTeX CSS via a <link> tag (only once)
    if (!katexCSSLoaded) {
      katexCSSLoaded = true;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css";
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }

    // Dynamic import of the KaTeX module
    const mod = await import("katex");
    katexModule = mod;
    return mod;
  })();

  return katexLoading;
}

// ── Math detection regexes ──────────────────────────────────────────
// Block math: $$...$$ (possibly multiline, but we handle per-visible-range)
// Inline math: $...$ (single line, non-greedy, not $$)

// Block: match $$ at start (possibly with preceding newline) through $$ at end
const BLOCK_MATH_RE = /\$\$([\s\S]+?)\$\$/g;
// Inline: match $...$ but NOT $$. Require non-whitespace after opening $
// and before closing $. Also exclude if preceded/followed by $.
const INLINE_MATH_RE = /(?<!\$)\$(?!\$)(\S(?:[^$]*?\S)?)\$(?!\$)/g;

// ── KaTeX Math Widget ───────────────────────────────────────────────

class MathWidget extends WidgetType {
  constructor(
    private readonly latex: string,
    private readonly displayMode: boolean,
  ) {
    super();
  }

  eq(other: MathWidget) {
    return this.latex === other.latex && this.displayMode === other.displayMode;
  }

  toDOM(view: EditorView) {
    const container = document.createElement(this.displayMode ? "div" : "span");
    container.className = this.displayMode
      ? "shared-md-math-block"
      : "shared-md-math-inline";

    if (katexModule) {
      try {
        container.innerHTML = katexModule.default.renderToString(this.latex, {
          displayMode: this.displayMode,
          throwOnError: false,
          output: "html",
        });
      } catch {
        container.textContent = this.latex;
        container.classList.add("shared-md-math-error");
      }
    } else {
      // KaTeX not loaded yet — show placeholder and trigger load
      container.textContent = this.displayMode ? `$$${this.latex}$$` : `$${this.latex}$`;
      container.classList.add("shared-md-math-loading");

      void loadKaTeX().then((katex) => {
        try {
          container.innerHTML = katex.default.renderToString(this.latex, {
            displayMode: this.displayMode,
            throwOnError: false,
            output: "html",
          });
          container.classList.remove("shared-md-math-loading");
        } catch {
          container.textContent = this.latex;
          container.classList.add("shared-md-math-error");
        }
        // Force CM6 to re-measure since widget size changed
        view.requestMeasure();
      });
    }

    return container;
  }

  ignoreEvent() { return true; }
}

// ── Quick-check: does the document contain any math syntax? ─────────

function hasMathSyntax(text: string): boolean {
  return text.includes("$");
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

// ── Decoration builder ──────────────────────────────────────────────

type DecorationEntry = { from: number; to: number; decoration: Decoration };

function buildMathDecorations(view: EditorView, editable: boolean): DecorationSet {
  const { state } = view;

  // Quick exit: if no $ in the visible text, nothing to do
  let hasAnyDollar = false;
  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    if (hasMathSyntax(text)) {
      hasAnyDollar = true;
      break;
    }
  }
  if (!hasAnyDollar) return Decoration.none;

  // Trigger lazy KaTeX load on first detection
  if (!katexModule && !katexLoading) {
    void loadKaTeX().then(() => {
      // Rebuild decorations after KaTeX loads
      view.dispatch({ effects: [] });
    });
  }

  const cursorLines = cursorLineNumbers(state, editable);
  const entries: DecorationEntry[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);

    // ── Block math: $$...$$ ─────────────────────────────────────────
    BLOCK_MATH_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = BLOCK_MATH_RE.exec(text)) !== null) {
      const latex = match[1].trim();
      const matchFrom = from + match.index;
      const matchTo = matchFrom + match[0].length;

      // Check if cursor is on any line of this block
      let cursorOnBlock = false;
      const startLine = state.doc.lineAt(matchFrom).number;
      const endLine = state.doc.lineAt(matchTo).number;
      for (let ln = startLine; ln <= endLine; ln++) {
        if (cursorLines.has(ln)) { cursorOnBlock = true; break; }
      }
      if (cursorOnBlock) continue;

      entries.push({
        from: matchFrom,
        to: matchTo,
        decoration: Decoration.replace({
          widget: new MathWidget(latex, true),
        }),
      });
    }

    // ── Inline math: $...$ ──────────────────────────────────────────
    INLINE_MATH_RE.lastIndex = 0;

    while ((match = INLINE_MATH_RE.exec(text)) !== null) {
      const latex = match[1];
      const matchFrom = from + match.index;
      const matchTo = matchFrom + match[0].length;

      // Check if cursor is on this line
      const line = state.doc.lineAt(matchFrom);
      if (cursorLines.has(line.number)) continue;

      // Skip if inside a code block/fenced code (check for ` or ``` context)
      const lineText = line.text;
      const lineOffset = matchFrom - line.from;
      // Simple check: if there's a backtick before and after, skip
      const beforeMatch = lineText.substring(0, lineOffset);
      if ((beforeMatch.split("`").length - 1) % 2 !== 0) continue;

      entries.push({
        from: matchFrom,
        to: matchTo,
        decoration: Decoration.replace({
          widget: new MathWidget(latex, false),
        }),
      });
    }
  }

  // Sort and deduplicate overlapping entries
  entries.sort((a, b) => a.from - b.from || a.to - b.to);

  // Remove overlapping entries (block math takes priority)
  const filtered: DecorationEntry[] = [];
  let lastTo = -1;
  for (const entry of entries) {
    if (entry.from >= lastTo) {
      filtered.push(entry);
      lastTo = entry.to;
    }
  }

  return Decoration.set(
    filtered.map((e) => e.decoration.range(e.from, e.to)),
    true,
  );
}

// ── Extension entry point ───────────────────────────────────────────

export function buildMathExtension({ editable }: { editable: boolean }): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildMathDecorations(view, editable);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged
        ) {
          this.decorations = buildMathDecorations(update.view, editable);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
