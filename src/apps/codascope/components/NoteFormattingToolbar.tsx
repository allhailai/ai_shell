/* ── CodaScope: NoteFormattingToolbar ────────────────────────────────
   Fixed toolbar strip rendered between the note header and editor body.
   Provides formatting buttons that dispatch CM6 transactions.

   Buttons show "active" state when cursor is inside the corresponding
   markdown node (uses syntaxTree inspection).

   Accepts `disabled` prop to gray out in read-only mode (version history).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState, useRef } from "react";
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import {
  IconBold,
  IconItalic,
  IconStrikethrough,
  IconInlineCode,
  IconHighlight,
  IconLink,
  IconHeading,
  IconChecklist,
  IconChevronDown,
} from "./CodaScopeIcons";
import {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleInlineCode,
  toggleHighlight,
  insertLink,
  setHeadingLevel,
  toggleChecklist,
} from "../../../shared/markdown/extensions/formattingCommands";

/* ── Props ───────────────────────────────────────────────────────────── */

interface NoteFormattingToolbarProps {
  /** CM6 EditorView ref for dispatching transactions. */
  editorView: EditorView | null;
  /** Gray out all buttons when viewing version history. */
  disabled?: boolean;
}

/* ── Active state detection ──────────────────────────────────────────── */

interface ActiveStates {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  inlineCode: boolean;
  highlight: boolean;
  headingLevel: number; // 0 = paragraph, 1–6 = heading
  checklist: boolean;
}

const defaultActive: ActiveStates = {
  bold: false,
  italic: false,
  strikethrough: false,
  inlineCode: false,
  highlight: false,
  headingLevel: 0,
  checklist: false,
};

function detectActiveStates(view: EditorView): ActiveStates {
  const { state } = view;
  const pos = state.selection.main.head;
  const tree = syntaxTree(state);
  const line = state.doc.lineAt(pos);
  const lineText = line.text;

  const result = { ...defaultActive };

  // Walk up the tree from cursor position
  let node = tree.resolveInner(pos, -1);
  while (node) {
    switch (node.name) {
      case "StrongEmphasis":
        result.bold = true;
        break;
      case "Emphasis":
        result.italic = true;
        break;
      case "Strikethrough":
        result.strikethrough = true;
        break;
      case "InlineCode":
        result.inlineCode = true;
        break;
      case "ATXHeading1":
        result.headingLevel = 1;
        break;
      case "ATXHeading2":
        result.headingLevel = 2;
        break;
      case "ATXHeading3":
        result.headingLevel = 3;
        break;
      case "ATXHeading4":
        result.headingLevel = 4;
        break;
      case "ATXHeading5":
        result.headingLevel = 5;
        break;
      case "ATXHeading6":
        result.headingLevel = 6;
        break;
    }
    if (node.parent) {
      node = node.parent;
    } else {
      break;
    }
  }

  // Highlight detection via regex (since == isn't in the Lezer grammar)
  const HIGHLIGHT_RE = /==((?:[^=]|=[^=])+)==/g;
  const cursorCol = pos - line.from;
  let match: RegExpExecArray | null;
  while ((match = HIGHLIGHT_RE.exec(lineText)) !== null) {
    if (cursorCol >= match.index && cursorCol <= match.index + match[0].length) {
      result.highlight = true;
      break;
    }
  }

  // Checklist detection
  const taskMatch = /^\s*[-*+]\s\[([ x/])\]\s/.exec(lineText);
  if (taskMatch) {
    result.checklist = true;
  }

  return result;
}

/* ── Heading dropdown labels ─────────────────────────────────────────── */

const HEADING_OPTIONS = [
  { level: 0, label: "Paragraph" },
  { level: 1, label: "Heading 1" },
  { level: 2, label: "Heading 2" },
  { level: 3, label: "Heading 3" },
  { level: 4, label: "Heading 4" },
  { level: 5, label: "Heading 5" },
  { level: 6, label: "Heading 6" },
];

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteFormattingToolbar({ editorView, disabled = false }: NoteFormattingToolbarProps) {
  const [active, setActive] = useState<ActiveStates>(defaultActive);
  const [headingOpen, setHeadingOpen] = useState(false);
  const headingDropdownRef = useRef<HTMLDivElement>(null);

  // Track active states when selection or doc changes
  useEffect(() => {
    if (!editorView || disabled) return;

    const updateActive = () => {
      setActive(detectActiveStates(editorView));
    };

    // Listen to selection and doc changes
    const listener = editorView.dom.addEventListener("keyup", updateActive);
    const mouseListener = editorView.dom.addEventListener("mouseup", updateActive);

    // Initial check
    updateActive();

    // Use a MutationObserver-like approach: poll on focus/selection changes
    const interval = setInterval(() => {
      if (editorView.hasFocus) {
        updateActive();
      }
    }, 300);

    return () => {
      editorView.dom.removeEventListener("keyup", updateActive);
      editorView.dom.removeEventListener("mouseup", updateActive);
      clearInterval(interval);
    };
  }, [editorView, disabled]);

  // Close heading dropdown on outside click
  useEffect(() => {
    if (!headingOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (headingDropdownRef.current && !headingDropdownRef.current.contains(e.target as Node)) {
        setHeadingOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [headingOpen]);

  // ── Button handlers ────────────────────────────────────────────────

  const withFocusReturn = useCallback((action: (view: EditorView) => boolean) => {
    if (!editorView || disabled) return;
    action(editorView);
    editorView.focus();
  }, [editorView, disabled]);

  const handleBold = useCallback(() => withFocusReturn(toggleBold), [withFocusReturn]);
  const handleItalic = useCallback(() => withFocusReturn(toggleItalic), [withFocusReturn]);
  const handleStrikethrough = useCallback(() => withFocusReturn(toggleStrikethrough), [withFocusReturn]);
  const handleInlineCode = useCallback(() => withFocusReturn(toggleInlineCode), [withFocusReturn]);
  const handleHighlight = useCallback(() => withFocusReturn(toggleHighlight), [withFocusReturn]);
  const handleLink = useCallback(() => withFocusReturn(insertLink), [withFocusReturn]);
  const handleChecklist = useCallback(() => withFocusReturn(toggleChecklist), [withFocusReturn]);

  const handleHeadingSelect = useCallback((level: number) => {
    if (!editorView || disabled) return;
    setHeadingLevel(editorView, level);
    editorView.focus();
    setHeadingOpen(false);
  }, [editorView, disabled]);

  // ── Current heading label ──────────────────────────────────────────

  const currentHeadingLabel = active.headingLevel > 0
    ? `H${active.headingLevel}`
    : "¶";

  return (
    <div className={`codascope-notes-formatting-toolbar${disabled ? " codascope-notes-formatting-toolbar-disabled" : ""}`}>
      {/* Heading dropdown */}
      <div className="codascope-notes-formatting-group" ref={headingDropdownRef}>
        <button
          className={`codascope-notes-formatting-btn codascope-notes-formatting-btn-heading${active.headingLevel > 0 ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={() => setHeadingOpen((o) => !o)}
          disabled={disabled}
          type="button"
          title="Heading level"
        >
          <IconHeading size={14} />
          <span className="codascope-notes-formatting-btn-label">{currentHeadingLabel}</span>
          <IconChevronDown size={10} />
        </button>

        {headingOpen && (
          <div className="codascope-notes-formatting-dropdown">
            {HEADING_OPTIONS.map(({ level, label }) => (
              <button
                key={level}
                className={`codascope-notes-formatting-dropdown-item${active.headingLevel === level ? " codascope-notes-formatting-dropdown-item-active" : ""}`}
                onClick={() => handleHeadingSelect(level)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="codascope-notes-formatting-divider" />

      {/* Inline formatting group */}
      <div className="codascope-notes-formatting-group">
        <button
          className={`codascope-notes-formatting-btn${active.bold ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={handleBold}
          disabled={disabled}
          type="button"
          title="Bold (⌘B)"
        >
          <IconBold size={14} />
        </button>

        <button
          className={`codascope-notes-formatting-btn${active.italic ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={handleItalic}
          disabled={disabled}
          type="button"
          title="Italic (⌘I)"
        >
          <IconItalic size={14} />
        </button>

        <button
          className={`codascope-notes-formatting-btn${active.strikethrough ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={handleStrikethrough}
          disabled={disabled}
          type="button"
          title="Strikethrough (⌘⇧X)"
        >
          <IconStrikethrough size={14} />
        </button>

        <button
          className={`codascope-notes-formatting-btn${active.inlineCode ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={handleInlineCode}
          disabled={disabled}
          type="button"
          title="Inline Code (⌘E)"
        >
          <IconInlineCode size={14} />
        </button>

        <button
          className={`codascope-notes-formatting-btn${active.highlight ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={handleHighlight}
          disabled={disabled}
          type="button"
          title="Highlight (⌘⇧H)"
        >
          <IconHighlight size={14} />
        </button>
      </div>

      <div className="codascope-notes-formatting-divider" />

      {/* Link + Checklist */}
      <div className="codascope-notes-formatting-group">
        <button
          className="codascope-notes-formatting-btn"
          onClick={handleLink}
          disabled={disabled}
          type="button"
          title="Link (⌘K)"
        >
          <IconLink size={14} />
        </button>

        <button
          className={`codascope-notes-formatting-btn${active.checklist ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={handleChecklist}
          disabled={disabled}
          type="button"
          title="Checklist"
        >
          <IconChecklist size={14} />
        </button>
      </div>
    </div>
  );
}
