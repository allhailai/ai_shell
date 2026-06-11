import type { AppManifest } from "../../types/app";
import { HelloContent } from "./HelloContent";
import { HelloNav } from "./HelloNav";
import { HelloInfoPanel } from "./HelloInfoPanel";
import { HelloLogPanel } from "./HelloLogPanel";

function WaveIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

/**
 * Hello World application manifest.
 *
 * Demonstrates the full application contract:
 * - Custom left navigation with sub-routes
 * - Main content with internal routing
 * - Right panel (shell state inspector)
 * - Bottom panel (activity log)
 * - Command handler (hello.greet)
 */
export const helloWorldApp: AppManifest = {
  id: "hello",
  name: "Hello World",
  icon: WaveIcon,
  description: "Demo app exercising all AIShell chassis capabilities",
  accentColor: "hsl(200, 80%, 55%)",

  leftNav: HelloNav,
  mainContent: HelloContent,

  rightPanel: {
    id: "hello-info",
    label: "Shell Inspector",
    component: HelloInfoPanel,
    defaultSize: 380,
    minSize: 280,
  },

  bottomPanel: {
    id: "hello-log",
    label: "Activity Log",
    component: HelloLogPanel,
    defaultSize: 200,
    minSize: 120,
  },

  commands: [
    {
      name: "hello.greet",
      handler: (payload) => {
        const name = typeof payload === "string" ? payload : "World";
        return `Hello, ${name}! 👋 (processed at ${new Date().toLocaleTimeString()})`;
      },
    },
  ],
};
