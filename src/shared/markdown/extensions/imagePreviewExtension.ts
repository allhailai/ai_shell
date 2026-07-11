/* ── Image Preview Extension ─────────────────────────────────────────
   CodeMirror 6 extension for inline image preview in markdown.

   Detects ![alt](url) patterns, hides the raw markdown when the cursor
   is NOT on the image line, and renders an <img> widget with resize
   handles. Resize updates alt text to ![alt|WxH](url) (Obsidian convention).

   Pattern: follows mermaidExtension.ts — WidgetType + StateField +
   cursor-aware show/hide.
   ──────────────────────────────────────────────────────────────────── */

import { RangeSetBuilder, StateField, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

// ── Image reference parser ──────────────────────────────────────────

export interface ImageRef {
  /** Full match start offset. */
  from: number;
  /** Full match end offset. */
  to: number;
  /** Line number (1-indexed). */
  lineNumber: number;
  /** Raw alt text (may include |WxH). */
  rawAlt: string;
  /** Cleaned alt text (without |WxH). */
  cleanAlt: string;
  /** Image URL/path. */
  url: string;
  /** Parsed width from alt text. */
  width?: number;
  /** Parsed height from alt text. */
  height?: number;
  /** Whether the image tag is the only content on its line. */
  isBlockImage: boolean;
}

/**
 * Parse |WxH from image alt text (Obsidian convention).
 * Reused from MarkdownViewer logic.
 */
export function parseImageDimensions(alt: string): { cleanAlt: string; width?: number; height?: number } {
  const match = alt.match(/^(.*?)\|(\d+)x(\d+)$/);
  if (match) {
    return {
      cleanAlt: match[1].trim(),
      width: parseInt(match[2], 10),
      height: parseInt(match[3], 10),
    };
  }
  return { cleanAlt: alt };
}

/** Scan a document for all image references. */
function findImageRefs(doc: Text): ImageRef[] {
  const refs: ImageRef[] = [];
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const text = doc.toString();
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(text)) !== null) {
    const rawAlt = match[1];
    const url = match[2];
    const { cleanAlt, width, height } = parseImageDimensions(rawAlt);
    const line = doc.lineAt(match.index);
    const lineText = line.text.trim();
    const isBlockImage = lineText === match[0];

    refs.push({
      from: match.index,
      to: match.index + match[0].length,
      lineNumber: line.number,
      rawAlt,
      cleanAlt,
      url,
      width,
      height,
      isBlockImage,
    });
  }

  return refs;
}

// ── Config ──────────────────────────────────────────────────────────

export interface ImagePreviewConfig {
  /** Whether the editor is editable (controls cursor-aware reveal). */
  editable: boolean;
  /** Optional URL resolver for relative image paths. */
  resolveImageUrl?: (src: string) => string;
}

// ── Cursor-line detection ───────────────────────────────────────────

function cursorLineNumbers(state: EditorState, editable: boolean): Set<number> {
  if (!editable) return new Set();
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;
    for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber++) {
      lines.add(lineNumber);
    }
  }
  return lines;
}

// ── Image widget ────────────────────────────────────────────────────

class ImageWidget extends WidgetType {
  constructor(
    private readonly ref: ImageRef,
    private readonly resolvedUrl: string,
    private readonly editable: boolean,
  ) { super(); }

  eq(other: ImageWidget) {
    return this.ref.url === other.ref.url
      && this.ref.width === other.ref.width
      && this.ref.height === other.ref.height
      && this.ref.cleanAlt === other.ref.cleanAlt;
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "shared-md-image-preview-wrapper";

    const container = document.createElement("div");
    container.className = "shared-md-image-preview-container";

    const img = document.createElement("img");
    img.className = "shared-md-image-preview-img";
    img.src = this.resolvedUrl;
    img.alt = this.ref.cleanAlt;
    img.draggable = false;

    if (this.ref.width) img.style.width = `${this.ref.width}px`;
    if (this.ref.height) img.style.height = `${this.ref.height}px`;

    // Error fallback
    img.onerror = () => {
      container.classList.add("shared-md-image-preview-error");
      img.style.display = "none";
      const errorEl = document.createElement("div");
      errorEl.className = "shared-md-image-preview-error-msg";
      errorEl.textContent = `Failed to load: ${this.ref.url}`;
      container.appendChild(errorEl);
    };

    container.appendChild(img);

    // Resize handle (only in editable mode)
    if (this.editable) {
      this.attachResizeHandle(container, img, view);
    }

    wrapper.appendChild(container);
    return wrapper;
  }

  private attachResizeHandle(container: HTMLElement, img: HTMLImageElement, view: EditorView) {
    const handle = document.createElement("div");
    handle.className = "shared-md-image-preview-resize-handle";
    handle.title = "Drag to resize";
    container.appendChild(handle);

    let startX = 0;
    let startWidth = 0;
    let aspectRatio = 1;

    const onMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const delta = e.clientX - startX;
      const newWidth = Math.max(50, startWidth + delta);
      const newHeight = Math.round(newWidth / aspectRatio);
      img.style.width = `${newWidth}px`;
      img.style.height = `${newHeight}px`;
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      container.classList.remove("shared-md-image-preview-resizing");

      // Compute final dimensions
      const finalWidth = Math.round(img.offsetWidth);
      const finalHeight = Math.round(img.offsetHeight);

      // Update the markdown source: replace ![alt](url) with ![alt|WxH](url)
      this.updateImageDimensions(view, finalWidth, finalHeight);
    };

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startWidth = img.offsetWidth;
      aspectRatio = (img.naturalWidth / img.naturalHeight) || 1;
      document.body.style.userSelect = "none";
      container.classList.add("shared-md-image-preview-resizing");
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  private updateImageDimensions(view: EditorView, width: number, height: number) {
    const doc = view.state.doc;
    const text = doc.toString();

    // Find the current image in the document by matching position
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    let currentIndex = 0;

    while ((match = imgRegex.exec(text)) !== null) {
      if (match[2] === this.ref.url) {
        // Check if this is roughly the same position (in case of duplicates)
        if (currentIndex === 0 || Math.abs(match.index - this.ref.from) < 5) {
          const rawAlt = match[1];
          // Strip existing |WxH from alt
          const cleanAlt = rawAlt.replace(/\|\d+x\d+$/, "").trim();
          const newTag = `![${cleanAlt}|${width}x${height}](${this.ref.url})`;

          view.dispatch({
            changes: {
              from: match.index,
              to: match.index + match[0].length,
              insert: newTag,
            },
          });
          return;
        }
        currentIndex++;
      }
    }
  }

  ignoreEvent() { return true; }
}

class EmptyImageWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "shared-md-image-preview-hidden-source";
    return span;
  }
}

// ── Decoration builder ──────────────────────────────────────────────

function buildImageDecorations(state: EditorState, config: ImagePreviewConfig): DecorationSet {
  const doc = state.doc;
  const cursorLines = cursorLineNumbers(state, config.editable);
  const builder = new RangeSetBuilder<Decoration>();
  const refs = findImageRefs(doc);
  const resolve = config.resolveImageUrl ?? ((s: string) => s);

  for (const ref of refs) {
    // Skip if cursor is on the image line
    if (cursorLines.has(ref.lineNumber)) continue;

    // Skip images inside code fences
    const line = doc.line(ref.lineNumber);
    if (isInsideCodeFence(doc, line.number)) continue;

    const resolvedUrl = resolve(ref.url);

    // For block images (image is the only content on the line), replace the entire line content
    if (ref.isBlockImage) {
      builder.add(ref.from, ref.from, Decoration.widget({
        block: true,
        side: -1,
        widget: new ImageWidget(ref, resolvedUrl, config.editable),
      }));

      // Hide the raw markdown text (but keep the line navigable for cursor movement)
      builder.add(ref.from, ref.to, Decoration.replace({ widget: new EmptyImageWidget() }));
    } else {
      // Inline image — replace just the image tag with a widget
      builder.add(ref.from, ref.to, Decoration.replace({
        widget: new ImageWidget(ref, resolvedUrl, config.editable),
      }));
    }
  }

  return builder.finish();
}

/** Check if a line number is inside a fenced code block. */
function isInsideCodeFence(doc: Text, lineNum: number): boolean {
  let inFence = false;
  for (let i = 1; i < lineNum; i++) {
    const text = doc.line(i).text.trimStart();
    if (/^(`{3,}|~{3,})/.test(text)) {
      inFence = !inFence;
    }
  }
  return inFence;
}

// ── Extension entry point ───────────────────────────────────────────

export function buildImagePreviewExtension(config: ImagePreviewConfig): Extension {
  const imageDecorations = StateField.define<DecorationSet>({
    create(state) { return buildImageDecorations(state, config); },
    update(decorations, transaction) {
      if (transaction.docChanged || transaction.selection) {
        return buildImageDecorations(transaction.state, config);
      }
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  return imageDecorations;
}
