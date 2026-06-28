/* ── Mermaid CDN type declaration ─────────────────────────────────────
   Declares the mermaid module type for CDN imports used by the shared
   markdown components. Mermaid is loaded dynamically from CDN, not
   bundled.
   ──────────────────────────────────────────────────────────────────── */

declare module "mermaid" {
  interface MermaidAPI {
    initialize(config: Record<string, unknown>): void;
    render(id: string, definition: string): Promise<{ svg: string }>;
  }
  const mermaid: MermaidAPI;
  export default mermaid;
}

declare module "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs" {
  interface MermaidAPI {
    initialize(config: Record<string, unknown>): void;
    render(id: string, definition: string): Promise<{ svg: string }>;
  }
  const mermaid: MermaidAPI;
  export default mermaid;
}

