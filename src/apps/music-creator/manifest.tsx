import type { AppManifest } from "../../types/app";
import { MusicCreatorContent } from "./MusicCreatorContent";
import { MusicCreatorHeaderItems } from "./MusicCreatorHeaderItems";
import { MusicCreatorNav } from "./MusicCreatorNav";

function MusicCreatorIcon({ size = 18 }: { size?: number }) {
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
      aria-hidden
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export const musicCreatorApp: AppManifest = {
  id: "music-creator",
  name: "Music Creator",
  icon: MusicCreatorIcon,
  description: "Compact browser-based drum and melody sequencer",
  accentColor: "hsl(330, 70%, 52%)",

  leftNav: MusicCreatorNav,
  mainContent: MusicCreatorContent,
  headerItems: MusicCreatorHeaderItems,
};
