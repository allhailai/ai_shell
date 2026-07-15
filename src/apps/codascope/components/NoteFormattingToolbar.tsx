/* ── CodaScope: NoteFormattingToolbar ────────────────────────────────
   Fixed toolbar strip rendered between the note header and editor body.
   Provides formatting buttons that dispatch CM6 transactions.

   Buttons show "active" state when cursor is inside the corresponding
   markdown node (uses syntaxTree inspection).

   Accepts `disabled` prop to gray out in read-only mode (version history).

   Window 2: Added highlight color picker and text color picker dropdowns.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState, useRef, useMemo, type RefObject } from "react";
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
  IconTextColor,
  IconClock,
  IconMove,
  IconActivity,
  IconDownload,
  IconArchive,
} from "./CodaScopeIcons";
import {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleInlineCode,
  insertLink,
  setHeadingLevel,
  toggleChecklist,
} from "../../../shared/markdown/extensions/formattingCommands";
import { detectHighlightColors } from "../../../shared/markdown/extensions/highlightExtension";
import { getHighlightApplyEdit } from "../../../shared/markdown/extensions/highlightMarkup";

/* ── Props ───────────────────────────────────────────────────────────── */

interface NoteFormattingToolbarProps {
  /** CM6 EditorView ref for dispatching transactions. */
  editorView: EditorView | null;
  /** Gray out all buttons when viewing version history. */
  disabled?: boolean;
  /** Color wrapping remains explicitly single-selection-only for now. */
  multipleSelections?: boolean;
  /** Note-level commands rendered after the checklist control. */
  onShowVersions: () => void;
  onMoveNote: () => void;
  onToggleActivity: () => void;
  activityOpen: boolean;
  onExportNote: () => void;
  onArchiveNote: () => void;
  archiveDisabled?: boolean;
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

interface FixedMenuPosition {
  top: number;
  left: number;
}

function getFixedMenuPosition(
  trigger: HTMLButtonElement | null,
  menuWidth: number,
  menuHeight: number,
  align: "start" | "end" = "start",
): FixedMenuPosition {
  if (!trigger) return { top: 0, left: 0 };
  const rect = trigger.getBoundingClientRect();
  const gutter = 8;
  const top = rect.bottom + gutter + menuHeight <= window.innerHeight
    ? rect.bottom + gutter
    : Math.max(gutter, rect.top - menuHeight - gutter);
  const desiredLeft = align === "end" ? rect.right - menuWidth : rect.left;
  const left = Math.max(gutter, Math.min(desiredLeft, window.innerWidth - menuWidth - gutter));
  return { top, left };
}

function useFixedMenuPosition(
  open: boolean,
  triggerRef: RefObject<HTMLButtonElement | null>,
  setPosition: (position: FixedMenuPosition) => void,
  menuWidth: number,
  menuHeight: number,
  align: "start" | "end" = "start",
): void {
  useEffect(() => {
    if (!open) return;
    const positionMenu = () => setPosition(getFixedMenuPosition(triggerRef.current, menuWidth, menuHeight, align));
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, triggerRef, setPosition, menuWidth, menuHeight, align]);
}

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
  const edit = getHighlightApplyEdit(state.doc.toString(), range.from, range.to, colorName);
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: EditorSelection.range(edit.selectionFrom, edit.selectionTo),
  });
}

interface TextColorClearEdit {
  from: number;
  to: number;
  insert: string;
  selectionFrom: number;
  selectionTo: number;
}

interface TextColorApplyEdit extends TextColorClearEdit {}

interface ColorSpan {
  from: number;
  to: number;
  hasColor: boolean;
}

const SPAN_TAG_RE = /<(\/)?span\b([^>]*)>/gi;
const STYLE_ATTRIBUTE_RE = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/i;

/**
 * Return a color-free opening tag when the span has a color declaration, or
 * null when it does not. An empty string means the span had no attributes
 * after color removal and can be unwrapped completely.
 */
function getColorFreeOpeningTag(attributes: string): string | null {
  const style = attributes.match(STYLE_ATTRIBUTE_RE);
  if (!style) return null;

  const declarations = (style[2] ?? "")
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean);
  if (!declarations.some((declaration) => /^color\s*:/i.test(declaration))) return null;

  const remainingDeclarations = declarations
    .filter((declaration) => !/^color\s*:/i.test(declaration));
  const replacementAttributes = remainingDeclarations.length > 0
    ? attributes.replace(STYLE_ATTRIBUTE_RE, ` style=${style[1]}${remainingDeclarations.join("; ")}${style[1]}`)
    : attributes.replace(STYLE_ATTRIBUTE_RE, "");

  return replacementAttributes.trim() ? `<span${replacementAttributes}>` : "";
}

/** Parse complete nested span ranges so operations can safely avoid nesting. */
function getColorSpans(documentText: string): ColorSpan[] {
  const spans: ColorSpan[] = [];
  const stack: Array<{ from: number; hasColor: boolean }> = [];

  for (const match of documentText.matchAll(SPAN_TAG_RE)) {
    const fullTag = match[0];
    const from = match.index ?? 0;
    if (match[1]) {
      const opening = stack.pop();
      if (opening) {
        spans.push({
          from: opening.from,
          to: from + fullTag.length,
          hasColor: opening.hasColor,
        });
      }
      continue;
    }

    stack.push({
      from,
      hasColor: getColorFreeOpeningTag(match[2] ?? "") !== null,
    });
  }

  return spans.filter((span) => span.hasColor);
}

/** Remove color declarations from every complete span in a markup fragment. */
function stripTextColorMarkup(markup: string): string {
  let result = "";
  let cursor = 0;
  const closeTagStack: boolean[] = [];

  for (const match of markup.matchAll(SPAN_TAG_RE)) {
    const fullTag = match[0];
    const from = match.index ?? 0;
    result += markup.slice(cursor, from);

    if (match[1]) {
      if (closeTagStack.pop()) result += fullTag;
    } else {
      const replacementOpenTag = getColorFreeOpeningTag(match[2] ?? "");
      if (replacementOpenTag === null) {
        result += fullTag;
        closeTagStack.push(true);
      } else {
        result += replacementOpenTag;
        closeTagStack.push(replacementOpenTag !== "");
      }
    }
    cursor = from + fullTag.length;
  }

  return result + markup.slice(cursor);
}

function getColorTargetRange(
  documentText: string,
  selectionFrom: number,
  selectionTo: number,
): { from: number; to: number } | null {
  const colorSpans = getColorSpans(documentText);
  let from = selectionFrom;
  let to = selectionTo;
  let found = false;
  let changed = true;

  while (changed) {
    changed = false;
    for (const span of colorSpans) {
      const intersects = from === to
        ? from >= span.from && from <= span.to
        : from < span.to && to > span.from;
      if (!intersects) continue;
      found = true;
      const nextFrom = Math.min(from, span.from);
      const nextTo = Math.max(to, span.to);
      if (nextFrom !== from || nextTo !== to) {
        from = nextFrom;
        to = nextTo;
        changed = true;
      }
    }
  }

  return found ? { from, to } : null;
}

/**
 * Normalize a selection before applying a new text color. Existing colors are
 * stripped first, including nested and adjacent spans, so the replacement has
 * exactly one color wrapper.
 */
export function getTextColorApplyEdit(
  documentText: string,
  selectionFrom: number,
  selectionTo: number,
  cssColor: string,
): TextColorApplyEdit {
  const target = getColorTargetRange(documentText, selectionFrom, selectionTo);
  const from = target?.from ?? selectionFrom;
  const to = target?.to ?? selectionTo;
  const selectedMarkup = documentText.slice(from, to);
  const normalizedContent = target ? stripTextColorMarkup(selectedMarkup) : selectedMarkup;
  const content = normalizedContent || "text";
  const openTag = `<span style="color:${cssColor}">`;

  return {
    from,
    to,
    insert: `${openTag}${content}</span>`,
    selectionFrom: from + openTag.length,
    selectionTo: from + openTag.length + content.length,
  };
}

function wrapWithTextColor(view: EditorView, cssColor: string): void {
  const { state } = view;
  const range = state.selection.main;
  const edit = getTextColorApplyEdit(state.doc.toString(), range.from, range.to, cssColor);
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: EditorSelection.range(edit.selectionFrom, edit.selectionTo),
  });
}

/**
 * Return the edit that removes the color wrapper around the current
 * selection. Color markup is deliberately removed rather than replaced with
 * `color: inherit`, so notes continue to use the editor's normal text color
 * in both editing and rendered views.
 */
export function getTextColorClearEdit(
  documentText: string,
  selectionFrom: number,
  selectionTo: number,
): TextColorClearEdit | null {
  const target = getColorTargetRange(documentText, selectionFrom, selectionTo);
  if (!target) return null;
  const insert = stripTextColorMarkup(documentText.slice(target.from, target.to));
  return {
    from: target.from,
    to: target.to,
    insert,
    selectionFrom: target.from,
    selectionTo: target.from + insert.length,
  };
}

function clearTextColor(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const edit = getTextColorClearEdit(state.doc.toString(), range.from, range.to);
  if (!edit) return false;

  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: EditorSelection.range(edit.selectionFrom, edit.selectionTo),
  });
  return true;
}

/* ── Custom highlight colors from settings ───────────────────────────── */

function useSettingsHighlightColors(): ColorSwatch[] {
  const [customColors, setCustomColors] = useState<ColorSwatch[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/codascope/settings/highlight-colors");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (Array.isArray(data.colors) && !cancelled) {
          setCustomColors(
            data.colors.map((c: { name: string; label: string; cssColor: string }) => ({
              name: c.name,
              label: c.label,
              cssColor: c.cssColor,
            })),
          );
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

export function NoteFormattingToolbar({
  editorView,
  disabled = false,
  multipleSelections = false,
  onShowVersions,
  onMoveNote,
  onToggleActivity,
  activityOpen,
  onExportNote,
  onArchiveNote,
  archiveDisabled = false,
}: NoteFormattingToolbarProps) {
  const [active, setActive] = useState<ActiveStates>(defaultActive);
  const [headingOpen, setHeadingOpen] = useState(false);
  const [highlightPickerOpen, setHighlightPickerOpen] = useState(false);
  const [textColorPickerOpen, setTextColorPickerOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [headingMenuPosition, setHeadingMenuPosition] = useState<FixedMenuPosition>({ top: 0, left: 0 });
  const [highlightPickerPosition, setHighlightPickerPosition] = useState<FixedMenuPosition>({ top: 0, left: 0 });
  const [textColorPickerPosition, setTextColorPickerPosition] = useState<FixedMenuPosition>({ top: 0, left: 0 });
  const [actionsMenuPosition, setActionsMenuPosition] = useState<FixedMenuPosition>({ top: 0, left: 0 });
  const headingDropdownRef = useRef<HTMLDivElement>(null);
  const highlightDropdownRef = useRef<HTMLDivElement>(null);
  const textColorDropdownRef = useRef<HTMLDivElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const headingTriggerRef = useRef<HTMLButtonElement>(null);
  const highlightTriggerRef = useRef<HTMLButtonElement>(null);
  const textColorTriggerRef = useRef<HTMLButtonElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);

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
    editorView.dom.addEventListener("keyup", updateActive);
    editorView.dom.addEventListener("mouseup", updateActive);

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

  // Close pickers and the note-actions menu on outside click or Escape.
  useEffect(() => {
    if (!headingOpen && !highlightPickerOpen && !textColorPickerOpen && !actionsOpen) return;
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
      if (actionsOpen && actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (actionsOpen) actionsTriggerRef.current?.focus();
        setHeadingOpen(false);
        setHighlightPickerOpen(false);
        setTextColorPickerOpen(false);
        setActionsOpen(false);
        return;
      }
      if (!actionsOpen || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;

      const items = Array.from(actionsMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []);
      if (items.length === 0) return;
      e.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      if (currentIndex === -1) {
        items[e.key === "ArrowDown" ? 0 : items.length - 1]?.focus();
        return;
      }
      const nextIndex = e.key === "ArrowDown"
        ? (currentIndex + 1 + items.length) % items.length
        : (currentIndex - 1 + items.length) % items.length;
      items[nextIndex]?.focus();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [headingOpen, highlightPickerOpen, textColorPickerOpen, actionsOpen]);

  useEffect(() => {
    if (!actionsOpen) return;
    actionsMenuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
  }, [actionsOpen]);

  useFixedMenuPosition(headingOpen, headingTriggerRef, setHeadingMenuPosition, 140, 240);
  useFixedMenuPosition(highlightPickerOpen, highlightTriggerRef, setHighlightPickerPosition, 180, 150);
  useFixedMenuPosition(textColorPickerOpen, textColorTriggerRef, setTextColorPickerPosition, 180, 250);

  // The toolbar scrolls horizontally, so the Actions menu must be fixed to
  // the trigger rather than clipped inside the toolbar's overflow container.
  useEffect(() => {
    if (!actionsOpen) return;
    const positionMenu = () => {
      setActionsMenuPosition(getFixedMenuPosition(actionsTriggerRef.current, 180, 190, "end"));
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [actionsOpen]);

  // ── Button handlers ────────────────────────────────────────────────

  const withFocusReturn = useCallback((action: (view: EditorView) => boolean) => {
    if (!editorView || disabled) return;
    setActionsOpen(false);
    action(editorView);
    editorView.focus();
  }, [editorView, disabled]);

  const handleBold = useCallback(() => withFocusReturn(toggleBold), [withFocusReturn]);
  const handleItalic = useCallback(() => withFocusReturn(toggleItalic), [withFocusReturn]);
  const handleStrikethrough = useCallback(() => withFocusReturn(toggleStrikethrough), [withFocusReturn]);
  const handleInlineCode = useCallback(() => withFocusReturn(toggleInlineCode), [withFocusReturn]);
  const handleHighlight = useCallback(() => {
    if (disabled || multipleSelections) return;
    setActionsOpen(false);
    setHeadingOpen(false);
    setHighlightPickerOpen((open) => !open);
    setTextColorPickerOpen(false);
  }, [disabled, multipleSelections]);
  const handleLink = useCallback(() => withFocusReturn(insertLink), [withFocusReturn]);
  const handleChecklist = useCallback(() => withFocusReturn(toggleChecklist), [withFocusReturn]);

  const handleHeadingSelect = useCallback((level: number) => {
    if (!editorView || disabled) return;
    setHeadingLevel(editorView, level);
    editorView.focus();
    setHeadingOpen(false);
  }, [editorView, disabled]);

  const handleHighlightColor = useCallback((colorName: string) => {
    if (!editorView || disabled || multipleSelections) return;
    wrapWithHighlightColor(editorView, colorName);
    editorView.focus();
    setHighlightPickerOpen(false);
  }, [editorView, disabled, multipleSelections]);

  const handleTextColor = useCallback((cssColor: string) => {
    if (!editorView || disabled || multipleSelections) return;
    wrapWithTextColor(editorView, cssColor);
    editorView.focus();
    setTextColorPickerOpen(false);
  }, [editorView, disabled, multipleSelections]);

  const handleClearTextColor = useCallback(() => {
    if (!editorView || disabled || multipleSelections) return;
    clearTextColor(editorView);
    editorView.focus();
    setTextColorPickerOpen(false);
  }, [editorView, disabled, multipleSelections]);

  // ── Current heading label ──────────────────────────────────────────

  const currentHeadingLabel = active.headingLevel > 0
    ? `H${active.headingLevel}`
    : "¶";

  return (
    <div className={`codascope-notes-formatting-toolbar${disabled ? " codascope-notes-formatting-toolbar-disabled" : ""}`}>
      {/* Heading dropdown */}
      <div className="codascope-notes-formatting-group" ref={headingDropdownRef}>
        <button
          ref={headingTriggerRef}
          className={`codascope-notes-formatting-btn codascope-notes-formatting-btn-heading${active.headingLevel > 0 ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={() => {
            setActionsOpen(false);
            setHighlightPickerOpen(false);
            setTextColorPickerOpen(false);
            setHeadingOpen((o) => !o);
          }}
          disabled={disabled}
          type="button"
          title="Heading level"
        >
          <IconHeading size={14} />
          <span className="codascope-notes-formatting-btn-label">{currentHeadingLabel}</span>
          <IconChevronDown size={10} />
        </button>

        {headingOpen && (
          <div className="codascope-notes-formatting-dropdown" style={headingMenuPosition}>
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
      <div className="codascope-notes-formatting-group" ref={highlightDropdownRef}>
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
          ref={highlightTriggerRef}
          className={`codascope-notes-formatting-btn${active.highlight || highlightPickerOpen ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={handleHighlight}
          disabled={disabled || multipleSelections}
          type="button"
          title={multipleSelections ? "Highlight colors support one selection at a time" : "Highlight (⌘⇧H)"}
        >
          <IconHighlight size={14} />
        </button>

        {highlightPickerOpen && (
          <div className="codascope-notes-formatting-color-picker" style={highlightPickerPosition}>
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

      <div className="codascope-notes-formatting-divider" />

      {/* Color pickers group */}
      <div className="codascope-notes-formatting-group" ref={textColorDropdownRef}>
        <button
          ref={textColorTriggerRef}
          className={`codascope-notes-formatting-btn${textColorPickerOpen ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={() => {
            setActionsOpen(false);
            setHeadingOpen(false);
            setTextColorPickerOpen((o) => !o);
            setHighlightPickerOpen(false);
          }}
          disabled={disabled || multipleSelections}
          type="button"
          title={multipleSelections ? "Text colors support one selection at a time" : "Text color"}
        >
          <IconTextColor size={14} />
          <IconChevronDown size={8} />
        </button>

        {textColorPickerOpen && (
          <div className="codascope-notes-formatting-color-picker" style={textColorPickerPosition}>
            <div className="codascope-notes-formatting-color-picker-label">Text Color</div>
            <button
              className="codascope-notes-formatting-color-default"
              onClick={handleClearTextColor}
              title="Restore the selected text to the default color"
              type="button"
            >
              <IconTextColor size={13} />
              Default
            </button>
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

      {/* Less-frequent note commands remain visible through one labeled menu. */}
      <div className="codascope-notes-formatting-group" ref={actionsMenuRef}>
        <button
          ref={actionsTriggerRef}
          className={`codascope-notes-formatting-btn codascope-notes-formatting-actions-trigger${actionsOpen ? " codascope-notes-formatting-btn-active" : ""}`}
          onClick={() => {
            setActionsOpen((open) => !open);
            setHeadingOpen(false);
            setHighlightPickerOpen(false);
            setTextColorPickerOpen(false);
          }}
          disabled={disabled}
          type="button"
          aria-haspopup="menu"
          aria-expanded={actionsOpen}
          aria-controls="codascope-note-actions-menu"
        >
          Actions <IconChevronDown size={10} />
        </button>

        {actionsOpen && (
          <div
            id="codascope-note-actions-menu"
            className="codascope-notes-formatting-actions-menu"
            role="menu"
            aria-label="Note actions"
            style={actionsMenuPosition}
          >
            <button className="codascope-notes-formatting-actions-menu-item" onClick={() => { setActionsOpen(false); onShowVersions(); }} role="menuitem" type="button">
              <IconClock size={14} /> Version history
            </button>
            <button className="codascope-notes-formatting-actions-menu-item" onClick={() => { setActionsOpen(false); onMoveNote(); }} role="menuitem" type="button">
              <IconMove size={14} /> Move note
            </button>
            <button
              className={`codascope-notes-formatting-actions-menu-item${activityOpen ? " codascope-notes-formatting-actions-menu-item-active" : ""}`}
              onClick={() => { setActionsOpen(false); onToggleActivity(); }}
              role="menuitem"
              type="button"
            >
              <IconActivity size={14} /> {activityOpen ? "Hide activity" : "View activity"}
            </button>
            <button className="codascope-notes-formatting-actions-menu-item" onClick={() => { setActionsOpen(false); onExportNote(); }} role="menuitem" type="button">
              <IconDownload size={14} /> Export note
            </button>
            <div className="codascope-notes-formatting-actions-menu-divider" role="separator" />
            <button
              className="codascope-notes-formatting-actions-menu-item codascope-notes-formatting-actions-menu-item-archive"
              onClick={() => { setActionsOpen(false); onArchiveNote(); }}
              disabled={archiveDisabled}
              role="menuitem"
              type="button"
            >
              <IconArchive size={14} /> Archive note
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
