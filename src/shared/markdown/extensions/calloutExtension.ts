/* ── Callout / Admonition Extension ──────────────────────────────────
   ViewPlugin that detects `> [!type] Title` blockquote patterns
   (Obsidian/GitHub callout syntax) and renders them as styled
   admonition blocks in live preview.

   Behavior:
   - When cursor is NOT on the block: render as a styled container
     with colored left border, tinted background, line icon, and title.
     Hide `> [!type]` syntax markers.
   - When cursor IS on the block: reveal raw blockquote markdown.
   - Support for 9 callout type families (see CALLOUT_TYPES).

   Uses SVG line icons inline — no external icon library. All colors
   use CSS custom properties for theming.
   ──────────────────────────────────────────────────────────────────── */

import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

// ── Callout type definitions ────────────────────────────────────────

interface CalloutTypeDef {
  /** CSS class suffix for styling (border, bg tint) */
  cssClass: string;
  /** SVG icon markup (viewBox 0 0 16 16, stroke-based line icon) */
  iconSvg: string;
}

const CALLOUT_TYPES: Record<string, CalloutTypeDef> = {
  // Blue — info circle
  note:      { cssClass: "note",     iconSvg: '<circle cx="8" cy="8" r="6"/><line x1="8" y1="7" x2="8" y2="11"/><circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none"/>' },
  info:      { cssClass: "note",     iconSvg: '<circle cx="8" cy="8" r="6"/><line x1="8" y1="7" x2="8" y2="11"/><circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none"/>' },

  // Cyan/teal — lightbulb
  tip:       { cssClass: "tip",      iconSvg: '<path d="M6 12h4"/><path d="M6.5 13h3"/><path d="M8 2a4 4 0 0 1 2.5 7.1c-.3.3-.5.7-.5 1.2V11H6v-.7c0-.5-.2-.9-.5-1.2A4 4 0 0 1 8 2z"/>' },
  hint:      { cssClass: "tip",      iconSvg: '<path d="M6 12h4"/><path d="M6.5 13h3"/><path d="M8 2a4 4 0 0 1 2.5 7.1c-.3.3-.5.7-.5 1.2V11H6v-.7c0-.5-.2-.9-.5-1.2A4 4 0 0 1 8 2z"/>' },
  important: { cssClass: "tip",      iconSvg: '<path d="M6 12h4"/><path d="M6.5 13h3"/><path d="M8 2a4 4 0 0 1 2.5 7.1c-.3.3-.5.7-.5 1.2V11H6v-.7c0-.5-.2-.9-.5-1.2A4 4 0 0 1 8 2z"/>' },

  // Orange/amber — alert triangle
  warning:   { cssClass: "warning",  iconSvg: '<path d="M8 2L1.5 13h13L8 2z"/><line x1="8" y1="6" x2="8" y2="9.5"/><circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none"/>' },
  caution:   { cssClass: "warning",  iconSvg: '<path d="M8 2L1.5 13h13L8 2z"/><line x1="8" y1="6" x2="8" y2="9.5"/><circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none"/>' },
  attention: { cssClass: "warning",  iconSvg: '<path d="M8 2L1.5 13h13L8 2z"/><line x1="8" y1="6" x2="8" y2="9.5"/><circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none"/>' },

  // Green — check circle
  success:   { cssClass: "success",  iconSvg: '<circle cx="8" cy="8" r="6"/><polyline points="5.5 8 7.2 9.7 10.5 6.3"/>' },
  check:     { cssClass: "success",  iconSvg: '<circle cx="8" cy="8" r="6"/><polyline points="5.5 8 7.2 9.7 10.5 6.3"/>' },
  done:      { cssClass: "success",  iconSvg: '<circle cx="8" cy="8" r="6"/><polyline points="5.5 8 7.2 9.7 10.5 6.3"/>' },

  // Red — X circle
  danger:    { cssClass: "danger",   iconSvg: '<circle cx="8" cy="8" r="6"/><line x1="6" y1="6" x2="10" y2="10"/><line x1="10" y1="6" x2="6" y2="10"/>' },
  error:     { cssClass: "danger",   iconSvg: '<circle cx="8" cy="8" r="6"/><line x1="6" y1="6" x2="10" y2="10"/><line x1="10" y1="6" x2="6" y2="10"/>' },

  // Yellow — help circle (question mark)
  question:  { cssClass: "question", iconSvg: '<circle cx="8" cy="8" r="6"/><path d="M6.5 6a1.7 1.7 0 0 1 3 .8c0 1.2-1.5 1-1.5 2.2"/><circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none"/>' },
  help:      { cssClass: "question", iconSvg: '<circle cx="8" cy="8" r="6"/><path d="M6.5 6a1.7 1.7 0 0 1 3 .8c0 1.2-1.5 1-1.5 2.2"/><circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none"/>' },
  faq:       { cssClass: "question", iconSvg: '<circle cx="8" cy="8" r="6"/><path d="M6.5 6a1.7 1.7 0 0 1 3 .8c0 1.2-1.5 1-1.5 2.2"/><circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none"/>' },

  // Red-orange — bug
  bug:       { cssClass: "bug",      iconSvg: '<ellipse cx="8" cy="9" rx="3" ry="4"/><path d="M8 5V3"/><path d="M5.5 5.5L3 4"/><path d="M10.5 5.5L13 4"/><path d="M5 9H2.5"/><path d="M11 9h2.5"/><path d="M5.2 12L3 13.5"/><path d="M10.8 12L13 13.5"/>' },

  // Purple — list
  example:   { cssClass: "example",  iconSvg: '<line x1="4" y1="4" x2="12" y2="4"/><line x1="4" y1="8" x2="12" y2="8"/><line x1="4" y1="12" x2="10" y2="12"/>' },

  // Gray — quote
  quote:     { cssClass: "quote",    iconSvg: '<path d="M3 7.5C3 5 4.5 3 7 3v1.5C5.5 4.5 5 5.5 5 7h1.5v3.5H3V7.5z"/><path d="M9 7.5C9 5 10.5 3 13 3v1.5c-1.5 0-2 1-2 2.5h1.5v3.5H9V7.5z"/>' },
  cite:      { cssClass: "quote",    iconSvg: '<path d="M3 7.5C3 5 4.5 3 7 3v1.5C5.5 4.5 5 5.5 5 7h1.5v3.5H3V7.5z"/><path d="M9 7.5C9 5 10.5 3 13 3v1.5c-1.5 0-2 1-2 2.5h1.5v3.5H9V7.5z"/>' },
};

// ── Callout header regex ────────────────────────────────────────────
// Matches: > [!type] Optional title
// Group 1: type (e.g., "note", "warning")
// Group 2: optional title text
const CALLOUT_HEADER_RE = /^>\s*\[!(\w+)\]\s*(.*)?$/;

// ── Callout title widget ────────────────────────────────────────────

class CalloutTitleWidget extends WidgetType {
  constructor(
    private readonly typeDef: CalloutTypeDef,
    private readonly title: string,
    private readonly typeName: string,
  ) {
    super();
  }

  eq(other: CalloutTitleWidget) {
    return (
      this.typeDef.cssClass === other.typeDef.cssClass &&
      this.title === other.title &&
      this.typeName === other.typeName
    );
  }

  toDOM() {
    const container = document.createElement("div");
    container.className = `shared-md-callout-title shared-md-callout-title-${this.typeDef.cssClass}`;

    // Icon
    const icon = document.createElement("span");
    icon.className = "shared-md-callout-icon";
    icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${this.typeDef.iconSvg}</svg>`;
    container.appendChild(icon);

    // Title text (fallback to capitalized type name)
    const titleText = document.createElement("span");
    titleText.className = "shared-md-callout-title-text";
    titleText.textContent = this.title || this.typeName.charAt(0).toUpperCase() + this.typeName.slice(1);
    container.appendChild(titleText);

    return container;
  }

  ignoreEvent() { return true; }
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

function buildCalloutDecorations(view: EditorView, editable: boolean): DecorationSet {
  const { state } = view;
  const cursorLines = cursorLineNumbers(state, editable);
  const entries: DecorationEntry[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter(node) {
        if (node.name !== "Blockquote") return;

        // Get the first line of the blockquote to check for callout syntax
        const firstLine = state.doc.lineAt(node.from);
        const match = CALLOUT_HEADER_RE.exec(firstLine.text);
        if (!match) return; // Not a callout — skip

        const typeName = match[1].toLowerCase();
        const title = (match[2] ?? "").trim();
        const typeDef = CALLOUT_TYPES[typeName];
        if (!typeDef) return; // Unknown type — skip

        // Determine all line numbers in this blockquote
        const blockStartLine = firstLine.number;
        const blockEndLine = state.doc.lineAt(node.to).number;

        // Check if cursor is on any line in the block
        let cursorInBlock = false;
        for (let lineNum = blockStartLine; lineNum <= blockEndLine; lineNum++) {
          if (cursorLines.has(lineNum)) {
            cursorInBlock = true;
            break;
          }
        }

        if (cursorInBlock) return; // Cursor on block — show raw markdown

        // ── Apply callout decorations ────────────────────────────

        // Apply container line decoration to every line in the block
        for (let lineNum = blockStartLine; lineNum <= blockEndLine; lineNum++) {
          const line = state.doc.line(lineNum);
          entries.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({
              class: `shared-md-callout-line shared-md-callout-line-${typeDef.cssClass}`,
            }),
          });
        }

        // Replace the first line's content (> [!type] Title) with a styled title widget
        entries.push({
          from: firstLine.from,
          to: firstLine.to,
          decoration: Decoration.replace({
            widget: new CalloutTitleWidget(typeDef, title, typeName),
          }),
        });

        // For remaining lines, hide the `> ` prefix (QuoteMark + space)
        for (let lineNum = blockStartLine + 1; lineNum <= blockEndLine; lineNum++) {
          const line = state.doc.line(lineNum);
          const lineText = line.text;
          // Find and hide the `> ` prefix on body lines
          const quoteMatch = /^>\s?/.exec(lineText);
          if (quoteMatch) {
            entries.push({
              from: line.from,
              to: line.from + quoteMatch[0].length,
              decoration: Decoration.replace({}),
            });
          }
        }

        return false; // Don't recurse into this blockquote's children
      },
    });
  }

  // Sort by position for Decoration.set (required)
  entries.sort((a, b) => a.from - b.from || a.to - b.to);

  return Decoration.set(
    entries.map((e) => e.decoration.range(e.from, e.to)),
    true,
  );
}

// ── Extension entry point ───────────────────────────────────────────

export function buildCalloutExtension({ editable }: { editable: boolean }): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildCalloutDecorations(view, editable);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.decorations = buildCalloutDecorations(update.view, editable);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
