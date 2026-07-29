/* ── Shared: MarkdownEditor ───────────────────────────────────────────
   Full CodeMirror 6 markdown editor with live preview, mermaid
   rendering, table support, wiki links, image preview, clipboard
   image paste, and insertion hotzones.

   Adapted from kiss_ai's editor for AI Shell's dark-mode design system.
   ──────────────────────────────────────────────────────────────────── */

import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
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
import { buildInlineAnnotationExtension, type InlineAnnotationAnchorItem } from "./extensions/inlineAnnotationExtension";
import { buildHighlightExtension } from "./extensions/highlightExtension";
import { buildSlashCommandExtension } from "./extensions/slashCommandExtension";
import { buildCalloutExtension } from "./extensions/calloutExtension";
import { buildTagPillExtension } from "./extensions/tagPillExtension";
import { buildFootnoteExtension } from "./extensions/footnoteExtension";
import {
  autoContinueList,
} from "./extensions/formattingCommands";
import { resolveMarkdownEditorKeymap, useKeybindingProfile } from "../keybindings";

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
  /** Enable footnote rendering ([^1] and [^1]: text). Default: false. */
  showFootnotes?: boolean;
  /** Server-validated marker pairs rendered as exact inline annotation pins. */
  inlineAnnotationAnchors?: InlineAnnotationAnchorItem[];
  /** Valid marker token ranges to hide even when a pair is unresolved. */
  inlineAnnotationMarkerRanges?: Array<{ from: number; to: number }>;
  /** Callback when a validated annotation pin is clicked. */
  onAnnotationClick?: (annotationId: string) => void;
  /** Called when the CM6 EditorView is created — enables external overlays. */
  onEditorView?: (view: EditorView) => void;
  /** Called when the editor text selection changes — enables selection actions. */
  onSelectionChange?: (view: EditorView) => void;
  /** Stable caller-owned extensions for feature-specific state/decorations. */
  additionalExtensions?: Extension[];
}

const EMPTY_EXTENSIONS: Extension[] = [];

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
  showFootnotes = false,
  inlineAnnotationAnchors,
  inlineAnnotationMarkerRanges,
  onAnnotationClick,
  onEditorView,
  onSelectionChange,
  additionalExtensions = EMPTY_EXTENSIONS,
}: MarkdownEditorProps) {
  const keybindingProfile = useKeybindingProfile();
  // This extension is intentionally only installed on editable shared editors;
  // MarkdownViewer and read-only history views never receive editor commands.
  const resolvedKeymap = useMemo(
    () => editable ? resolveMarkdownEditorKeymap(keybindingProfile) : null,
    [editable, keybindingProfile],
  );
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

  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);
  const stableOnSelectionChange = useCallback(
    (view: EditorView) => onSelectionChangeRef.current?.(view),
    [],
  );

  const extensions = useMemo(
    () => {
      const wikiLinkConfig = { getFiles, selectedPath, getOnOpenFile };
      const renderCellDisplay = buildTableCellDisplayRenderer(wikiLinkConfig);
      const exts = [
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        darkTheme ? darkEditorTheme : lightEditorTheme,
        buildLivePreviewExtension({ editable }),
        buildHighlightExtension({ editable }),
        buildMermaidExtension({ editable }),
        buildMarkdownTableExtension({ editable, renderCellDisplay }),
        buildWikiLinkExtension(wikiLinkConfig),
      ];

      if (resolvedKeymap) exts.push(resolvedKeymap);

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

      // Pins are drawn only from validated marker-pair offsets supplied by
      // the annotation service. There is no client-side text or line search.
      if (inlineAnnotationAnchors?.length || inlineAnnotationMarkerRanges?.length) {
        exts.push(buildInlineAnnotationExtension({
          onAnnotationClick: stableOnAnnotationClick,
          anchors: inlineAnnotationAnchors ?? [],
          markerRanges: inlineAnnotationMarkerRanges,
        }));
      }

      if (onSelectionChange) {
        exts.push(EditorView.updateListener.of((update) => {
          if (update.selectionSet) stableOnSelectionChange(update.view);
        }));
      }

      // Conditionally add slash command extension
      if (showSlashCommands) {
        exts.push(buildSlashCommandExtension());
      }

      exts.push(...additionalExtensions);
      return exts;
    },
    [editable, darkTheme, getFiles, selectedPath, getOnOpenFile, resolvedKeymap,
     onImagePaste, stableOnImagePaste, showImagePreview, stableResolveImageUrl,
     showInsertionHotzones, onInsertionRequest, stableOnInsertionRequest,
     showSlashCommands, showCallouts, showTagPills, autoContinueLists,
     showFootnotes,
     inlineAnnotationAnchors, inlineAnnotationMarkerRanges, stableOnAnnotationClick,
     onSelectionChange, stableOnSelectionChange, additionalExtensions],
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
