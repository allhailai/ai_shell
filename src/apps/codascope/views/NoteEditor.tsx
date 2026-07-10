/* ── CodaScope: NoteEditor View ──────────────────────────────────────
   Wraps MarkdownEditor with all extensions enabled:
   - Image paste + preview
   - Insertion hotzones
   - Wiki links, mermaid, tables
   - Annotation gutter + side panel
   Auto-saves on every change with debounce (~1.5s).
   Optimistic concurrency via contentHash (409 conflict handling).
   Version history viewing.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { MarkdownEditor, type AnnotationSummaryItem } from "../../../shared/markdown";
import { ConfirmDialog } from "../../../shared/confirm-dialog/ConfirmDialog";
import { IconClose, IconWarning } from "../components/CodaScopeIcons";
import { NoteInsertionPrompt } from "../components/NoteInsertionPrompt";
import { NoteAnnotationPanel } from "../components/NoteAnnotationPanel";
import { NoteMoveDialog } from "../components/NoteMoveDialog";
import type { NoteLevel, NoteAnnotation } from "../codaScopeTypes";
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
  const body = content.replace(FRONTMATTER_RE, "").trim();
  if (!body) return 0;
  return body.split(/\s+/).length;
}

/* ── Version types ───────────────────────────────────────────────────── */

interface VersionEntry {
  version: string;
  savedAt: string;
  sizeBytes: number;
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

  // Annotation state
  const [annotations, setAnnotations] = useState<NoteAnnotation[]>([]);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  // Move dialog state
  const [showMoveDialog, setShowMoveDialog] = useState(false);

  // Version history state
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<{ version: string; content: string } | null>(null);

  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const hashRef = useRef(contentHash);
  const editorViewRef = useRef<EditorView | null>(null);
  const annotationFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync
  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => { hashRef.current = contentHash; }, [contentHash]);

  // Ensure the notePath ends with .md for API calls
  const apiPath = useMemo(() => {
    return notePath.endsWith(".md") ? notePath : `${notePath}.md`;
  }, [notePath]);

  // Compute stable query string from primitive values inside queryParams,
  // NOT from the queryParams object reference (which may change identity).
  const queryString = useMemo(() => {
    return new URLSearchParams(queryParams).toString();
  }, [queryParams.projectId, queryParams.epicId, queryParams.username]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Fetch annotations ─────────────────────────────────────────────
  const fetchAnnotations = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/codascope/notes/${level}/note/${apiPath}/annotations?${queryString}`,
      );
      if (res.ok) {
        const data = await res.json();
        setAnnotations(data.annotations ?? []);
      }
    } catch { /* ignore */ }
  }, [level, apiPath, queryString]);

  // Fetch annotations on mount and when content changes (debounced)
  useEffect(() => {
    void fetchAnnotations();
  }, [fetchAnnotations]);

  useEffect(() => {
    if (annotationFetchTimerRef.current) clearTimeout(annotationFetchTimerRef.current);
    annotationFetchTimerRef.current = setTimeout(() => {
      void fetchAnnotations();
    }, 3000);
    return () => {
      if (annotationFetchTimerRef.current) clearTimeout(annotationFetchTimerRef.current);
    };
  }, [content, fetchAnnotations]);

  // ── Compute annotation summary for gutter ─────────────────────────
  const annotationSummary = useMemo((): AnnotationSummaryItem[] => {
    if (annotations.length === 0) return [];

    // Group root annotations by blockId
    const roots = annotations.filter((a) => !a.parentId);
    const blockMap = new Map<string, { count: number; hasOpen: boolean }>();

    for (const ann of roots) {
      const blockId = ann.anchor.blockId;
      const existing = blockMap.get(blockId);
      const replies = annotations.filter((a) => a.parentId === ann.id);
      const totalCount = 1 + replies.length;

      if (existing) {
        existing.count += totalCount;
        if (ann.status === "open") existing.hasOpen = true;
      } else {
        blockMap.set(blockId, {
          count: totalCount,
          hasOpen: ann.status === "open",
        });
      }
    }

    return Array.from(blockMap.entries()).map(([blockId, { count, hasOpen }]) => ({
      blockId,
      count,
      hasOpen,
    }));
  }, [annotations]);

  // ── Open annotation count for header badge ────────────────────────
  const openAnnotationCount = useMemo(() => {
    return annotations.filter((a) => a.status === "open" && !a.parentId).length;
  }, [annotations]);

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

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

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
    if (src.startsWith("http") || src.startsWith("data:") || src.startsWith("/")) {
      return src;
    }
    // Markdown stores relative paths like "Note.assets/image.png".
    // Extract the bare filename for the API, and pass the original
    // assets dir name as a hint for when the note has been renamed.
    const parts = src.split("/");
    const filename = parts.length > 1 ? parts.pop()! : src;
    const assetDir = parts.length > 0 ? parts[0] : undefined;
    const sep = queryString ? "&" : "";
    const hint = assetDir ? `${sep}assetDir=${encodeURIComponent(assetDir)}` : "";
    return `/api/codascope/notes/${level}/note/${apiPath}/images/${encodeURIComponent(filename)}?${queryString}${hint}`;
  }, [level, apiPath, queryString]);

  // ── Insertion hotzone handler ──────────────────────────────────────
  const handleInsertionRequest = useCallback((afterLine: number, view: EditorView) => {
    editorViewRef.current = view;
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

  // ── Annotation gutter click ────────────────────────────────────────
  const handleAnnotationClick = useCallback((blockId: string) => {
    setActiveBlockId(blockId);
    setShowAnnotations(true);
  }, []);

  // ── Comment from selection toolbar (future) ─────────────────────────
  // NOTE: handleCommentFromSelection will be wired when
  // NoteSelectionToolbar is rendered within this component.

  // ── Version history ────────────────────────────────────────────────
  const fetchVersions = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/codascope/notes/${level}/note/${apiPath}/versions?${queryString}`,
      );
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions ?? []);
      }
    } catch { /* ignore */ }
  }, [level, apiPath, queryString]);

  const handleShowVersions = useCallback(() => {
    setShowVersions(true);
    void fetchVersions();
  }, [fetchVersions]);

  const handleViewVersion = useCallback(async (version: string) => {
    try {
      const res = await fetch(
        `/api/codascope/notes/${level}/note/${apiPath}/versions/${version}?${queryString}`,
      );
      if (res.ok) {
        const data = await res.json();
        setSelectedVersion({ version: data.version, content: data.content });
      }
    } catch { /* ignore */ }
  }, [level, apiPath, queryString]);

  const handleRestoreVersion = useCallback((versionContent: string) => {
    setContent(versionContent);
    setSelectedVersion(null);
    setShowVersions(false);
    // Trigger save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    void saveNote(versionContent, hashRef.current);
  }, [saveNote]);

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

          {/* Annotations toggle */}
          <button
            className={`codascope-btn codascope-btn-ghost codascope-btn-sm codascope-notes-editor-ann-toggle${showAnnotations ? " codascope-notes-editor-ann-toggle--active" : ""}`}
            onClick={() => setShowAnnotations((s) => !s)}
            type="button"
            title="Toggle annotations"
          >
            💬{openAnnotationCount > 0 && (
              <span className="codascope-notes-editor-ann-badge">{openAnnotationCount}</span>
            )}
          </button>

          {/* History */}
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-sm"
            onClick={handleShowVersions}
            type="button"
            title="Version history"
          >
            🕒
          </button>

          {/* Move */}
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-sm"
            onClick={() => setShowMoveDialog(true)}
            type="button"
            title="Move note"
          >
            📦
          </button>

          {/* Delete */}
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

      {/* Editor body — split layout when annotation panel is open */}
      <div className={`codascope-notes-editor-body${showAnnotations ? " codascope-notes-editor-body--split" : ""}`}>
        {/* Editor pane */}
        <div className="codascope-notes-editor-pane">
          {showVersions && selectedVersion ? (
            /* Version viewer */
            <div className="codascope-notes-version-viewer">
              <div className="codascope-notes-version-viewer-header">
                <span>Viewing: {selectedVersion.version}</span>
                <div className="codascope-notes-version-viewer-actions">
                  <button
                    className="codascope-btn codascope-btn-primary codascope-btn-xs"
                    onClick={() => handleRestoreVersion(selectedVersion.content)}
                    type="button"
                  >
                    Restore
                  </button>
                  <button
                    className="codascope-btn codascope-btn-ghost codascope-btn-xs"
                    onClick={() => setSelectedVersion(null)}
                    type="button"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="codascope-notes-version-viewer-content">
                <MarkdownEditor
                  value={selectedVersion.content}
                  onChange={() => {}}
                  editable={false}
                />
              </div>
            </div>
          ) : showVersions ? (
            /* Version list */
            <div className="codascope-notes-version-list">
              <div className="codascope-notes-version-list-header">
                <span>Version History</span>
                <button
                  className="codascope-btn codascope-btn-ghost codascope-btn-xs"
                  onClick={() => setShowVersions(false)}
                  type="button"
                >
                  <IconClose size={12} />
                </button>
              </div>
              {versions.length === 0 ? (
                <div className="codascope-notes-version-empty">
                  No versions yet. Versions are created when you save changes.
                </div>
              ) : (
                <div className="codascope-notes-version-items">
                  {versions.map((v) => (
                    <button
                      key={v.version}
                      className="codascope-notes-version-item"
                      onClick={() => handleViewVersion(v.version)}
                      type="button"
                    >
                      <span className="codascope-notes-version-name">{v.version}</span>
                      <span className="codascope-notes-version-time">
                        {new Date(v.savedAt).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                      <span className="codascope-notes-version-size">
                        {Math.round(v.sizeBytes / 1024)}KB
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Normal editor */
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
              annotationSummary={annotationSummary.length > 0 ? annotationSummary : undefined}
              onAnnotationClick={handleAnnotationClick}
              onEditorView={(view) => { editorViewRef.current = view; }}
            />
          )}

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

        {/* Annotation panel (right split) */}
        {showAnnotations && (
          <NoteAnnotationPanel
            level={level}
            notePath={apiPath}
            queryParams={queryParams}
            annotations={annotations}
            onAnnotationsChange={fetchAnnotations}
            activeBlockId={activeBlockId}
            onClose={() => setShowAnnotations(false)}
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

      {/* Move dialog */}
      <NoteMoveDialog
        open={showMoveDialog}
        fromLevel={level}
        fromPath={apiPath}
        fromOpts={queryParams}
        onMoved={onBack}
        onClose={() => setShowMoveDialog(false)}
      />
    </div>
  );
}

