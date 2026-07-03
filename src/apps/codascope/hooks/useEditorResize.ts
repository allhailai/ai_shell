/* ── useEditorResize ────────────────────────────────────────────────
   Mermaid diagram and image resize handlers for the DocumentEditor.
   Updates markdown source (fence metadata or alt-text dimensions)
   and auto-persists changes to the server API.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback } from "react";

interface UseEditorResizeOptions {
  activeProjectId: string | null;
  epicId: string;
  docId: string;
  content: string;
  onContentChange: (content: string) => void;
}

interface UseEditorResizeResult {
  handleMermaidResize: (index: number, height: number) => Promise<void>;
  handleImageResize: (index: number, width: number, height: number) => Promise<void>;
}

export function useEditorResize({
  activeProjectId,
  epicId,
  docId,
  content,
  onContentChange,
}: UseEditorResizeOptions): UseEditorResizeResult {
  /**
   * When user drags a mermaid resize handle, update the markdown source
   * with {height=N} on the corresponding fence line and auto-save.
   */
  const handleMermaidResize = useCallback(async (index: number, height: number) => {
    if (!activeProjectId) return;
    const roundedHeight = Math.round(height);
    let mermaidIdx = 0;
    const lines = content.split("\n");
    let updated = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fenceMatch = line.match(/^(\s*(`{3,}|~{3,})\s*mermaid)\s*(?:\{height=\d+\})?\s*$/);
      if (fenceMatch) {
        if (mermaidIdx === index) {
          // Replace or insert {height=N}
          lines[i] = `${fenceMatch[1]} {height=${roundedHeight}}`;
          updated = true;
          break;
        }
        mermaidIdx++;
      }
    }
    if (!updated) return;
    const newContent = lines.join("\n");
    onContentChange(newContent);
    // Persist to server
    try {
      await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/designs/${docId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent }),
        },
      );
    } catch { /* best effort */ }
  }, [activeProjectId, epicId, docId, content, onContentChange]);

  /**
   * When user drags an image resize handle, update the markdown source
   * with |WxH in the alt text (Obsidian convention) and auto-save.
   */
  const handleImageResize = useCallback(async (index: number, width: number, height: number) => {
    if (!activeProjectId) return;
    const rw = Math.round(width);
    const rh = Math.round(height);
    // Find the Nth image in the markdown
    let imgIdx = 0;
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    const replacements: { from: number; to: number; replacement: string }[] = [];

    while ((match = imgRegex.exec(content)) !== null) {
      if (imgIdx === index) {
        const fullMatch = match[0];
        let alt = match[1];
        const url = match[2];
        // Strip existing |WxH from alt
        alt = alt.replace(/\|\d+x\d+$/, "").trim();
        const newTag = `![${alt}|${rw}x${rh}](${url})`;
        replacements.push({ from: match.index, to: match.index + fullMatch.length, replacement: newTag });
        break;
      }
      imgIdx++;
    }

    if (replacements.length === 0) return;
    // Apply replacements (only one for now)
    const r = replacements[0];
    const newContent = content.slice(0, r.from) + r.replacement + content.slice(r.to);
    onContentChange(newContent);
    // Persist to server
    try {
      await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/designs/${docId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent }),
        },
      );
    } catch { /* best effort */ }
  }, [activeProjectId, epicId, docId, content, onContentChange]);

  return { handleMermaidResize, handleImageResize };
}
