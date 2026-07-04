import { useShellStore } from "../shell/store";
import { usePanelResize } from "../shell/hooks";
import { getPanelParams } from "../shell/urlState";
import type { AppManifest } from "../types/app";

/**
 * Right panel surface.
 * Renders the active app's right panel registration if the panel is open.
 */
export function RightPanel({ activeApp }: { activeApp: AppManifest | null }) {
  const panelId = useShellStore((s) => s.rightPanelId);
  const width = useShellStore((s) => s.rightPanelWidth);
  const setWidth = useShellStore((s) => s.setRightPanelWidth);
  const closePanel = useShellStore((s) => s.closeRightPanel);

  const registration = activeApp?.rightPanel ?? null;

  const minSize = registration?.minSize ?? 280;
  const maxSize = registration?.maxSize ?? Math.round(window.innerWidth * 0.6);

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
        <button
          className="shell-panel-collapse-btn"
          onClick={closePanel}
          aria-label="Collapse panel"
          title="Collapse panel"
          type="button"
        >
          ▶
        </button>
        <span className="right-panel-title">{registration.label}</span>
      </div>

      {/* Body */}
      <div className="right-panel-body">
        <PanelComponent params={params} />
      </div>
    </aside>
  );
}
