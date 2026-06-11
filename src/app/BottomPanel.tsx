import { useShellStore } from "../shell/store";
import { usePanelResize } from "../shell/hooks";
import { getPanelParams } from "../shell/urlState";
import type { AppManifest } from "../types/app";

/**
 * Bottom panel surface.
 * Same pattern as RightPanel but with vertical resize.
 */
export function BottomPanel({ activeApp }: { activeApp: AppManifest | null }) {
  const panelId = useShellStore((s) => s.bottomPanelId);
  const height = useShellStore((s) => s.bottomPanelHeight);
  const setHeight = useShellStore((s) => s.setBottomPanelHeight);
  const closePanel = useShellStore((s) => s.closeBottomPanel);

  const registration = activeApp?.bottomPanel ?? null;

  const minSize = registration?.minSize ?? 120;
  const maxSize = registration?.maxSize ?? Math.round(window.innerHeight * 0.8);

  const resizeHandlers = usePanelResize({
    axis: "vertical",
    currentSize: height,
    minSize,
    maxSize,
    onResize: setHeight,
  });

  if (!registration || !panelId) return null;

  const params = getPanelParams("bp");
  const PanelComponent = registration.component;

  return (
    <div className="bottom-panel" aria-label={registration.label}>
      {/* Resize handle */}
      <div
        className="resize-handle resize-handle-vertical"
        role="separator"
        aria-orientation="horizontal"
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        aria-valuenow={Math.round(height)}
        title="Drag to resize panel"
        {...resizeHandlers}
      />

      {/* Header */}
      <div className="bottom-panel-header">
        <span className="bottom-panel-title">{registration.label}</span>
        <button
          className="bottom-panel-close"
          onClick={closePanel}
          aria-label="Close panel"
          title="Close panel"
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="bottom-panel-body scrollable-y">
        <PanelComponent params={params} />
      </div>
    </div>
  );
}
