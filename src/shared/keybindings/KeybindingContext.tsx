import { createContext, useContext, useMemo, type ReactNode } from "react";
import { EMPTY_KEYBINDING_PROFILE, type KeybindingProfile } from "./types";

const KeybindingContext = createContext<KeybindingProfile>(EMPTY_KEYBINDING_PROFILE);

/** Generic editor-facing provider. Persistence belongs to the shell layer. */
export function KeybindingProvider({ profile, children }: { profile: KeybindingProfile; children: ReactNode }) {
  const value = useMemo(() => profile, [profile]);
  return <KeybindingContext.Provider value={value}>{children}</KeybindingContext.Provider>;
}

export function useKeybindingProfile(): KeybindingProfile {
  return useContext(KeybindingContext);
}
