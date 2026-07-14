/* ── Shared keybinding profile contract ──────────────────────────────── */

/** A shortcut is modelled as strokes now so profiles can grow into chords. */
export interface Shortcut {
  strokes: string[];
}

export type CommandOverride =
  | { mode: "custom"; shortcuts: Shortcut[] }
  | { mode: "disabled" };

/** Persisted per-user command overrides. Missing IDs use registry defaults. */
export interface KeybindingProfile {
  schemaVersion: 1;
  bindings: Record<string, CommandOverride>;
}

export const KEYBINDING_PROFILE_SCHEMA_VERSION = 1 as const;

export const EMPTY_KEYBINDING_PROFILE: KeybindingProfile = {
  schemaVersion: KEYBINDING_PROFILE_SCHEMA_VERSION,
  bindings: {},
};

export type KeybindingPlatform = "mac" | "windows" | "linux";

export interface PortableKeybindingProfile {
  format: "aishell.keybindings";
  version: 1;
  exportedAt: string;
  bindings: Record<string, CommandOverride>;
}
