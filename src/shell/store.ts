/* ── Shell Store (Tier 1 Communication) ──────────────────────────────
   Use the Shell Store for STATE that UI components subscribe to and
   re-render on. This includes layout geometry, which panels are open,
   active module, and theme.

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

export interface ShellState {
  // ── Layout ──
  leftNavCollapsed: boolean;
  rightPanelId: string | null;
  rightPanelWidth: number;
  bottomPanelId: string | null;
  bottomPanelHeight: number;

  // ── Navigation ──
  activePluginId: string | null;

  // ── Theme ──
  theme: "dark" | "light";

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
  setActivePlugin: (pluginId: string | null) => void;
  toggleTheme: () => void;
}

export const useShellStore = create<ShellState>((set) => ({
  // ── Initial state ──
  leftNavCollapsed: false,
  rightPanelId: null,
  rightPanelWidth: 380,
  bottomPanelId: null,
  bottomPanelHeight: 240,
  activePluginId: null,
  theme: "dark",

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
  setActivePlugin: (pluginId) => set({ activePluginId: pluginId }),

  // ── Theme ──
  toggleTheme: () =>
    set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
}));
