/* ── Shared: Annotation Gutter Extension ─────────────────────────────
   CM6 LEFT GUTTER that renders annotation-count badges next to
   annotated heading-level sections. Uses CM6's built-in gutter() API
   which places markers in the gutter area alongside line numbers.

   The summary data is passed directly via a closure — no CM6 state
   field needed. When the summary changes, the MarkdownEditor rebuilds
   extensions (via useMemo) which re-creates this gutter with the new
   data.

   Badges are color-coded:
     - has open annotations → accent color
     - all resolved → muted color
   ──────────────────────────────────────────────────────────────────── */

import {
  gutter,
  GutterMarker,
} from "@codemirror/view";
import {
  RangeSetBuilder,
  RangeSet,
  type Extension,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/* ── Public types ────────────────────────────────────────────────── */

export interface AnnotationSummaryItem {
  blockId: string;
  count: number;
  hasOpen: boolean;
}

export interface AnnotationGutterConfig {
  onAnnotationClick?: (blockId: string) => void;
  summary?: AnnotationSummaryItem[];
}

/* ── Gutter marker ───────────────────────────────────────────────── */

class AnnotationGutterMarker extends GutterMarker {
  constructor(
    readonly blockId: string,
    readonly count: number,
    readonly hasOpen: boolean,
    readonly onClick: ((blockId: string) => void) | undefined,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const badge = document.createElement("span");
    badge.className = `shared-md-ann-badge${this.hasOpen ? " shared-md-ann-badge--open" : " shared-md-ann-badge--resolved"}`;
    badge.textContent = String(this.count);
    badge.title = `${this.count} annotation${this.count !== 1 ? "s" : ""}${this.hasOpen ? "" : " (all resolved)"}`;
    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onClick?.(this.blockId);
    });
    return badge;
  }

  eq(other: AnnotationGutterMarker): boolean {
    return this.blockId === other.blockId && this.count === other.count && this.hasOpen === other.hasOpen;
  }
}

/* ── Build extension ─────────────────────────────────────────────── */

export function buildAnnotationGutterExtension(config: AnnotationGutterConfig): Extension {
  const summary = config.summary ?? [];

  const annotationGutter = gutter({
    class: "shared-md-ann-gutter",
    markers(view: EditorView): RangeSet<GutterMarker> {
      if (summary.length === 0) {
        return RangeSet.empty;
      }

      // Build slug → summary map
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

      const doc = view.state.doc;
      const markers: Array<{ pos: number; marker: AnnotationGutterMarker }> = [];

      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const headingMatch = line.text.match(/^#{1,6}\s+(.+)/);
        if (!headingMatch) continue;

        const headingSlug = slugify(headingMatch[1]);

        for (const [key, item] of summaryBySlug) {
          if (headingSlug === key || headingSlug.startsWith(key) || key.startsWith(headingSlug)) {
            markers.push({
              pos: line.from,
              marker: new AnnotationGutterMarker(
                item.blockId,
                item.count,
                item.hasOpen,
                config.onAnnotationClick,
              ),
            });
            summaryBySlug.delete(key);
            break;
          }
        }
      }

      // Must be sorted by position for RangeSet
      markers.sort((a, b) => a.pos - b.pos);
      const builder = new RangeSetBuilder<GutterMarker>();
      for (const { pos, marker } of markers) {
        builder.add(pos, pos, marker);
      }
      return builder.finish();
    },
  });

  return annotationGutter;
}

/* ── Deprecated exports kept for compatibility ───────────────────── */

// setAnnotationSummary is no longer used — data flows via config.summary
import { StateEffect } from "@codemirror/state";
export const setAnnotationSummary = StateEffect.define<AnnotationSummaryItem[]>();

/* ── Helpers ──────────────────────────────────────────────────────── */

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "root";
}
