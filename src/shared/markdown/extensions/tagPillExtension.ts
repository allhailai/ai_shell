/* ── Tag Pill Extension ───────────────────────────────────────────────
   ViewPlugin that detects #tag patterns in markdown content and
   renders them as styled pill badges in live preview.

   Behavior:
   - Scans visible text for `#word` patterns (hashtag + word chars/hyphens)
   - Excludes matches inside: code blocks, fenced code, inline code,
     headings (# prefix at line start), URLs, HTML tags
   - When cursor is NOT on the tag: replace with Decoration.widget
     (styled pill span)
   - When cursor IS on the tag: reveal raw #tag text
   - NO click behavior — purely visual for now

   Uses `shared-md-` CSS prefix per shell conventions.
   ──────────────────────────────────────────────────────────────────── */

import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

// ── Tag pill widget ─────────────────────────────────────────────────

class TagPillWidget extends WidgetType {
  constructor(private readonly tagName: string) {
    super();
  }

  eq(other: TagPillWidget) {
    return this.tagName === other.tagName;
  }

  toDOM() {
    const pill = document.createElement("span");
    pill.className = "shared-md-tag-pill";
    pill.textContent = `#${this.tagName}`;
    return pill;
  }

  ignoreEvent() { return true; }
}

// ── Tag pattern regex ───────────────────────────────────────────────
// Matches #word where word starts with a letter/underscore and continues
// with letters, digits, hyphens, or underscores.
// Negative lookbehind ensures we don't match inside URLs or after alphanumerics.
const TAG_RE = /(?<![a-zA-Z0-9/:.&?=])#([a-zA-Z_]\w[\w-]*)/g;

// ── Node names to exclude (code-related nodes in CM6 markdown tree) ──

const CODE_NODE_NAMES = new Set([
  "CodeBlock",
  "FencedCode",
  "InlineCode",
  "CodeMark",
  "CodeInfo",
  "CodeText",
  "HTMLBlock",
  "HTMLTag",
  "URL",
  "Link",
  "LinkMark",
]);

// ── Heading detection ───────────────────────────────────────────────
// Lines starting with # should not have their # treated as tags.
const HEADING_LINE_RE = /^#{1,6}\s/;

// ── Cursor-line detection ───────────────────────────────────────────

function cursorPositions(state: EditorState, editable: boolean): Set<number> {
  if (!editable) return new Set();
  const positions = new Set<number>();
  for (const range of state.selection.ranges) {
    // Mark a range of character positions as "cursor-occupied"
    for (let pos = range.from; pos <= range.to; pos++) {
      positions.add(pos);
    }
  }
  return positions;
}

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

// ── Check if a position is inside a code node ───────────────────────

function isInsideCodeNode(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  let inside = false;
  tree.iterate({
    from: pos,
    to: pos + 1,
    enter(node) {
      if (CODE_NODE_NAMES.has(node.name)) {
        inside = true;
        return false; // stop
      }
    },
  });
  return inside;
}

// ── Decoration builder ──────────────────────────────────────────────

type DecorationEntry = { from: number; to: number; decoration: Decoration };

function buildTagPillDecorations(view: EditorView, editable: boolean): DecorationSet {
  const { state } = view;
  const cursorLines = cursorLineNumbers(state, editable);
  const entries: DecorationEntry[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = TAG_RE.exec(text)) !== null) {
      const tagName = match[1];
      const matchFrom = from + match.index;
      const matchTo = matchFrom + match[0].length;

      // Check if cursor is on this line
      const line = state.doc.lineAt(matchFrom);
      if (cursorLines.has(line.number)) continue;

      // Skip if the line starts with heading syntax (# Heading)
      if (HEADING_LINE_RE.test(line.text)) {
        // Check if this # is actually the heading prefix
        const lineOffset = matchFrom - line.from;
        // If the # is at the very start of what looks like a heading, skip
        if (lineOffset === 0) continue;
        // Also skip if this match IS the heading mark (first # chars)
        const textBefore = line.text.substring(0, lineOffset);
        if (/^#{0,5}$/.test(textBefore)) continue;
      }

      // Skip if inside a code node in the syntax tree
      if (isInsideCodeNode(state, matchFrom)) continue;

      // Skip if inside a URL-like context (check surrounding text)
      const lineText = line.text;
      const charIdx = matchFrom - line.from;
      // Check for URL patterns: http://..., https://..., ftp://...
      const urlCheck = lineText.substring(Math.max(0, charIdx - 30), charIdx);
      if (/https?:\/\/\S*$/.test(urlCheck) || /ftp:\/\/\S*$/.test(urlCheck)) continue;

      // Skip if inside markdown link syntax: [text](url#fragment)
      // Check if we're inside parentheses that look like a URL
      const beforeMatch = lineText.substring(0, charIdx);
      const afterMatch = lineText.substring(charIdx + match[0].length);
      if (/\]\([^)]*$/.test(beforeMatch) && /^[^(]*\)/.test(afterMatch)) continue;

      entries.push({
        from: matchFrom,
        to: matchTo,
        decoration: Decoration.replace({
          widget: new TagPillWidget(tagName),
        }),
      });
    }
  }

  // Sort by position for Decoration.set
  entries.sort((a, b) => a.from - b.from || a.to - b.to);

  return Decoration.set(
    entries.map((e) => e.decoration.range(e.from, e.to)),
    true,
  );
}

// ── Extension entry point ───────────────────────────────────────────

export function buildTagPillExtension({ editable }: { editable: boolean }): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildTagPillDecorations(view, editable);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.decorations = buildTagPillDecorations(update.view, editable);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
