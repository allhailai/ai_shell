import { useShellStore } from "../shell/store";
import type { AppManifest } from "../types/app";

/**
 * Top bar with brand, breadcrumb, app header items, and action buttons.
 */
export function Topbar({ activeApp }: { activeApp: AppManifest | null }) {
  const collapsed = useShellStore((s) => s.leftNavCollapsed);
  const toggleLeftNav = useShellStore((s) => s.toggleLeftNav);
  const goHome = useShellStore((s) => s.goHome);
  const rightPanelId = useShellStore((s) => s.rightPanelId);
  const bottomPanelId = useShellStore((s) => s.bottomPanelId);
  const closeRightPanel = useShellStore((s) => s.closeRightPanel);
  const closeBottomPanel = useShellStore((s) => s.closeBottomPanel);

  const hasRightPanel = !!activeApp?.rightPanel;
  const hasBottomPanel = !!activeApp?.bottomPanel;

  // Render app-provided header items
  const AppHeaderItems = activeApp?.headerItems;

  return (
    <header className="shell-topbar">
      {/* Brand — clickable to go home */}
      <button
        className="topbar-brand"
        onClick={goHome}
        type="button"
        title="Back to applications"
      >
        <div className="topbar-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <span className="topbar-title">AIShell</span>
      </button>

      {/* Nav toggle */}
      <button
        className="topbar-nav-toggle"
        onClick={toggleLeftNav}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {collapsed ? (
            <>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <path d="M14 9l3 3-3 3" />
            </>
          ) : (
            <>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <path d="M15 9l-3 3 3 3" />
            </>
          )}
        </svg>
      </button>

      {/* Breadcrumb */}
      <div className="topbar-breadcrumb">
        {activeApp ? (
          <>
            <span className="topbar-breadcrumb-active">{activeApp.name}</span>
          </>
        ) : (
          <span>Applications</span>
        )}
      </div>

      {/* App header items (injected by active app) */}
      {AppHeaderItems && (
        <div className="topbar-app-items">
          <AppHeaderItems />
        </div>
      )}

      {/* Actions */}
      <div className="topbar-actions">
        {hasBottomPanel && (
          <button
            className={`topbar-action-button${bottomPanelId ? " active" : ""}`}
            onClick={() => bottomPanelId ? closeBottomPanel() : useShellStore.getState().openBottomPanel(activeApp!.bottomPanel!.id)}
            aria-pressed={!!bottomPanelId}
            title={bottomPanelId ? "Close bottom panel" : "Open bottom panel"}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="15" x2="21" y2="15" />
            </svg>
            <span>Panel</span>
          </button>
        )}

        {hasRightPanel && (
          <button
            className={`topbar-action-button${rightPanelId ? " active" : ""}`}
            onClick={() => rightPanelId ? closeRightPanel() : useShellStore.getState().openRightPanel(activeApp!.rightPanel!.id)}
            aria-pressed={!!rightPanelId}
            title={rightPanelId ? "Close right panel" : "Open right panel"}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
            <span>Sidebar</span>
          </button>
        )}
      </div>
    </header>
  );
}
