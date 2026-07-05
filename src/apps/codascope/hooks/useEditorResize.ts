/* ── useEditorResize ────────────────────────────────────────────────
   Mermaid diagram and image resize + delete handlers for the DocumentEditor.
   Delegates resize/delete mutations to the server-side PATCH endpoint, which
   reads → mutates → writes content.md atomically. This eliminates
   stale-closure bugs and ensures changes persist across page refresh.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useRef } from "react";

interface UseEditorResizeOptions {
  activeProjectId: string | null;
  epicId: string;
  docId: string;
  onContentChange: (content: string, contentHash: string) => void;
}

interface UseEditorResizeResult {
  handleMermaidResize: (index: number, height: number) => Promise<void>;
  handleImageResize: (index: number, width: number, height: number) => Promise<void>;
  handleMermaidDelete: (index: number) => Promise<void>;
  handleImageDelete: (index: number) => Promise<void>;
  handleCodeBlockDelete: (index: number) => Promise<void>;
}

export function useEditorResize({
  activeProjectId,
  epicId,
  docId,
  onContentChange,
}: UseEditorResizeOptions): UseEditorResizeResult {
  // Use refs for values that change frequently to avoid re-creating callbacks
  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  /**
   * When user drags a mermaid resize handle, send a PATCH to the server
   * which atomically reads content.md, inserts {height=N} on the matching
   * fence line, and writes it back. The server returns the updated content.
   */
  const handleMermaidResize = useCallback(async (index: number, height: number) => {
    const projId = activeProjectIdRef.current;
    if (!projId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${projId}/epics/${epicId}/designs/${docId}/resize`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "mermaid", index, height: Math.round(height) }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        onContentChangeRef.current(data.content, data.contentHash);
      }
    } catch { /* best effort */ }
  }, [epicId, docId]);

  /**
   * When user drags an image resize handle, send a PATCH to the server
   * which atomically reads content.md, updates |WxH in the alt text
   * (Obsidian convention), and writes it back.
   */
  const handleImageResize = useCallback(async (index: number, width: number, height: number) => {
    const projId = activeProjectIdRef.current;
    if (!projId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${projId}/epics/${epicId}/designs/${docId}/resize`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "image",
            index,
            width: Math.round(width),
            height: Math.round(height),
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        onContentChangeRef.current(data.content, data.contentHash);
      }
    } catch { /* best effort */ }
  }, [epicId, docId]);

  /**
   * Generic helper to send a delete-* operation to the server.
   * Creates a version snapshot server-side before applying the deletion.
   */
  const sendDelete = useCallback(async (type: string, index: number) => {
    const projId = activeProjectIdRef.current;
    if (!projId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${projId}/epics/${epicId}/designs/${docId}/resize`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, index }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        onContentChangeRef.current(data.content, data.contentHash);
      }
    } catch { /* best effort */ }
  }, [epicId, docId]);

  const handleMermaidDelete = useCallback(
    (index: number) => sendDelete("delete-mermaid", index),
    [sendDelete],
  );

  const handleImageDelete = useCallback(
    (index: number) => sendDelete("delete-image", index),
    [sendDelete],
  );

  const handleCodeBlockDelete = useCallback(
    (index: number) => sendDelete("delete-codeblock", index),
    [sendDelete],
  );

  return { handleMermaidResize, handleImageResize, handleMermaidDelete, handleImageDelete, handleCodeBlockDelete };
}
