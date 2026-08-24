import type { AppManifest } from "../../types/app";
import { MarketAccessContent } from "./MarketAccessContent";

function MarketAccessIcon({ size = 18 }: { size?: number }) {
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
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15 15 0 0 1 0 20" />
      <path d="M12 2a15 15 0 0 0 0 20" />
    </svg>
  );
}

export const marketAccessApp: AppManifest = {
  id: "market-access",
  name: "Market Access",
  icon: MarketAccessIcon,
  description: "Research pharmaceutical analogs and build evidence-backed assessments",
  accentColor: "hsl(172, 55%, 42%)",
  mainContent: MarketAccessContent,
};
