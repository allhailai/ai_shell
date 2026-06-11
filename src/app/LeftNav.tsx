import type { AppManifest } from "../types/app";
import { useShellStore } from "../shell/store";
import { useCallback } from "react";

/**
 * Left navigation panel.
 *
 * Three modes:
 * 1. No active app → shows a list of available apps (launcher nav)
 * 2. Active app with `leftNav` → renders the app's left nav component
 * 3. Active app without `leftNav` → shows only a home button
 */
export function LeftNav({
  apps,
  activeApp,
}: {
  apps: AppManifest[];
  activeApp: AppManifest | null;
}) {
  const collapsed = useShellStore((s) => s.leftNavCollapsed);

  if (!activeApp) {
    // Mode 1: Launcher nav — show app list
    return (
      <nav className="left-nav" aria-label="Application navigation">
        <div className="left-nav-content scrollable-y">
          {apps.map((app) => (
            <AppNavItem key={app.id} app={app} collapsed={collapsed} />
          ))}
        </div>
      </nav>
    );
  }

  if (activeApp.leftNav) {
    // Mode 2: App-provided left nav
    const AppNav = activeApp.leftNav;
    return (
      <nav className="left-nav" aria-label={`${activeApp.name} navigation`}>
        <div className="left-nav-content scrollable-y">
          {/* Home button at the top */}
          <HomeNavItem collapsed={collapsed} />
          <div className="nav-divider" />
          <AppNav />
        </div>
      </nav>
    );
  }

  // Mode 3: No app nav — just a home button
  return (
    <nav className="left-nav" aria-label="Navigation">
      <div className="left-nav-content scrollable-y">
        <HomeNavItem collapsed={collapsed} />
      </div>
    </nav>
  );
}

/**
 * Nav item that launches an app from the landing nav.
 */
function AppNavItem({
  app,
  collapsed,
}: {
  app: AppManifest;
  collapsed: boolean;
}) {
  const setActiveApp = useShellStore((s) => s.setActiveApp);
  const handleClick = useCallback(() => {
    setActiveApp(app.id);
  }, [app.id, setActiveApp]);

  const Icon = app.icon;

  return (
    <button
      className="nav-item"
      onClick={handleClick}
      title={collapsed ? app.name : undefined}
      type="button"
    >
      <span className="nav-item-icon">
        {Icon ? <Icon size={18} /> : <DefaultAppIcon />}
      </span>
      <span className="nav-item-label">{app.name}</span>
    </button>
  );
}

/**
 * Home button that navigates back to the landing page.
 */
function HomeNavItem({ collapsed }: { collapsed: boolean }) {
  const goHome = useShellStore((s) => s.goHome);

  return (
    <button
      className="nav-item nav-item-home"
      onClick={goHome}
      title={collapsed ? "Home" : undefined}
      type="button"
    >
      <span className="nav-item-icon">
        <HomeIcon />
      </span>
      <span className="nav-item-label">Home</span>
    </button>
  );
}

function DefaultAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 12h6M12 9v6" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
