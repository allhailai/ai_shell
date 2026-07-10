/* ── Annotation Badge Overlay ─────────────────────────────────────────
   React component that renders annotation count badges as an overlay
   positioned relative to the editor wrapper. Reads heading line
   positions from the CM6 view's DOM to place badges correctly.

   This approach bypasses CM6's internal layout entirely — badges are
   standard React elements with absolute positioning.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import type { AnnotationSummaryItem } from "../../../shared/markdown/extensions/annotationGutterExtension";
import { slugify } from "../../../shared/markdown/extensions/annotationGutterExtension";

interface AnnotationBadgeOverlayProps {
  /** Ref to the CM6 EditorView */
  editorViewRef: RefObject<EditorView | null>;
  /** Annotation summary data */
  summary: AnnotationSummaryItem[];
  /** Callback when a badge is clicked */
  onBadgeClick?: (blockId: string) => void;
  /** Wrapper element ref for positioning context */
  wrapperRef: RefObject<HTMLDivElement | null>;
}

interface BadgePosition {
  blockId: string;
  count: number;
  hasOpen: boolean;
  top: number; // px relative to wrapper
}

export function AnnotationBadgeOverlay({
  editorViewRef,
  summary,
  onBadgeClick,
  wrapperRef,
}: AnnotationBadgeOverlayProps) {
  const [badges, setBadges] = useState<BadgePosition[]>([]);

  const computePositions = useCallback(() => {
    const view = editorViewRef.current;
    const wrapper = wrapperRef.current;
    if (!view || !wrapper || summary.length === 0) {
      setBadges([]);
      return;
    }

    // Build slug → summary lookup
    const summaryBySlug = new Map<string, AnnotationSummaryItem>();
    for (const item of summary) {
      const match = item.blockId.match(/^blk_(.+?)_\d+_/);
      if (match) {
        const slug = match[1];
        const existing = summaryBySlug.get(slug);
        if (!existing || (item.hasOpen && !existing.hasOpen)) {
          summaryBySlug.set(slug, item);
        }
      }
    }

    const wrapperRect = wrapper.getBoundingClientRect();
    const newBadges: BadgePosition[] = [];
    const doc = view.state.doc;

    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const headingMatch = line.text.match(/^#{1,6}\s+(.+)/);
      if (!headingMatch) continue;

      const slug = slugify(headingMatch[1]);

      for (const [key, item] of summaryBySlug) {
        if (slug === key || slug.startsWith(key) || key.startsWith(slug)) {
          // Get the screen coordinates of this line from CM6
          const coords = view.coordsAtPos(line.from);
          if (coords) {
            newBadges.push({
              blockId: item.blockId,
              count: item.count,
              hasOpen: item.hasOpen,
              top: coords.top - wrapperRect.top,
            });
          }
          summaryBySlug.delete(key);
          break;
        }
      }
    }

    setBadges(newBadges);
  }, [editorViewRef, wrapperRef, summary]);

  // Recompute on mount and when summary changes
  useEffect(() => {
    computePositions();
  }, [computePositions]);

  // Recompute on scroll — the CM6 scroll container moves line positions
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const scroller = view.scrollDOM;
    const handleScroll = () => {
      requestAnimationFrame(computePositions);
    };

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    // Also watch for window resize
    window.addEventListener("resize", handleScroll, { passive: true });

    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [editorViewRef, computePositions]);

  if (badges.length === 0) return null;

  return (
    <>
      {badges.map((badge) => (
        <button
          key={badge.blockId}
          className={`codascope-annotation-badge${badge.hasOpen ? " codascope-annotation-badge--open" : " codascope-annotation-badge--resolved"}`}
          style={{ top: `${badge.top}px` }}
          title={`${badge.count} annotation${badge.count !== 1 ? "s" : ""}${badge.hasOpen ? "" : " (all resolved)"}`}
          onClick={() => onBadgeClick?.(badge.blockId)}
          type="button"
        >
          {badge.count}
        </button>
      ))}
    </>
  );
}
