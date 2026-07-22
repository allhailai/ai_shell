/* ── Formatting Commands ──────────────────────────────────────────────
   Pure CM6 command functions for markdown formatting.
   Reused by both the toolbar buttons AND the keyboard shortcuts.

   Each command follows the CM6 command signature:
     (view: EditorView) => boolean
   ──────────────────────────────────────────────────────────────────── */

import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { getHighlightApplyEdit, getHighlightClearEdit } from "./highlightMarkup";

// ── Generic inline toggle ────────────────────────────────────────────

/**
 * Toggles inline markers (**, *, ~~, `, ==) around the selection.
 * If text is already wrapped with the marker, removes it.
 * If nothing is selected, inserts markers and places cursor between them.
 */
function toggleInlineMarker(view: EditorView, marker: string): boolean {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];
  const selections: { anchor: number; head?: number }[] = [];
  const markerLen = marker.length;

  for (const range of state.selection.ranges) {
    const from = range.from;
    const to = range.to;
    const selectedText = state.doc.sliceString(from, to);

    if (from === to) {
      // No selection — check if cursor is inside markers
      const lineText = state.doc.lineAt(from).text;
      const lineFrom = state.doc.lineAt(from).from;
      const cursorOffset = from - lineFrom;

      // Look for surrounding markers
      const unwrapped = tryUnwrapAtCursor(lineText, cursorOffset, marker);
      if (unwrapped) {
        changes.push({
          from: lineFrom + unwrapped.from,
          to: lineFrom + unwrapped.to,
          insert: unwrapped.text,
        });
        selections.push({ anchor: lineFrom + unwrapped.cursorPos });
      } else {
        // Insert empty markers and place cursor between
        changes.push({ from, to, insert: `${marker}${marker}` });
        selections.push({ anchor: from + markerLen });
      }
    } else {
      // Text is selected — check if already wrapped
      if (
        selectedText.startsWith(marker) &&
        selectedText.endsWith(marker) &&
        selectedText.length >= markerLen * 2
      ) {
        // Unwrap
        const inner = selectedText.slice(markerLen, -markerLen);
        changes.push({ from, to, insert: inner });
        selections.push({ anchor: from, head: from + inner.length });
      } else {
        // Check if the surrounding context already has markers
        const before = state.doc.sliceString(Math.max(0, from - markerLen), from);
        const after = state.doc.sliceString(to, Math.min(state.doc.length, to + markerLen));

        if (before === marker && after === marker) {
          // Remove surrounding markers
          changes.push(
            { from: from - markerLen, to: from, insert: "" },
            { from: to, to: to + markerLen, insert: "" },
          );
          selections.push({ anchor: from - markerLen, head: to - markerLen });
        } else {
          // Wrap selection
          changes.push({ from, to, insert: `${marker}${selectedText}${marker}` });
          selections.push({
            anchor: from + markerLen,
            head: from + markerLen + selectedText.length,
          });
        }
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({
      changes,
      selection: EditorSelection.create(
        selections.map((s) => EditorSelection.range(s.anchor, s.head ?? s.anchor)),
      ),
    });
    return true;
  }

  return false;
}

/**
 * Try to detect and unwrap markers around the cursor position.
 * Returns the replacement info if markers are found, null otherwise.
 */
function tryUnwrapAtCursor(
  lineText: string,
  cursorOffset: number,
  marker: string,
): { from: number; to: number; text: string; cursorPos: number } | null {
  const markerLen = marker.length;
  // Use a simple search: find the nearest pair of markers around the cursor
  // Search backward for opening marker
  let openIdx = -1;
  for (let i = cursorOffset - 1; i >= 0; i--) {
    if (lineText.substring(i, i + markerLen) === marker) {
      openIdx = i;
      break;
    }
  }
  if (openIdx < 0) return null;

  // Search forward for closing marker (starting after the opening one)
  const searchStart = Math.max(openIdx + markerLen, cursorOffset);
  let closeIdx = -1;
  for (let i = searchStart; i <= lineText.length - markerLen; i++) {
    if (lineText.substring(i, i + markerLen) === marker) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx < 0) return null;

  // Found pair — unwrap
  const inner = lineText.substring(openIdx + markerLen, closeIdx);
  return {
    from: openIdx,
    to: closeIdx + markerLen,
    text: inner,
    cursorPos: openIdx + (cursorOffset - openIdx - markerLen),
  };
}

// ── Exported commands ────────────────────────────────────────────────

/** Toggle **bold** formatting. */
export function toggleBold(view: EditorView): boolean {
  return toggleInlineMarker(view, "**");
}

/** Toggle *italic* formatting. */
export function toggleItalic(view: EditorView): boolean {
  return toggleInlineMarker(view, "*");
}

/** Toggle ~~strikethrough~~ formatting. */
export function toggleStrikethrough(view: EditorView): boolean {
  return toggleInlineMarker(view, "~~");
}

/** Toggle `inline code` formatting. */
export function toggleInlineCode(view: EditorView): boolean {
  return toggleInlineMarker(view, "`");
}

/** Toggle ==highlight== formatting. */
export function toggleHighlight(view: EditorView): boolean {
  const { state } = view;
  const documentText = state.doc.toString();
  const transaction = state.changeByRange((range) => {
    const clearEdit = getHighlightClearEdit(documentText, range.from, range.to);
    const edit = clearEdit ?? getHighlightApplyEdit(documentText, range.from, range.to);
    return {
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      range: EditorSelection.range(edit.selectionFrom, edit.selectionTo),
    };
  });
  view.dispatch(transaction);
  return true;
}

/** Build a Markdown link, treating selected text as the URL when provided. */
export function createMarkdownLink(selectedText: string): string {
  return selectedText ? `[](${selectedText})` : "[text](url)";
}

/** Insert a [text](url) link. */
export function insertLink(view: EditorView): boolean {
  const { state } = view;
  const transaction = state.changeByRange((range) => {
    const selectedText = state.doc.sliceString(range.from, range.to);
    if (selectedText) {
      const link = createMarkdownLink(selectedText);
      return {
        changes: { from: range.from, to: range.to, insert: link },
        range: EditorSelection.cursor(range.from + 1),
      };
    }
    const link = createMarkdownLink("");
    return {
      changes: { from: range.from, insert: link },
      range: EditorSelection.range(range.from + 1, range.from + 5),
    };
  });
  view.dispatch(transaction);
  return true;
}

/** Toggle heading level on the current line. */
export function setHeadingLevel(view: EditorView, level: number): boolean {
  const { state } = view;
  const processedLines = new Set<number>();
  const changes: { from: number; to?: number; insert: string }[] = [];
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(range.to);
    for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber++) {
      if (processedLines.has(lineNumber)) continue;
      processedLines.add(lineNumber);
      const line = state.doc.line(lineNumber);
      const headingMatch = /^(#{1,6})\s/.exec(line.text);
      const existingLevel = headingMatch ? headingMatch[1].length : 0;
      if (existingLevel > 0 && (level === 0 || existingLevel === level)) {
        changes.push({ from: line.from, to: line.from + existingLevel + 1, insert: "" });
      } else if (level > 0) {
        changes.push({
          from: line.from,
          to: existingLevel > 0 ? line.from + existingLevel + 1 : undefined,
          insert: "#".repeat(level) + " ",
        });
      }
    }
  }
  if (changes.length > 0) view.dispatch({ changes });

  return true;
}

/** Toggle checklist (- [ ]) prefix on the current line. */
export function toggleChecklist(view: EditorView): boolean {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];

  // Handle all selection ranges (for multi-cursor support)
  const processedLines = new Set<number>();

  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(range.to);

    for (let lineNum = fromLine.number; lineNum <= toLine.number; lineNum++) {
      if (processedLines.has(lineNum)) continue;
      processedLines.add(lineNum);

      const line = state.doc.line(lineNum);
      const text = line.text;

      // Check for existing task list pattern
      const taskMatch = /^(\s*)- \[([ x/])\]\s/.exec(text);
      const bulletMatch = /^(\s*)[-*+]\s/.exec(text);

      if (taskMatch) {
        // Remove task list prefix — convert back to regular text
        const indent = taskMatch[1];
        const prefixLen = taskMatch[0].length;
        changes.push({
          from: line.from,
          to: line.from + prefixLen,
          insert: indent,
        });
      } else if (bulletMatch) {
        // Convert bullet to task list
        const indent = bulletMatch[1];
        const bulletLen = bulletMatch[0].length;
        changes.push({
          from: line.from,
          to: line.from + bulletLen,
          insert: `${indent}- [ ] `,
        });
      } else {
        // No list prefix — add task list
        const indent = /^(\s*)/.exec(text)?.[1] ?? "";
        changes.push({
          from: line.from + indent.length,
          to: line.from + indent.length,
          insert: "- [ ] ",
        });
      }
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    return true;
  }

  return false;
}

// ── Auto-continue lists ──────────────────────────────────────────────

/**
 * Enter key handler that auto-continues list items.
 * - End of `- item` → insert `\n- ` (continue bullet)
 * - End of `1. item` → insert `\n2. ` (auto-increment number)
 * - End of `- [ ] item` → insert `\n- [ ] ` (continue checklist)
 * - Empty list item (`- ` with no content) → remove prefix (exit list)
 */
export function autoContinueList(view: EditorView): boolean {
  const { state } = view;
  // Let CodeMirror's native Enter handling edit every range when multiple
  // cursors are active. Auto-continuation is intentionally single-cursor.
  if (state.selection.ranges.length !== 1) return false;
  const { head } = state.selection.main;
  const line = state.doc.lineAt(head);
  const text = line.text;

  // Detect indent
  const indentMatch = /^(\s*)/.exec(text);
  const indent = indentMatch?.[1] ?? "";
  const trimmed = text.substring(indent.length);

  // ── Checklist: `- [ ] text` or `- [x] text` or `- [/] text`
  const checklistMatch = /^([-*+])\s\[([ x/])\]\s(.*)$/.exec(trimmed);
  if (checklistMatch) {
    const bullet = checklistMatch[1];
    const content = checklistMatch[3];

    if (content.length === 0) {
      // Empty checklist item → remove prefix (exit list)
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: indent },
        selection: EditorSelection.cursor(line.from + indent.length),
      });
      return true;
    }

    // Continue checklist
    const insert = `\n${indent}${bullet} [ ] `;
    view.dispatch({
      changes: { from: head, insert },
      selection: EditorSelection.cursor(head + insert.length),
    });
    return true;
  }

  // ── Numbered list: `1. text`, `2. text`, etc.
  const numberedMatch = /^(\d+)\.\s(.*)$/.exec(trimmed);
  if (numberedMatch) {
    const num = parseInt(numberedMatch[1], 10);
    const content = numberedMatch[2];

    if (content.length === 0) {
      // Empty numbered item → remove prefix (exit list)
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: indent },
        selection: EditorSelection.cursor(line.from + indent.length),
      });
      return true;
    }

    // Continue with next number
    const nextNum = num + 1;
    const insert = `\n${indent}${nextNum}. `;
    view.dispatch({
      changes: { from: head, insert },
      selection: EditorSelection.cursor(head + insert.length),
    });
    return true;
  }

  // ── Bullet list: `- text`, `* text`, `+ text`
  const bulletMatch = /^([-*+])\s(.*)$/.exec(trimmed);
  if (bulletMatch) {
    const bullet = bulletMatch[1];
    const content = bulletMatch[2];

    if (content.length === 0) {
      // Empty bullet item → remove prefix (exit list)
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: indent },
        selection: EditorSelection.cursor(line.from + indent.length),
      });
      return true;
    }

    // Continue bullet list
    const insert = `\n${indent}${bullet} `;
    view.dispatch({
      changes: { from: head, insert },
      selection: EditorSelection.cursor(head + insert.length),
    });
    return true;
  }

  return false; // Not a list line — let default Enter behavior handle it
}
