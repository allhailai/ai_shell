/* ── Shared: MarkdownViewer ───────────────────────────────────────────
   Read-only markdown renderer using react-markdown + remark-gfm.
   Designed for AI Shell's dark theme with proper design token usage.

   Usage:
     <MarkdownViewer content={markdownString} />
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useCallback } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownViewerProps {
  /** The markdown string to render. */
  content: string;
  /** Optional CSS class name to add to the wrapper. */
  className?: string;
  /** Optional callback when a wiki-link ([[topic]]) is clicked. */
  onWikiLink?: (topic: string) => void;
  /** Callback when user resizes a mermaid diagram. index = occurrence order, height = new px value. */
  onMermaidResize?: (index: number, height: number) => void;
  /** Callback when user resizes an image. index = occurrence order, width/height = new px values. */
  onImageResize?: (index: number, width: number, height: number) => void;
}

// ── Mermaid CDN loader (shared singleton) ───────────────────────────

let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;
let mermaidApi: typeof import("mermaid")["default"] | null = null;
let renderCounter = 0;

async function loadMermaid() {
  if (mermaidApi) return mermaidApi;
  if (!mermaidPromise) {
    mermaidPromise = (async () => {
      const mod = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
      const api = mod.default;
      api.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
        fontFamily: "var(--font-sans)",
      });
      mermaidApi = api;
      return api;
    })();
  }
  return mermaidPromise;
}

// ── Adaptive sizing ─────────────────────────────────────────────────

function computeAdaptiveMaxHeight(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 500;
  const ratio = width / height;
  if (ratio > 2)   return 300;  // very wide (sequence diagrams)
  if (ratio > 1)   return 400;  // landscape
  if (ratio > 0.8) return 500;  // roughly square
  return 600;                    // tall/portrait (ER diagrams, flowcharts)
}

// ── SVG viewBox tightening ───────────────────────────────────────────

/**
 * Rewrites the SVG's viewBox, width, and height to tightly wrap the actual
 * drawn content (via getBBox()), eliminating Mermaid v11's generous internal
 * padding. Returns the tightened dimensions.
 */
function tightenSvgViewBox(svgEl: SVGSVGElement, padding = 8): { width: number; height: number } {
  const bbox = svgEl.getBBox();
  const x = bbox.x - padding;
  const y = bbox.y - padding;
  const w = bbox.width + padding * 2;
  const h = bbox.height + padding * 2;
  svgEl.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  svgEl.setAttribute("width", `${w}`);
  svgEl.setAttribute("height", `${h}`);
  return { width: w, height: h };
}

// ── Resize handle helper ────────────────────────────────────────────

/**
 * Scales the SVG inside a mermaid container to fit a given height.
 * Uses CSS transform: scale() so the entire diagram is visible (just smaller).
 */
function scaleMermaidToHeight(container: HTMLElement, targetHeight: number): void {
  const svgEl = container.querySelector<SVGSVGElement>("svg");
  if (!svgEl) return;

  // Tighten the viewBox to actual content bounds before reading dimensions
  const { width: natW, height: natH } = tightenSvgViewBox(svgEl);

  if (natH <= 0) return;

  // Account for container padding when computing available space
  const cs = getComputedStyle(container);
  const padTop = parseFloat(cs.paddingTop) || 0;
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const availableHeight = targetHeight - padTop - padBottom;

  // Also consider the container width for the scale factor
  const containerWidth = container.clientWidth || container.parentElement?.clientWidth || natW;
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const padRight = parseFloat(cs.paddingRight) || 0;
  const availableWidth = containerWidth - padLeft - padRight;

  const ratio = natW / natH;
  const diagram = container.querySelector<HTMLElement>(".shared-md-mermaid-diagram");
  if (!diagram) return;

  // For very wide diagrams, allow horizontal scroll instead of scaling tiny
  if (ratio > 2.5 && natW > availableWidth) {
    // Use natural height (clamped to target), let the width overflow with scroll
    const displayHeight = Math.min(natH, availableHeight);
    diagram.style.transform = "none";
    diagram.style.transformOrigin = "";
    diagram.style.width = `${natW}px`;
    container.style.height = `${Math.ceil(displayHeight + padTop + padBottom)}px`;
    container.style.overflowX = "auto";
    container.style.overflowY = "hidden";
    return;
  }

  const scaleByHeight = availableHeight / natH;
  const scaleByWidth = availableWidth / natW;
  const scale = Math.min(scaleByHeight, scaleByWidth, 1); // never scale up beyond natural

  diagram.style.transform = `scale(${scale})`;
  diagram.style.transformOrigin = "top center";
  // Set container height to scaled diagram + padding
  container.style.height = `${Math.ceil(natH * scale + padTop + padBottom)}px`;
}

function attachResizeHandle(
  container: HTMLElement,
  onResizeEnd?: (height: number) => void,
): void {
  const handle = document.createElement("div");
  handle.className = "shared-md-mermaid-resize-handle";
  handle.title = "Drag to resize";
  container.appendChild(handle);

  let startY = 0;
  let startHeight = 0;

  const onMouseMove = (e: MouseEvent) => {
    e.preventDefault();
    const delta = e.clientY - startY;
    const newHeight = Math.max(60, startHeight + delta);
    // Scale the diagram to the new height
    scaleMermaidToHeight(container, newHeight);
  };

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.body.style.userSelect = "";
    container.classList.remove("shared-md-mermaid-resizing");
    // Fire callback with final height
    const finalHeight = container.offsetHeight;
    onResizeEnd?.(finalHeight);
  };

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startY = e.clientY;
    startHeight = container.offsetHeight;
    document.body.style.userSelect = "none";
    container.classList.add("shared-md-mermaid-resizing");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

// ── Image resize handle helper ──────────────────────────────────────

function attachImageResizeHandle(
  container: HTMLElement,
  imgEl: HTMLImageElement,
  onResizeEnd?: (width: number, height: number) => void,
): void {
  const handle = document.createElement("div");
  handle.className = "shared-md-image-resize-handle";
  handle.title = "Drag to resize";
  container.appendChild(handle);

  let startX = 0;
  let startWidth = 0;
  let aspectRatio = 1;

  const onMouseMove = (e: MouseEvent) => {
    e.preventDefault();
    const delta = e.clientX - startX;
    const newWidth = Math.max(100, Math.min(startWidth + delta, container.parentElement?.clientWidth ?? 9999));
    const newHeight = Math.round(newWidth / aspectRatio);
    imgEl.style.width = `${newWidth}px`;
    imgEl.style.height = `${newHeight}px`;
  };

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.body.style.userSelect = "";
    container.classList.remove("shared-md-image-resizing");
    const finalWidth = imgEl.offsetWidth;
    const finalHeight = imgEl.offsetHeight;
    onResizeEnd?.(finalWidth, finalHeight);
  };

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startWidth = imgEl.offsetWidth;
    aspectRatio = imgEl.naturalWidth / imgEl.naturalHeight || 1;
    document.body.style.userSelect = "none";
    container.classList.add("shared-md-image-resizing");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

// ── Parse |WxH from image alt text (Obsidian convention) ────────────

function parseImageDimensions(alt: string): { cleanAlt: string; width?: number; height?: number } {
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

export function MarkdownViewer({
  content,
  className,
  onWikiLink,
  onMermaidResize,
  onImageResize,
}: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Track resize callbacks in refs so the useEffect closure stays stable
  const onMermaidResizeRef = useRef(onMermaidResize);
  onMermaidResizeRef.current = onMermaidResize;

  // ── Render mermaid blocks after mount ────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const mermaidBlocks = container.querySelectorAll<HTMLElement>("code.language-mermaid");
    if (mermaidBlocks.length === 0) return;

    // Pre-parse {height=N} from raw markdown content for each mermaid fence
    const mermaidHeights: (number | undefined)[] = [];
    const fenceRegex = /^[ \t]*(?:`{3,}|~{3,})\s*mermaid\s*(?:\{height=(\d+)\})?\s*$/gm;
    let fenceMatch: RegExpExecArray | null;
    while ((fenceMatch = fenceRegex.exec(content)) !== null) {
      mermaidHeights.push(fenceMatch[1] ? parseInt(fenceMatch[1], 10) : undefined);
    }

    let cancelled = false;

    void (async () => {
      const api = await loadMermaid();
      if (cancelled) return;

      let mermaidIndex = 0;
      for (const block of mermaidBlocks) {
        const pre = block.parentElement;
        if (!pre || pre.dataset.mermaidRendered === "true") {
          mermaidIndex++;
          continue;
        }

        const source = block.textContent ?? "";
        if (!source.trim()) { mermaidIndex++; continue; }

        const explicitHeight = mermaidHeights[mermaidIndex];
        const currentIndex = mermaidIndex;

        try {
          const id = `shared-md-mermaid-${++renderCounter}`;
          const { svg } = await api.render(id, source);
          if (cancelled) return;

          pre.dataset.mermaidRendered = "true";
          pre.innerHTML = "";
          pre.className = "shared-md-mermaid-rendered-pre";

          // Create resizable container
          const resizable = document.createElement("div");
          resizable.className = "shared-md-mermaid-resizable";

          const diagram = document.createElement("div");
          diagram.className = "shared-md-mermaid-diagram";
          diagram.innerHTML = svg;

          const svgEl = diagram.querySelector("svg");
          resizable.appendChild(diagram);

          // Determine target height and scale the diagram to fit
          let targetHeight: number;
          if (explicitHeight && explicitHeight > 0) {
            targetHeight = Math.max(explicitHeight, 100); // clamp to min 100px
          } else if (svgEl) {
            const { width: w, height: h } = tightenSvgViewBox(svgEl as SVGSVGElement);
            targetHeight = computeAdaptiveMaxHeight(w, h);
          } else {
            targetHeight = 500;
          }

          // Need to append to DOM before scaling (so clientWidth is available)
          pre.appendChild(resizable);

          // Scale the diagram to fit within target height
          scaleMermaidToHeight(resizable, targetHeight);

          // Attach resize handle with callback
          attachResizeHandle(resizable, (newHeight) => {
            onMermaidResizeRef.current?.(currentIndex, newHeight);
          });
        } catch {
          pre.dataset.mermaidRendered = "true";
          const errorEl = document.createElement("div");
          errorEl.className = "shared-md-mermaid-error";
          errorEl.textContent = "Failed to render diagram";
          pre.appendChild(errorEl);
        }

        mermaidIndex++;
      }
    })();

    return () => { cancelled = true; };
  }, [content]);

  // ── Process wiki links [[topic]] ──────────────────────────────────

  const processWikiLinks = useCallback((text: string): string => {
    return text.replace(/\[\[([^\]]+)\]\]/g, (_match, topic: string) => {
      return `[${topic}](#wiki:${encodeURIComponent(topic)})`;
    });
  }, []);

  const processedContent = onWikiLink ? processWikiLinks(content) : content;

  // ── Custom component overrides ────────────────────────────────────

  // Track image resize callback in ref
  const onImageResizeRef = useRef(onImageResize);
  onImageResizeRef.current = onImageResize;
  const imageIndexRef = useRef(0);

  // Reset image index counter on each render
  imageIndexRef.current = 0;

  const components: Components = {
    // Override img to support resizable images with Obsidian |WxH convention
    img({ alt, src, ...props }) {
      const currentIdx = imageIndexRef.current++;
      const parsed = parseImageDimensions(alt ?? "");

      const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        const wrapper = img.parentElement;
        if (!wrapper || wrapper.dataset.resizeAttached === "true") return;
        wrapper.dataset.resizeAttached = "true";

        // Apply parsed dimensions or adaptive default
        if (parsed.width && parsed.height) {
          img.style.width = `${parsed.width}px`;
          img.style.height = `${parsed.height}px`;
        }

        attachImageResizeHandle(wrapper, img, (w, h) => {
          onImageResizeRef.current?.(currentIdx, w, h);
        });
      };

      return (
        <span className="shared-md-image-resizable" style={{ display: "inline-block", position: "relative" }}>
          <img
            alt={parsed.cleanAlt}
            src={src}
            onLoad={handleLoad}
            style={{
              maxWidth: "100%",
              height: "auto",
              borderRadius: "var(--radius-md)",
              ...(parsed.width && parsed.height
                ? { width: `${parsed.width}px`, height: `${parsed.height}px` }
                : {}),
            }}
            {...props}
          />
        </span>
      );
    },

    a({ children, href, ...props }) {
      // Handle wiki links
      if (href?.startsWith("#wiki:") && onWikiLink) {
        const topic = decodeURIComponent(href.slice(6));
        return (
          <a
            href={href}
            className="shared-md-wiki-link"
            onClick={(e) => {
              e.preventDefault();
              onWikiLink(topic);
            }}
            {...props}
          >
            {children}
          </a>
        );
      }

      // Internal app links — navigate in-place, don't open new tab
      if (href?.startsWith("/codascope/")) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState(null, "", href);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
            {...props}
          >
            {children}
          </a>
        );
      }

      return (
        <a href={href} rel="noopener noreferrer" target="_blank" {...props}>
          {children}
        </a>
      );
    },
  };

  return (
    <div ref={containerRef} className={`shared-md-viewer ${className ?? ""}`.trim()}>
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]} skipHtml>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
