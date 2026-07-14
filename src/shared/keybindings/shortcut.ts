import type { KeybindingPlatform, Shortcut } from "./types";

const MODIFIER_ORDER = ["Mod", "Ctrl", "Alt", "Shift"] as const;
const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  cmd: "Mod",
  command: "Mod",
  meta: "Mod",
  mod: "Mod",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};

const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  space: "Space",
  spacebar: "Space",
  up: "ArrowUp",
  arrowup: "ArrowUp",
  down: "ArrowDown",
  arrowdown: "ArrowDown",
  left: "ArrowLeft",
  arrowleft: "ArrowLeft",
  right: "ArrowRight",
  arrowright: "ArrowRight",
  return: "Enter",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  tab: "Tab",
};

const NAMED_KEYS = new Set([
  "Escape", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Enter", "Backspace", "Delete", "Tab", "Home", "End", "PageUp", "PageDown",
]);

/** Browser and OS combinations that must never be claimed by editor keymaps. */
const RESERVED_SHORTCUTS = new Set([
  "Mod-a", "Mod-c", "Mod-v", "Mod-x", "Mod-z", "Mod-Shift-z", "Mod-f", "Mod-g", "Mod-Shift-g",
  "Mod-r", "Mod-l", "Mod-t", "Mod-w", "Mod-n", "Mod-q", "Mod-p", "Mod-s", "Mod-o", "Mod-Shift-n",
  "Mod-Shift-t", "Mod-Tab", "Mod-Space", "Mod-Alt-Escape", "Alt-Tab", "Alt-F4", "Ctrl-Alt-Delete",
  "Alt-ArrowLeft", "Alt-ArrowRight", "F5", "Mod-Shift-i", "Mod-Alt-i", "Mod-Alt-j",
]);

export interface ShortcutValidation {
  shortcut?: Shortcut;
  error?: string;
  reserved?: boolean;
}

export function detectKeybindingPlatform(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): KeybindingPlatform {
  if (/Mac|iPhone|iPad|iPod/i.test(userAgent)) return "mac";
  if (/Windows/i.test(userAgent)) return "windows";
  return "linux";
}

function canonicalKey(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (/^f(?:[1-9]|1[0-2])$/i.test(normalized)) return normalized.toUpperCase();
  if (/^[a-z]$/i.test(normalized)) return normalized.toLowerCase();
  if (NAMED_KEYS.has(normalized)) return normalized;
  return null;
}

/** Parse a single CodeMirror-style stroke into a canonical portable string. */
export function normalizeStroke(input: string): ShortcutValidation {
  const parts = input.split("-").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { error: "Enter a shortcut." };

  const modifiers = new Set<string>();
  let key: string | null = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    if (key) return { error: "A shortcut can only contain one non-modifier key." };
    key = canonicalKey(part);
    if (!key) return { error: `Unsupported key: ${part}.` };
  }

  if (!key) return { error: "A shortcut needs a non-modifier key." };
  if (/^[a-z]$/.test(key) && modifiers.size === 0) {
    return { error: "Printable keys need a modifier." };
  }

  const stroke = [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join("-");
  if (RESERVED_SHORTCUTS.has(stroke)) {
    return { error: "This shortcut is reserved by the browser or operating system.", reserved: true };
  }
  return { shortcut: { strokes: [stroke] } };
}

/** Capture a browser keyboard event without adding any document-global listener. */
export function captureKeyboardShortcut(event: KeyboardEvent, platform = detectKeybindingPlatform()): ShortcutValidation {
  const key = event.key === " " ? "Space" : event.key;
  if (["Meta", "Control", "Alt", "Shift"].includes(key)) {
    return { error: "Press a non-modifier key together with the modifier." };
  }

  const parts: string[] = [];
  if (event.metaKey) parts.push("Mod");
  if (event.ctrlKey) parts.push(platform === "mac" ? "Ctrl" : "Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return normalizeStroke(parts.join("-"));
}

export function validateShortcut(shortcut: Shortcut): ShortcutValidation {
  if (!Array.isArray(shortcut.strokes) || shortcut.strokes.length !== 1) {
    return { error: "Only one keystroke is supported today; chords are reserved for a future release." };
  }
  return normalizeStroke(shortcut.strokes[0] ?? "");
}

export function shortcutKey(shortcut: Shortcut): string {
  return shortcut.strokes.join(" ");
}

export function formatShortcut(shortcut: Shortcut, platform = detectKeybindingPlatform()): string {
  const stroke = shortcut.strokes[0] ?? "";
  const parts = stroke.split("-");
  const key = parts.pop() ?? "";
  const keyDisplay: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", Space: "Space",
  };
  const displayKey = keyDisplay[key] ?? key.toUpperCase();

  if (platform === "mac") {
    const symbols: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
    return `${parts.map((part) => symbols[part] ?? part).join("")}${displayKey}`;
  }
  const labels: Record<string, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
  return [...parts.map((part) => labels[part] ?? part), displayKey].join("+");
}
