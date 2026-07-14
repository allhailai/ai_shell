/* ── App Registry ─────────────────────────────────────────────────────
   Central registry that imports all application manifests at compile time.

   To install a new application:
   1. Create your app directory under src/apps/<appId>/
   2. Export an AppManifest from <appId>/manifest.ts
   3. Import and add it to the `apps` array below
   ──────────────────────────────────────────────────────────────────── */

import type { AppManifest } from "../types/app";
import { helloWorldApp } from "./hello-world/manifest";
import { arcadeApp } from "./arcade/manifest";
import { adminApp } from "./admin/manifest";
import { dbHelperApp } from "./db-helper/manifest";
import { codaScopeApp } from "./codascope/manifest";
import { settingsApp } from "./settings/manifest";

/** All registered applications. Add new app imports here. */
export const apps: AppManifest[] = [
  helloWorldApp,
  arcadeApp,
  dbHelperApp,
  codaScopeApp,
  settingsApp,
  adminApp,
];
