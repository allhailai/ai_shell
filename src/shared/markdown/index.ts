/* ── Shared Markdown Components ───────────────────────────────────────
   Barrel export for all shared markdown components.
   ──────────────────────────────────────────────────────────────────── */

export { MarkdownViewer } from "./MarkdownViewer";
export { MarkdownEditor, type MarkdownFileRef } from "./MarkdownEditor";

// Extensions are exported for advanced usage (composing custom editors)
export { buildLivePreviewExtension } from "./extensions/livePreviewExtension";
export { buildMermaidExtension, parseMermaidBlock, type MermaidBlock } from "./extensions/mermaidExtension";
export { buildMarkdownTableExtension, parseMarkdownTableBlock, type TableBlock } from "./extensions/markdownTableExtension";
export { buildWikiLinkExtension } from "./extensions/wikiLinkExtension";

// CSS must be imported by the consuming app's styles.css:
//   @import "./shared/markdown/MarkdownEditor.css";
//   @import "./shared/markdown/extensions/livePreviewExtension.css";
//   @import "./shared/markdown/extensions/mermaidExtension.css";
//   @import "./shared/markdown/extensions/markdownTableExtension.css";
