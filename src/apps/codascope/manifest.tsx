import type { AppManifest } from "../../types/app";
import { CodaScopeContent } from "./CodaScopeContent";
import { CodaScopeNav } from "./CodaScopeNav";
import { CodaScopeHeaderItems } from "./CodaScopeHeaderItems";
import { CodaScopeAssistant } from "./CodaScopeAssistant";
import { IconCodeMap } from "./components/CodaScopeIcons";

function CodaScopeIcon({ size = 18 }: { size?: number }) {
  return <IconCodeMap size={size} />;
}

export const codaScopeApp: AppManifest = {
  id: "codascope",
  name: "CodaScope",
  icon: CodaScopeIcon,
  description: "AI-powered codebase exploration, documentation & analysis",
  accentColor: "hsl(260, 65%, 55%)",

  leftNav: CodaScopeNav,
  headerItems: CodaScopeHeaderItems,
  mainContent: CodaScopeContent,

  rightPanel: {
    id: "assistant",
    label: "CodaScope Assistant",
    component: CodaScopeAssistant,
    defaultSize: 420,
    minSize: 320,
    maxSize: 1000,
  },

  secrets: [
    {
      key: "cursor_api_key",
      label: "Cursor API Key",
      description: "API key for the Cursor SDK used by CodaScope agents.",
      scope: "app",
      required: true,
      sensitive: true,
    },
    {
      key: "codascope_projects_root",
      label: "Projects Root Path",
      description: "Filesystem path to the codascope_projects directory.",
      scope: "app",
      required: true,
      sensitive: false,
    },
  ],
};
