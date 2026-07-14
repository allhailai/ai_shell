/* ── Shell user settings provider ──────────────────────────────────────
   Canonical user settings live on the AIShell server. This deliberately does
   not use the shell's localStorage preference store, which only owns layout
   conveniences such as pinned applications.
   ──────────────────────────────────────────────────────────────────── */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { KeybindingProvider, EMPTY_KEYBINDING_PROFILE, type KeybindingProfile } from "../shared/keybindings";
import { useAuth } from "./authContext";

export interface UserSettingsState {
  keybindings: KeybindingProfile;
  revision: string | null;
  isLoading: boolean;
  recoverableError: string | null;
  reload: () => Promise<void>;
  saveKeybindings: (profile: KeybindingProfile, expectedRevision?: string) => Promise<{ revision: string }>;
}

const UserSettingsContext = createContext<UserSettingsState | null>(null);

function asProfile(value: unknown): KeybindingProfile {
  if (!value || typeof value !== "object") return EMPTY_KEYBINDING_PROFILE;
  const candidate = value as Partial<KeybindingProfile>;
  if (candidate.schemaVersion !== 1 || !candidate.bindings || typeof candidate.bindings !== "object") {
    return EMPTY_KEYBINDING_PROFILE;
  }
  return candidate as KeybindingProfile;
}

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [keybindings, setKeybindings] = useState<KeybindingProfile>(EMPTY_KEYBINDING_PROFILE);
  const [revision, setRevision] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [recoverableError, setRecoverableError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setKeybindings(EMPTY_KEYBINDING_PROFILE);
      setRevision(null);
      setRecoverableError(null);
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch("/api/user-settings");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load user settings.");
      setKeybindings(asProfile(payload.profile));
      setRevision(typeof payload.revision === "string" ? payload.revision : null);
      setRecoverableError(typeof payload.recoverableError === "string" ? payload.recoverableError : null);
    } catch (error) {
      setKeybindings(EMPTY_KEYBINDING_PROFILE);
      setRevision(null);
      setRecoverableError(error instanceof Error ? error.message : "Could not load user settings.");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void reload();
  }, [authLoading, reload]);

  const saveKeybindings = useCallback(async (profile: KeybindingProfile, expectedRevision = revision ?? "") => {
    const response = await fetch("/api/user-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, expectedRevision }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error ?? "Could not save keybindings.") as Error & { code?: string; latest?: unknown };
      error.code = payload.code;
      error.latest = payload;
      throw error;
    }
    const nextProfile = asProfile(payload.profile);
    const nextRevision = typeof payload.revision === "string" ? payload.revision : null;
    setKeybindings(nextProfile);
    setRevision(nextRevision);
    setRecoverableError(null);
    return { revision: nextRevision ?? "" };
  }, [revision]);

  const state: UserSettingsState = {
    keybindings,
    revision,
    isLoading,
    recoverableError,
    reload,
    saveKeybindings,
  };

  return (
    <UserSettingsContext.Provider value={state}>
      <KeybindingProvider profile={keybindings}>{children}</KeybindingProvider>
    </UserSettingsContext.Provider>
  );
}

export function useUserSettings(): UserSettingsState {
  const context = useContext(UserSettingsContext);
  if (!context) throw new Error("useUserSettings must be used within UserSettingsProvider");
  return context;
}
