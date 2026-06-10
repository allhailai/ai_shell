/* ── Plugin Registry ──────────────────────────────────────────────────
   Central registry that imports all plugin manifests at compile time.

   To install a new plugin:
   1. Create your plugin directory under src/plugins/<pluginId>/
   2. Export a PluginManifest from <pluginId>/manifest.ts
   3. Import and add it to the `plugins` array below
   ──────────────────────────────────────────────────────────────────── */

import type { PluginManifest } from "../types/plugin";
import { helloWorldManifest } from "./hello-world/manifest";

/** All registered plugins. Add new plugin imports here. */
export const plugins: PluginManifest[] = [
  helloWorldManifest,
];
