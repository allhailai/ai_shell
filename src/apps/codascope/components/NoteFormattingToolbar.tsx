/* ── CodaScope: NoteFormattingToolbar ────────────────────────────────
   Fixed toolbar strip rendered between the note header and editor body.
   Provides formatting buttons that dispatch CM6 transactions.

   Buttons show "active" state when cursor is inside the corresponding
   markdown node (uses syntaxTree inspection).

   Accepts `disabled` prop to gray out in read-only mode (version history).

   Window 2: Added highlight color picker and text color picker dropdowns.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
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
  IconPalette,
  IconTextColor,
  IconFocusMode,
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
import { detectHighlightColors } from "../../../shared/markdown/extensions/highlightExtension";
import { toggleFocusMode, isFocusModeOn } from "../../../shared/markdown/extensions/focusModeExtension";

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
  const HIGHLIGHT_RE = /==((?:[^=]|=[^=])+)==(?:\{\.\w+\})?/g;
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

/* ── Default highlight colors ────────────────────────────────────────── */

interface ColorSwatch {
  name: string;
  label: string;
  cssColor: string;
}

const DEFAULT_HIGHLIGHT_COLORS: ColorSwatch[] = [
  { name: "", label: "Yellow (default)", cssColor: "hsla(45, 90%, 55%, 0.5)" },
  { name: "red", label: "Red", cssColor: "hsla(0, 80%, 55%, 0.5)" },
  { name: "green", label: "Green", cssColor: "hsla(140, 70%, 45%, 0.5)" },
  { name: "blue", label: "Blue", cssColor: "hsla(220, 80%, 55%, 0.5)" },
  { name: "purple", label: "Purple", cssColor: "hsla(270, 70%, 55%, 0.5)" },
  { name: "orange", label: "Orange", cssColor: "hsla(30, 90%, 55%, 0.5)" },
  { name: "pink", label: "Pink", cssColor: "hsla(330, 80%, 55%, 0.5)" },
  { name: "cyan", label: "Cyan", cssColor: "hsla(180, 70%, 45%, 0.5)" },
];

const DEFAULT_TEXT_COLORS: ColorSwatch[] = [
  { name: "red", label: "Red", cssColor: "#ef4444" },
  { name: "orange", label: "Orange", cssColor: "#f97316" },
  { name: "yellow", label: "Yellow", cssColor: "#eab308" },
  { name: "green", label: "Green", cssColor: "#22c55e" },
  { name: "cyan", label: "Cyan", cssColor: "#06b6d4" },
  { name: "blue", label: "Blue", cssColor: "#3b82f6" },
  { name: "purple", label: "Purple", cssColor: "#a855f7" },
  { name: "pink", label: "Pink", cssColor: "#ec4899" },
];

/* ── Highlight color wrapping ────────────────────────────────────────── */

function wrapWithHighlightColor(view: EditorView, colorName: string): void {
  const { state } = view;
  const range = state.selection.main;
  const selectedText = state.doc.sliceString(range.from, range.to);
  const suffix = colorName ? `{.${colorName}}` : "";

  if (selectedText) {
    const wrapped = `==${selectedText}==${suffix}`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: wrapped },
      selection: EditorSelection.range(
        range.from + 2,
        range.from + 2 + selectedText.length,
      ),
    });
  } else {
    const wrapped = `==${suffix === "" ? "" : "text"}==${suffix}`;
    if (suffix) {
      view.dispatch({
        changes: { from: range.from, insert: wrapped },
        selection: EditorSelection.range(range.from + 2, range.from + 6),
      });
    } else {
      view.dispatch({
        changes: { from: range.from, insert: "====" },
        selection: EditorSelection.cursor(range.from + 2),
      });
    }
  }
}

function wrapWithTextColor(view: EditorView, cssColor: string): void {
  const { state } = view;
  const range = state.selection.main;
  const selectedText = state.doc.sliceString(range.from, range.to);

  if (selectedText) {
    const wrapped = `<span style="color:${cssColor}">${selectedText}</span>`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: wrapped },
      selection: EditorSelection.range(
        range.from + `<span style="color:${cssColor}">`.length,
        range.from + `<span style="color:${cssColor}">`.length + selectedText.length,
      ),
    });
  } else {
    const wrapped = `<span style="color:${cssColor}">text</span>`;
    const openTagLen = `<span style="color:${cssColor}">`.length;
    view.dispatch({
      changes: { from: range.from, insert: wrapped },
      selection: EditorSelection.range(range.from + openTagLen, range.from + openTagLen + 4),
    });
  }
}

/* ── Custom highlight colors from settings ───────────────────────────── */

function useSettingsHighlightColors(): ColorSwatch[] {
  const [customColors, setCustomColors] = useState<ColorSwatch[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/secrets/app/codascope/highlight_colors");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.value && !cancelled) {
          try {
            const parsed = JSON.parse(data.value);
            if (Array.isArray(parsed)) {
              setCustomColors(
                parsed.map((c: { name: string; label: string; cssColor: string }) => ({
                  name: c.name,
                  label: c.label,
                  cssColor: c.cssColor,
                })),
              );
            }
          } catch {
            // Invalid JSON — ignore
          }
        }
      } catch {
        // Network error — ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return customColors;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteFormattingToolbar({ editorView, disabled = false }: NoteFormattingToolbarProps) {
  const [active, setActive] = useState<ActiveStates>(defaultActive);
  const [headingOpen, setHeadingOpen] = useState(false);
  const [highlightPickerOpen, setHighlightPickerOpen] = useState(false);
  const [textColorPickerOpen, setTextColorPickerOpen] = useState(false);
  const headingDropdownRef = useRef<HTMLDivElement>(null);
  const highlightDropdownRef = useRef<HTMLDivElement>(null);
  const textColorDropdownRef = useRef<HTMLDivElement>(null);

  // Custom colors from settings
  const settingsColors = useSettingsHighlightColors();

  // Document-detected colors
  const [docColors, setDocColors] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!editorView) return;
    const update = () => {
      const content = editorView.state.doc.toString();
      setDocColors(detectHighlightColors(content));
    };
    update();
    // Re-detect when doc changes via interval (lightweight)
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, [editorView]);

  // Combined highlight colors: defaults + settings + document-detected
  const allHighlightColors = useMemo(() => {
    const known = new Set(DEFAULT_HIGHLIGHT_COLORS.map((c) => c.name));
    settingsColors.forEach((c) => known.add(c.name));

    const extras: ColorSwatch[] = [];
    for (const colorName of docColors) {
      if (!known.has(colorName)) {
        extras.push({
          name: colorName,
          label: colorName.charAt(0).toUpperCase() + colorName.slice(1),
          cssColor: `var(--color-highlight-${colorName}, hsla(0, 0%, 50%, 0.3))`,
        });
      }
    }

    return [...DEFAULT_HIGHLIGHT_COLORS, ...settingsColors, ...extras];
  }, [settingsColors, docColors]);

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

  // Close dropdowns on outside click
  useEffect(() => {
    if (!headingOpen && !highlightPickerOpen && !textColorPickerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (headingOpen && headingDropdownRef.current && !headingDropdownRef.current.contains(e.target as Node)) {
        setHeadingOpen(false);
      }
      if (highlightPickerOpen && highlightDropdownRef.current && !highlightDropdownRef.current.contains(e.target as Node)) {
        setHighlightPickerOpen(false);
      }
      if (textColorPickerOpen && textColorDropdownRef.current && !textColorDropdownRef.current.contains(e.target as Node)) {
        setTextColorPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [headingOpen, highlightPickerOpen, textColorPickerOpen]);

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

  const handleHighlightColor = useCallback((colorName: string) => {
    if (!editorView || disabled) return;
    wrapWithHighlightColor(editorView, colorName);
    editorView.focus();
    setHighlightPickerOpen(false);
  }, [editorView, disabled]);

  const handleTextColor = useCallback((cssColor: string) => {
    if (!editorView || disabled) return;
    wrapWithTextColor(editorView, cssColor);
    editorView.focus();
    setTextColorPickerOpen(false);
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

      {/* Color pickers group */}
      <div className="codascope-notes-formatting-group" ref={highlightDropdownRef}>
        <button
          className={`codascope-notes-formatting-btn${highlightPickerOpen ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={() => {
            setHighlightPickerOpen((o) => !o);
            setTextColorPickerOpen(false);
          }}
          disabled={disabled}
          type="button"
          title="Highlight color"
        >
          <IconPalette size={14} />
          <IconChevronDown size={8} />
        </button>

        {highlightPickerOpen && (
          <div className="codascope-notes-formatting-color-picker">
            <div className="codascope-notes-formatting-color-picker-label">Highlight Color</div>
            <div className="codascope-notes-formatting-color-grid">
              {allHighlightColors.map((color) => (
                <button
                  key={color.name || "default"}
                  className="codascope-notes-formatting-color-swatch"
                  style={{ backgroundColor: color.cssColor }}
                  onClick={() => handleHighlightColor(color.name)}
                  title={color.label}
                  type="button"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="codascope-notes-formatting-group" ref={textColorDropdownRef}>
        <button
          className={`codascope-notes-formatting-btn${textColorPickerOpen ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={() => {
            setTextColorPickerOpen((o) => !o);
            setHighlightPickerOpen(false);
          }}
          disabled={disabled}
          type="button"
          title="Text color"
        >
          <IconTextColor size={14} />
          <IconChevronDown size={8} />
        </button>

        {textColorPickerOpen && (
          <div className="codascope-notes-formatting-color-picker">
            <div className="codascope-notes-formatting-color-picker-label">Text Color</div>
            <div className="codascope-notes-formatting-color-grid">
              {DEFAULT_TEXT_COLORS.map((color) => (
                <button
                  key={color.name}
                  className="codascope-notes-formatting-color-swatch"
                  style={{ backgroundColor: color.cssColor }}
                  onClick={() => handleTextColor(color.cssColor)}
                  title={color.label}
                  type="button"
                />
              ))}
            </div>
          </div>
        )}
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

      <div className="codascope-notes-formatting-divider" />

      {/* Focus mode toggle */}
      <div className="codascope-notes-formatting-group">
        <button
          className={`codascope-notes-formatting-btn${editorView && isFocusModeOn(editorView) ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={() => {
            if (!editorView || disabled) return;
            toggleFocusMode(editorView);
            editorView.focus();
          }}
          disabled={disabled}
          type="button"
          title="Focus mode (⌘⇧F)"
        >
          <IconFocusMode size={14} />
        </button>
      </div>
    </div>
  );
}
