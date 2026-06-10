import { useEffect, useMemo, type CSSProperties } from "react";
import { useShellStore } from "../shell/store";
import { hydrateStoreFromUrl, startUrlSync } from "../shell/urlState";
import { commandBus } from "../shell/commandBus";
import { plugins } from "../plugins/registry";
import { Topbar } from "./Topbar";
import { LeftNav } from "./LeftNav";
import { CanvasArea } from "./CanvasArea";
import { RightPanel } from "./RightPanel";
import { BottomPanel } from "./BottomPanel";
import { PluginRouter } from "./Router";

/**
 * Root shell component.
 * Composes the full layout: topbar, left nav, canvas, panels.
 * Manages URL sync and plugin command registration lifecycle.
 */
export function Shell() {
  // Hydrate store from URL on first mount
  useEffect(() => {
    hydrateStoreFromUrl();
    const stopSync = startUrlSync();
    return stopSync;
  }, []);

  // Register plugin commands on mount
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // Register built-in shell commands
    cleanups.push(
      commandBus.register("shell.navigate", (payload) => {
        const { pluginId } = payload as { pluginId: string };
        useShellStore.getState().setActivePlugin(pluginId);
      }),
    );
    cleanups.push(
      commandBus.register("shell.openRightPanel", (payload) => {
        const { panelId } = payload as { panelId: string };
        useShellStore.getState().openRightPanel(panelId);
      }),
    );
    cleanups.push(
      commandBus.register("shell.closeRightPanel", () => {
        useShellStore.getState().closeRightPanel();
      }),
    );
    cleanups.push(
      commandBus.register("shell.openBottomPanel", (payload) => {
        const { panelId } = payload as { panelId: string };
        useShellStore.getState().openBottomPanel(panelId);
      }),
    );
    cleanups.push(
      commandBus.register("shell.closeBottomPanel", () => {
        useShellStore.getState().closeBottomPanel();
      }),
    );

    // Register plugin commands
    for (const plugin of plugins) {
      if (plugin.commands) {
        for (const cmd of plugin.commands) {
          cleanups.push(commandBus.register(cmd.name, cmd.handler));
        }
      }
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  // Read layout state
  const leftNavCollapsed = useShellStore((s) => s.leftNavCollapsed);
  const rightPanelId = useShellStore((s) => s.rightPanelId);
  const rightPanelWidth = useShellStore((s) => s.rightPanelWidth);

  // Build dynamic CSS variables
  const shellStyle = useMemo((): CSSProperties => {
    const vars: Record<string, string> = {};
    if (rightPanelId) {
      vars["--right-panel-width"] = `${rightPanelWidth}px`;
    }
    return vars as CSSProperties;
  }, [rightPanelId, rightPanelWidth]);

  return (
    <main
      className="shell"
      data-nav={leftNavCollapsed ? "collapsed" : undefined}
      data-right-panel={rightPanelId || undefined}
      style={shellStyle}
    >
      <Topbar plugins={plugins} />
      <LeftNav plugins={plugins} />
      <CanvasArea plugins={plugins} bottomPanel={<BottomPanel plugins={plugins} />}>
        <PluginRouter plugins={plugins} />
      </CanvasArea>
      {rightPanelId && <RightPanel plugins={plugins} />}
    </main>
  );
}
