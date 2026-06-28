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

export function MarkdownViewer({ content, className, onWikiLink }: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Render mermaid blocks after mount ────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const mermaidBlocks = container.querySelectorAll<HTMLElement>("code.language-mermaid");
    if (mermaidBlocks.length === 0) return;

    let cancelled = false;

    void (async () => {
      const api = await loadMermaid();
      if (cancelled) return;

      for (const block of mermaidBlocks) {
        const pre = block.parentElement;
        if (!pre || pre.dataset.mermaidRendered === "true") continue;

        const source = block.textContent ?? "";
        if (!source.trim()) continue;

        try {
          const id = `shared-md-mermaid-${++renderCounter}`;
          const { svg } = await api.render(id, source);
          if (cancelled) return;

          pre.dataset.mermaidRendered = "true";
          pre.innerHTML = "";
          pre.className = "shared-md-mermaid-diagram";

          const wrapper = document.createElement("div");
          wrapper.innerHTML = svg;

          const svgEl = wrapper.querySelector("svg");
          if (svgEl) {
            svgEl.style.maxWidth = "100%";
            svgEl.style.height = "auto";
          }

          pre.appendChild(wrapper);
        } catch {
          pre.dataset.mermaidRendered = "true";
          const errorEl = document.createElement("div");
          errorEl.className = "shared-md-mermaid-error";
          errorEl.textContent = "Failed to render diagram";
          pre.appendChild(errorEl);
        }
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

  const components: Components = {
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
