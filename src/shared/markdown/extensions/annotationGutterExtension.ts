/* ── Shared: Annotation Gutter Extension ──────────────────────────────
   Legacy section summaries only. Exact note pins live in
   inlineAnnotationExtension.ts and are rendered from validated marker pairs.
   ──────────────────────────────────────────────────────────────────── */

import { gutter, GutterMarker, type EditorView } from "@codemirror/view";
import { RangeSetBuilder, RangeSet, StateEffect, type Extension } from "@codemirror/state";

export interface AnnotationSummaryItem {
  blockId: string;
  count: number;
  hasOpen: boolean;
}

export interface AnnotationGutterConfig {
  onAnnotationClick?: (blockId: string) => void;
  summary?: AnnotationSummaryItem[];
}

class AnnotationGutterMarker extends GutterMarker {
  constructor(
    private blockId: string,
    private count: number,
    private hasOpen: boolean,
    private onClick?: (blockId: string) => void,
  ) { super(); }

  toDOM(): HTMLElement {
    const badge = document.createElement("span");
    badge.className = `shared-md-ann-badge${this.hasOpen ? " shared-md-ann-badge--open" : " shared-md-ann-badge--resolved"}`;
    badge.textContent = String(this.count);
    badge.title = `${this.count} annotation${this.count === 1 ? "" : "s"}`;
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onClick?.(this.blockId);
    });
    return badge;
  }
}

export function buildAnnotationGutterExtension(config: AnnotationGutterConfig): Extension {
  const summary = config.summary ?? [];
  return gutter({
    class: "shared-md-ann-gutter",
    markers(view: EditorView): RangeSet<GutterMarker> {
      const bySlug = new Map<string, AnnotationSummaryItem>();
      for (const item of summary) {
        const match = item.blockId.match(/^blk_(.+?)_\d+_/);
        if (match) bySlug.set(match[1], item);
      }
      const builder = new RangeSetBuilder<GutterMarker>();
      for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber++) {
        const line = view.state.doc.line(lineNumber);
        const heading = line.text.match(/^#{1,6}\s+(.+)/);
        if (!heading) continue;
        const item = bySlug.get(slugify(heading[1]));
        if (item) builder.add(line.from, line.from, new AnnotationGutterMarker(item.blockId, item.count, item.hasOpen, config.onAnnotationClick));
      }
      return builder.finish();
    },
  });
}

export const setAnnotationSummary = StateEffect.define<AnnotationSummaryItem[]>();

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "root";
}
