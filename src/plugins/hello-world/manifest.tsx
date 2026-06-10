import type { PluginManifest } from "../../types/plugin";
import { HelloPage } from "./HelloPage";
import { AboutPage } from "./AboutPage";
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
 * Hello World plugin manifest.
 *
 * Demonstrates the full plugin contract:
 * - Two routes (home + about sub-page)
 * - One right panel (shell state inspector)
 * - One bottom panel (activity log)
 * - One command handler (hello.greet)
 */
export const helloWorldManifest: PluginManifest = {
  id: "hello",
  name: "Hello World",
  icon: WaveIcon,
  description: "Demo plugin exercising all chassis capabilities",
  routes: [
    { path: "", label: "Home", component: HelloPage },
    { path: "about", label: "About", component: AboutPage },
  ],
  panels: {
    right: [
      {
        id: "hello-info",
        label: "Shell Inspector",
        component: HelloInfoPanel,
        defaultSize: 380,
        minSize: 280,
        maxSize: 550,
      },
    ],
    bottom: [
      {
        id: "hello-log",
        label: "Activity Log",
        component: HelloLogPanel,
        defaultSize: 200,
        minSize: 120,
        maxSize: 400,
      },
    ],
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
