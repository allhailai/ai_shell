import { useEffect, useMemo, type CSSProperties } from "react";
import { useShellStore } from "../shell/store";
import { hydrateStoreFromUrl, startUrlSync } from "../shell/urlState";
import { commandBus } from "../shell/commandBus";
import { apps } from "../apps/registry";
import { Topbar } from "./Topbar";
import { LeftNav } from "./LeftNav";
import { CanvasArea } from "./CanvasArea";
import { RightPanel } from "./RightPanel";
import { BottomPanel } from "./BottomPanel";
import { LandingPage } from "./LandingPage";

/**
 * Root shell component.
 * Composes the full layout: topbar, left nav, canvas, panels.
 * Manages URL sync and app command registration lifecycle.
 */
export function Shell() {
  // Hydrate store from URL on first mount
  useEffect(() => {
    hydrateStoreFromUrl();
    const stopSync = startUrlSync();
    return stopSync;
  }, []);

  // Register app commands on mount
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // Register built-in shell commands
    cleanups.push(
      commandBus.register("shell.navigate", (payload) => {
        const { appId } = payload as { appId: string };
        useShellStore.getState().setActiveApp(appId);
      }),
    );
    cleanups.push(
      commandBus.register("shell.goHome", () => {
        useShellStore.getState().goHome();
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

    // Register app commands
    for (const app of apps) {
      if (app.commands) {
        for (const cmd of app.commands) {
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
  const activeAppId = useShellStore((s) => s.activeAppId);
  const rightPanelId = useShellStore((s) => s.rightPanelId);
  const rightPanelWidth = useShellStore((s) => s.rightPanelWidth);

  // Find the active app
  const activeApp = useMemo(
    () => apps.find((a) => a.id === activeAppId) ?? null,
    [activeAppId],
  );

  // Build dynamic CSS variables
  const shellStyle = useMemo((): CSSProperties => {
    const vars: Record<string, string> = {};
    if (rightPanelId) {
      vars["--right-panel-width"] = `${rightPanelWidth}px`;
    }
    return vars as CSSProperties;
  }, [rightPanelId, rightPanelWidth]);

  // Determine the main content
  const MainContent = activeApp?.mainContent;

  return (
    <main
      className="shell"
      data-nav={leftNavCollapsed ? "collapsed" : undefined}
      data-right-panel={rightPanelId || undefined}
      style={shellStyle}
    >
      <Topbar activeApp={activeApp} />
      <LeftNav apps={apps} activeApp={activeApp} />
      <CanvasArea bottomPanel={<BottomPanel activeApp={activeApp} />}>
        {MainContent ? <MainContent /> : <LandingPage apps={apps} />}
      </CanvasArea>
      {rightPanelId && <RightPanel activeApp={activeApp} />}
    </main>
  );
}
