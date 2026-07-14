import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  EMPTY_KEYBINDING_PROFILE,
  captureKeyboardShortcut,
  detectKeybindingPlatform,
  findKeybindingConflicts,
  formatShortcut,
  shortcutKey,
  validateShortcut,
  visibleKeybindingCommands,
  type CommandOverride,
  type KeybindingCommand,
  type KeybindingProfile,
  type PortableKeybindingProfile,
  type Shortcut,
} from "../../shared/keybindings";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import { useUserSettings } from "../../shell/userSettingsContext";

type ImportMode = "merge" | "replace";

interface ImportPreview {
  profile: KeybindingProfile;
  added: string[];
  changed: string[];
  disabled: string[];
  reset: string[];
  conflicting: Array<{ shortcut: string; commandIds: string[] }>;
  unavailable: string[];
}

interface PendingReplacement {
  commandId: string;
  shortcut: Shortcut;
  conflicts: string[];
}

function cloneProfile(profile: KeybindingProfile): KeybindingProfile {
  return JSON.parse(JSON.stringify(profile)) as KeybindingProfile;
}

function overridesEqual(a: KeybindingProfile, b: KeybindingProfile): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function commandName(id: string): string {
  return visibleKeybindingCommands().find((command) => command.id === id)?.label ?? id;
}

export function SettingsContent() {
  const { subPath, replace } = useAppSubRoute("settings");

  useEffect(() => {
    if (!subPath) replace("keybindings");
  }, [subPath, replace]);

  if (subPath && subPath !== "keybindings") {
    return (
      <div className="settings-page">
        <div className="settings-page-inner settings-empty-route">
          <h1>Settings</h1>
          <p>This settings page is not available.</p>
          <button className="settings-btn settings-btn-primary" onClick={() => replace("keybindings")} type="button">Open keybindings</button>
        </div>
      </div>
    );
  }

  return <KeybindingsSection />;
}

function KeybindingsSection() {
  const { keybindings, revision, isLoading, recoverableError, reload, saveKeybindings } = useUserSettings();
  const [draft, setDraft] = useState<KeybindingProfile>(keybindings);
  const [query, setQuery] = useState("");
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<PendingReplacement | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const platform = useMemo(() => detectKeybindingPlatform(), []);

  useEffect(() => {
    setDraft(cloneProfile(keybindings));
    setSaveError(null);
  }, [keybindings, revision]);

  const dirty = !overridesEqual(draft, keybindings);
  const commands = useMemo(() => visibleKeybindingCommands().filter((command) => {
    const needle = query.trim().toLowerCase();
    return !needle || `${command.label} ${command.description} ${command.category}`.toLowerCase().includes(needle);
  }), [query]);
  const grouped = useMemo(() => {
    const categories = new Map<string, KeybindingCommand[]>();
    for (const command of commands) {
      categories.set(command.category, [...(categories.get(command.category) ?? []), command]);
    }
    return [...categories.entries()];
  }, [commands]);

  const updateOverride = useCallback((commandId: string, override: CommandOverride | undefined) => {
    setDraft((previous) => {
      const bindings = { ...previous.bindings };
      if (override) bindings[commandId] = override;
      else delete bindings[commandId];
      return { schemaVersion: 1, bindings };
    });
  }, []);

  const attemptCustomShortcut = useCallback((commandId: string, shortcut: Shortcut) => {
    const proposed = cloneProfile(draft);
    proposed.bindings[commandId] = { mode: "custom", shortcuts: [shortcut] };
    const conflicts = findKeybindingConflicts(proposed)
      .filter((conflict) => conflict.commandIds.includes(commandId))
      .flatMap((conflict) => conflict.commandIds.filter((id) => id !== commandId));
    if (conflicts.length > 0) {
      setPendingReplacement({ commandId, shortcut, conflicts: [...new Set(conflicts)] });
      return;
    }
    setDraft(proposed);
    setCaptureId(null);
    setCaptureError(null);
  }, [draft]);

  const confirmReplacement = useCallback(() => {
    if (!pendingReplacement) return;
    const proposed = cloneProfile(draft);
    proposed.bindings[pendingReplacement.commandId] = { mode: "custom", shortcuts: [pendingReplacement.shortcut] };
    const captured = shortcutKey(pendingReplacement.shortcut);
    for (const commandId of pendingReplacement.conflicts) {
      const existing = proposed.bindings[commandId];
      if (existing?.mode === "custom") {
        const remaining = existing.shortcuts.filter((candidate) => shortcutKey(candidate) !== captured);
        proposed.bindings[commandId] = remaining.length > 0
          ? { mode: "custom", shortcuts: remaining }
          : { mode: "disabled" };
      } else {
        proposed.bindings[commandId] = { mode: "disabled" };
      }
    }
    setDraft(proposed);
    setPendingReplacement(null);
    setCaptureId(null);
    setCaptureError(null);
  }, [draft, pendingReplacement]);

  const save = useCallback(async () => {
    setSaveError(null);
    const conflicts = findKeybindingConflicts(draft);
    if (conflicts.length > 0) {
      setSaveError("Resolve conflicting shortcut assignments before saving.");
      return;
    }
    try {
      await saveKeybindings(draft, revision ?? "");
    } catch (error) {
      const typed = error as Error & { code?: string };
      setSaveError(typed.code === "revision_conflict"
        ? "These settings changed in another tab. Reload before saving."
        : typed.message);
    }
  }, [draft, revision, saveKeybindings]);

  const exportProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/user-settings/keybindings/export");
      if (!response.ok) throw new Error("Could not export keybindings.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "aishell-keybindings.aishell-keybindings.json";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not export keybindings.");
    }
  }, []);

  const previewFile = useCallback(async (file: File) => {
    setImportError(null);
    setImportPreview(null);
    try {
      if (file.size > 100_000) throw new Error("The keybinding file is too large.");
      const document = JSON.parse(await file.text()) as PortableKeybindingProfile;
      const response = await fetch("/api/user-settings/keybindings/import/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document, mode: importMode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "The keybinding file is invalid.");
      setImportPreview(payload as ImportPreview);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not read that keybinding file.");
    }
  }, [importMode]);

  const executeImport = useCallback(async () => {
    if (!importPreview) return;
    if (importPreview.conflicting.length > 0) {
      setImportError("Resolve the listed conflicts before importing.");
      return;
    }
    try {
      const document = JSON.parse((inputRef.current?.dataset.document ?? "{}")) as PortableKeybindingProfile;
      // The latest parsed document is placed in the data attribute only after a
      // server preview succeeds, keeping invalid files from ever being saved.
      const response = await fetch("/api/user-settings/keybindings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document, mode: importMode, confirmReplace: importMode === "replace", expectedRevision: revision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not import keybindings.");
      setImportPreview(null);
      await reload();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import keybindings.");
    }
  }, [importMode, importPreview, reload, revision]);

  // Keep the portable document out of component routing state while still
  // avoiding a second file read when the user confirms the preview.
  const persistPreviewDocument = useCallback(async (file: File) => {
    const raw = await file.text();
    if (inputRef.current) inputRef.current.dataset.document = raw;
    await previewFile(new File([raw], file.name, { type: file.type }));
  }, [previewFile]);

  const onStoredFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void persistPreviewDocument(file);
    event.target.value = "";
  }, [persistPreviewDocument]);

  const onStoredDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void persistPreviewDocument(file);
  }, [persistPreviewDocument]);

  return (
    <div className="settings-page">
      <div className="settings-page-inner">
        <header className="settings-header">
          <div>
            <h1>Keybindings</h1>
            <p>Works in editable AIShell Markdown editors.</p>
          </div>
          <div className="settings-header-actions">
            <button className="settings-btn" onClick={exportProfile} type="button">Export</button>
            <button className="settings-btn" onClick={() => inputRef.current?.click()} type="button">Import</button>
            <input ref={inputRef} className="settings-visually-hidden" type="file" accept="application/json,.json,.aishell-keybindings.json" onChange={onStoredFileChange} />
          </div>
        </header>

        {(recoverableError || saveError || importError) && (
          <div className="settings-notice" role="alert">
            {recoverableError ?? saveError ?? importError}
            {(recoverableError || (saveError?.includes("another tab"))) && <button className="settings-inline-action" onClick={() => void reload()} type="button">Reload</button>}
          </div>
        )}

        <section className="settings-toolbar" aria-label="Keybinding controls">
          <input className="settings-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands" aria-label="Search commands" />
          <button className="settings-btn" onClick={() => setResetAllOpen(true)} disabled={!dirty} type="button">Reset all</button>
          <button className="settings-btn" onClick={() => { setDraft(cloneProfile(keybindings)); setSaveError(null); }} disabled={!dirty} type="button">Cancel</button>
          <button className="settings-btn settings-btn-primary" onClick={() => void save()} disabled={!dirty || isLoading} type="button">Save</button>
        </section>

        {isLoading ? <p className="settings-muted">Loading keybindings…</p> : grouped.map(([category, categoryCommands]) => (
          <section className="settings-command-group" key={category}>
            <h2>{category}</h2>
            {categoryCommands.map((command) => (
              <KeybindingRow
                key={command.id}
                command={command}
                override={draft.bindings[command.id]}
                platform={platform}
                capturing={captureId === command.id}
                captureError={captureId === command.id ? captureError : null}
                onCapture={(event) => {
                  event.preventDefault();
                  const captured = captureKeyboardShortcut(event.nativeEvent, platform);
                  if (!captured.shortcut) { setCaptureError(captured.error ?? "Invalid shortcut."); return; }
                  attemptCustomShortcut(command.id, captured.shortcut);
                }}
                onStartCapture={() => { setCaptureId(command.id); setCaptureError(null); }}
                onDisable={() => updateOverride(command.id, { mode: "disabled" })}
                onReset={() => updateOverride(command.id, undefined)}
              />
            ))}
          </section>
        ))}

        <section className="settings-import-zone" onDragOver={(event) => event.preventDefault()} onDrop={onStoredDrop}>
          <strong>Import profile</strong>
          <span>Drop a `.aishell-keybindings.json` file here, or choose Import.</span>
          <div className="settings-import-mode" role="group" aria-label="Import mode">
            <label><input type="radio" checked={importMode === "merge"} onChange={() => setImportMode("merge")} /> Merge</label>
            <label><input type="radio" checked={importMode === "replace"} onChange={() => setImportMode("replace")} /> Replace All</label>
          </div>
        </section>

        {importPreview && (
          <section className="settings-import-preview">
            <h2>Import preview</h2>
            <PreviewList label="Added" values={importPreview.added} />
            <PreviewList label="Changed" values={importPreview.changed} />
            <PreviewList label="Disabled" values={importPreview.disabled} />
            <PreviewList label="Reset to default" values={importPreview.reset} />
            <PreviewList label="Unavailable (kept inactive for round-trip)" values={importPreview.unavailable} />
            {importPreview.conflicting.length > 0 && <PreviewList label="Conflicts to resolve" values={importPreview.conflicting.map((conflict) => `${conflict.shortcut}: ${conflict.commandIds.map(commandName).join(", ")}`)} />}
            <button className="settings-btn settings-btn-primary" disabled={importPreview.conflicting.length > 0} onClick={() => void executeImport()} type="button">
              {importMode === "replace" ? "Confirm Replace All" : "Import merge"}
            </button>
          </section>
        )}

        {pendingReplacement && (
          <div className="settings-dialog-backdrop" role="presentation">
            <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="Replace keybinding assignment">
              <h2>Replace existing assignment?</h2>
              <p>{formatShortcut(pendingReplacement.shortcut, platform)} is already assigned to {pendingReplacement.conflicts.map(commandName).join(", ")}.</p>
              <div className="settings-dialog-actions">
                <button className="settings-btn" onClick={() => setPendingReplacement(null)} type="button">Cancel</button>
                <button className="settings-btn settings-btn-primary" onClick={confirmReplacement} type="button">Replace assignment</button>
              </div>
            </div>
          </div>
        )}

        {resetAllOpen && (
          <div className="settings-dialog-backdrop" role="presentation">
            <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="Reset all keybindings">
              <h2>Reset all keybindings?</h2>
              <p>This removes every custom and disabled override from this draft. Save to apply the change.</p>
              <div className="settings-dialog-actions">
                <button className="settings-btn" onClick={() => setResetAllOpen(false)} type="button">Cancel</button>
                <button className="settings-btn settings-btn-primary" onClick={() => { setDraft(EMPTY_KEYBINDING_PROFILE); setResetAllOpen(false); }} type="button">Reset all</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KeybindingRow({
  command, override, platform, capturing, captureError, onCapture, onStartCapture, onDisable, onReset,
}: {
  command: KeybindingCommand;
  override: CommandOverride | undefined;
  platform: ReturnType<typeof detectKeybindingPlatform>;
  capturing: boolean;
  captureError: string | null;
  onCapture: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onStartCapture: () => void;
  onDisable: () => void;
  onReset: () => void;
}) {
  const shortcut = override?.mode === "custom" ? override.shortcuts[0] : command.defaultShortcuts[0];
  const validation = shortcut ? validateShortcut(shortcut) : undefined;
  return (
    <div className="settings-command-row">
      <div className="settings-command-copy">
        <strong>{command.label}</strong>
        <span>{command.description}</span>
      </div>
      <div className="settings-command-shortcut">
        <button className="settings-capture" onClick={onStartCapture} onKeyDown={capturing ? onCapture : undefined} type="button">
          {capturing ? "Press shortcut…" : override?.mode === "disabled" ? "Disabled" : shortcut ? formatShortcut(shortcut, platform) : "Unassigned"}
        </button>
        {captureError || validation?.error ? <span className="settings-field-error">{captureError ?? validation?.error}</span> : null}
        <span className="settings-default">Default: {command.defaultShortcuts[0] ? formatShortcut(command.defaultShortcuts[0], platform) : "Unassigned"}</span>
      </div>
      <div className="settings-row-actions">
        <button className="settings-text-btn" onClick={onDisable} disabled={override?.mode === "disabled"} type="button">Disable</button>
        <button className="settings-text-btn" onClick={onReset} disabled={!override} type="button">Reset</button>
      </div>
    </div>
  );
}

function PreviewList({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return <p className="settings-preview-line"><strong>{label}:</strong> {values.map(commandName).join(", ")}</p>;
}
