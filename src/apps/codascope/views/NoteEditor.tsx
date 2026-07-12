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
import { useAuth } from "../../../shell/authContext";
import { IconClose, IconWarning, IconComment, IconClock, IconMove, IconArchive, IconLink, IconUser, IconActivity, IconDraft, IconCheckCircle, IconEye, IconCopy } from "../components/CodaScopeIcons";
import { NoteInsertionPrompt } from "../components/NoteInsertionPrompt";
import { NoteAnnotationPanel } from "../components/NoteAnnotationPanel";
import { NoteFormattingToolbar } from "../components/NoteFormattingToolbar";
import { NoteMoveDialog } from "../components/NoteMoveDialog";
import type { NoteScope, NoteVisibility, NoteAnnotation, NoteBacklink, NoteActivityEntry, NoteReaderInfo } from "../codaScopeTypes";
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

/* ── Visibility label helpers ────────────────────────────────────────── */

function visibilityLabel(visibility: NoteVisibility, scope: NoteScope): string {
  const scopeLabel = scope === "codascope" ? "CodaScope" : scope === "project" ? "Project" : "Epic";
  if (visibility === "shared") return `Shared · ${scopeLabel}`;
  return "Private · You";
}

/* ── Version types ───────────────────────────────────────────────────── */

interface VersionEntry {
  version: string;
  savedAt: string;
  sizeBytes: number;
}

/* ── Props ───────────────────────────────────────────────────────────── */

interface NoteEditorProps {
  /** Note scope */
  scope: NoteScope;
  /** Note visibility */
  visibility: NoteVisibility;
  /** Note file path (relative, without .md for URL but with for API) */
  notePath: string;
  /** Query params for API calls */
  queryParams: Record<string, string>;
  /** Callback to navigate back to the browser */
  onBack: () => void;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function NoteEditor({ scope, visibility, notePath, queryParams, onBack }: NoteEditorProps) {
  const { user } = useAuth();
  // ── State ──────────────────────────────────────────────────────────
  const [content, setContent] = useState("");
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("Untitled");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");

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

  // Backlinks state
  const [backlinks, setBacklinks] = useState<NoteBacklink[]>([]);
  const [showBacklinks, setShowBacklinks] = useState(false);

  // Last editor state
  const [lastEditor, setLastEditor] = useState<{ username: string; editedAt: string } | null>(null);
  const [lastEditorDismissed, setLastEditorDismissed] = useState(false);

  // Activity feed state
  const [activityEntries, setActivityEntries] = useState<NoteActivityEntry[]>([]);
  const [showActivity, setShowActivity] = useState(false);

  // Read indicator state (shared notes only)
  const [readers, setReaders] = useState<NoteReaderInfo[]>([]);

  // Draft/ready status state (shared notes only)
  const [noteStatus, setNoteStatus] = useState<"draft" | "ready" | undefined>(undefined);

  // Note ID (extracted from frontmatter)
  const [noteId, setNoteId] = useState<string | null>(null);

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

  // API base path for this scope/visibility
  const apiBase = useMemo(() => {
    return `/api/codascope/notes/${scope}/${visibility}`;
  }, [scope, visibility]);

  // Compute stable query string from primitive values inside queryParams,
  // NOT from the queryParams object reference (which may change identity).
  const queryString = useMemo(() => {
    return new URLSearchParams(queryParams).toString();
  }, [queryParams.projectId, queryParams.epicId]);

  // ── Load note ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLastEditor(null);
    setLastEditorDismissed(false);
    setReaders([]);

    void (async () => {
      try {
        const res = await fetch(`${apiBase}/note/${apiPath}?${queryString}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setContent(data.content ?? "");
          setContentHash(data.contentHash ?? null);
          setTitle(extractTitle(data.content ?? ""));

          // Extract noteId and status from frontmatter
          const fm = data.frontmatter;
          if (fm) {
            setNoteId(fm.id ?? null);
            setNoteStatus(fm.status ?? undefined);
          }

          // Last editor tracking
          if (data.lastEditor && data.lastEditedAt) {
            setLastEditor({ username: data.lastEditor, editedAt: data.lastEditedAt });
          }

          // Auto mark-read for shared notes (fire-and-forget)
          if (visibility === "shared") {
            fetch(`${apiBase}/note/${apiPath}/read?${queryString}`, { method: "POST" }).catch(() => {});
          }
        } else {
          setError("Note not found");
        }
      } catch {
        if (!cancelled) setError("Failed to load note");
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [apiBase, apiPath, queryString]);

  // ── Fetch annotations ─────────────────────────────────────────────
  const fetchAnnotations = useCallback(async () => {
    try {
      const res = await fetch(
        `${apiBase}/note/${apiPath}/annotations?${queryString}`,
      );
      if (res.ok) {
        const data = await res.json();
        setAnnotations(data.annotations ?? []);
      }
    } catch { /* ignore */ }
  }, [apiBase, apiPath, queryString]);

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
      const res = await fetch(`${apiBase}/note/${apiPath}?${queryString}`, {
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
  }, [apiBase, apiPath, queryString]);

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

  // ── Archive note ───────────────────────────────────────────────────
  const handleArchive = useCallback(async () => {
    setArchiving(true);
    try {
      const res = await fetch(`${apiBase}/note/${apiPath}/archive?${queryString}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: archiveReason.trim() || undefined }),
      });
      if (res.ok) {
        onBack();
      }
    } catch {
      // Silently fail
    }
    setArchiving(false);
    setShowArchiveConfirm(false);
    setArchiveReason("");
  }, [apiBase, apiPath, queryString, onBack, archiveReason]);

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
      const res = await fetch(`${apiBase}/note/${apiPath}?${queryString}`, {
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
  }, [conflictData, apiBase, apiPath, queryString]);

  // Save as copy (conflict resolution)
  const handleConflictSaveAsCopy = useCallback(async () => {
    if (!conflictData) return;
    try {
      // Create a copy with "(conflict copy)" suffix
      const copyPath = apiPath.replace(/\.md$/, " (conflict copy).md");
      const res = await fetch(`${apiBase}/note/${copyPath}?${queryString}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: contentRef.current }),
      });
      if (res.ok) {
        // Reload the server version into the current editor
        setContent(conflictData.currentContent);
        setContentHash(conflictData.currentHash);
        setTitle(extractTitle(conflictData.currentContent));
        setConflictData(null);
        setSaveStatus("idle");
      }
    } catch { /* best effort */ }
  }, [conflictData, apiBase, apiPath, queryString]);

  // ── Stash content on conflict for recovery ─────────────────────────
  useEffect(() => {
    if (conflictData && noteId) {
      try {
        localStorage.setItem(`codascope-note-recovery-${noteId}`, contentRef.current);
      } catch { /* best effort */ }
    }
  }, [conflictData, noteId]);

  // ── Image paste handler ────────────────────────────────────────────
  const handleImagePaste = useCallback(async (file: File, view: EditorView) => {
    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch(
        `${apiBase}/note/${apiPath}/images?${queryString}`,
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
  }, [apiBase, apiPath, queryString]);

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
    return `${apiBase}/note/${apiPath}/images/${encodeURIComponent(filename)}?${queryString}${hint}`;
  }, [apiBase, apiPath, queryString]);

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
        `${apiBase}/note/${apiPath}/versions?${queryString}`,
      );
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions ?? []);
      }
    } catch { /* ignore */ }
  }, [apiBase, apiPath, queryString]);

  const handleShowVersions = useCallback(() => {
    setShowVersions(true);
    void fetchVersions();
  }, [fetchVersions]);

  const handleViewVersion = useCallback(async (version: string) => {
    try {
      const res = await fetch(
        `${apiBase}/note/${apiPath}/versions/${version}?${queryString}`,
      );
      if (res.ok) {
        const data = await res.json();
        setSelectedVersion({ version: data.version, content: data.content });
      }
    } catch { /* ignore */ }
  }, [apiBase, apiPath, queryString]);

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

  // ── Fetch backlinks ─────────────────────────────────────────────
  const fetchBacklinks = useCallback(async (noteId: string) => {
    try {
      const params = new URLSearchParams(queryParams);
      params.set("scope", scope);
      params.set("visibility", visibility);
      const res = await fetch(`/api/codascope/notes/backlinks/${noteId}?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBacklinks(data.backlinks ?? []);
      }
    } catch { /* best effort */ }
  }, [scope, visibility, queryParams]);

  // Fetch backlinks when the note loads
  useEffect(() => {
    if (!content) return;
    // Extract noteId from frontmatter
    const match = FRONTMATTER_RE.exec(content);
    if (match) {
      const idMatch = /^id:\s*(.+)$/m.exec(match[1]);
      if (idMatch) {
        void fetchBacklinks(idMatch[1].trim());
      }
    }
  }, [content, fetchBacklinks]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch readers (shared notes) ───────────────────────────────────
  useEffect(() => {
    if (visibility !== "shared" || !noteId) return;
    void (async () => {
      try {
        const params = new URLSearchParams(queryString);
        const res = await fetch(`${apiBase}/readers/${noteId}?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setReaders(data.readers ?? []);
        }
      } catch { /* best effort */ }
    })();
  }, [visibility, noteId, apiBase, queryString]);

  // ── Fetch activity ─────────────────────────────────────────────────
  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/note/${apiPath}/activity?${queryString}`);
      if (res.ok) {
        const data = await res.json();
        setActivityEntries(data.activity ?? []);
      }
    } catch { /* best effort */ }
  }, [apiBase, apiPath, queryString]);

  // ── Draft/Ready toggle ─────────────────────────────────────────────
  const handleStatusToggle = useCallback(() => {
    const newStatus = noteStatus === "ready" ? "draft" : "ready";
    setNoteStatus(newStatus);

    // Update frontmatter in content
    const match = FRONTMATTER_RE.exec(contentRef.current);
    if (match) {
      let fm = match[1];
      if (/^status:\s*.+$/m.test(fm)) {
        fm = fm.replace(/^status:\s*.+$/m, `status: ${newStatus}`);
      } else {
        fm = fm + `\nstatus: ${newStatus}`;
      }
      const body = contentRef.current.slice(match[0].length);
      const updatedContent = `---\n${fm}\n---\n${body}`;
      setContent(updatedContent);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void saveNote(updatedContent, hashRef.current);
    }
  }, [noteStatus, saveNote]);

  // ── Last editor banner logic ───────────────────────────────────────
  const showLastEditorBanner = useMemo(() => {
    if (lastEditorDismissed || !lastEditor || lastEditor.username === user?.username) return false;
    const diff = Date.now() - new Date(lastEditor.editedAt).getTime();
    return diff < 5 * 60 * 1000; // < 5 minutes ago
  }, [lastEditor, lastEditorDismissed, user?.username]);

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

        {/* Visibility chip */}
        <span className={`codascope-notes-visibility-badge codascope-notes-visibility-badge--${visibility}`}>
          {visibilityLabel(visibility, scope)}
        </span>

        {/* Draft/Ready toggle (shared notes only) */}
        {visibility === "shared" && (
          <button
            className={`codascope-notes-status-toggle codascope-notes-status-toggle--${noteStatus ?? "draft"}`}
            onClick={handleStatusToggle}
            type="button"
            title={noteStatus === "ready" ? "Revert to draft" : "Mark as ready"}
          >
            {noteStatus === "ready" ? <IconCheckCircle size={12} /> : <IconDraft size={12} />}
            <span>{noteStatus === "ready" ? "Ready" : "Draft"}</span>
          </button>
        )}

        {/* Read by indicator (shared notes only) */}
        {visibility === "shared" && readers.length > 0 && (
          <span className="codascope-notes-read-indicator" title={readers.map((r) => r.userId).join(", ")}>
            <IconEye size={12} />
            <span>Read by {readers.length}</span>
          </span>
        )}

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
            <IconComment size={14} />{openAnnotationCount > 0 && (
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
            <IconClock size={14} />
          </button>

          {/* Move */}
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-sm"
            onClick={() => setShowMoveDialog(true)}
            type="button"
            title="Move note"
          >
            <IconMove size={14} />
          </button>

          {/* Activity */}
          <button
            className={`codascope-btn codascope-btn-ghost codascope-btn-sm${showActivity ? " codascope-notes-editor-ann-toggle--active" : ""}`}
            onClick={() => { setShowActivity((s) => !s); if (!showActivity) void fetchActivity(); }}
            type="button"
            title="Activity feed"
          >
            <IconActivity size={14} />
          </button>

          {/* Archive */}
          <button
            className="codascope-btn codascope-btn-ghost codascope-btn-sm"
            onClick={() => setShowArchiveConfirm(true)}
            disabled={archiving}
            type="button"
            title="Archive note"
            style={{ color: "var(--color-warning)" }}
          >
            <IconArchive size={14} />
          </button>
        </div>
      </div>

      {/* Last editor banner */}
      {showLastEditorBanner && lastEditor && (
        <div className="codascope-notes-last-editor-banner">
          <IconUser size={12} />
          <span>
            {lastEditor.username} edited this {(() => {
              const diff = Math.round((Date.now() - new Date(lastEditor.editedAt).getTime()) / 60000);
              return diff <= 1 ? "just now" : `${diff} min ago`;
            })()}
          </span>
          <button
            className="codascope-notes-last-editor-dismiss"
            onClick={() => setLastEditorDismissed(true)}
            type="button"
          >
            <IconClose size={10} />
          </button>
        </div>
      )}

      {/* Conflict dialog (modal) */}
      {conflictData && (
        <div className="codascope-notes-conflict-overlay">
          <div className="codascope-notes-conflict-dialog">
            <div className="codascope-notes-conflict-dialog-header">
              <IconWarning size={18} />
              <span>Save Conflict</span>
            </div>
            <p className="codascope-notes-conflict-dialog-message">
              This note was modified by someone else since you started editing.
              Your changes have been preserved.
            </p>
            <div className="codascope-notes-conflict-dialog-actions">
              <button
                className="codascope-btn codascope-btn-primary codascope-btn-sm"
                type="button"
                onClick={handleConflictForce}
              >
                Save my version
              </button>
              <button
                className="codascope-btn codascope-btn-ghost codascope-btn-sm"
                type="button"
                onClick={handleConflictReload}
              >
                Load their version
              </button>
              <button
                className="codascope-btn codascope-btn-ghost codascope-btn-sm"
                type="button"
                onClick={handleConflictSaveAsCopy}
              >
                <IconCopy size={12} />
                Save as copy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Formatting toolbar */}
      <NoteFormattingToolbar
        editorView={editorViewRef.current}
        disabled={showVersions && !!selectedVersion}
      />

      {/* Editor body — split layout when annotation panel is open */}
      <div className={`codascope-notes-editor-body${(showAnnotations || showActivity) ? " codascope-notes-editor-body--split" : ""}`}>
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
              showSlashCommands
              autoContinueLists
              showFocusMode
              showMath
              showFootnotes
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
              scope={scope}
              visibility={visibility}
              notePath={apiPath}
              editorView={editorViewRef.current}
              onClose={() => setInsertionPoint(null)}
            />
          )}
        </div>

        {/* Annotation panel (right split) */}
        {showAnnotations && (
          <NoteAnnotationPanel
            scope={scope}
            visibility={visibility}
            notePath={apiPath}
            queryParams={queryParams}
            annotations={annotations}
            onAnnotationsChange={fetchAnnotations}
            activeBlockId={activeBlockId}
            onClose={() => setShowAnnotations(false)}
          />
        )}

        {/* Activity panel (right split) */}
        {showActivity && !showAnnotations && (
          <div className="codascope-notes-activity-panel">
            <div className="codascope-notes-activity-panel-header">
              <IconActivity size={14} />
              <span>Activity</span>
              <button
                className="codascope-notes-activity-panel-close"
                onClick={() => setShowActivity(false)}
                type="button"
              >
                <IconClose size={12} />
              </button>
            </div>
            <div className="codascope-notes-activity-list">
              {activityEntries.length === 0 ? (
                <div className="codascope-notes-activity-empty">No activity yet</div>
              ) : (
                activityEntries.map((entry, i) => (
                  <div key={`${entry.timestamp}-${i}`} className={`codascope-notes-activity-item codascope-notes-activity-item--${entry.type}`}>
                    <div className="codascope-notes-activity-item-icon">
                      {entry.type === "edit" && <IconClock size={12} />}
                      {entry.type === "created" && <IconCheckCircle size={12} />}
                      {entry.type === "moved" && <IconMove size={12} />}
                      {entry.type === "archived" && <IconArchive size={12} />}
                      {entry.type === "restored" && <IconCheckCircle size={12} />}
                    </div>
                    <div className="codascope-notes-activity-item-content">
                      <span className="codascope-notes-activity-item-details">{entry.details}</span>
                      <div className="codascope-notes-activity-item-meta">
                        {entry.actor !== "unknown" && <span className="codascope-notes-activity-item-actor">{entry.actor}</span>}
                        <span className="codascope-notes-activity-item-time">
                          {new Date(entry.timestamp).toLocaleDateString("en-US", {
                            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="codascope-notes-editor-footer">
        <span>{wordCount} word{wordCount !== 1 ? "s" : ""}</span>
        {backlinks.length > 0 && (
          <button
            className={`codascope-notes-backlinks-toggle${showBacklinks ? " codascope-notes-backlinks-toggle-active" : ""}`}
            onClick={() => setShowBacklinks((v) => !v)}
            type="button"
          >
            <IconLink size={12} />
            <span>{backlinks.length} backlink{backlinks.length !== 1 ? "s" : ""}</span>
          </button>
        )}
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-quaternary)" }}>
          Auto-save enabled
        </span>
      </div>

      {/* Backlinks panel */}
      {showBacklinks && backlinks.length > 0 && (
        <div className="codascope-notes-backlinks">
          <div className="codascope-notes-backlinks-header">
            <IconLink size={13} />
            <span>Linked from</span>
          </div>
          <div className="codascope-notes-backlinks-list">
            {backlinks.map((bl) => (
              <button
                key={bl.noteId}
                className={`codascope-notes-backlink-item${bl.isArchived ? " codascope-notes-backlink-item-archived" : ""}`}
                onClick={() => {
                  if (!bl.isArchived && bl.path) {
                    onBack();
                  }
                }}
                type="button"
                disabled={bl.isArchived || !bl.path}
              >
                <span className="codascope-notes-backlink-title">{bl.title}</span>
                {bl.isArchived && <span className="codascope-notes-backlink-badge">(archived)</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Archive confirmation dialog */}
      {showArchiveConfirm && (
        <div className="codascope-notes-archive-dialog-overlay" onClick={() => { setShowArchiveConfirm(false); setArchiveReason(""); }}>
          <div className="codascope-notes-archive-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="codascope-notes-archive-dialog-header">
              <IconArchive size={16} />
              <span>Archive Note?</span>
            </div>
            <p className="codascope-notes-archive-dialog-message">
              This note will be moved to the archive. You can restore it at any time from the archive browser.
            </p>
            <div className="codascope-notes-archive-dialog-reason">
              <label htmlFor="archive-reason">Reason (optional)</label>
              <input
                id="archive-reason"
                type="text"
                className="codascope-notes-archive-reason-input"
                placeholder="e.g. No longer relevant"
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                autoFocus
              />
            </div>
            <div className="codascope-notes-archive-dialog-actions">
              <button
                className="codascope-btn codascope-btn-ghost codascope-btn-sm"
                onClick={() => { setShowArchiveConfirm(false); setArchiveReason(""); }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="codascope-btn codascope-btn-primary codascope-btn-sm"
                onClick={handleArchive}
                disabled={archiving}
                type="button"
              >
                {archiving ? "Archiving…" : "Archive"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move dialog */}
      <NoteMoveDialog
        open={showMoveDialog}
        fromScope={scope}
        fromVisibility={visibility}
        fromPath={apiPath}
        fromOpts={queryParams}
        onMoved={onBack}
        onClose={() => setShowMoveDialog(false)}
      />
    </div>
  );
}
