import { useShellStore } from "../shell/store";
import type { PluginManifest } from "../types/plugin";

/**
 * Top bar with brand, breadcrumb, and action buttons.
 */
export function Topbar({ plugins }: { plugins: PluginManifest[] }) {
  const activePluginId = useShellStore((s) => s.activePluginId);
  const collapsed = useShellStore((s) => s.leftNavCollapsed);
  const toggleLeftNav = useShellStore((s) => s.toggleLeftNav);
  const rightPanelId = useShellStore((s) => s.rightPanelId);
  const bottomPanelId = useShellStore((s) => s.bottomPanelId);
  const closeRightPanel = useShellStore((s) => s.closeRightPanel);
  const closeBottomPanel = useShellStore((s) => s.closeBottomPanel);

  const activePlugin = plugins.find((p) => p.id === activePluginId);

  // Collect all panels across plugins for toggle buttons
  const allRightPanels = plugins.flatMap((p) => p.panels?.right ?? []);
  const allBottomPanels = plugins.flatMap((p) => p.panels?.bottom ?? []);
  const hasRightPanels = allRightPanels.length > 0;
  const hasBottomPanels = allBottomPanels.length > 0;

  return (
    <header className="shell-topbar">
      {/* Brand */}
      <div className="topbar-brand">
        <div className="topbar-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <span className="topbar-title">AIShell</span>
      </div>

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
        {activePlugin ? (
          <>
            <span className="topbar-breadcrumb-active">{activePlugin.name}</span>
          </>
        ) : (
          <span>Home</span>
        )}
      </div>

      {/* Actions */}
      <div className="topbar-actions">
        {hasBottomPanels && (
          <button
            className={`topbar-action-button${bottomPanelId ? " active" : ""}`}
            onClick={() => bottomPanelId ? closeBottomPanel() : useShellStore.getState().openBottomPanel(allBottomPanels[0].id)}
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

        {hasRightPanels && (
          <button
            className={`topbar-action-button${rightPanelId ? " active" : ""}`}
            onClick={() => rightPanelId ? closeRightPanel() : useShellStore.getState().openRightPanel(allRightPanels[0].id)}
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
