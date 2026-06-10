import { useMemo } from "react";
import { useShellStore } from "../shell/store";
import type { PluginManifest } from "../types/plugin";
import { EmptyState } from "./EmptyState";

/**
 * Dynamic router that resolves the active plugin's page component.
 *
 * Instead of React Router (which would add routing complexity for a
 * URL-state-driven shell), we use the shell store's activePluginId
 * to select which plugin component to render. Sub-routing within
 * plugins can be handled by the plugin itself using the URL path.
 */
export function PluginRouter({ plugins }: { plugins: PluginManifest[] }) {
  const activePluginId = useShellStore((s) => s.activePluginId);

  const ActiveComponent = useMemo(() => {
    if (!activePluginId) return null;

    const plugin = plugins.find((p) => p.id === activePluginId);
    if (!plugin) return null;

    // For now, find the matching route based on the URL sub-path
    const pathSegments = window.location.pathname.split("/").filter(Boolean);
    const subPath = pathSegments.slice(1).join("/"); // everything after /:pluginId

    // Find a matching route, fallback to the default (empty path) route
    const matchedRoute =
      plugin.routes.find((r) => r.path === subPath) ??
      plugin.routes.find((r) => r.path === "");

    return matchedRoute?.component ?? null;
  }, [activePluginId, plugins]);

  if (!ActiveComponent) return <EmptyState />;

  return <ActiveComponent />;
}
