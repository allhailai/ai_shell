/* ── Shared: Inline Annotation Extension ──────────────────────────────
   Hides server-validated annotation marker comments and decorates the exact
   source range they enclose. There is intentionally no text-search or line
   fallback here: if the server cannot provide a valid pair, this extension
   has nothing to render.
   ──────────────────────────────────────────────────────────────────── */

import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSet, type Extension } from "@codemirror/state";

export interface InlineAnnotationAnchorItem {
  annotationId: string;
  startMarkerFrom: number;
  startMarkerTo: number;
  endMarkerFrom: number;
  endMarkerTo: number;
  rangeFrom: number;
  rangeTo: number;
  count: number;
  hasOpen: boolean;
}

export interface InlineAnnotationExtensionConfig {
  anchors: InlineAnnotationAnchorItem[];
  markerRanges?: Array<{ from: number; to: number }>;
  onAnnotationClick?: (annotationId: string) => void;
}

class InlineAnnotationPin extends WidgetType {
  constructor(
    private annotationId: string,
    private count: number,
    private hasOpen: boolean,
    private onClick?: (annotationId: string) => void,
  ) { super(); }

  toDOM(): HTMLElement {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = `shared-md-inline-ann-pin${this.hasOpen ? " shared-md-inline-ann-pin--open" : " shared-md-inline-ann-pin--resolved"}`;
    pin.setAttribute("aria-label", `${this.count} annotation${this.count === 1 ? "" : "s"}. Open thread.`);
    pin.title = `${this.count} annotation${this.count === 1 ? "" : "s"}. Open thread.`;
    pin.addEventListener("mousedown", (event) => event.preventDefault());
    pin.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onClick?.(this.annotationId);
    });
    return pin;
  }

  eq(other: InlineAnnotationPin): boolean {
    return this.annotationId === other.annotationId && this.count === other.count && this.hasOpen === other.hasOpen;
  }
}

function buildDecorations(
  anchors: InlineAnnotationAnchorItem[],
  markerRanges: Array<{ from: number; to: number }>,
  onClick?: (annotationId: string) => void,
): {
  decorations: DecorationSet;
  atomicRanges: RangeSet<Decoration>;
} {
  const decorations: Array<{ from: number; to: number; value: Decoration }> = [];
  const atomic: Array<{ from: number; to: number; value: Decoration }> = [];
  const hiddenMarkers = new Set(markerRanges.map((range) => `${range.from}:${range.to}`));
  for (const marker of markerRanges) {
    const replacement = Decoration.replace({});
    decorations.push({ from: marker.from, to: marker.to, value: replacement });
    atomic.push({ from: marker.from, to: marker.to, value: replacement });
  }
  for (const anchor of anchors) {
    if (anchor.rangeFrom > anchor.rangeTo || anchor.startMarkerFrom > anchor.startMarkerTo || anchor.endMarkerFrom > anchor.endMarkerTo) continue;
    const markerStart = Decoration.replace({});
    const markerEnd = Decoration.replace({});
    if (!hiddenMarkers.has(`${anchor.startMarkerFrom}:${anchor.startMarkerTo}`)) {
      decorations.push({ from: anchor.startMarkerFrom, to: anchor.startMarkerTo, value: markerStart });
      atomic.push({ from: anchor.startMarkerFrom, to: anchor.startMarkerTo, value: markerStart });
    }
    if (!hiddenMarkers.has(`${anchor.endMarkerFrom}:${anchor.endMarkerTo}`)) {
      decorations.push({ from: anchor.endMarkerFrom, to: anchor.endMarkerTo, value: markerEnd });
      atomic.push({ from: anchor.endMarkerFrom, to: anchor.endMarkerTo, value: markerEnd });
    }
    if (anchor.rangeFrom < anchor.rangeTo) {
      decorations.push({
        from: anchor.rangeFrom,
        to: anchor.rangeTo,
        value: Decoration.mark({ class: `shared-md-inline-ann-range${anchor.hasOpen ? " shared-md-inline-ann-range--open" : " shared-md-inline-ann-range--resolved"}` }),
      });
    }
    decorations.push({
      from: anchor.rangeTo,
      to: anchor.rangeTo,
      value: Decoration.widget({ widget: new InlineAnnotationPin(anchor.annotationId, anchor.count, anchor.hasOpen, onClick), side: 1 }),
    });
  }
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  atomic.sort((a, b) => a.from - b.from || a.to - b.to);
  return {
    decorations: Decoration.set(decorations.map((entry) => entry.value.range(entry.from, entry.to)), true),
    atomicRanges: RangeSet.of(atomic.map((entry) => entry.value.range(entry.from, entry.to)), true),
  };
}

/** Build the marker-hiding extension from validated server offsets only. */
export function buildInlineAnnotationExtension(config: InlineAnnotationExtensionConfig): Extension {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    atomicRanges: RangeSet<Decoration>;

    constructor(_view: EditorView) {
      const built = buildDecorations(config.anchors, config.markerRanges ?? [], config.onAnnotationClick);
      this.decorations = built.decorations;
      this.atomicRanges = built.atomicRanges;
    }

    update(update: ViewUpdate): void {
      // React refreshes this extension after reconciliation. Mapping keeps
      // markers stable during the brief interval between a local edit and the
      // next validated server response, without inventing a new location.
      if (update.docChanged) {
        this.decorations = this.decorations.map(update.changes);
        this.atomicRanges = this.atomicRanges.map(update.changes);
      }
    }
  }, { decorations: (value) => value.decorations });

  return [
    plugin,
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomicRanges ?? Decoration.none),
  ];
}
