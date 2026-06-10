import { useMemo } from "react";
import { useShellStore } from "../shell/store";
import { usePanelResize } from "../shell/hooks";
import { getPanelParams } from "../shell/urlState";
import type { PluginManifest, PanelRegistration } from "../types/plugin";

/**
 * Right panel surface.
 * Looks up the active panel ID from the store, finds the matching
 * PanelRegistration from the plugin registry, and renders it.
 */
export function RightPanel({ plugins }: { plugins: PluginManifest[] }) {
  const panelId = useShellStore((s) => s.rightPanelId);
  const width = useShellStore((s) => s.rightPanelWidth);
  const setWidth = useShellStore((s) => s.setRightPanelWidth);
  const closePanel = useShellStore((s) => s.closeRightPanel);

  // Find the panel registration across all plugins
  const registration = useMemo((): PanelRegistration | null => {
    if (!panelId) return null;
    for (const plugin of plugins) {
      const panel = plugin.panels?.right?.find((p) => p.id === panelId);
      if (panel) return panel;
    }
    return null;
  }, [panelId, plugins]);

  const minSize = registration?.minSize ?? 280;
  const maxSize = registration?.maxSize ?? 600;

  const resizeHandlers = usePanelResize({
    axis: "horizontal",
    currentSize: width,
    minSize,
    maxSize,
    onResize: setWidth,
  });

  if (!registration || !panelId) return null;

  const params = getPanelParams("rp");
  const PanelComponent = registration.component;

  return (
    <aside className="right-panel" aria-label={registration.label}>
      {/* Resize handle */}
      <div
        className="resize-handle resize-handle-horizontal"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        aria-valuenow={Math.round(width)}
        title="Drag to resize panel"
        {...resizeHandlers}
      />

      {/* Header */}
      <div className="right-panel-header">
        <span className="right-panel-title">{registration.label}</span>
        <button
          className="right-panel-close"
          onClick={closePanel}
          aria-label="Close panel"
          title="Close panel"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="right-panel-body">
        <PanelComponent params={params} />
      </div>
    </aside>
  );
}
