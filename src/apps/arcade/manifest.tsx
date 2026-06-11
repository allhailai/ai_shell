import type { AppManifest } from "../../types/app";
import { ArcadeContent, ArcadeNavWrapper, ArcadeScorePanelWrapper } from "./ArcadeContent";
import { ArcadeHeaderItems } from "./ArcadeHeaderItems";

function ArcadeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="3" />
      <circle cx="8" cy="12" r="2" />
      <line x1="16" y1="10" x2="16" y2="14" />
      <line x1="14" y1="12" x2="18" y2="12" />
    </svg>
  );
}

export const arcadeApp: AppManifest = {
  id: "arcade",
  name: "Arcade",
  description: "Classic retro games — Tetris and more",
  icon: ArcadeIcon,
  accentColor: "hsl(280, 70%, 55%)",

  mainContent: ArcadeContent,
  leftNav: ArcadeNavWrapper,
  headerItems: ArcadeHeaderItems,

  rightPanel: {
    id: "arcade-scores",
    label: "High Scores",
    component: ArcadeScorePanelWrapper,
    defaultSize: 320,
    minSize: 260,
  },
};
