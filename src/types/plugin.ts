import type { ComponentType } from "react";

/* ── Plugin Contract Types ───────────────────────────────────────────
   This is the API surface that plugin authors code against.
   The chassis imports these types to build routes, panels, and commands.

   Naming convention: plugin IDs are lowercase kebab-case (e.g., "hello-world").
   Panel IDs are scoped to their plugin namespace in the URL.
   ──────────────────────────────────────────────────────────────────── */

/** Unique plugin identifier — used in URLs, registry, commands. */
export type PluginId = string;

/**
 * A page registered by a plugin, rendered in the main canvas.
 *
 * The URL for a route is `/:pluginId/:path`. An empty path ("") means
 * the plugin's default landing page.
 */
export interface PluginRoute {
  /** Sub-path within the plugin's URL namespace. "" = default page. */
  path: string;
  /** Human-readable label shown in the left nav. */
  label: string;
  /** React component rendered in the main canvas. */
  component: ComponentType;
}

/**
 * A panel widget a plugin can inject into the right or bottom panel.
 *
 * The panel ID appears in the URL as `?rp=<id>` or `?bp=<id>`.
 * Panel-specific state can be passed via `?rp.<key>=<value>` or `?bp.<key>=<value>`.
 */
export interface PanelRegistration {
  /** Unique panel ID — used in URL query params. */
  id: string;
  /** Display label for the panel header. */
  label: string;
  /** Optional icon component for tabs/headers. */
  icon?: ComponentType<{ size?: number }>;
  /** The panel content component. Receives `params` from the URL. */
  component: ComponentType<{ params?: Record<string, string> }>;
  /** Default size in pixels (width for right panel, height for bottom). */
  defaultSize?: number;
  /** Minimum size constraint in pixels. */
  minSize?: number;
  /** Maximum size constraint in pixels. */
  maxSize?: number;
}

/**
 * A command handler a plugin registers on the command bus.
 *
 * Commands are namespaced as `pluginId.commandName` by convention.
 * Handlers receive an unknown payload and may return a value (sync or async).
 */
export interface CommandRegistration {
  /** Command name (e.g., "hello.greet"). */
  name: string;
  /** Handler function. */
  handler: (payload: unknown) => unknown | Promise<unknown>;
}

/**
 * The full plugin manifest — everything the chassis needs to integrate a plugin.
 *
 * Plugins export a single `PluginManifest` from their `manifest.ts` file.
 * The chassis registry imports these at compile time.
 */
export interface PluginManifest {
  /** Unique identifier — used in URLs as `/:pluginId`. */
  id: PluginId;
  /** Human-readable name shown in nav and headers. */
  name: string;
  /** Icon component for the left nav. */
  icon?: ComponentType<{ size?: number }>;
  /** Navigation group name. Null/undefined = top-level ungrouped item. */
  group?: string;
  /** Sort order within group. Lower = higher in list. Default: 0. */
  order?: number;
  /** Pages rendered in the main canvas. */
  routes: PluginRoute[];
  /** Panel widgets this plugin provides. */
  panels?: {
    right?: PanelRegistration[];
    bottom?: PanelRegistration[];
  };
  /** Commands this plugin handles via the command bus. */
  commands?: CommandRegistration[];
  /** Short description for tooltips and empty states. */
  description?: string;
}
