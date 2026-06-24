/* ── DB Helper: Manifest ──────────────────────────────────────────────
   Application manifest for the DB Helper app.
   Allows users to configure and manage Postgres database connections.
   ──────────────────────────────────────────────────────────────────── */

import type { AppManifest } from "../../types/app";
import { DbHelperContent, DbHelperLeftNav, DbHelperRightPanel } from "./DbHelperContent";

function DatabaseIcon({ size = 18 }: { size?: number }) {
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
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 5v14a9 3 0 0 1-18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  );
}

export const dbHelperApp: AppManifest = {
  id: "db-helper",
  name: "DB Helper",
  icon: DatabaseIcon,
  description: "Configure and manage Postgres database connections",
  accentColor: "hsl(270, 60%, 55%)",

  leftNav: DbHelperLeftNav,
  mainContent: DbHelperContent,

  rightPanel: {
    id: "db-helper-info",
    label: "Table Info",
    component: DbHelperRightPanel,
    defaultSize: 300,
    minSize: 220,
  },
};
