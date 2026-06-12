import type { AppManifest } from "../types/app";
import { useShellStore } from "../shell/store";
import { useCallback, useMemo } from "react";

/**
 * Left navigation panel.
 *
 * Three modes:
 * 1. No active app → shows a list of available apps (launcher nav)
 * 2. Active app with `leftNav` → renders the app's left nav component
 * 3. Active app without `leftNav` → shows only a home button
 *
 * System apps (system: true) are always rendered at the bottom with a separator.
 */
export function LeftNav({
  apps,
  activeApp,
}: {
  apps: AppManifest[];
  activeApp: AppManifest | null;
}) {
  const collapsed = useShellStore((s) => s.leftNavCollapsed);

  const { regularApps, systemApps } = useMemo(() => {
    const regular: AppManifest[] = [];
    const system: AppManifest[] = [];
    for (const app of apps) {
      if (app.system) {
        system.push(app);
      } else {
        regular.push(app);
      }
    }
    return { regularApps: regular, systemApps: system };
  }, [apps]);

  if (!activeApp) {
    // Mode 1: Launcher nav — show app list
    return (
      <nav className="left-nav" aria-label="Application navigation">
        <div className="left-nav-content scrollable-y">
          <div className="left-nav-top">
            {regularApps.map((app) => (
              <AppNavItem key={app.id} app={app} collapsed={collapsed} />
            ))}
          </div>
          {systemApps.length > 0 && (
            <div className="left-nav-bottom">
              <div className="nav-divider" />
              {systemApps.map((app) => (
                <AppNavItem key={app.id} app={app} collapsed={collapsed} />
              ))}
            </div>
          )}
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
          <div className="left-nav-top">
            {/* Home button at the top */}
            <HomeNavItem collapsed={collapsed} />
            <div className="nav-divider" />
            <AppNav />
          </div>
          {systemApps.length > 0 && (
            <div className="left-nav-bottom">
              <div className="nav-divider" />
              {systemApps.map((app) => (
                <AppNavItem key={app.id} app={app} collapsed={collapsed} />
              ))}
            </div>
          )}
        </div>
      </nav>
    );
  }

  // Mode 3: No app nav — just a home button
  return (
    <nav className="left-nav" aria-label="Navigation">
      <div className="left-nav-content scrollable-y">
        <div className="left-nav-top">
          <HomeNavItem collapsed={collapsed} />
        </div>
        {systemApps.length > 0 && (
          <div className="left-nav-bottom">
            <div className="nav-divider" />
            {systemApps.map((app) => (
              <AppNavItem key={app.id} app={app} collapsed={collapsed} />
            ))}
          </div>
        )}
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
  const activeAppId = useShellStore((s) => s.activeAppId);
  const handleClick = useCallback(() => {
    setActiveApp(app.id);
  }, [app.id, setActiveApp]);

  const Icon = app.icon;
  const isActive = activeAppId === app.id;

  return (
    <button
      className={`nav-item${isActive ? " active" : ""}`}
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
 * Back button that navigates to the applications landing page.
 */
function HomeNavItem({ collapsed }: { collapsed: boolean }) {
  const goHome = useShellStore((s) => s.goHome);

  return (
    <button
      className="nav-item nav-item-home"
      onClick={goHome}
      title={collapsed ? "Applications" : undefined}
      type="button"
    >
      <span className="nav-item-icon">
        <BackArrowIcon />
      </span>
      <span className="nav-item-label">Applications</span>
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

function BackArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

