/* ── Shell React Hooks ────────────────────────────────────────────────
   Convenience hooks for apps to interact with the shell.
   Import from "../../shell/hooks" in app code.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShellStore } from "./store";
import { commandBus } from "./commandBus";
import { getPanelParams, setPanelParams } from "./urlState";

/**
 * Hook to open/close/toggle the right panel for a specific panel ID.
 */
export function useRightPanel(panelId: string) {
  const currentId = useShellStore((s) => s.rightPanelId);
  const isOpen = currentId === panelId;

  const open = useCallback(
    () => useShellStore.getState().openRightPanel(panelId),
    [panelId],
  );
  const close = useCallback(
    () => useShellStore.getState().closeRightPanel(),
    [],
  );
  const toggle = useCallback(
    () => useShellStore.getState().toggleRightPanel(panelId),
    [panelId],
  );

  return useMemo(() => ({ isOpen, open, close, toggle }), [isOpen, open, close, toggle]);
}

/**
 * Hook to open/close/toggle the bottom panel for a specific panel ID.
 */
export function useBottomPanel(panelId: string) {
  const currentId = useShellStore((s) => s.bottomPanelId);
  const isOpen = currentId === panelId;

  const open = useCallback(
    () => useShellStore.getState().openBottomPanel(panelId),
    [panelId],
  );
  const close = useCallback(
    () => useShellStore.getState().closeBottomPanel(),
    [],
  );
  const toggle = useCallback(
    () => useShellStore.getState().toggleBottomPanel(panelId),
    [panelId],
  );

  return useMemo(() => ({ isOpen, open, close, toggle }), [isOpen, open, close, toggle]);
}

/**
 * Hook to read/write URL params namespaced to a panel.
 *
 * Example: If the right panel uses this with prefix "rp":
 *   ?rp.conversationId=abc → params = { conversationId: "abc" }
 */
export function usePanelParams(prefix: "rp" | "bp") {
  const [params, setParamsState] = useState(() => getPanelParams(prefix));

  // Re-read on popstate (browser back/forward)
  useEffect(() => {
    const handlePopState = () => setParamsState(getPanelParams(prefix));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [prefix]);

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      setPanelParams(prefix, updates);
      setParamsState(getPanelParams(prefix));
    },
    [prefix],
  );

  return [params, setParams] as const;
}

/**
 * Hook to use the command bus within a React component.
 * Automatically cleans up registered handlers on unmount.
 */
export function useCommandBus() {
  const cleanupRef = useRef<(() => void)[]>([]);

  const register = useCallback((command: string, handler: (payload: unknown) => unknown | Promise<unknown>) => {
    const unsub = commandBus.register(command, handler);
    cleanupRef.current.push(unsub);
    return unsub;
  }, []);

  const on = useCallback((event: string, listener: (payload: unknown) => void) => {
    const unsub = commandBus.on(event, listener);
    cleanupRef.current.push(unsub);
    return unsub;
  }, []);

  useEffect(() => {
    return () => {
      for (const cleanup of cleanupRef.current) cleanup();
      cleanupRef.current = [];
    };
  }, []);

  return useMemo(
    () => ({
      register,
      invoke: commandBus.invoke.bind(commandBus),
      emit: commandBus.emit.bind(commandBus),
      on,
    }),
    [register, on],
  );
}

/**
 * Hook for pointer-capture-based panel resizing.
 * Used by right panel (horizontal) and bottom panel (vertical).
 */
export function usePanelResize({
  axis,
  currentSize,
  minSize,
  maxSize,
  onResize,
  onCommit,
}: {
  axis: "horizontal" | "vertical";
  currentSize: number;
  minSize: number;
  maxSize: number;
  onResize: (size: number) => void;
  onCommit?: () => void;
}) {
  const draggingRef = useRef(false);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      startPosRef.current = axis === "horizontal" ? e.clientX : e.clientY;
      startSizeRef.current = currentSize;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [axis, currentSize],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      const pos = axis === "horizontal" ? e.clientX : e.clientY;
      // For right panel: dragging left increases width. For bottom: dragging up increases height.
      const delta = startPosRef.current - pos;
      const newSize = Math.min(maxSize, Math.max(minSize, startSizeRef.current + delta));
      onResize(newSize);
    },
    [axis, minSize, maxSize, onResize],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      onCommit?.();
    },
    [onCommit],
  );

  return useMemo(
    () => ({
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
    }),
    [handlePointerDown, handlePointerMove, handlePointerUp],
  );
}
