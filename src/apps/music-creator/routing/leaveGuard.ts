/**
 * Cross-region leave guard — blocks app-controlled navigation while Studio is dirty.
 *
 * Studio (mainContent) registers on mount; MusicCreatorNav calls tryLeaveStudio
 * before hub navigation. Lives under routing/ because it gates route changes, not
 * persistence or audio. Shell app switch / Home does not use this (see AGENTS.md).
 */

export interface StudioLeaveGuard {
  getIsDirty: () => boolean;
  /** Open leave confirm in Studio; call proceed() only if user chooses Leave */
  confirmLeave: (proceed: () => void) => void;
}

let activeGuard: StudioLeaveGuard | null = null;

export function registerStudioLeaveGuard(guard: StudioLeaveGuard | null): void {
  activeGuard = guard;
}

/** App-controlled navigation away from Studio — confirm when dirty */
export function tryLeaveStudio(proceed: () => void): void {
  if (activeGuard?.getIsDirty()) {
    activeGuard.confirmLeave(proceed);
    return;
  }
  proceed();
}
