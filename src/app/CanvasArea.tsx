import { useMemo, type ReactNode } from "react";
import { useShellStore } from "../shell/store";
import type { PluginManifest } from "../types/plugin";

/**
 * Canvas area containing the main content and optional bottom panel.
 * Uses a nested CSS grid so the bottom panel can resize independently.
 */
export function CanvasArea({
  children,
  bottomPanel,
}: {
  children: ReactNode;
  bottomPanel: ReactNode;
  plugins: PluginManifest[];
}) {
  const bottomPanelId = useShellStore((s) => s.bottomPanelId);
  const bottomPanelHeight = useShellStore((s) => s.bottomPanelHeight);

  const style = useMemo(() => {
    if (!bottomPanelId) return undefined;
    return { "--bottom-panel-height": `${bottomPanelHeight}px` } as React.CSSProperties;
  }, [bottomPanelId, bottomPanelHeight]);

  return (
    <div
      className="shell-canvas-area"
      data-bottom-panel={bottomPanelId || undefined}
      style={style}
    >
      <div className="shell-canvas scrollable-y">
        {children}
      </div>
      {bottomPanel}
    </div>
  );
}
