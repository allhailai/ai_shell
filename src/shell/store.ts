/* ── Shell Store (Tier 1 Communication) ──────────────────────────────
   Use the Shell Store for STATE that UI components subscribe to and
   re-render on. This includes layout geometry, which panels are open,
   active application, and theme.

   WHEN TO USE TIER 1:
   - "What is the current state of the UI?" → Tier 1
   - State that multiple components/modules need to READ reactively
   - Persisted/serializable state (synced to URL)

   WHEN TO USE TIER 2 (Command Bus) INSTEAD:
   - "Make something happen" → Tier 2
   - One-off imperative actions (navigate, show toast)
   - Module-to-module invocation
   ──────────────────────────────────────────────────────────────────── */

import { create } from "zustand";

/* ── User Preferences (localStorage) ─────────────────────────────── */

const PREFS_KEY = "aishell:user-prefs";

interface UserPrefs {
  pinnedApps: string[];
  hiddenApps: string[];
}

function loadPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw) as UserPrefs;
  } catch { /* ignore parse errors */ }
  return { pinnedApps: [], hiddenApps: [] };
}

function savePrefs(prefs: UserPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/* ── Store Shape ─────────────────────────────────────────────────── */

export interface ShellState {
  // ── Layout ──
  leftNavCollapsed: boolean;
  rightPanelId: string | null;
  rightPanelWidth: number;
  bottomPanelId: string | null;
  bottomPanelHeight: number;

  // ── Navigation ──
  activeAppId: string | null;

  // ── Theme ──
  theme: "dark" | "light";

  // ── User Preferences (pinned / hidden apps) ──
  pinnedApps: string[];
  hiddenApps: string[];

  // ── Actions ──
  setLeftNavCollapsed: (collapsed: boolean) => void;
  toggleLeftNav: () => void;
  openRightPanel: (panelId: string) => void;
  closeRightPanel: () => void;
  toggleRightPanel: (panelId: string) => void;
  setRightPanelWidth: (width: number) => void;
  openBottomPanel: (panelId: string) => void;
  closeBottomPanel: () => void;
  toggleBottomPanel: (panelId: string) => void;
  setBottomPanelHeight: (height: number) => void;
  setActiveApp: (appId: string | null) => void;
  goHome: () => void;
  toggleTheme: () => void;

  // ── Preference actions ──
  togglePinApp: (appId: string) => void;
  toggleHideApp: (appId: string) => void;
}

export const useShellStore = create<ShellState>((set, get) => {
  const prefs = loadPrefs();

  return {
    // ── Initial state ──
    leftNavCollapsed: false,
    rightPanelId: null,
    rightPanelWidth: 380,
    bottomPanelId: null,
    bottomPanelHeight: 240,
    activeAppId: null,
    theme: "dark",
    pinnedApps: prefs.pinnedApps,
    hiddenApps: prefs.hiddenApps,

    // ── Layout actions ──
    setLeftNavCollapsed: (collapsed) => set({ leftNavCollapsed: collapsed }),
    toggleLeftNav: () => set((s) => ({ leftNavCollapsed: !s.leftNavCollapsed })),

    openRightPanel: (panelId) => set({ rightPanelId: panelId }),
    closeRightPanel: () => set({ rightPanelId: null }),
    toggleRightPanel: (panelId) =>
      set((s) => ({ rightPanelId: s.rightPanelId === panelId ? null : panelId })),
    setRightPanelWidth: (width) => set({ rightPanelWidth: width }),

    openBottomPanel: (panelId) => set({ bottomPanelId: panelId }),
    closeBottomPanel: () => set({ bottomPanelId: null }),
    toggleBottomPanel: (panelId) =>
      set((s) => ({ bottomPanelId: s.bottomPanelId === panelId ? null : panelId })),
    setBottomPanelHeight: (height) => set({ bottomPanelHeight: height }),

    // ── Navigation ──
    setActiveApp: (appId) => set({ activeAppId: appId }),
    goHome: () => set({
      activeAppId: null,
      rightPanelId: null,
      bottomPanelId: null,
    }),

    // ── Theme ──
    toggleTheme: () =>
      set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),

    // ── Preference actions ──
    togglePinApp: (appId) => {
      const s = get();
      const isPinned = s.pinnedApps.includes(appId);
      const pinnedApps = isPinned
        ? s.pinnedApps.filter((id) => id !== appId)
        : [...s.pinnedApps, appId];
      savePrefs({ pinnedApps, hiddenApps: s.hiddenApps });
      set({ pinnedApps });
    },

    toggleHideApp: (appId) => {
      const s = get();
      const isHidden = s.hiddenApps.includes(appId);
      const hiddenApps = isHidden
        ? s.hiddenApps.filter((id) => id !== appId)
        : [...s.hiddenApps, appId];
      // If hiding, also unpin
      let pinnedApps = s.pinnedApps;
      if (!isHidden) {
        pinnedApps = pinnedApps.filter((id) => id !== appId);
      }
      savePrefs({ pinnedApps, hiddenApps });
      set({ pinnedApps, hiddenApps });
    },
  };
});
