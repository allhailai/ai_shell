/* ── AIShell user settings persistence ─────────────────────────────────
   Per-user profiles are isolated below AISHELL_DATA_DIR/user-settings and
   are written atomically. CodaScope is intentionally not involved.
   ──────────────────────────────────────────────────────────────────── */

import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Shortcut { strokes: string[]; }
export type CommandOverride = { mode: "custom"; shortcuts: Shortcut[] } | { mode: "disabled" };
export interface KeybindingProfile { schemaVersion: 1; bindings: Record<string, CommandOverride>; }
export interface PortableKeybindingProfile {
  format: "aishell.keybindings";
  version: 1;
  exportedAt: string;
  bindings: Record<string, CommandOverride>;
}

export const EMPTY_KEYBINDING_PROFILE: KeybindingProfile = { schemaVersion: 1, bindings: {} };
export const MAX_PROFILE_BYTES = 100_000;
export const MAX_BINDINGS = 200;
export const MAX_SHORTCUTS_PER_COMMAND = 4;

const COMMAND_ID = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)?(?:\.[a-z][a-zA-Z0-9]*)+$/;
const KNOWN_COMMAND_IDS = new Set([
  "markdown.addCursorAbove", "markdown.addCursorBelow", "markdown.selectNextOccurrence",
  "markdown.selectAllOccurrences", "markdown.selectAllSearchMatches", "markdown.exitMultipleSelections",
  "markdown.format.bold", "markdown.format.italic", "markdown.format.strikethrough",
  "markdown.format.inlineCode", "markdown.format.highlight", "markdown.format.link",
]);
const STROKE = /^(?:(?:Mod|Ctrl|Alt|Shift)-)*(?:[a-z]|F(?:[1-9]|1[0-2])|Escape|Space|Arrow(?:Up|Down|Left|Right)|Enter|Backspace|Delete|Tab|Home|End|PageUp|PageDown)$/;
const MODIFIER_ORDER = ["Mod", "Ctrl", "Alt", "Shift"];
const RESERVED = new Set([
  "Mod-a", "Mod-c", "Mod-v", "Mod-x", "Mod-z", "Mod-Shift-z", "Mod-f", "Mod-g", "Mod-Shift-g",
  "Mod-r", "Mod-l", "Mod-t", "Mod-w", "Mod-n", "Mod-q", "Mod-p", "Mod-s", "Mod-o", "Mod-Shift-n",
  "Mod-Shift-t", "Mod-Tab", "Mod-Space", "Mod-Alt-Escape", "Alt-Tab", "Alt-F4", "Ctrl-Alt-Delete",
  "Alt-ArrowLeft", "Alt-ArrowRight", "F5", "Mod-Shift-i", "Mod-Alt-i", "Mod-Alt-j",
]);

export class UserSettingsError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 400) {
    super(message);
  }
}

interface ReadResult {
  profile: KeybindingProfile;
  revision: string;
  recoverableError?: string;
  malformed?: boolean;
}

export interface ImportPreview {
  profile: KeybindingProfile;
  added: string[];
  changed: string[];
  disabled: string[];
  reset: string[];
  conflicting: Array<{ shortcut: string; commandIds: string[] }>;
  unavailable: string[];
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function revisionFor(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function cloneDefault(): KeybindingProfile {
  return { schemaVersion: 1, bindings: {} };
}

function equalOverride(a: CommandOverride | undefined, b: CommandOverride | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function assertSafeUsername(username: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(username)) {
    throw new UserSettingsError("Invalid authenticated username.", "invalid_username", 400);
  }
  return username;
}

function validateOverride(value: unknown, commandId: string): CommandOverride {
  if (!value || typeof value !== "object") throw new UserSettingsError(`Invalid override for ${commandId}.`, "invalid_profile");
  const override = value as { mode?: unknown; shortcuts?: unknown };
  if (override.mode === "disabled") return { mode: "disabled" };
  if (override.mode !== "custom" || !Array.isArray(override.shortcuts) || override.shortcuts.length === 0 || override.shortcuts.length > MAX_SHORTCUTS_PER_COMMAND) {
    throw new UserSettingsError(`Invalid custom shortcuts for ${commandId}.`, "invalid_profile");
  }
  const shortcuts = override.shortcuts.map((candidate): Shortcut => {
    if (!candidate || typeof candidate !== "object" || !Array.isArray((candidate as Shortcut).strokes) || (candidate as Shortcut).strokes.length !== 1) {
      throw new UserSettingsError(`Only one valid keystroke is supported for ${commandId}.`, "invalid_shortcut");
    }
    const stroke = (candidate as Shortcut).strokes[0];
    if (typeof stroke !== "string" || !STROKE.test(stroke) || !isCanonicalStroke(stroke) || RESERVED.has(stroke)) {
      throw new UserSettingsError(`Invalid or reserved shortcut for ${commandId}.`, "invalid_shortcut");
    }
    const parts = stroke.split("-");
    if (/^[a-z]$/.test(parts.at(-1) ?? "") && parts.length === 1) {
      throw new UserSettingsError(`Printable shortcuts need a modifier for ${commandId}.`, "invalid_shortcut");
    }
    return { strokes: [stroke] };
  });
  return { mode: "custom", shortcuts };
}

function isCanonicalStroke(stroke: string): boolean {
  const parts = stroke.split("-");
  const modifiers = parts.slice(0, -1);
  let previous = -1;
  for (const modifier of modifiers) {
    const index = MODIFIER_ORDER.indexOf(modifier);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

/** Validate format, limits and syntax. Unknown but valid command IDs are retained. */
export function validateKeybindingProfile(value: unknown): KeybindingProfile {
  const serialized = JSON.stringify(value);
  if (!serialized || Buffer.byteLength(serialized, "utf8") > MAX_PROFILE_BYTES) {
    throw new UserSettingsError("Keybinding profile is too large.", "profile_too_large");
  }
  if (!value || typeof value !== "object") throw new UserSettingsError("Invalid keybinding profile.", "invalid_profile");
  const candidate = value as { schemaVersion?: unknown; bindings?: unknown };
  if (candidate.schemaVersion !== 1 || !candidate.bindings || typeof candidate.bindings !== "object" || Array.isArray(candidate.bindings)) {
    throw new UserSettingsError("Unsupported keybinding profile schema.", "invalid_profile");
  }
  const entries = Object.entries(candidate.bindings as Record<string, unknown>);
  if (entries.length > MAX_BINDINGS) throw new UserSettingsError("Too many keybinding overrides.", "invalid_profile");
  const bindings: Record<string, CommandOverride> = {};
  for (const [id, override] of entries) {
    if (!COMMAND_ID.test(id)) throw new UserSettingsError(`Invalid command ID: ${id}.`, "invalid_profile");
    bindings[id] = validateOverride(override, id);
  }
  return { schemaVersion: 1, bindings };
}

function defaultShortcutByCommand(commandId: string): string[] {
  const defaults: Record<string, string[]> = {
    "markdown.addCursorAbove": ["Mod-Alt-ArrowUp"],
    "markdown.addCursorBelow": ["Mod-Alt-ArrowDown"],
    "markdown.selectNextOccurrence": ["Mod-d"],
    "markdown.selectAllOccurrences": ["Mod-Shift-l"],
    "markdown.exitMultipleSelections": ["Escape"],
    "markdown.format.bold": ["Mod-b"],
    "markdown.format.italic": ["Mod-i"],
    "markdown.format.strikethrough": ["Mod-Shift-x"],
    "markdown.format.inlineCode": ["Mod-e"],
    "markdown.format.highlight": ["Mod-Shift-h"],
    "markdown.format.link": ["Mod-k"],
  };
  return defaults[commandId] ?? [];
}

export function findProfileConflicts(profile: KeybindingProfile): Array<{ shortcut: string; commandIds: string[] }> {
  const owners = new Map<string, string[]>();
  for (const commandId of KNOWN_COMMAND_IDS) {
    const override = profile.bindings[commandId];
    const strokes = !override ? defaultShortcutByCommand(commandId)
      : override.mode === "custom" ? override.shortcuts.map((shortcut) => shortcut.strokes[0] ?? "") : [];
    for (const stroke of strokes) owners.set(stroke, [...(owners.get(stroke) ?? []), commandId]);
  }
  return [...owners.entries()]
    .filter(([, commandIds]) => commandIds.length > 1)
    .map(([shortcut, commandIds]) => ({ shortcut, commandIds }));
}

export function validatePortableKeybindingProfile(value: unknown): { profile: KeybindingProfile; unavailable: string[] } {
  if (!value || typeof value !== "object") throw new UserSettingsError("Invalid keybinding import.", "invalid_import");
  const document = value as Partial<PortableKeybindingProfile>;
  if (document.format !== "aishell.keybindings" || document.version !== 1 || typeof document.exportedAt !== "string") {
    throw new UserSettingsError("Unsupported keybinding import format.", "invalid_import");
  }
  const profile = validateKeybindingProfile({ schemaVersion: 1, bindings: document.bindings });
  return { profile, unavailable: Object.keys(profile.bindings).filter((id) => !KNOWN_COMMAND_IDS.has(id)).sort() };
}

export function createPortableKeybindingExport(profile: KeybindingProfile, exportedAt: string): PortableKeybindingProfile {
  const sortedBindings = Object.fromEntries(Object.entries(profile.bindings).sort(([a], [b]) => a.localeCompare(b)));
  return { format: "aishell.keybindings", version: 1, exportedAt, bindings: sortedBindings };
}

interface UserSettingsFileOperations {
  writeFile?: typeof writeFile;
  rename?: typeof rename;
}

export class AiShellUserSettingsService {
  private readonly writeQueues = new Map<string, Promise<unknown>>();
  private readonly writeFileOperation: typeof writeFile;
  private readonly renameOperation: typeof rename;

  constructor(private readonly dataDir: string, operations: UserSettingsFileOperations = {}) {
    this.writeFileOperation = operations.writeFile ?? writeFile;
    this.renameOperation = operations.rename ?? rename;
  }

  private directory(): string { return path.join(this.dataDir, "user-settings"); }
  private filePath(username: string): string { return path.join(this.directory(), `${assertSafeUsername(username)}.json`); }

  private async read(username: string): Promise<ReadResult> {
    const filePath = this.filePath(username);
    try {
      const content = await readFile(filePath, "utf8");
      try {
        return { profile: validateKeybindingProfile(JSON.parse(content)), revision: revisionFor(content) };
      } catch (error) {
        const recoverableError = error instanceof Error ? error.message : "Malformed keybinding settings file.";
        return { profile: cloneDefault(), revision: `malformed:${revisionFor(content)}`, recoverableError, malformed: true };
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const content = canonicalJson(EMPTY_KEYBINDING_PROFILE);
        return { profile: cloneDefault(), revision: revisionFor(content) };
      }
      throw error;
    }
  }

  async get(username: string): Promise<ReadResult> {
    return this.read(username);
  }

  private async writeAtomically(filePath: string, profile: KeybindingProfile): Promise<string> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const content = canonicalJson(profile);
    const tempPath = `${filePath}.tmp.${randomUUID()}`;
    try {
      await this.writeFileOperation(tempPath, content, { encoding: "utf8", mode: 0o600 });
      await this.renameOperation(tempPath, filePath);
    } catch (error) {
      // The original is left untouched if a temporary write or rename fails.
      throw error;
    }
    return revisionFor(content);
  }

  private async preserveMalformed(filePath: string): Promise<void> {
    try {
      const suffix = (await stat(filePath)).mtimeMs.toFixed(0);
      await copyFile(filePath, `${filePath}.malformed.${suffix}`);
    } catch {
      // A failed backup must not let a corrupt original be overwritten.
      throw new UserSettingsError("Could not preserve malformed keybinding settings for recovery.", "recovery_backup_failed", 500);
    }
  }

  async save(username: string, profileInput: unknown, expectedRevision: unknown): Promise<{ profile: KeybindingProfile; revision: string }> {
    const profile = validateKeybindingProfile(profileInput);
    if (typeof expectedRevision !== "string" || expectedRevision.length === 0) {
      throw new UserSettingsError("A settings revision is required to save.", "missing_revision", 400);
    }
    const safeUsername = assertSafeUsername(username);
    const previous = this.writeQueues.get(safeUsername) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const current = await this.read(safeUsername);
      if (current.revision !== expectedRevision) {
        throw new UserSettingsError("Keybindings changed in another tab. Reload before saving.", "revision_conflict", 409);
      }
      const filePath = this.filePath(safeUsername);
      if (current.malformed) await this.preserveMalformed(filePath);
      const revision = await this.writeAtomically(filePath, profile);
      return { profile, revision };
    });
    this.writeQueues.set(safeUsername, operation);
    try {
      return await operation;
    } finally {
      if (this.writeQueues.get(safeUsername) === operation) this.writeQueues.delete(safeUsername);
    }
  }

  async previewImport(username: string, document: unknown, mode: unknown): Promise<ImportPreview> {
    const { profile: imported, unavailable } = validatePortableKeybindingProfile(document);
    const current = await this.read(username);
    const replace = mode === "replace";
    const profile: KeybindingProfile = replace
      ? imported
      : { schemaVersion: 1, bindings: { ...current.profile.bindings, ...imported.bindings } };
    const added: string[] = [];
    const changed: string[] = [];
    const disabled: string[] = [];
    const reset: string[] = [];
    const ids = new Set([...Object.keys(current.profile.bindings), ...Object.keys(profile.bindings)]);
    for (const id of ids) {
      const before = current.profile.bindings[id];
      const after = profile.bindings[id];
      if (!before && after) added.push(id);
      else if (before && !after) reset.push(id);
      else if (!equalOverride(before, after)) changed.push(id);
      if (after?.mode === "disabled" && before?.mode !== "disabled") disabled.push(id);
    }
    return {
      profile,
      added: added.sort(), changed: changed.sort(), disabled: disabled.sort(), reset: reset.sort(),
      conflicting: findProfileConflicts(profile), unavailable,
    };
  }
}
