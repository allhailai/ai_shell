import { SettingsIcon } from "../../app/ShellIcons";
import type { AppManifest } from "../../types/app";
import { SettingsContent } from "./SettingsContent";

export const settingsApp: AppManifest = {
  id: "settings",
  name: "Settings",
  icon: SettingsIcon,
  description: "Personal AIShell preferences and keybindings",
  accentColor: "hsl(210, 70%, 55%)",
  system: true,
  mainContent: SettingsContent,
};
