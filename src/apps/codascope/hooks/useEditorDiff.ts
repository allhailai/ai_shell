/* ── useEditorDiff ──────────────────────────────────────────────────
   Tracks diff highlighting state for the DocumentEditor.
   Compares old vs new block content by hash, highlights changed blocks
   with a CSS class, then fades the highlight out after 5 seconds.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, useCallback } from "react";
import type { BlockInfo } from "../codaScopeTypes";

/** Simple string hash for diff comparison (djb2 algorithm) */
function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

interface UseEditorDiffResult {
  changedBlockIds: Set<string>;
  fadingBlockIds: Set<string>;
  /** Call after fetching new blocks to run the diff comparison */
  trackContentChange: (newBlocks: BlockInfo[], content: string) => void;
}

export function useEditorDiff(): UseEditorDiffResult {
  const [changedBlockIds, setChangedBlockIds] = useState<Set<string>>(new Set());
  const [fadingBlockIds, setFadingBlockIds] = useState<Set<string>>(new Set());
  const previousContentRef = useRef<string>("");
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup fade timer on unmount
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  const trackContentChange = useCallback((newBlocks: BlockInfo[], content: string) => {
    if (previousContentRef.current && previousContentRef.current !== content) {
      const oldBlockHashes = new Map<string, number>();
      // Simple hash per block from previous render's blocks
      const oldLines = previousContentRef.current.split("\n");
      for (const block of newBlocks) {
        const blockContent = oldLines.slice(block.lineStart - 1, block.lineEnd).join("\n");
        oldBlockHashes.set(block.blockId, simpleHash(blockContent));
      }
      const changed = new Set<string>();
      for (const block of newBlocks) {
        const newBlockContent = content.split("\n").slice(block.lineStart - 1, block.lineEnd).join("\n");
        const newHash = simpleHash(newBlockContent);
        const oldHash = oldBlockHashes.get(block.blockId);
        if (oldHash !== undefined && oldHash !== newHash) {
          changed.add(block.blockId);
        }
      }
      // Also mark any blocks that exist in new but not old
      if (changed.size > 0) {
        setChangedBlockIds(changed);
        setFadingBlockIds(new Set());
        // Start fade-out timer
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = setTimeout(() => {
          setFadingBlockIds(changed);
          // After transition completes, clear everything
          setTimeout(() => {
            setChangedBlockIds(new Set());
            setFadingBlockIds(new Set());
          }, 1000);
        }, 5000);
      }
    }
    previousContentRef.current = content;
  }, []);

  return { changedBlockIds, fadingBlockIds, trackContentChange };
}
