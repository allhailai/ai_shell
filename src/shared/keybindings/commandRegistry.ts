import { Prec } from "@codemirror/state";
import type { Command, KeyBinding } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { addCursorAbove, addCursorBelow, simplifySelection } from "@codemirror/commands";
import {
  findNext,
  findPrevious,
  openSearchPanel,
  selectMatches,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import {
  insertLink,
  toggleBold,
  toggleHighlight,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough,
} from "../markdown/extensions/formattingCommands";
import { shortcutKey, validateShortcut } from "./shortcut";
import type { CommandOverride, KeybindingProfile, Shortcut } from "./types";

export interface KeybindingCommand {
  id: string;
  label: string;
  description: string;
  category: string;
  /** Commands only run while an editable shared MarkdownEditor owns focus. */
  editableOnly: true;
  defaultShortcuts: Shortcut[];
  run: Command;
  /** Kept out of the first editor UI while still using the common registry. */
  settingsVisible?: boolean;
}

const shortcut = (stroke: string): Shortcut => ({ strokes: [stroke] });

export const markdownKeybindingCommands: KeybindingCommand[] = [
  {
    id: "markdown.addCursorAbove",
    label: "Add cursor above",
    description: "Add a cursor on the line above.",
    category: "Multi-cursor",
    editableOnly: true,
    defaultShortcuts: [shortcut("Mod-Alt-ArrowUp")],
    run: addCursorAbove,
    settingsVisible: true,
  },
  {
    id: "markdown.addCursorBelow",
    label: "Add cursor below",
    description: "Add a cursor on the line below.",
    category: "Multi-cursor",
    editableOnly: true,
    defaultShortcuts: [shortcut("Mod-Alt-ArrowDown")],
    run: addCursorBelow,
    settingsVisible: true,
  },
  {
    id: "markdown.selectNextOccurrence",
    label: "Select next occurrence",
    description: "Add the next matching occurrence to the selection.",
    category: "Multi-cursor",
    editableOnly: true,
    defaultShortcuts: [shortcut("Mod-d")],
    run: selectNextOccurrence,
    settingsVisible: true,
  },
  {
    id: "markdown.selectAllOccurrences",
    label: "Select all occurrences",
    description: "Select every occurrence of the current selection.",
    category: "Multi-cursor",
    editableOnly: true,
    defaultShortcuts: [shortcut("Mod-Shift-l")],
    run: selectSelectionMatches,
    settingsVisible: true,
  },
  {
    id: "markdown.selectAllSearchMatches",
    label: "Select all search matches",
    description: "Turn current search matches into multiple selections.",
    category: "Search",
    editableOnly: true,
    defaultShortcuts: [],
    run: selectMatches,
    settingsVisible: true,
  },
  {
    id: "markdown.openSearch",
    label: "Open search",
    description: "Open the in-note search panel.",
    category: "Search",
    editableOnly: true,
    defaultShortcuts: [shortcut("Mod-f")],
    run: openSearchPanel,
    settingsVisible: true,
  },
  {
    id: "markdown.findNext",
    label: "Find next",
    description: "Move to the next in-note search result.",
    category: "Search",
    editableOnly: true,
    defaultShortcuts: [shortcut("F3"), shortcut("Mod-g")],
    run: findNext,
    settingsVisible: true,
  },
  {
    id: "markdown.findPrevious",
    label: "Find previous",
    description: "Move to the previous in-note search result.",
    category: "Search",
    editableOnly: true,
    defaultShortcuts: [shortcut("Shift-F3"), shortcut("Mod-Shift-g")],
    run: findPrevious,
    settingsVisible: true,
  },
  {
    id: "markdown.exitMultipleSelections",
    label: "Exit multiple selections",
    description: "Return to one selection.",
    category: "Multi-cursor",
    editableOnly: true,
    defaultShortcuts: [shortcut("Escape")],
    run: simplifySelection,
    settingsVisible: true,
  },
  // The existing formatting actions share this registry now, so a later UI
  // category can expose overrides without another MarkdownEditor rewrite.
  { id: "markdown.format.bold", label: "Bold", description: "Toggle bold markdown.", category: "Formatting", editableOnly: true, defaultShortcuts: [shortcut("Mod-b")], run: toggleBold },
  { id: "markdown.format.italic", label: "Italic", description: "Toggle italic markdown.", category: "Formatting", editableOnly: true, defaultShortcuts: [shortcut("Mod-i")], run: toggleItalic },
  { id: "markdown.format.strikethrough", label: "Strikethrough", description: "Toggle strikethrough markdown.", category: "Formatting", editableOnly: true, defaultShortcuts: [shortcut("Mod-Shift-x")], run: toggleStrikethrough },
  { id: "markdown.format.inlineCode", label: "Inline code", description: "Toggle inline code markdown.", category: "Formatting", editableOnly: true, defaultShortcuts: [shortcut("Mod-e")], run: toggleInlineCode },
  { id: "markdown.format.highlight", label: "Highlight", description: "Toggle highlight markdown.", category: "Formatting", editableOnly: true, defaultShortcuts: [shortcut("Mod-Shift-h")], run: toggleHighlight },
  { id: "markdown.format.link", label: "Link", description: "Insert a markdown link.", category: "Formatting", editableOnly: true, defaultShortcuts: [shortcut("Mod-k")], run: insertLink },
];

const commandById = new Map(markdownKeybindingCommands.map((command) => [command.id, command]));

export function getKeybindingCommand(id: string): KeybindingCommand | undefined {
  return commandById.get(id);
}

export function visibleKeybindingCommands(): KeybindingCommand[] {
  return markdownKeybindingCommands.filter((command) => command.settingsVisible === true);
}

export interface KeybindingConflict {
  shortcut: Shortcut;
  commandIds: string[];
}

export function resolvedShortcuts(command: KeybindingCommand, profile: KeybindingProfile): Shortcut[] {
  const override = profile.bindings[command.id];
  if (!override) return command.defaultShortcuts;
  return override.mode === "custom" ? override.shortcuts : [];
}

/** Find conflicts only among executable known commands in the same editor scope. */
export function findKeybindingConflicts(profile: KeybindingProfile): KeybindingConflict[] {
  const owners = new Map<string, { shortcut: Shortcut; commandIds: string[] }>();
  for (const command of markdownKeybindingCommands) {
    for (const assigned of resolvedShortcuts(command, profile)) {
      const validation = validateShortcut(assigned);
      if (!validation.shortcut) continue;
      const key = shortcutKey(validation.shortcut);
      const entry = owners.get(key) ?? { shortcut: validation.shortcut, commandIds: [] };
      entry.commandIds.push(command.id);
      owners.set(key, entry);
    }
  }
  return [...owners.values()]
    .filter((entry) => entry.commandIds.length > 1)
    .map((entry) => ({ shortcut: entry.shortcut, commandIds: entry.commandIds }));
}

/**
 * Produce the high-precedence CodeMirror map for editable MarkdownEditor
 * instances. User assignments are emitted before blockers; blockers consume
 * old defaults only when another resolved command did not claim that stroke.
 */
export function resolveMarkdownEditorKeymap(profile: KeybindingProfile) {
  return Prec.highest(keymap.of(resolveMarkdownEditorBindings(profile)));
}

/** Exposed separately for deterministic validation and focused tests. */
export function resolveMarkdownEditorBindings(profile: KeybindingProfile): KeyBinding[] {
  const bindings: KeyBinding[] = [];
  const assigned = new Set<string>();

  for (const command of markdownKeybindingCommands) {
    for (const candidate of resolvedShortcuts(command, profile)) {
      const validation = validateShortcut(candidate);
      if (!validation.shortcut) continue;
      const key = shortcutKey(validation.shortcut);
      if (assigned.has(key)) continue;
      assigned.add(key);
      bindings.push({ key, run: command.run, preventDefault: true });
    }
  }

  for (const command of markdownKeybindingCommands) {
    const override: CommandOverride | undefined = profile.bindings[command.id];
    if (!override) continue;
    for (const defaultShortcut of command.defaultShortcuts) {
      const key = shortcutKey(defaultShortcut);
      if (assigned.has(key)) continue;
      assigned.add(key);
      bindings.push({ key, run: () => true, preventDefault: true });
    }
  }

  return bindings;
}
