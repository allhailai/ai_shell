/**
 * Module-level studio session store — bridges Studio (mainContent tree) and
 * MusicCreatorHeaderItems (topbar tree). Same pattern as Arcade shared state.
 *
 * Studio publishes read-only snapshot + registers action callbacks on mount.
 * Header subscribes via useSyncExternalStore; calls actions owned by Studio.
 */

export interface StudioSessionSnapshot {
  /** False on hub or when Studio unmounts — header renders nothing */
  active: boolean;
  projectId: string | null;
  name: string;
  tempo: number;
  isDirty: boolean;
  isPlaying: boolean;
}

export interface StudioSessionActions {
  onNameChange: (name: string) => void;
  onTempoChange: (tempo: number) => void;
  onTogglePlayback: () => void;
  onSave: () => void;
}

const INACTIVE_SNAPSHOT: StudioSessionSnapshot = {
  active: false,
  projectId: null,
  name: "",
  tempo: 120,
  isDirty: false,
  isPlaying: false,
};

let snapshot: StudioSessionSnapshot = INACTIVE_SNAPSHOT;

let actions: StudioSessionActions | null = null;

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

/** Merge partial snapshot — Studio syncs workingCopy / playback / route state here */
export function setStudioSession(partial: Partial<StudioSessionSnapshot>): void {
  snapshot = { ...snapshot, ...partial };
  notify();
}

/** Studio registers handlers on mount; clears on unmount so header cannot call stale closures */
export function registerStudioSessionActions(next: StudioSessionActions | null): void {
  actions = next;
}

export function subscribeStudioSession(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getStudioSessionSnapshot(): StudioSessionSnapshot {
  return snapshot;
}

/** Header invokes Studio-owned callbacks — no-ops when Studio is not mounted */
export function invokeStudioSessionAction<K extends keyof StudioSessionActions>(
  key: K,
  ...args: Parameters<StudioSessionActions[K]>
): void {
  const handler = actions?.[key];
  if (handler) {
    (handler as (...params: typeof args) => void)(...args);
  }
}

/** Reset to inactive — called when leaving studio route */
export function clearStudioSession(): void {
  snapshot = INACTIVE_SNAPSHOT;
  actions = null;
  notify();
}
