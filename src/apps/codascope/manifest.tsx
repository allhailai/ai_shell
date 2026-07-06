import type { AppManifest } from "../../types/app";
import { CodaScopeContent } from "./CodaScopeContent";
import { CodaScopeNav } from "./CodaScopeNav";
import { CodaScopeHeaderItems } from "./CodaScopeHeaderItems";
import { CodaScopeAssistant } from "./CodaScopeAssistant";

function CodaScopeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Magnifying glass over code brackets */}
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
      <path d="M8 8l-2 3 2 3" />
      <path d="M14 8l2 3-2 3" />
    </svg>
  );
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

