/* ── URL ↔ State Synchronization ──────────────────────────────────────
   Bidirectional sync between the URL and the Shell Store.
   The URL is the source of truth on initial load.

   URL schema:
     /:appId                      → active application, default view
     /:appId/:subRoute*           → app sub-routes (splat)
     ?rp=<panelId>                → right panel open
     ?bp=<panelId>                → bottom panel open
     ?rp.<key>=<value>            → right panel scoped state
     ?bp.<key>=<value>            → bottom panel scoped state
     ?rpw=<px>                    → right panel width
     ?bph=<px>                    → bottom panel height
     &nav=collapsed               → left nav collapsed
   ──────────────────────────────────────────────────────────────────── */

import { useShellStore, type ShellState } from "./store";

// ── URL → Store (initial hydration + popstate) ──

/** Parse the current URL and hydrate the shell store. */
export function hydrateStoreFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const pathSegments = window.location.pathname.split("/").filter(Boolean);
  const appId = pathSegments[0] ?? null;

  const store = useShellStore.getState();

  if (appId) store.setActiveApp(appId);

  const rp = params.get("rp");
  if (rp) store.openRightPanel(rp);

  const bp = params.get("bp");
  if (bp) store.openBottomPanel(bp);

  const rpw = params.get("rpw");
  if (rpw) {
    const w = parseInt(rpw, 10);
    if (!Number.isNaN(w) && w > 0) store.setRightPanelWidth(w);
  }

  const bph = params.get("bph");
  if (bph) {
    const h = parseInt(bph, 10);
    if (!Number.isNaN(h) && h > 0) store.setBottomPanelHeight(h);
  }

  if (params.get("nav") === "collapsed") {
    store.setLeftNavCollapsed(true);
  }
}

// ── Store → URL (reactive sync) ──

/** Build query string from shell state. Preserves app-scoped params. */
function buildSearchParams(state: ShellState): URLSearchParams {
  const params = new URLSearchParams(window.location.search);

  // Clear shell-managed params
  params.delete("rp");
  params.delete("bp");
  params.delete("rpw");
  params.delete("bph");
  params.delete("nav");

  if (state.rightPanelId) params.set("rp", state.rightPanelId);
  if (state.bottomPanelId) params.set("bp", state.bottomPanelId);
  if (state.rightPanelId && state.rightPanelWidth !== 380) {
    params.set("rpw", String(Math.round(state.rightPanelWidth)));
  }
  if (state.bottomPanelId && state.bottomPanelHeight !== 240) {
    params.set("bph", String(Math.round(state.bottomPanelHeight)));
  }
  if (state.leftNavCollapsed) params.set("nav", "collapsed");

  return params;
}

/**
 * Subscribe to store changes and update the URL.
 * Call once at app startup after hydration.
 */
export function startUrlSync(): () => void {
  let isInternalUpdate = false;

  const unsubStore = useShellStore.subscribe((state, prevState) => {
    if (isInternalUpdate) return;

    // Determine if this is a "navigation" (app change) or a "layout adjustment"
    const isNavigation = state.activeAppId !== prevState.activeAppId;
    const search = buildSearchParams(state);
    const searchStr = search.toString();
    const query = searchStr ? `?${searchStr}` : "";

    // Build the path from the active app
    const currentPath = window.location.pathname;
    let path = currentPath;
    if (isNavigation) {
      path = state.activeAppId ? `/${state.activeAppId}` : "/";
    }

    const newUrl = `${path}${query}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (newUrl !== currentUrl) {
      if (isNavigation) {
        window.history.pushState(null, "", newUrl);
      } else {
        window.history.replaceState(null, "", newUrl);
      }
    }
  });

  // Listen for browser back/forward
  const handlePopState = () => {
    isInternalUpdate = true;
    hydrateStoreFromUrl();
    isInternalUpdate = false;
  };

  window.addEventListener("popstate", handlePopState);

  return () => {
    unsubStore();
    window.removeEventListener("popstate", handlePopState);
  };
}

// ── App panel params helper ──

/**
 * Extract namespaced params for a panel from the current URL.
 * e.g., `?rp.conversationId=abc` → { conversationId: "abc" }
 */
export function getPanelParams(prefix: "rp" | "bp"): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const result: Record<string, string> = {};
  const dotPrefix = `${prefix}.`;

  for (const [key, value] of params) {
    if (key.startsWith(dotPrefix)) {
      result[key.slice(dotPrefix.length)] = value;
    }
  }

  return result;
}

/**
 * Set namespaced params for a panel in the URL.
 * Merges with existing panel params — pass null value to remove a key.
 */
export function setPanelParams(
  prefix: "rp" | "bp",
  updates: Record<string, string | null>,
): void {
  const params = new URLSearchParams(window.location.search);
  const dotPrefix = `${prefix}.`;

  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      params.delete(`${dotPrefix}${key}`);
    } else {
      params.set(`${dotPrefix}${key}`, value);
    }
  }

  const searchStr = params.toString();
  const query = searchStr ? `?${searchStr}` : "";
  window.history.replaceState(null, "", `${window.location.pathname}${query}`);
}
