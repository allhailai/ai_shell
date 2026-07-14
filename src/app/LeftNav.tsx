import type { AppManifest } from "../types/app";
import { useShellStore } from "../shell/store";
import { useAuth } from "../shell/authContext";
import { canAccessApp } from "../shell/appAccess";
import { useCallback, useMemo, type ReactNode } from "react";

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
  const { user } = useAuth();
  const collapsed = useShellStore((s) => s.leftNavCollapsed);
  const toggleLeftNav = useShellStore((s) => s.toggleLeftNav);

  const { regularApps, systemApps } = useMemo(() => {
    const regular: AppManifest[] = [];
    const system: AppManifest[] = [];
    for (const app of apps.filter((candidate) => canAccessApp(candidate, user))) {
      if (app.system) {
        system.push(app);
      } else {
        regular.push(app);
      }
    }
    return { regularApps: regular, systemApps: system };
  }, [apps, user]);

  if (!activeApp) {
    // Mode 1: Launcher nav — show app list
    return (
      <LeftNavShell collapsed={collapsed} onToggle={toggleLeftNav}>
        <div className="left-nav-content scrollable-y">
          <div className="left-nav-top">
            {regularApps.map((app) => (
              <AppNavItem key={app.id} app={app} collapsed={collapsed} />
            ))}
          </div>
          <div className="left-nav-bottom">
            {systemApps.length > 0 && (
              <>
                <div className="nav-divider" />
                {systemApps.map((app) => (
                  <AppNavItem key={app.id} app={app} collapsed={collapsed} />
                ))}
              </>
            )}
          </div>
        </div>
      </LeftNavShell>
    );
  }

  if (activeApp.leftNav) {
    // Mode 2: App-provided left nav
    const AppNav = activeApp.leftNav;
    return (
      <LeftNavShell collapsed={collapsed} onToggle={toggleLeftNav} label={`${activeApp.name} navigation`}>
        <div className="left-nav-content scrollable-y">
          <div className="left-nav-top">
            <AppNav />
          </div>
          <div className="left-nav-bottom">
            <ShellNavSection collapsed={collapsed} systemApps={systemApps} />
          </div>
        </div>
      </LeftNavShell>
    );
  }

  // Mode 3: No app nav — just a home button
  return (
    <LeftNavShell collapsed={collapsed} onToggle={toggleLeftNav}>
      <div className="left-nav-content scrollable-y">
        <div className="left-nav-top" />
        <div className="left-nav-bottom">
          <ShellNavSection collapsed={collapsed} systemApps={systemApps} />
        </div>
      </div>
    </LeftNavShell>
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
 * Shell-level nav section rendered at the bottom of the left nav.
 * Groups the "← Applications" link and system apps (Settings) under
 * an "AISHELL" label so users can clearly distinguish shell navigation
 * from app-specific items.
 */
function ShellNavSection({
  collapsed,
  systemApps,
}: {
  collapsed: boolean;
  systemApps: AppManifest[];
}) {
  const goHome = useShellStore((s) => s.goHome);

  return (
    <>
      <div className="nav-divider" />
      {!collapsed && (
        <div className="nav-section-label">AIShell</div>
      )}
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
      {systemApps.map((app) => (
        <AppNavItem key={app.id} app={app} collapsed={collapsed} />
      ))}
    </>
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

/**
 * Wrapper for left nav that adds the collapse/expand toggle button,
 * matching CodaScope's panel collapse pattern.
 */
function LeftNavShell({
  collapsed,
  onToggle,
  label,
  children,
}: {
  collapsed: boolean;
  onToggle: () => void;
  label?: string;
  children: ReactNode;
}) {
  return (
    <nav className="left-nav" aria-label={label ?? "Application navigation"}>
      {/* Collapse/expand toggle — pinned to the top-right of the nav */}
      <div className="shell-panel-collapse-row">
        <button
          className="shell-panel-collapse-btn"
          onClick={onToggle}
          type="button"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "▶" : "◀"}
        </button>
      </div>
      {children}
    </nav>
  );
}
