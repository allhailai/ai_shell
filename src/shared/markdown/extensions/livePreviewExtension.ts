/* ── Live Preview Extension ───────────────────────────────────────────
   Obsidian-style "live preview" for CodeMirror 6.

   Hides markdown syntax markers (##, **, *, ~~, >, etc.) when the
   cursor is NOT on that line, and reveals raw markdown when the cursor
   moves to that line.

   Also renders interactive checkboxes for task list items:
   - [ ] → unchecked checkbox
   - [x] → checked checkbox
   - [/] → in-progress indicator

   Auto-links bare URLs and standard [text](url) Markdown links when the
   cursor is away from the line.

   Adapted from kiss_ai for AI Shell's shared component library.
   ──────────────────────────────────────────────────────────────────── */

import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { parseMarkdownTableBlock } from "./markdownTableExtension";

// ── Heading level → node name mapping ───────────────────────────────

const headingNodeNames = new Set([
  "ATXHeading1", "ATXHeading2", "ATXHeading3",
  "ATXHeading4", "ATXHeading5", "ATXHeading6",
]);

function headingLevel(nodeName: string): number {
  switch (nodeName) {
    case "ATXHeading1": return 1;
    case "ATXHeading2": return 2;
    case "ATXHeading3": return 3;
    case "ATXHeading4": return 4;
    case "ATXHeading5": return 5;
    case "ATXHeading6": return 6;
    default: return 0;
  }
}

// ── Checkbox Widget ─────────────────────────────────────────────────

class CheckboxWidget extends WidgetType {
  constructor(
    readonly state: " " | "x" | "/",
    readonly pos: number,
  ) {
    super();
  }

  eq(other: CheckboxWidget) {
    return this.state === other.state && this.pos === other.pos;
  }

  toDOM(view: EditorView) {
    if (this.state === "/") {
      // In-progress indicator — styled span instead of checkbox
      const span = document.createElement("span");
      span.className = "cm-live-checkbox cm-live-checkbox-progress";
      span.setAttribute("aria-label", "In progress");
      span.title = "In progress";
      span.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Toggle: [/] → [x]
        this.toggleState(view, "x");
      });
      return span;
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "cm-live-checkbox";
    checkbox.checked = this.state === "x";
    checkbox.setAttribute("aria-label", this.state === "x" ? "Completed" : "Uncompleted");

    checkbox.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newState = this.state === "x" ? " " : "x";
      this.toggleState(view, newState);
    });

    return checkbox;
  }

  private toggleState(view: EditorView, newState: string) {
    // The pos points to the `[` in `[ ]` / `[x]` / `[/]`
    // We need to replace the character between `[` and `]`
    view.dispatch({
      changes: { from: this.pos + 1, to: this.pos + 2, insert: newState },
    });
  }

  ignoreEvent() { return false; }
}

// ── Task list regex ─────────────────────────────────────────────────

const TASK_RE = /^(\s*[-*+]\s)\[([ x/])\]\s/;

// ── Text color regex ────────────────────────────────────────────────
// Matches <span style="color:VALUE">text</span>
// VALUE can be: named color, #hex, rgb(...), hsl(...)
const TEXT_COLOR_RE = /<span\s+style="color:\s*([^"]+)">([\s\S]*?)<\/span>/g;

// ── Bare URL regex ──────────────────────────────────────────────────
// Matches https:// or http:// URLs that are NOT already inside [text](url)
const BARE_URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;
const MARKDOWN_LINK_RE = /(?<!!)\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

// ── Link widget for bare URLs ───────────────────────────────────────

class BareURLWidget extends WidgetType {
  constructor(private readonly url: string) {
    super();
  }

  eq(other: BareURLWidget) {
    return this.url === other.url;
  }

  toDOM() {
    const link = document.createElement("a");
    link.className = "cm-live-bare-url";
    link.href = this.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    // Show a shortened display: remove protocol and truncate if long
    let display = this.url.replace(/^https?:\/\//, "");
    if (display.length > 50) {
      display = display.substring(0, 47) + "…";
    }
    link.textContent = display;
    link.title = this.url;
    link.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(this.url, "_blank", "noopener,noreferrer");
    });
    return link;
  }

  ignoreEvent() { return false; }
}

// ── Standard Markdown link widget ──────────────────────────────────

class MarkdownLinkWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly url: string,
  ) {
    super();
  }

  eq(other: MarkdownLinkWidget) {
    return this.label === other.label && this.url === other.url;
  }

  toDOM() {
    const link = document.createElement("a");
    link.className = "cm-live-markdown-link";
    link.href = this.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = this.label;
    link.title = this.url;
    link.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.open(this.url, "_blank", "noopener,noreferrer");
    });
    return link;
  }

  ignoreEvent() { return false; }
}

// Cache for inline-color mark decorations
const colorMarkCache = new Map<string, Decoration>();

function getInlineColorDecoration(color: string): Decoration {
  let dec = colorMarkCache.get(color);
  if (!dec) {
    dec = Decoration.mark({
      attributes: { style: `color: ${color}` },
      class: "cm-live-text-color",
    });
    colorMarkCache.set(color, dec);
  }
  return dec;
}

// ── Decoration cache ────────────────────────────────────────────────

const headingMarkDecorations = [
  /* 0 */ Decoration.mark({ class: "cm-live-heading-1" }),
  Decoration.mark({ class: "cm-live-heading-1" }),
  Decoration.mark({ class: "cm-live-heading-2" }),
  Decoration.mark({ class: "cm-live-heading-3" }),
  Decoration.mark({ class: "cm-live-heading-4" }),
  Decoration.mark({ class: "cm-live-heading-5" }),
  Decoration.mark({ class: "cm-live-heading-6" }),
];

const boldMarkDecoration = Decoration.mark({ class: "cm-live-bold" });
const italicMarkDecoration = Decoration.mark({ class: "cm-live-italic" });
const strikethroughMarkDecoration = Decoration.mark({ class: "cm-live-strikethrough" });
const inlineCodeMarkDecoration = Decoration.mark({ class: "cm-live-inline-code" });
const blockquoteLineDecoration = Decoration.line({ class: "cm-live-blockquote-line" });
const listBulletDecoration = Decoration.mark({ class: "cm-live-list-bullet" });
const replaceDecoration = Decoration.replace({});
const horizontalRuleLineDecoration = Decoration.line({ class: "cm-live-hr-line" });

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

// ── Table-line detection ────────────────────────────────────────────

function tableLineNumbers(state: EditorState): Set<number> {
  const lines = new Set<number>();
  let position = 0;
  while (position <= state.doc.length) {
    const line = state.doc.lineAt(position);
    const table = parseMarkdownTableBlock(state.doc, line.number);
    if (table) {
      for (let lineNumber = table.startLineNumber; lineNumber <= table.endLineNumber; lineNumber++) {
        lines.add(lineNumber);
      }
      position = table.to + 1;
      continue;
    }
    if (line.to >= state.doc.length) break;
    position = line.to + 1;
  }
  return lines;
}

// ── Decoration builder ──────────────────────────────────────────────

type DecorationEntry = { from: number; to: number; decoration: Decoration };

function buildDecorations(view: EditorView, editable: boolean): DecorationSet {
  const { state } = view;
  const cursorLines = cursorLineNumbers(state, editable);
  const tableLines = tableLineNumbers(state);
  const entries: DecorationEntry[] = [];

  // ── Task list checkbox decorations (line-based scan) ──────────────
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      if (!cursorLines.has(line.number) && !tableLines.has(line.number)) {
        const match = TASK_RE.exec(line.text);
        if (match) {
          const checkState = match[2] as " " | "x" | "/";
          const bulletPrefix = match[1]; // e.g. "- "
          const bracketStart = line.from + bulletPrefix.length; // position of `[`

          // Replace `[x] ` (or `[ ] ` / `[/] `) with checkbox widget
          entries.push({
            from: bracketStart,
            to: bracketStart + 4, // `[x] ` = 4 chars (bracket + state + bracket + space)
            decoration: Decoration.replace({
              widget: new CheckboxWidget(checkState, bracketStart),
            }),
          });
        }
      }
      if (line.to >= state.doc.length) break;
      pos = line.to + 1;
    }
  }
  // ── Text color span decorations (regex-based scan) ─────────────────
  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    let match: RegExpExecArray | null;
    TEXT_COLOR_RE.lastIndex = 0;

    while ((match = TEXT_COLOR_RE.exec(text)) !== null) {
      const fullMatch = match[0]; // <span style="color:red">text</span>
      const colorValue = match[1]; // e.g., "red", "#ff0000"
      const matchFrom = from + match.index;
      const matchTo = matchFrom + fullMatch.length;

      // Check if cursor is on this line
      const line = state.doc.lineAt(matchFrom);
      if (cursorLines.has(line.number)) continue;

      // Find boundaries of the opening and closing tags
      const openTagEnd = matchFrom + fullMatch.indexOf(">") + 1;
      const closeTagStart = matchTo - "</span>".length;

      // Validate boundaries
      if (openTagEnd <= matchFrom || closeTagStart <= openTagEnd) continue;

      // Hide the opening <span style="color:..."> tag
      entries.push({ from: matchFrom, to: openTagEnd, decoration: replaceDecoration });

      // Apply inline color to the inner text
      if (openTagEnd < closeTagStart) {
        entries.push({
          from: openTagEnd,
          to: closeTagStart,
          decoration: getInlineColorDecoration(colorValue.trim()),
        });
      }

      // Hide the closing </span> tag
      entries.push({ from: closeTagStart, to: matchTo, decoration: replaceDecoration });
    }
  }

  // ── Standard Markdown links ────────────────────────────────────────
  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    MARKDOWN_LINK_RE.lastIndex = 0;

    for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
      const line = state.doc.lineAt(from + (match.index ?? 0));
      if (cursorLines.has(line.number) || tableLines.has(line.number)) continue;

      const label = match[1];
      const url = match[2];
      if (!label || !url) continue;
      const matchFrom = from + (match.index ?? 0);
      entries.push({
        from: matchFrom,
        to: matchFrom + match[0].length,
        decoration: Decoration.replace({ widget: new MarkdownLinkWidget(label, url) }),
      });
    }
  }

  // ── Bare URL auto-linking ──────────────────────────────────────────
  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    let match: RegExpExecArray | null;
    BARE_URL_RE.lastIndex = 0;

    while ((match = BARE_URL_RE.exec(text)) !== null) {
      const url = match[0];
      const matchFrom = from + match.index;
      const matchTo = matchFrom + url.length;

      // Check if cursor is on this line
      const line = state.doc.lineAt(matchFrom);
      if (cursorLines.has(line.number)) continue;

      // Skip if inside a markdown link: [text](url)
      // Check if preceded by ]( — indicating this URL is inside a link's href
      const lineText = line.text;
      const lineOffset = matchFrom - line.from;
      const textBefore = lineText.substring(0, lineOffset);

      // Check for markdown link syntax: ](url) or ]( url)
      if (/\]\(\s*$/.test(textBefore)) continue;

      // Also skip if this is already inside an autolink <https://...>
      if (lineOffset > 0 && lineText[lineOffset - 1] === "<") continue;

      // Skip if inside a wiki link or other bracket context
      if (/\[\[[^\]]*$/.test(textBefore)) continue;

      // Strip trailing punctuation that's likely not part of the URL
      let cleanUrl = url;
      let cleanTo = matchTo;
      const trailingPunct = /[.,;:!?)]+$/.exec(cleanUrl);
      if (trailingPunct) {
        cleanUrl = cleanUrl.substring(0, cleanUrl.length - trailingPunct[0].length);
        cleanTo = matchFrom + cleanUrl.length;
      }

      if (cleanUrl.length < 8) continue; // Too short to be a real URL

      entries.push({
        from: matchFrom,
        to: cleanTo,
        decoration: Decoration.replace({
          widget: new BareURLWidget(cleanUrl),
        }),
      });
    }
  }

  // ── Syntax tree decorations ───────────────────────────────────────
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter(node) {
        // Headings
        if (headingNodeNames.has(node.name)) {
          const level = headingLevel(node.name);
          if (!level) return;
          const headingLine = state.doc.lineAt(node.from);
          if (cursorLines.has(headingLine.number) || tableLines.has(headingLine.number)) return;
          if (node.from < node.to) {
            entries.push({ from: node.from, to: node.to, decoration: headingMarkDecorations[level] });
          }
          const cursor = node.node.cursor();
          if (cursor.firstChild()) {
            do {
              if (cursor.name === "HeaderMark") {
                let replaceEnd = cursor.to;
                if (state.doc.sliceString(cursor.to, cursor.to + 1) === " ") replaceEnd = cursor.to + 1;
                entries.push({ from: cursor.from, to: replaceEnd, decoration: replaceDecoration });
              }
            } while (cursor.nextSibling());
          }
          return false;
        }

        // Bold
        if (node.name === "StrongEmphasis") {
          const line = state.doc.lineAt(node.from);
          if (cursorLines.has(line.number) || tableLines.has(line.number)) return false;
          entries.push({ from: node.from, to: node.to, decoration: boldMarkDecoration });
          const cursor = node.node.cursor();
          if (cursor.firstChild()) {
            do {
              if (cursor.name === "EmphasisMark") {
                entries.push({ from: cursor.from, to: cursor.to, decoration: replaceDecoration });
              }
            } while (cursor.nextSibling());
          }
          return false;
        }

        // Italic
        if (node.name === "Emphasis") {
          const line = state.doc.lineAt(node.from);
          if (cursorLines.has(line.number) || tableLines.has(line.number)) return false;
          entries.push({ from: node.from, to: node.to, decoration: italicMarkDecoration });
          const cursor = node.node.cursor();
          if (cursor.firstChild()) {
            do {
              if (cursor.name === "EmphasisMark") {
                entries.push({ from: cursor.from, to: cursor.to, decoration: replaceDecoration });
              }
            } while (cursor.nextSibling());
          }
          return false;
        }

        // Strikethrough
        if (node.name === "Strikethrough") {
          const line = state.doc.lineAt(node.from);
          if (cursorLines.has(line.number) || tableLines.has(line.number)) return false;
          entries.push({ from: node.from, to: node.to, decoration: strikethroughMarkDecoration });
          const cursor = node.node.cursor();
          if (cursor.firstChild()) {
            do {
              if (cursor.name === "StrikethroughMark") {
                entries.push({ from: cursor.from, to: cursor.to, decoration: replaceDecoration });
              }
            } while (cursor.nextSibling());
          }
          return false;
        }

        // Inline Code
        if (node.name === "InlineCode") {
          const line = state.doc.lineAt(node.from);
          if (cursorLines.has(line.number) || tableLines.has(line.number)) return false;
          entries.push({ from: node.from, to: node.to, decoration: inlineCodeMarkDecoration });
          const cursor = node.node.cursor();
          if (cursor.firstChild()) {
            do {
              if (cursor.name === "CodeMark") {
                entries.push({ from: cursor.from, to: cursor.to, decoration: replaceDecoration });
              }
            } while (cursor.nextSibling());
          }
          return false;
        }

        // Blockquote
        if (node.name === "Blockquote") {
          const cursor = node.node.cursor();
          if (cursor.firstChild()) {
            do {
              if (cursor.name === "QuoteMark") {
                const quoteLine = state.doc.lineAt(cursor.from);
                if (cursorLines.has(quoteLine.number) || tableLines.has(quoteLine.number)) continue;
                entries.push({ from: quoteLine.from, to: quoteLine.from, decoration: blockquoteLineDecoration });
                let replaceEnd = cursor.to;
                if (state.doc.sliceString(cursor.to, cursor.to + 1) === " ") replaceEnd = cursor.to + 1;
                entries.push({ from: cursor.from, to: replaceEnd, decoration: replaceDecoration });
              }
            } while (cursor.nextSibling());
          }
          return;
        }

        // List items
        if (node.name === "ListMark") {
          const line = state.doc.lineAt(node.from);
          if (cursorLines.has(line.number) || tableLines.has(line.number)) return;
          entries.push({ from: node.from, to: node.to, decoration: listBulletDecoration });
          return;
        }

        // Horizontal rule
        if (node.name === "HorizontalRule") {
          const line = state.doc.lineAt(node.from);
          if (cursorLines.has(line.number) || tableLines.has(line.number)) return false;
          entries.push({ from: line.from, to: line.from, decoration: horizontalRuleLineDecoration });
          entries.push({ from: node.from, to: node.to, decoration: replaceDecoration });
          return false;
        }
      },
    });
  }

  return Decoration.set(
    entries.map((entry) => entry.decoration.range(entry.from, entry.to)),
    true,
  );
}

// ── Extension entry point ───────────────────────────────────────────

export function buildLivePreviewExtension({ editable }: { editable: boolean }): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, editable);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.decorations = buildDecorations(update.view, editable);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
