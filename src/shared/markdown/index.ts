/* ── Shared Markdown Components ───────────────────────────────────────
   Barrel export for all shared markdown components.
   ──────────────────────────────────────────────────────────────────── */

export { MarkdownViewer } from "./MarkdownViewer";
export { MarkdownEditor, type MarkdownFileRef } from "./MarkdownEditor";

// Extensions are exported for advanced usage (composing custom editors)
export { buildLivePreviewExtension } from "./extensions/livePreviewExtension";
export { buildMermaidExtension, parseMermaidBlock, type MermaidBlock } from "./extensions/mermaidExtension";
export { buildMarkdownTableExtension, parseMarkdownTableBlock, type TableBlock } from "./extensions/markdownTableExtension";
export { buildWikiLinkExtension, buildTableCellDisplayRenderer } from "./extensions/wikiLinkExtension";
export { buildClipboardImageExtension, type ClipboardImageConfig } from "./extensions/clipboardImageExtension";
export { buildImagePreviewExtension, parseImageDimensions, type ImagePreviewConfig, type ImageRef } from "./extensions/imagePreviewExtension";
export { buildInsertionHotzoneExtension, type InsertionHotzoneConfig } from "./extensions/insertionHotzoneExtension";
export { buildInlineAnnotationExtension, type InlineAnnotationAnchorItem, type InlineAnnotationExtensionConfig } from "./extensions/inlineAnnotationExtension";
export { buildHighlightExtension } from "./extensions/highlightExtension";
export { buildFootnoteExtension } from "./extensions/footnoteExtension";
export {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleInlineCode,
  toggleHighlight,
  insertLink,
  setHeadingLevel,
  toggleChecklist,
} from "./extensions/formattingCommands";

// CSS must be imported by the consuming app's styles.css:
//   @import "./shared/markdown/MarkdownEditor.css";
//   @import "./shared/markdown/extensions/livePreviewExtension.css";
//   @import "./shared/markdown/extensions/mermaidExtension.css";
//   @import "./shared/markdown/extensions/markdownTableExtension.css";
//   @import "./shared/markdown/extensions/clipboardImageExtension.css";
//   @import "./shared/markdown/extensions/imagePreviewExtension.css";
//   @import "./shared/markdown/extensions/insertionHotzoneExtension.css";
//   @import "./shared/markdown/extensions/annotationGutterExtension.css";
//   @import "./shared/markdown/extensions/highlightExtension.css";
//   @import "./shared/markdown/extensions/footnoteExtension.css";
