/* ── Wiki Link Extension ──────────────────────────────────────────────
   Resolves and decorates [[wiki links]] in CodeMirror 6.

   Links are resolved against a provided file list. Clicking a resolved
   link navigates via the onOpenFile callback. Unresolved links are
   styled differently to indicate missing targets.

   Adapted from kiss_ai for AI Shell's shared component library.
   Generalized with pluggable file resolver and navigation callbacks.
   ──────────────────────────────────────────────────────────────────── */

import { syntaxTree } from "@codemirror/language";
import { type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

interface WikiLinkFile {
  path: string;
  label?: string;
}

interface WikiLinkConfig {
  /** Accessor for the current file list — avoids rebuilding extensions on file changes. */
  getFiles: () => WikiLinkFile[];
  /** Current file path (used to detect self-links). */
  selectedPath: string;
  /** Accessor for the navigation callback. */
  getOnOpenFile: () => ((path: string) => void) | undefined;
}

// ── Link resolution ─────────────────────────────────────────────────

type Resolution = "resolved" | "missing";

function resolveWikiLink(target: string, files: WikiLinkFile[], _selectedPath: string): { path: string; resolution: Resolution } | null {
  const normalizedTarget = target.toLowerCase().trim();

  // Try exact path match
  const exactMatch = files.find((f) => f.path.toLowerCase() === normalizedTarget);
  if (exactMatch) return { path: exactMatch.path, resolution: "resolved" };

  // Try basename match (without extension)
  const basenameMatch = files.find((f) => {
    const basename = f.path.split("/").pop()?.replace(/\.[^.]+$/, "").toLowerCase() ?? "";
    return basename === normalizedTarget;
  });
  if (basenameMatch) return { path: basenameMatch.path, resolution: "resolved" };

  // Try label match
  const labelMatch = files.find((f) => f.label?.toLowerCase() === normalizedTarget);
  if (labelMatch) return { path: labelMatch.path, resolution: "resolved" };

  // Not found
  return { path: normalizedTarget, resolution: "missing" };
}

// ── Wiki link widget ────────────────────────────────────────────────

class WikiLinkWidget extends WidgetType {
  constructor(
    private readonly display: string,
    private readonly targetPath: string,
    private readonly resolution: Resolution,
    private readonly getOnOpenFile: () => ((path: string) => void) | undefined,
  ) {
    super();
  }

  eq(other: WikiLinkWidget) {
    return this.display === other.display && this.targetPath === other.targetPath && this.resolution === other.resolution;
  }

  toDOM() {
    const link = document.createElement("span");
    link.className = `shared-md-wiki-link shared-md-wiki-link-${this.resolution}`;
    link.textContent = this.display;
    link.title = this.resolution === "resolved" ? this.targetPath : `Not found: ${this.targetPath}`;

    if (this.resolution === "resolved") {
      link.style.cursor = "pointer";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const onOpenFile = this.getOnOpenFile();
        if (onOpenFile) onOpenFile(this.targetPath);
      });
    }

    return link;
  }

  ignoreEvent() { return false; }
}

// ── Decoration builder ──────────────────────────────────────────────

const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

function buildWikiLinkDecorations(view: EditorView, config: WikiLinkConfig): DecorationSet {
  const { state } = view;
  const files = config.getFiles();
  const entries: { from: number; to: number; decoration: Decoration }[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    let match: RegExpExecArray | null;
    WIKI_LINK_RE.lastIndex = 0;

    while ((match = WIKI_LINK_RE.exec(text)) !== null) {
      const matchFrom = from + match.index;
      const matchTo = matchFrom + match[0].length;
      const target = match[1];

      // Don't decorate if cursor is on this line
      const line = state.doc.lineAt(matchFrom);
      let cursorOnLine = false;
      for (const range of state.selection.ranges) {
        const cursorLine = state.doc.lineAt(range.head).number;
        if (cursorLine === line.number) { cursorOnLine = true; break; }
      }
      if (cursorOnLine) continue;

      // Check we're not inside a fenced code block
      const node = syntaxTree(state).resolveInner(matchFrom, 1);
      if (node.name === "CodeText" || node.name === "FencedCode" || node.name === "CodeBlock") continue;

      const resolved = resolveWikiLink(target, files, config.selectedPath);
      if (!resolved) continue;

      const [displayText] = target.split("|");

      entries.push({
        from: matchFrom,
        to: matchTo,
        decoration: Decoration.replace({
          widget: new WikiLinkWidget(
            displayText.trim(),
            resolved.path,
            resolved.resolution,
            config.getOnOpenFile,
          ),
        }),
      });
    }
  }

  return Decoration.set(
    entries.map((e) => e.decoration.range(e.from, e.to)),
    true,
  );
}

// ── Extension entry point ───────────────────────────────────────────

export function buildWikiLinkExtension(config: WikiLinkConfig): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildWikiLinkDecorations(view, config);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.decorations = buildWikiLinkDecorations(update.view, config);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
