/* ── Shared: MarkdownEditor ───────────────────────────────────────────
   Full CodeMirror 6 markdown editor with live preview, mermaid
   rendering, table support, and wiki links.

   Adapted from kiss_ai's editor for AI Shell's dark-mode design system.
   ──────────────────────────────────────────────────────────────────── */

import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo, useRef, useEffect, useCallback } from "react";
import { buildLivePreviewExtension } from "./extensions/livePreviewExtension";
import { buildMermaidExtension } from "./extensions/mermaidExtension";
import { buildMarkdownTableExtension } from "./extensions/markdownTableExtension";
import { buildWikiLinkExtension, buildTableCellDisplayRenderer } from "./extensions/wikiLinkExtension";

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
}: MarkdownEditorProps) {
  // Refs for volatile data so extensions read latest values without rebuilding
  const onOpenFileRef = useRef(onOpenFile);
  useEffect(() => { onOpenFileRef.current = onOpenFile; }, [onOpenFile]);

  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);

  const getFiles = useCallback(() => filesRef.current, []);
  const getOnOpenFile = useCallback(() => onOpenFileRef.current, []);

  const extensions = useMemo(
    () => {
      const wikiLinkConfig = { getFiles, selectedPath, getOnOpenFile };
      const renderCellDisplay = buildTableCellDisplayRenderer(wikiLinkConfig);
      return [
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        darkTheme ? darkEditorTheme : lightEditorTheme,
        buildLivePreviewExtension({ editable }),
        buildMermaidExtension({ editable }),
        buildMarkdownTableExtension({ editable, renderCellDisplay }),
        buildWikiLinkExtension(wikiLinkConfig),
      ];
    },
    [editable, darkTheme, getFiles, selectedPath, getOnOpenFile],
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
        readOnly={!editable}
        theme={darkTheme ? "dark" : "light"}
        value={value}
      />
    </div>
  );
}
