/* ── CodaScope: NoteEditor View ──────────────────────────────────────
   Wraps MarkdownEditor with all extensions enabled:
   - Image paste + preview
   - Insertion hotzones
   - Wiki links, mermaid, tables
   Auto-saves on every change with debounce (~1.5s).
   Optimistic concurrency via contentHash (409 conflict handling).
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { MarkdownEditor } from "../../../shared/markdown";
import { ConfirmDialog } from "../../../shared/confirm-dialog/ConfirmDialog";
import { IconClose, IconWarning } from "../components/CodaScopeIcons";
import { NoteInsertionPrompt } from "../components/NoteInsertionPrompt";
import type { NoteLevel } from "../codaScopeTypes";
import type { EditorView } from "@codemirror/view";

/* ── Frontmatter helpers ─────────────────────────────────────────────── */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

function extractTitle(content: string): string {
  const match = FRONTMATTER_RE.exec(content);
  if (match) {
    const titleMatch = /^title:\s*(.+)$/m.exec(match[1]);
    if (titleMatch) return titleMatch[1].trim();
  }
  return "Untitled";
}

function updateFrontmatterTitle(content: string, newTitle: string): string {
  const match = FRONTMATTER_RE.exec(content);
  if (match) {
    const updatedFm = match[1].replace(
      /^title:\s*.+$/m,
      `title: ${newTitle}`,
    );
    return content.replace(FRONTMATTER_RE, `---\n${updatedFm}\n---\n`);
  }
  return content;
}

function countWords(content: string): number {
  // Strip frontmatter, then count words
  const body = content.replace(FRONTMATTER_RE, "").trim();
  if (!body) return 0;
  return body.split(/\s+/).length;
}

/* ── Props ───────────────────────────────────────────────────────────── */

interface NoteEditorProps {
  /** Note level */
  level: NoteLevel;
  /** Note file path (relative, without .md for URL but with for API) */
  notePath: string;
  /** Query params for API calls */
  queryParams: Record<string, string>;
  /** Callback to navigate back to the browser */
  onBack: () => void;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteEditor({ level, notePath, queryParams, onBack }: NoteEditorProps) {
  // ── State ──────────────────────────────────────────────────────────
  const [content, setContent] = useState("");
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("Untitled");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Conflict state
  const [conflictData, setConflictData] = useState<{
    currentContent: string;
    currentHash: string;
  } | null>(null);

  // Insertion prompt state
  const [insertionPoint, setInsertionPoint] = useState<{
    afterLine: number;
    top: number;
    left: number;
  } | null>(null);

  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const hashRef = useRef(contentHash);
  const editorViewRef = useRef<EditorView | null>(null);

  // Keep refs in sync
  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => { hashRef.current = contentHash; }, [contentHash]);

  // Ensure the notePath ends with .md for API calls
  const apiPath = useMemo(() => {
    return notePath.endsWith(".md") ? notePath : `${notePath}.md`;
  }, [notePath]);

  const queryString = useMemo(() => {
    return new URLSearchParams(queryParams).toString();
  }, [queryParams]);

  // ── Load note ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/codascope/notes/${level}/note/${apiPath}?${queryString}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setContent(data.content ?? "");
          setContentHash(data.contentHash ?? null);
          setTitle(extractTitle(data.content ?? ""));
        } else {
          setError("Note not found");
        }
      } catch {
        if (!cancelled) setError("Failed to load note");
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [level, apiPath, queryString]);

  // ── Auto-save (debounced) ──────────────────────────────────────────
  const saveNote = useCallback(async (newContent: string, expectedHash: string | null) => {
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/codascope/notes/${level}/note/${apiPath}?${queryString}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: newContent,
          expectedHash: expectedHash ?? undefined,
        }),
      });

      if (res.status === 409) {
        const data = await res.json();
        setConflictData({
          currentContent: data.currentContent,
          currentHash: data.currentHash,
        });
        setSaveStatus("error");
        return;
      }

      if (res.ok) {
        const data = await res.json();
        setContentHash(data.contentHash);
        setSaveStatus("saved");
        // Reset to idle after a moment
        setTimeout(() => setSaveStatus((s) => s === "saved" ? "idle" : s), 2000);
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  }, [level, apiPath, queryString]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    setTitle(extractTitle(newContent));

    // Clear any pending save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    // Debounce save
    saveTimerRef.current = setTimeout(() => {
      void saveNote(newContent, hashRef.current);
    }, 1500);
  }, [saveNote]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ── Title editing ──────────────────────────────────────────────────
  const handleTitleBlur = useCallback(() => {
    if (!title.trim()) return;
    const updated = updateFrontmatterTitle(contentRef.current, title.trim());
    if (updated !== contentRef.current) {
      setContent(updated);
      // Trigger save immediately for title changes
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void saveNote(updated, hashRef.current);
    }
  }, [title, saveNote]);

  // ── Delete note ────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/codascope/notes/${level}/note/${apiPath}?${queryString}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onBack();
      }
    } catch {
      // Silently fail
    }
    setDeleting(false);
    setShowDeleteConfirm(false);
  }, [level, apiPath, queryString, onBack]);

  // ── Conflict resolution ────────────────────────────────────────────
  const handleConflictReload = useCallback(() => {
    if (!conflictData) return;
    setContent(conflictData.currentContent);
    setContentHash(conflictData.currentHash);
    setTitle(extractTitle(conflictData.currentContent));
    setConflictData(null);
    setSaveStatus("idle");
  }, [conflictData]);

  const handleConflictForce = useCallback(async () => {
    if (!conflictData) return;
    setConflictData(null);
    // Force save without expectedHash
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/codascope/notes/${level}/note/${apiPath}?${queryString}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: contentRef.current }),
      });
      if (res.ok) {
        const data = await res.json();
        setContentHash(data.contentHash);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus((s) => s === "saved" ? "idle" : s), 2000);
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  }, [conflictData, level, apiPath, queryString]);

  // ── Image paste handler ────────────────────────────────────────────
  const handleImagePaste = useCallback(async (file: File, view: EditorView) => {
    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch(
        `/api/codascope/notes/${level}/note/${apiPath}/images?${queryString}`,
        { method: "POST", body: formData },
      );

      if (res.ok) {
        const data = await res.json();
        const relativePath = data.relativePath ?? data.filename;
        // Insert image markdown at cursor position
        const pos = view.state.selection.main.head;
        const insert = `![](${relativePath})`;
        view.dispatch({ changes: { from: pos, insert } });
      }
    } catch {
      // Silently fail
    }
  }, [level, apiPath, queryString]);

  // ── Image URL resolver ─────────────────────────────────────────────
  const resolveImageUrl = useCallback((src: string) => {
    // If it's already an absolute URL or data URI, return as-is
    if (src.startsWith("http") || src.startsWith("data:") || src.startsWith("/")) {
      return src;
    }
    // Convert relative path to API URL
    return `/api/codascope/notes/${level}/note/${apiPath}/images/${encodeURIComponent(src)}?${queryString}`;
  }, [level, apiPath, queryString]);

  // ── Insertion hotzone handler ──────────────────────────────────────
  const handleInsertionRequest = useCallback((afterLine: number, view: EditorView) => {
    editorViewRef.current = view;
    // Get coordinates for the line to position the floating prompt
    const lineInfo = view.state.doc.line(Math.min(afterLine + 1, view.state.doc.lines));
    const coords = view.coordsAtPos(lineInfo.from);
    if (coords) {
      setInsertionPoint({
        afterLine,
        top: coords.bottom + 4,
        left: coords.left,
      });
    }
  }, []);

  // ── Selection toolbar ──────────────────────────────────────────────
  // We'll detect selection changes via a CM event handler approach.
  // For now, the NoteSelectionToolbar listens to mouseup on the editor.

  // ── Word count ─────────────────────────────────────────────────────
  const wordCount = useMemo(() => countWords(content), [content]);

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="codascope-notes-editor">
        <div className="codascope-notes-editor-header">
          <button className="codascope-notes-editor-back" onClick={onBack} type="button">
            ←
          </button>
          <span style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>Loading…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="codascope-notes-editor">
        <div className="codascope-notes-editor-header">
          <button className="codascope-notes-editor-back" onClick={onBack} type="button">
            ←
          </button>
          <span style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="codascope-notes-editor">
      {/* Header */}
      <div className="codascope-notes-editor-header">
        <button
          className="codascope-notes-editor-back"
          onClick={onBack}
          type="button"
          title="Back to notes"
        >
          ←
        </button>

        <input
          className="codascope-notes-editor-title-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Note title…"
        />

        <div className="codascope-notes-editor-actions">
          {/* Save status indicator */}
          <span className={`codascope-notes-editor-save-status codascope-notes-editor-save-status--${saveStatus}`}>
            {saveStatus === "saving" && "Saving…"}
            {saveStatus === "saved" && "✓ Saved"}
            {saveStatus === "error" && "⚠ Error"}
          </span>

          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-sm"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deleting}
            type="button"
            title="Delete note"
            style={{ color: "var(--color-danger)" }}
          >
            <IconClose size={14} />
          </button>
        </div>
      </div>

      {/* Conflict banner */}
      {conflictData && (
        <div className="codascope-notes-conflict-banner">
          <div className="codascope-notes-conflict-banner-text">
            <IconWarning size={14} />
            <span>This note was modified externally. Your save was blocked to prevent overwriting.</span>
          </div>
          <div className="codascope-notes-conflict-banner-actions">
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-sm"
              type="button"
              onClick={handleConflictReload}
            >
              Reload
            </button>
            <button
              className="codascope-btn codascope-btn-danger codascope-btn-sm"
              type="button"
              onClick={handleConflictForce}
            >
              Force Save
            </button>
          </div>
        </div>
      )}

      {/* Editor body */}
      <div className="codascope-notes-editor-body">
        <MarkdownEditor
          value={content}
          onChange={handleContentChange}
          editable
          selectedPath={apiPath}
          onImagePaste={handleImagePaste}
          resolveImageUrl={resolveImageUrl}
          showImagePreview
          showInsertionHotzones
          onInsertionRequest={handleInsertionRequest}
        />

        {/* Floating insertion prompt */}
        {insertionPoint && (
          <NoteInsertionPrompt
            afterLine={insertionPoint.afterLine}
            top={insertionPoint.top}
            left={insertionPoint.left}
            level={level}
            notePath={apiPath}
            editorView={editorViewRef.current}
            onClose={() => setInsertionPoint(null)}
          />
        )}
      </div>

      {/* Footer */}
      <div className="codascope-notes-editor-footer">
        <span>{wordCount} word{wordCount !== 1 ? "s" : ""}</span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-quaternary)" }}>
          Auto-save enabled
        </span>
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Note?"
        message="This will permanently delete this note and any associated images. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
