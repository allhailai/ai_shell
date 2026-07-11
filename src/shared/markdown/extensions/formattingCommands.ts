/* ── Formatting Commands ──────────────────────────────────────────────
   Pure CM6 command functions for markdown formatting.
   Reused by both the toolbar buttons AND the keyboard shortcuts.

   Each command follows the CM6 command signature:
     (view: EditorView) => boolean
   ──────────────────────────────────────────────────────────────────── */

import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

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
  return toggleInlineMarker(view, "==");
}

/** Insert a [text](url) link. */
export function insertLink(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const selectedText = state.doc.sliceString(range.from, range.to);

  if (selectedText) {
    // Wrap selected text as link
    const link = `[${selectedText}](url)`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: link },
      selection: EditorSelection.cursor(range.from + selectedText.length + 3),
    });
  } else {
    // Insert link template
    const link = "[text](url)";
    view.dispatch({
      changes: { from: range.from, insert: link },
      selection: EditorSelection.range(range.from + 1, range.from + 5),
    });
  }
  return true;
}

/** Toggle heading level on the current line. */
export function setHeadingLevel(view: EditorView, level: number): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const lineText = line.text;

  // Parse existing heading level
  const headingMatch = /^(#{1,6})\s/.exec(lineText);
  const existingLevel = headingMatch ? headingMatch[1].length : 0;

  if (level === 0) {
    // Remove heading
    if (existingLevel > 0) {
      const prefixLen = existingLevel + 1; // # + space
      view.dispatch({
        changes: { from: line.from, to: line.from + prefixLen, insert: "" },
      });
    }
  } else if (existingLevel === level) {
    // Same level — remove heading (toggle off)
    const prefixLen = existingLevel + 1;
    view.dispatch({
      changes: { from: line.from, to: line.from + prefixLen, insert: "" },
    });
  } else {
    // Set to new level
    const newPrefix = "#".repeat(level) + " ";
    if (existingLevel > 0) {
      const oldPrefixLen = existingLevel + 1;
      view.dispatch({
        changes: { from: line.from, to: line.from + oldPrefixLen, insert: newPrefix },
      });
    } else {
      view.dispatch({
        changes: { from: line.from, insert: newPrefix },
      });
    }
  }

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
