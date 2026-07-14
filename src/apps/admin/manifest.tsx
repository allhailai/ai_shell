/* ── Administration app manifest ─────────────────────────────────────── */

import { SettingsIcon } from "../../app/ShellIcons";
import type { AppManifest } from "../../types/app";
import { AdminContent } from "./AdminContent";

/** Retains the /admin URL while making privileged scope explicit. */
export const adminApp: AppManifest = {
  id: "admin",
  name: "Administration",
  icon: SettingsIcon,
  description: "System administration — secrets, users, and configuration",
  accentColor: "hsl(220, 15%, 50%)",
  system: true,
  requiresAdmin: true,
  mainContent: AdminContent,
};
