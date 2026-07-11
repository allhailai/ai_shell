/* ── Shared: MarkdownEditor ───────────────────────────────────────────
   Full CodeMirror 6 markdown editor with live preview, mermaid
   rendering, table support, wiki links, image preview, clipboard
   image paste, and insertion hotzones.

   Adapted from kiss_ai's editor for AI Shell's dark-mode design system.
   ──────────────────────────────────────────────────────────────────── */

import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo, useRef, useEffect, useCallback } from "react";
import { buildLivePreviewExtension } from "./extensions/livePreviewExtension";
import { buildMermaidExtension } from "./extensions/mermaidExtension";
import { buildMarkdownTableExtension } from "./extensions/markdownTableExtension";
import { buildWikiLinkExtension, buildTableCellDisplayRenderer } from "./extensions/wikiLinkExtension";
import { buildClipboardImageExtension } from "./extensions/clipboardImageExtension";
import { buildImagePreviewExtension } from "./extensions/imagePreviewExtension";
import { buildInsertionHotzoneExtension } from "./extensions/insertionHotzoneExtension";
import { buildAnnotationGutterExtension, type AnnotationSummaryItem } from "./extensions/annotationGutterExtension";
import { buildHighlightExtension } from "./extensions/highlightExtension";
import { buildSlashCommandExtension } from "./extensions/slashCommandExtension";
import { buildCalloutExtension } from "./extensions/calloutExtension";
import { buildTagPillExtension } from "./extensions/tagPillExtension";
import { buildFocusModeExtension, toggleFocusMode } from "./extensions/focusModeExtension";
import { buildMathExtension } from "./extensions/mathExtension";
import { buildFootnoteExtension } from "./extensions/footnoteExtension";
import {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleInlineCode,
  toggleHighlight,
  insertLink,
  autoContinueList,
} from "./extensions/formattingCommands";

/** File reference for wiki link resolution. */
export interface MarkdownFileRef {
  /** Relative path within the file set. */
  path: string;
  /** Optional display label. */
  label?: string;
}

interface MarkdownEditorProps {
  /** Current markdown content. */
  value: string;
  /** Called when the content changes. */
  onChange: (value: string) => void;
  /** Whether the editor is editable (false = read-only with live preview). */
  editable?: boolean;
  /** Currently selected file path (for wiki link self-reference). */
  selectedPath?: string;
  /** Available files for wiki link resolution. */
  files?: MarkdownFileRef[];
  /** Callback when a wiki link or file reference is clicked. */
  onOpenFile?: (path: string) => void;
  /** Use dark theme (default: true for AI Shell). */
  darkTheme?: boolean;

  /** Callback when an image is pasted or dropped. Enables clipboard image extension. */
  onImagePaste?: (file: File, view: EditorView) => Promise<void>;
  /** URL resolver for relative image paths in preview. */
  resolveImageUrl?: (src: string) => string;
  /** Enable inline image preview with resize handles. */
  showImagePreview?: boolean;
  /** Enable "+" insertion hotzones between heading sections. */
  showInsertionHotzones?: boolean;
  /** Callback when an insertion hotzone "+" button is clicked. */
  onInsertionRequest?: (afterLine: number, view: EditorView) => void;
  /** Enable slash command autocomplete (/ menu). */
  showSlashCommands?: boolean;
  /** Enable callout/admonition rendering (> [!type] blocks). Default: true. */
  showCallouts?: boolean;
  /** Enable #tag pill rendering. Default: true. */
  showTagPills?: boolean;
  /** Enable auto-continue lists on Enter key. */
  autoContinueLists?: boolean;
  /** Enable focus mode (dim non-active blocks). Default: false. */
  showFocusMode?: boolean;
  /** Enable math block rendering ($$...$$ and $...$). Default: false. */
  showMath?: boolean;
  /** Enable footnote rendering ([^1] and [^1]: text). Default: false. */
  showFootnotes?: boolean;
  /** Annotation summary data — when provided, enables the annotation gutter. */
  annotationSummary?: AnnotationSummaryItem[];
  /** Callback when an annotation gutter badge is clicked. */
  onAnnotationClick?: (blockId: string) => void;
  /** Called when the CM6 EditorView is created — enables external overlays. */
  onEditorView?: (view: EditorView) => void;
}

const darkEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--color-text-primary)",
    backgroundColor: "var(--color-bg-secondary)",
  },
  ".cm-content": {
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-base)",
    lineHeight: "1.7",
    padding: "var(--space-5)",
    caretColor: "var(--color-accent)",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-gutters": {
    borderRight: "1px solid var(--color-border-primary)",
    backgroundColor: "var(--color-bg-primary)",
    color: "var(--color-text-tertiary)",
  },
  ".cm-activeLine": {
    backgroundColor: "hsla(220, 20%, 93%, 0.04)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "hsla(220, 90%, 56%, 0.2)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--color-accent)",
  },
  ".cm-focused": {
    outline: "none",
  },
});

const lightEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "hsl(220, 20%, 15%)",
    backgroundColor: "white",
  },
  ".cm-content": {
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontSize: "1rem",
    lineHeight: "1.7",
    padding: "20px",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
});

export function MarkdownEditor({
  value,
  onChange,
  editable = true,
  selectedPath = "",
  files = [],
  onOpenFile,
  darkTheme = true,
  onImagePaste,
  resolveImageUrl,
  showImagePreview = false,
  showInsertionHotzones = false,
  onInsertionRequest,
  showSlashCommands = false,
  showCallouts = true,
  showTagPills = true,
  autoContinueLists = false,
  showFocusMode = false,
  showMath = false,
  showFootnotes = false,
  annotationSummary,
  onAnnotationClick,
  onEditorView,
}: MarkdownEditorProps) {
  // Refs for volatile data so extensions read latest values without rebuilding
  const onOpenFileRef = useRef(onOpenFile);
  useEffect(() => { onOpenFileRef.current = onOpenFile; }, [onOpenFile]);

  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);

  const getFiles = useCallback(() => filesRef.current, []);
  const getOnOpenFile = useCallback(() => onOpenFileRef.current, []);

  // Stable refs for image/insertion callbacks (prevents extension rebuilds)
  const onImagePasteRef = useRef(onImagePaste);
  useEffect(() => { onImagePasteRef.current = onImagePaste; }, [onImagePaste]);

  const resolveImageUrlRef = useRef(resolveImageUrl);
  useEffect(() => { resolveImageUrlRef.current = resolveImageUrl; }, [resolveImageUrl]);

  const onInsertionRequestRef = useRef(onInsertionRequest);
  useEffect(() => { onInsertionRequestRef.current = onInsertionRequest; }, [onInsertionRequest]);

  // Stable wrappers that always call latest ref
  const stableOnImagePaste = useCallback(
    (file: File, view: EditorView) => onImagePasteRef.current?.(file, view) ?? Promise.resolve(),
    [],
  );
  const stableResolveImageUrl = useCallback(
    (src: string) => resolveImageUrlRef.current?.(src) ?? src,
    [],
  );
  const stableOnInsertionRequest = useCallback(
    (afterLine: number, view: EditorView) => onInsertionRequestRef.current?.(afterLine, view),
    [],
  );

  // Stable ref for annotation click callback
  const onAnnotationClickRef = useRef(onAnnotationClick);
  useEffect(() => { onAnnotationClickRef.current = onAnnotationClick; }, [onAnnotationClick]);
  const stableOnAnnotationClick = useCallback(
    (blockId: string) => onAnnotationClickRef.current?.(blockId),
    [],
  );

  const extensions = useMemo(
    () => {
      const wikiLinkConfig = { getFiles, selectedPath, getOnOpenFile };
      const renderCellDisplay = buildTableCellDisplayRenderer(wikiLinkConfig);
      const formattingKeymap = keymap.of([
        { key: "Mod-b", run: toggleBold },
        { key: "Mod-i", run: toggleItalic },
        { key: "Mod-Shift-x", run: toggleStrikethrough },
        { key: "Mod-e", run: toggleInlineCode },
        { key: "Mod-Shift-h", run: toggleHighlight },
        { key: "Mod-k", run: insertLink },
        ...(showFocusMode ? [{ key: "Mod-Shift-f", run: toggleFocusMode }] : []),
      ]);

      const exts = [
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        darkTheme ? darkEditorTheme : lightEditorTheme,
        formattingKeymap,
        buildLivePreviewExtension({ editable }),
        buildHighlightExtension({ editable }),
        buildMermaidExtension({ editable }),
        buildMarkdownTableExtension({ editable, renderCellDisplay }),
        buildWikiLinkExtension(wikiLinkConfig),
      ];

      // Callout extension (on by default)
      if (showCallouts) {
        exts.push(buildCalloutExtension({ editable }));
      }

      // Tag pill extension (on by default)
      if (showTagPills) {
        exts.push(buildTagPillExtension({ editable }));
      }

      // Auto-continue lists keymap (opt-in)
      if (autoContinueLists) {
        exts.push(keymap.of([
          { key: "Enter", run: autoContinueList },
        ]));
      }

      // Focus mode extension (opt-in)
      if (showFocusMode) {
        exts.push(buildFocusModeExtension());
      }

      // Math extension with lazy KaTeX loading (opt-in)
      if (showMath) {
        exts.push(buildMathExtension({ editable }));
      }

      // Footnote extension (opt-in)
      if (showFootnotes) {
        exts.push(buildFootnoteExtension({ editable }));
      }

      // Conditionally add clipboard image extension
      if (onImagePaste) {
        exts.push(buildClipboardImageExtension({ onImagePaste: stableOnImagePaste }));
      }

      // Conditionally add image preview extension
      if (showImagePreview) {
        exts.push(buildImagePreviewExtension({
          editable,
          resolveImageUrl: stableResolveImageUrl,
        }));
      }

      // Conditionally add insertion hotzone extension
      if (showInsertionHotzones && onInsertionRequest) {
        exts.push(buildInsertionHotzoneExtension({
          editable,
          onInsertionRequest: stableOnInsertionRequest,
        }));
      }

      // Conditionally add annotation gutter extension
      if (annotationSummary) {
        exts.push(buildAnnotationGutterExtension({
          onAnnotationClick: stableOnAnnotationClick,
          summary: annotationSummary,
        }));
      }

      // Conditionally add slash command extension
      if (showSlashCommands) {
        exts.push(buildSlashCommandExtension());
      }

      return exts;
    },
    [editable, darkTheme, getFiles, selectedPath, getOnOpenFile,
     onImagePaste, stableOnImagePaste, showImagePreview, stableResolveImageUrl,
     showInsertionHotzones, onInsertionRequest, stableOnInsertionRequest,
     showSlashCommands, showCallouts, showTagPills, autoContinueLists,
     showFocusMode, showMath, showFootnotes,
     annotationSummary, stableOnAnnotationClick],
  );

  return (
    <div className="shared-md-editor-shell">
      <CodeMirror
        basicSetup={{
          foldGutter: false,
          lineNumbers: true,
          highlightActiveLine: editable,
          highlightActiveLineGutter: false,
        }}
        editable={editable}
        extensions={extensions}
        height="100%"
        key={selectedPath}
        onChange={onChange}
        onCreateEditor={onEditorView}
        readOnly={!editable}
        theme={darkTheme ? "dark" : "light"}
        value={value}
      />
    </div>
  );
}
