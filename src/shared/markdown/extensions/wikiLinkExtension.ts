/* ── Wiki Link Extension ──────────────────────────────────────────────
   Resolves and decorates [[wiki links]] in CodeMirror 6.

   Links are resolved against a provided file list. Clicking a resolved
   link navigates via the onOpenFile callback. Unresolved links are
   styled differently to indicate missing targets.

   Adapted from kiss_ai for AI Shell's shared component library.
   Generalized with pluggable file resolver and navigation callbacks.
   ──────────────────────────────────────────────────────────────────── */

import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { parseMarkdownTableBlock } from "./markdownTableExtension";

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
    private readonly rawTarget: string,
  ) {
    super();
  }

  eq(other: WikiLinkWidget) {
    return this.display === other.display && this.targetPath === other.targetPath && this.resolution === other.resolution;
  }

  toDOM() {
    const link = document.createElement("span");
    link.className = `shared-md-wiki-link shared-md-wiki-link-${this.resolution}`;
    link.role = "link";
    link.tabIndex = 0;

    // Breadcrumb support: if rawTarget contains `/`, show folder icon and
    // full path in tooltip, but display only the page name.
    const hasPath = this.rawTarget.includes("/");

    if (hasPath) {
      // Add subtle folder icon before link text
      const icon = document.createElement("span");
      icon.className = "shared-md-wiki-link-folder-icon";
      icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5A1 1 0 0 0 5.8 3H3a1 1 0 0 0-1 1z"/></svg>';
      link.appendChild(icon);
      // Tooltip shows the full path
      link.title = this.resolution === "resolved" ? this.rawTarget : `Not found: ${this.rawTarget}`;
    } else {
      link.title = this.resolution === "resolved" ? this.targetPath : `Not found: ${this.targetPath}`;
    }

    const textNode = document.createTextNode(this.display);
    link.appendChild(textNode);

    if (this.resolution === "resolved") {
      link.style.cursor = "pointer";
    }

    const open = () => {
      if (this.resolution !== "resolved") return;
      const onOpenFile = this.getOnOpenFile();
      if (onOpenFile) onOpenFile(this.targetPath);
    };

    // Prevent mousedown from reaching CodeMirror — this stops CM from
    // positioning the cursor (which would reveal the raw markdown and
    // destroy this widget before the click handler fires).
    link.addEventListener("mousedown", (e) => e.preventDefault());
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      open();
    });
    link.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      open();
    });

    return link;
  }
}

const WIKI_LINK_RE = /\[\[([^\]\n]+)\]\]/g;

/** Extract display label from a raw wiki link target.
 *  Handles:
 *  - Aliases: `target|alias` → alias
 *  - Breadcrumb paths: `folder/subfolder/page` → page (just the final segment)
 */
function wikiLinkLabel(rawTarget: string): string {
  const [target, alias] = rawTarget.split("|").map((s) => s.trim());
  if (alias) return alias;
  if (!target) return "";
  // For paths with `/`, show only the last segment (page name)
  const lastSegment = target.split("/").pop();
  return lastSegment || target;
}

// ── Decoration builder ──────────────────────────────────────────────

function buildWikiLinkDecorations(view: import("@codemirror/view").EditorView, config: WikiLinkConfig): DecorationSet {
  const { state } = view;
  const files = config.getFiles();

  // Determine which lines have cursors — links on those lines stay as
  // raw markdown so the user can edit them.
  const cursorLines = new Set<number>();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      cursorLines.add(lineNum);
    }
  }

  const allLinks: Array<{ from: number; to: number; display: string; targetPath: string; resolution: Resolution; rawTarget: string }> = [];

  for (const { from, to } of view.visibleRanges) {
    let position = from;

    while (position <= to) {
      const line = state.doc.lineAt(position);

      // Skip cursor lines — show raw markdown for editing
      if (cursorLines.has(line.number)) {
        if (line.to >= to) break;
        position = line.to + 1;
        continue;
      }

      // Skip table lines — the table extension renders its own wiki links
      const table = parseMarkdownTableBlock(state.doc, line.number);
      if (table) {
        position = table.to + 1;
        continue;
      }

      // Find wiki links on this line
      WIKI_LINK_RE.lastIndex = 0;
      for (const match of line.text.matchAll(WIKI_LINK_RE)) {
        const matchIndex = match.index ?? 0;
        const rawTarget = match[1] ?? "";
        const matchFrom = line.from + matchIndex;
        const matchTo = matchFrom + match[0].length;

        const resolved = resolveWikiLink(rawTarget, files, config.selectedPath);
        if (!resolved) continue;

        allLinks.push({
          from: matchFrom,
          to: matchTo,
          display: wikiLinkLabel(rawTarget),
          targetPath: resolved.path,
          resolution: resolved.resolution,
          rawTarget: rawTarget.split("|")[0]?.trim() ?? rawTarget,
        });
      }

      if (line.to >= to) break;
      position = line.to + 1;
    }
  }

  // Sort by position, then build decorations
  allLinks.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  let lastEnd = -1;
  for (const link of allLinks) {
    if (link.from < lastEnd) continue; // skip overlapping
    lastEnd = link.to;
    builder.add(
      link.from,
      link.to,
      Decoration.replace({
        widget: new WikiLinkWidget(link.display, link.targetPath, link.resolution, config.getOnOpenFile, link.rawTarget),
      }),
    );
  }

  return builder.finish();
}

// ── Extension entry point ───────────────────────────────────────────

export function buildWikiLinkExtension(config: WikiLinkConfig): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: import("@codemirror/view").EditorView) {
        this.decorations = buildWikiLinkDecorations(view, config);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildWikiLinkDecorations(update.view, config);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

// ── Table cell display renderer ─────────────────────────────────────

/**
 * Builds a renderCellDisplay callback for the markdown table extension.
 * Parses cell text for wiki links and renders them as clickable DOM elements.
 */
export function buildTableCellDisplayRenderer(config: WikiLinkConfig): (cell: string, container: HTMLElement) => void {
  return (cell: string, container: HTMLElement) => {
    const files = config.getFiles();
    const onOpenFile = config.getOnOpenFile();

    const combinedPattern = /\[\[([^\]\n]+)\]\]/g;
    let lastIndex = 0;

    for (const match of cell.matchAll(combinedPattern)) {
      const matchStart = match.index ?? 0;

      // Append any plain text before this match
      if (matchStart > lastIndex) {
        appendFormattedText(cell.slice(lastIndex, matchStart), container);
      }

      const rawTarget = match[1] ?? "";
      const label = wikiLinkLabel(rawTarget);
      const resolved = resolveWikiLink(rawTarget, files, config.selectedPath);

      if (resolved) {
        container.appendChild(createLinkElement(label, resolved, onOpenFile));
      } else {
        container.appendChild(document.createTextNode(label));
      }

      lastIndex = matchStart + match[0].length;
    }

    // Append any remaining text after the last match
    if (lastIndex < cell.length) {
      appendFormattedText(cell.slice(lastIndex), container);
    }
  };
}

/**
 * Appends text with inline markdown formatting (bold, italic, code) to a
 * container element.
 */
function appendFormattedText(text: string, container: HTMLElement) {
  const formattingPattern = /\*\*(.+?)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;
  let lastIndex = 0;

  for (const match of text.matchAll(formattingPattern)) {
    const matchStart = match.index ?? 0;

    if (matchStart > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, matchStart)));
    }

    if (match[1] !== undefined) {
      const strong = document.createElement("strong");
      strong.textContent = match[1];
      container.appendChild(strong);
    } else if (match[2] !== undefined) {
      const em = document.createElement("em");
      em.textContent = match[2];
      container.appendChild(em);
    } else if (match[3] !== undefined) {
      const code = document.createElement("code");
      code.className = "shared-md-table-inline-code";
      code.textContent = match[3];
      container.appendChild(code);
    }

    lastIndex = matchStart + match[0].length;
  }

  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function createLinkElement(
  label: string,
  resolved: { path: string; resolution: Resolution },
  onOpenFile: ((path: string) => void) | undefined,
  rawTarget?: string,
): HTMLElement {
  const link = document.createElement("span");
  link.className = `shared-md-wiki-link shared-md-wiki-link-${resolved.resolution}`;
  link.role = "link";
  link.tabIndex = 0;

  // Breadcrumb: if the raw target has `/`, add folder icon and full-path tooltip
  const hasPath = rawTarget?.includes("/");
  if (hasPath) {
    const icon = document.createElement("span");
    icon.className = "shared-md-wiki-link-folder-icon";
    icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5A1 1 0 0 0 5.8 3H3a1 1 0 0 0-1 1z"/></svg>';
    link.appendChild(icon);
    link.title = resolved.resolution === "resolved" ? rawTarget : `Not found: ${rawTarget}`;
  } else {
    link.title = resolved.resolution === "resolved" ? resolved.path : `Not found: ${resolved.path}`;
  }

  link.appendChild(document.createTextNode(label));

  if (resolved.resolution === "resolved") {
    link.style.cursor = "pointer";
    const open = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (onOpenFile) onOpenFile(resolved.path);
    };
    link.addEventListener("mousedown", (e) => e.preventDefault());
    link.addEventListener("click", open);
    link.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      open(e);
    });
  }

  return link;
}
