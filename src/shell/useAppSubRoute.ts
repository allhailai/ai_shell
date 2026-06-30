/* ── App Sub-Route Hook ──────────────────────────────────────────────
   Provides URL-based sub-routing for applications hosted in the shell.

   The shell owns the first path segment (`/:appId`). Everything after
   that is the app's sub-route, which this hook reads and writes.

   URL schema for apps:
     /codascope                       → app root
     /codascope/projects              → projects list
     /codascope/project/:id/dashboard → project dashboard
     /codascope/project/:id/wiki      → wiki browser
     /codascope/project/:id/wiki/:t   → specific wiki topic

   Usage:
     const { segments, navigate, replace } = useAppSubRoute("codascope");
   ──────────────────────────────────────────────────────────────────── */

import { useSyncExternalStore, useCallback } from "react";

// ── External store for path changes ─────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string {
  return window.location.pathname + window.location.search;
}

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

// Patch pushState/replaceState to notify listeners
if (typeof window !== "undefined") {
  const originalPush = window.history.pushState.bind(window.history);
  const originalReplace = window.history.replaceState.bind(window.history);

  window.history.pushState = function (...args: Parameters<typeof originalPush>) {
    originalPush(...args);
    notifyListeners();
  };

  window.history.replaceState = function (...args: Parameters<typeof originalReplace>) {
    originalReplace(...args);
    notifyListeners();
  };

  window.addEventListener("popstate", () => notifyListeners());
}

// ── Hook ────────────────────────────────────────────────────────────

export interface AppSubRoute {
  /** All path segments after the appId. e.g. ["project", "abc", "wiki"] */
  segments: string[];
  /** The raw sub-path string, e.g. "project/abc/wiki" */
  subPath: string;
  /** Navigate to a new sub-route (pushState). Pass a path like "project/abc/wiki". */
  navigate: (subPath: string) => void;
  /** Replace the current sub-route (replaceState). */
  replace: (subPath: string) => void;
  /** Get a specific query parameter. */
  getParam: (key: string) => string | null;
  /** Set a query parameter (replaceState). Pass null to remove. */
  setParam: (key: string, value: string | null) => void;
}

export function useAppSubRoute(appId: string): AppSubRoute {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  // Parse segments from current URL
  const allSegments = snapshot.split("?")[0].split("/").filter(Boolean);
  // Find the appId segment and take everything after it
  const appIndex = allSegments.indexOf(appId);
  const segments = appIndex >= 0 ? allSegments.slice(appIndex + 1) : [];
  const subPath = segments.join("/");

  const navigate = useCallback(
    (newSubPath: string) => {
      const clean = newSubPath.replace(/^\/+/, "");
      const path = clean ? `/${appId}/${clean}` : `/${appId}`;
      // Preserve non-app query params (rp, bp, nav, etc.)
      const currentParams = new URLSearchParams(window.location.search);
      const shellParams = new URLSearchParams();
      for (const [key, value] of currentParams) {
        if (["rp", "bp", "rpw", "bph", "nav", "conv"].includes(key) || key.startsWith("rp.") || key.startsWith("bp.")) {
          shellParams.set(key, value);
        }
      }
      const search = shellParams.toString();
      window.history.pushState(null, "", search ? `${path}?${search}` : path);
    },
    [appId],
  );

  const replace = useCallback(
    (newSubPath: string) => {
      const clean = newSubPath.replace(/^\/+/, "");
      const path = clean ? `/${appId}/${clean}` : `/${appId}`;
      const currentParams = new URLSearchParams(window.location.search);
      const shellParams = new URLSearchParams();
      for (const [key, value] of currentParams) {
        if (["rp", "bp", "rpw", "bph", "nav", "conv"].includes(key) || key.startsWith("rp.") || key.startsWith("bp.")) {
          shellParams.set(key, value);
        }
      }
      const search = shellParams.toString();
      window.history.replaceState(null, "", search ? `${path}?${search}` : path);
    },
    [appId],
  );

  const getParam = useCallback(
    (key: string) => {
      const params = new URLSearchParams(window.location.search);
      return params.get(key);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- need to re-read on snapshot change
    [snapshot],
  );

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (value === null) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      const search = params.toString();
      const path = window.location.pathname;
      window.history.replaceState(null, "", search ? `${path}?${search}` : path);
    },
    [],
  );

  return { segments, subPath, navigate, replace, getParam, setParam };
}
