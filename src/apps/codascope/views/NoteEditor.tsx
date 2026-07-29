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
import {
  buildPinnedRangeExtension,
  MarkdownEditor,
  setPinnedEditorRange,
  type InlineAnnotationAnchorItem,
} from "../../../shared/markdown";
import { getAnnotationAnchorById, getRelativeAnnotationAnchor } from "../annotationNavigation";
import { useAuth } from "../../../shell/authContext";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useShellStore } from "../../../shell/store";
import { IconArrowLeft, IconClose, IconWarning, IconComment, IconClock, IconMove, IconArchive, IconLink, IconUser, IconActivity, IconDraft, IconCheckCircle, IconEye, IconCopy, IconFile } from "../components/CodaScopeIcons";
import { NoteInsertionPrompt } from "../components/NoteInsertionPrompt";
import { NoteAnnotationPanel } from "../components/NoteAnnotationPanel";
import { NoteDocumentPanel } from "../components/NoteDocumentPanel";
import { NoteSelectionToolbar, type NoteSelectionInfo } from "../components/NoteSelectionToolbar";
import { canCreateRangeAnnotation } from "../components/noteSelectionPolicy";
import { NoteFormattingToolbar } from "../components/NoteFormattingToolbar";
import { NoteMoveDialog } from "../components/NoteMoveDialog";
import { NoteExportDialog } from "../components/NoteExportDialog";
import type { AssistantScope, NoteScope, NoteVisibility, NoteAnnotation, NoteBacklink, NoteActivityEntry, NoteReaderInfo } from "../codaScopeTypes";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import {
  clearRootNoteContext,
  createRootNoteContextOwner,
  publishRootNoteContext,
  updateRootNoteContext,
} from "../assistantNoteContext";
import { resolveAssistantScope } from "../assistantScope";
import {
  clearNoteRangeHandoff,
  clearNoteRangeHandoffBySource,
  createNoteRangeHandoffSource,
  getNoteRangeHandoff,
  stageNoteRangeHandoff,
  useNoteRangeHandoff,
} from "../noteRangeHandoff";
import {
  createSerializedTaskQueue,
  NOTE_RANGE_STAGED_STATUS_MESSAGE,
  saveAndPrepareNoteRangeTarget,
  sameSaveSnapshot,
  statusAfterClearedNoteRangeHandoff,
  type NoteRangeSelectionStatus,
  type NoteSaveResult,
  type NoteSaveSnapshot,
} from "../noteRangeEditorPreparation";
import { isCanonicalContentHash } from "../workspaceMutationActionValidation";

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
  const { segments, getParam, setParam } = useAppSubRoute("codascope");
  const assistantScope = useMemo<AssistantScope>(
    () => resolveAssistantScope(segments),
    [segments[0], segments[1]],
  );
  const noteRangeHandoff = useNoteRangeHandoff(assistantScope);
  const annotationsOpenFromUrl = getParam("annotations") === "open";
  const documentsOpenFromUrl = getParam("documents") === "open";
  // ── State ──────────────────────────────────────────────────────────
  const [content, setContent] = useState("");
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("Untitled");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");

  // Conflict state
  const [conflictData, setConflictData] = useState<{
    currentContent: string;
    currentHash: string;
    currentFrontmatter?: { title?: string; tags?: string[]; status?: "draft" | "ready" };
  } | null>(null);

  // Insertion prompt state
  const [insertionPoint, setInsertionPoint] = useState<{
    afterLine: number;
    top: number;
    left: number;
  } | null>(null);

  // Annotation state
  const [annotations, setAnnotations] = useState<NoteAnnotation[]>([]);
  const [inlineAnnotationAnchors, setInlineAnnotationAnchors] = useState<InlineAnnotationAnchorItem[]>([]);
  const [inlineAnnotationMarkerRanges, setInlineAnnotationMarkerRanges] = useState<Array<{ from: number; to: number }>>([]);
  const [showAnnotations, setShowAnnotations] = useState(annotationsOpenFromUrl);
  const [showDocuments, setShowDocuments] = useState(documentsOpenFromUrl);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [selectionInfo, setSelectionInfo] = useState<NoteSelectionInfo | null>(null);
  const [selectionStatus, setSelectionStatus] =
    useState<NoteRangeSelectionStatus | null>(null);
  const [preparingAgentEdit, setPreparingAgentEdit] = useState(false);
  const [multipleSelections, setMultipleSelections] = useState(false);
  const [pendingAnnotation, setPendingAnnotation] = useState<NoteSelectionInfo | null>(null);

  // Move dialog state
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // Version history state
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<{ version: string; content: string; markerRanges?: Array<{ from: number; to: number }> } | null>(null);

  // Backlinks state
  const [backlinks, setBacklinks] = useState<NoteBacklink[]>([]);
  const [showBacklinks, setShowBacklinks] = useState(false);

  // Last editor state
  const [lastEditor, setLastEditor] = useState<{ username: string; editedAt: string } | null>(null);
  const [lastEditorDismissed, setLastEditorDismissed] = useState(false);

  // Activity feed state
  const [activityEntries, setActivityEntries] = useState<NoteActivityEntry[]>([]);
  const [showActivity, setShowActivity] = useState(false);

  useEffect(() => {
    setShowAnnotations(annotationsOpenFromUrl);
  }, [annotationsOpenFromUrl]);

  useEffect(() => {
    setShowDocuments(documentsOpenFromUrl);
  }, [documentsOpenFromUrl]);

  const setAnnotationsPanelOpen = useCallback((open: boolean) => {
    setShowAnnotations(open);
    setParam("annotations", open ? "open" : null);
    if (open) {
      setShowDocuments(false);
      setParam("documents", null);
      setShowActivity(false);
    }
  }, [setParam]);

  const setDocumentsPanelOpen = useCallback((open: boolean) => {
    setShowDocuments(open);
    setParam("documents", open ? "open" : null);
    if (open) {
      setShowAnnotations(false);
      setParam("annotations", null);
      setShowActivity(false);
    }
  }, [setParam]);

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
  const titleRef = useRef(title);
  const tagsRef = useRef(tags);
  const noteStatusRef = useRef(noteStatus);
  const noteIdRef = useRef(noteId);
  const durableSnapshotRef = useRef<(NoteSaveSnapshot & { hash: string }) | null>(null);
  const saveQueueRef = useRef(createSerializedTaskQueue());
  const localRevisionRef = useRef(0);
  const editorViewRef = useRef<EditorView | null>(null);
  const annotationFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantContextOwnerRef = useRef(createRootNoteContextOwner());
  const handoffSourceRef = useRef(createNoteRangeHandoffSource());
  const handledTerminalHandoffRef = useRef<string | null>(null);
  const observedLiveHandoffRef = useRef<{
    handoffId: string;
    noteIdentity: string;
  } | null>(null);
  const pinnedRangeExtensions = useMemo(
    () => [buildPinnedRangeExtension()],
    [],
  );

  // Keep refs in sync
  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => { hashRef.current = contentHash; }, [contentHash]);
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { tagsRef.current = tags; }, [tags]);
  useEffect(() => { noteStatusRef.current = noteStatus; }, [noteStatus]);
  useEffect(() => { noteIdRef.current = noteId; }, [noteId]);

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
  const noteIdentity = `${scope}\u0000${visibility}\u0000${apiPath}\u0000${queryString}`;
  const noteIdentityRef = useRef(noteIdentity);
  noteIdentityRef.current = noteIdentity;

  const sourceHandoff = noteRangeHandoff?.sourceId === handoffSourceRef.current
    ? noteRangeHandoff
    : null;
  const liveSourceHandoff = sourceHandoff
    && (sourceHandoff.status === "staged"
      || sourceHandoff.status === "in-flight")
    ? sourceHandoff
    : null;
  const targetInFlight = liveSourceHandoff?.status === "in-flight";

  useEffect(() => {
    if (liveSourceHandoff) {
      observedLiveHandoffRef.current = {
        handoffId: liveSourceHandoff.handoffId,
        noteIdentity,
      };
      return;
    }
    const observed = observedLiveHandoffRef.current;
    if (!sourceHandoff && observed) {
      observedLiveHandoffRef.current = null;
      if (observed.noteIdentity === noteIdentity) {
        setSelectionStatus(statusAfterClearedNoteRangeHandoff);
      }
    }
  }, [liveSourceHandoff, noteIdentity, sourceHandoff]);

  const invalidateStagedHandoff = useCallback(() => {
    const current = getNoteRangeHandoff(assistantScope);
    if (current?.sourceId === handoffSourceRef.current
      && current.status === "staged") {
      clearNoteRangeHandoff(assistantScope, current.handoffId);
      setSelectionStatus({
        kind: "status",
        message: "The selected range was cleared because the note changed.",
      });
    }
  }, [assistantScope]);

  useEffect(() => {
    clearNoteRangeHandoffBySource(handoffSourceRef.current);
    handledTerminalHandoffRef.current = null;
  }, [apiPath, queryString, scope, visibility]);

  useEffect(() => () => {
    clearNoteRangeHandoffBySource(handoffSourceRef.current);
  }, []);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const target = liveSourceHandoff?.target;
    const matchesMountedNote = Boolean(
      target
      && target.stableId === noteIdRef.current
      && target.scope === scope
      && target.visibility === visibility
      && target.path === apiPath,
    );
    view.dispatch({
      effects: setPinnedEditorRange.of(matchesMountedNote && target
        ? {
            from: target.selectionStart,
            to: target.selectionEnd,
          }
        : null),
    });
  }, [
    apiPath,
    liveSourceHandoff?.handoffId,
    liveSourceHandoff?.status,
    scope,
    visibility,
  ]);

  useEffect(() => {
    if (!targetInFlight) return;
    setInsertionPoint(null);
    setPendingAnnotation(null);
    setSelectionInfo(null);
    setAnnotationsPanelOpen(false);
    setDocumentsPanelOpen(false);
    setShowMoveDialog(false);
    setShowArchiveConfirm(false);
    setShowVersions(false);
    setSelectedVersion(null);
  }, [setAnnotationsPanelOpen, setDocumentsPanelOpen, targetInFlight]);

  // ── Load note ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const assistantContextOwner = assistantContextOwnerRef.current;
    clearRootNoteContext(assistantContextOwner);
    clearNoteRangeHandoffBySource(handoffSourceRef.current);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setLoading(true);
    setError(null);
    setSaveStatus("idle");
    setSelectionInfo(null);
    setSelectionStatus(null);
    setPreparingAgentEdit(false);
    setLastEditor(null);
    setLastEditorDismissed(false);
    setReaders([]);
    setNoteId(null);
    noteIdRef.current = null;
    durableSnapshotRef.current = null;
    localRevisionRef.current += 1;

    void (async () => {
      try {
        const res = await fetch(`${apiBase}/note/${apiPath}?${queryString}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const loadedContent = typeof data.content === "string"
            ? data.content
            : "";
          const loadedHash = typeof data.contentHash === "string"
            ? data.contentHash
            : null;
          setContent(loadedContent);
          contentRef.current = loadedContent;
          setContentHash(loadedHash);
          hashRef.current = loadedHash;

          // Metadata is supplied separately from the editable note body.
          const fm = data.frontmatter;
          if (fm) {
            const loadedTitle = fm.title ?? "Untitled";
            const loadedTags = Array.isArray(fm.tags) ? fm.tags : [];
            const loadedStatus = fm.status ?? undefined;
            const loadedNoteId = fm.id ?? null;
            setTitle(loadedTitle);
            titleRef.current = loadedTitle;
            setTags(loadedTags);
            tagsRef.current = loadedTags;
            setNoteId(loadedNoteId);
            noteIdRef.current = loadedNoteId;
            setNoteStatus(loadedStatus);
            noteStatusRef.current = loadedStatus;
            if (loadedHash && isCanonicalContentHash(loadedHash)) {
              durableSnapshotRef.current = {
                content: loadedContent,
                title: loadedTitle.trim() || "Untitled",
                tags: [...loadedTags],
                status: loadedStatus,
                hash: loadedHash,
              };
            } else {
              durableSnapshotRef.current = null;
            }
            if (scope === "codascope" && typeof fm.id === "string") {
              publishRootNoteContext(assistantContextOwner, {
                stableId: fm.id,
                scope: "codascope",
                path: apiPath,
                title: fm.title ?? "Untitled",
                visibility,
                ...(typeof data.contentHash === "string"
                  ? { contentHash: data.contentHash }
                  : {}),
              });
            }
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
          clearRootNoteContext(assistantContextOwner);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load note");
          clearRootNoteContext(assistantContextOwner);
        }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
      clearRootNoteContext(assistantContextOwner);
    };
  }, [apiBase, apiPath, queryString, scope, visibility]);

  useEffect(() => {
    updateRootNoteContext(assistantContextOwnerRef.current, {
      title,
      contentHash: contentHash ?? undefined,
    });
  }, [contentHash, title]);

  // ── Fetch annotations ─────────────────────────────────────────────
  const fetchAnnotations = useCallback(async () => {
    try {
      const res = await fetch(
        `${apiBase}/note/${apiPath}/annotations?${queryString}`,
      );
      if (res.ok) {
        const data = await res.json();
        setAnnotations(data.annotations ?? []);
        setInlineAnnotationAnchors(data.anchors ?? []);
        setInlineAnnotationMarkerRanges(data.markerRanges ?? []);
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

  const refreshNoteAfterAgent = useCallback(async (
    expectedStableId: string,
  ): Promise<boolean> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await saveQueueRef.current.drain();
    try {
      const res = await fetch(`${apiBase}/note/${apiPath}?${queryString}`);
      if (!res.ok) return false;
      const data = await res.json();
      const fm = data.frontmatter;
      if (!fm
        || fm.id !== expectedStableId
        || typeof data.content !== "string"
        || !isCanonicalContentHash(data.contentHash)) {
        return false;
      }
      const refreshedTitle = fm.title ?? "Untitled";
      const refreshedTags = Array.isArray(fm.tags) ? fm.tags : [];
      const refreshedStatus = fm.status ?? undefined;
      setContent(data.content);
      contentRef.current = data.content;
      setContentHash(data.contentHash);
      hashRef.current = data.contentHash;
      setTitle(refreshedTitle);
      titleRef.current = refreshedTitle;
      setTags(refreshedTags);
      tagsRef.current = refreshedTags;
      setNoteStatus(refreshedStatus);
      noteStatusRef.current = refreshedStatus;
      durableSnapshotRef.current = {
        content: data.content,
        title: refreshedTitle.trim() || "Untitled",
        tags: [...refreshedTags],
        status: refreshedStatus,
        hash: data.contentHash,
      };
      localRevisionRef.current += 1;
      if (data.lastEditor && data.lastEditedAt) {
        setLastEditor({
          username: data.lastEditor,
          editedAt: data.lastEditedAt,
        });
      }
      await fetchAnnotations();
      return true;
    } catch {
      return false;
    }
  }, [apiBase, apiPath, fetchAnnotations, queryString]);

  useEffect(() => {
    if (!sourceHandoff
      || (sourceHandoff.status !== "completed"
        && sourceHandoff.status !== "failed")
      || handledTerminalHandoffRef.current === sourceHandoff.handoffId) {
      return;
    }
    handledTerminalHandoffRef.current = sourceHandoff.handoffId;
    if (!sourceHandoff.completionAction) {
      setSelectionStatus({
        kind: sourceHandoff.status === "failed" ? "error" : "status",
        message: sourceHandoff.status === "failed"
          ? "The agent did not complete this selected edit."
          : "The selected edit turn is complete.",
      });
      return;
    }
    void refreshNoteAfterAgent(sourceHandoff.target.stableId).then((refreshed) => {
      setSelectionStatus({
        kind: refreshed ? "status" : "error",
        message: refreshed
          ? "The agent edit was applied and the note was refreshed."
          : "The agent edit was confirmed, but the note could not be refreshed.",
      });
    });
  }, [refreshNoteAfterAgent, sourceHandoff]);

  // ── Open annotation count for header badge ────────────────────────
  const openAnnotationCount = useMemo(() => {
    return annotations.filter((a) => a.status === "open" && !a.parentId).length;
  }, [annotations]);

  // ── Auto-save (debounced) ──────────────────────────────────────────
  const performSave = useCallback(async (
    snapshot: NoteSaveSnapshot,
  ): Promise<NoteSaveResult> => {
    const saveIdentity = noteIdentity;
    if (noteIdentityRef.current !== saveIdentity) {
      return { ok: false, reason: "error" };
    }
    const durable = durableSnapshotRef.current;
    if (noteIdentityRef.current === saveIdentity
      && durable
      && sameSaveSnapshot(durable, snapshot)) {
      return { ok: true, hash: durable.hash, snapshot };
    }
    if (noteIdentityRef.current === saveIdentity) setSaveStatus("saving");
    try {
      const res = await fetch(`${apiBase}/note/${apiPath}?${queryString}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: snapshot.content,
          title: snapshot.title,
          tags: snapshot.tags,
          status: snapshot.status,
          expectedHash: hashRef.current ?? undefined,
        }),
      });

      if (res.status === 409) {
        const data = await res.json();
        if (noteIdentityRef.current === saveIdentity) {
          setConflictData({
            currentContent: data.currentContent,
            currentHash: data.currentHash,
            currentFrontmatter: data.currentFrontmatter,
          });
          setSaveStatus("error");
        }
        return { ok: false, reason: "conflict" };
      }

      if (res.ok) {
        const data = await res.json();
        if (!isCanonicalContentHash(data.contentHash)) {
          if (noteIdentityRef.current === saveIdentity) setSaveStatus("error");
          return { ok: false, reason: "error" };
        }
        const hash = data.contentHash;
        if (noteIdentityRef.current === saveIdentity) {
          hashRef.current = hash;
          durableSnapshotRef.current = {
            ...snapshot,
            tags: [...snapshot.tags],
            hash,
          };
          setContentHash(hash);
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus((s) => s === "saved" ? "idle" : s), 2000);
        }
        return { ok: true, hash, snapshot };
      } else {
        if (noteIdentityRef.current === saveIdentity) setSaveStatus("error");
        return { ok: false, reason: "error" };
      }
    } catch {
      if (noteIdentityRef.current === saveIdentity) setSaveStatus("error");
      return { ok: false, reason: "error" };
    }
  }, [apiBase, apiPath, noteIdentity, queryString]);

  const enqueueSave = useCallback((
    snapshot: NoteSaveSnapshot,
  ): Promise<NoteSaveResult> => {
    return saveQueueRef.current.enqueue(() => performSave(snapshot));
  }, [performSave]);

  const snapshotForSave = useCallback((
    nextContent = contentRef.current,
    metadata: {
      title?: string;
      tags?: string[];
      status?: "draft" | "ready";
    } = {},
  ): NoteSaveSnapshot => ({
    content: nextContent,
    title: (metadata.title ?? titleRef.current.trim()) || "Untitled",
    tags: [...(metadata.tags ?? tagsRef.current)],
    status: metadata.status ?? noteStatusRef.current,
  }), []);

  const saveNote = useCallback((
    newContent: string,
    _expectedHash: string | null,
    metadata: {
      title?: string;
      tags?: string[];
      status?: "draft" | "ready";
    } = {},
  ) => enqueueSave(snapshotForSave(newContent, metadata)), [
    enqueueSave,
    snapshotForSave,
  ]);

  const handleContentChange = useCallback((newContent: string) => {
    if (targetInFlight) return;
    invalidateStagedHandoff();
    setContent(newContent);
    contentRef.current = newContent;
    localRevisionRef.current += 1;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      void saveNote(newContent, hashRef.current);
    }, 1500);
  }, [invalidateStagedHandoff, saveNote, targetInFlight]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ── Editable presentation metadata ─────────────────────────────────
  const handleTitleChange = useCallback((nextTitle: string) => {
    if (targetInFlight) return;
    invalidateStagedHandoff();
    setTitle(nextTitle);
    titleRef.current = nextTitle;
    localRevisionRef.current += 1;
  }, [invalidateStagedHandoff, targetInFlight]);

  const handleTitleBlur = useCallback(() => {
    if (targetInFlight || !title.trim()) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    void saveNote(contentRef.current, hashRef.current, { title: title.trim() });
  }, [targetInFlight, title, saveNote]);

  const saveTags = useCallback((nextTags: string[]) => {
    if (targetInFlight) return;
    invalidateStagedHandoff();
    setTags(nextTags);
    tagsRef.current = nextTags;
    localRevisionRef.current += 1;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    void saveNote(contentRef.current, hashRef.current, { tags: nextTags });
  }, [invalidateStagedHandoff, saveNote, targetInFlight]);

  const addTags = useCallback((value: string) => {
    const additions = value.split(",").map((tag) => tag.trim()).filter(Boolean);
    if (additions.length === 0) return;
    saveTags(Array.from(new Set([...tags, ...additions])));
    setTagInput("");
  }, [tags, saveTags]);

  // ── Archive note ───────────────────────────────────────────────────
  const handleArchive = useCallback(async () => {
    if (targetInFlight) return;
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
  }, [
    apiBase,
    apiPath,
    queryString,
    onBack,
    archiveReason,
    targetInFlight,
  ]);

  // ── Conflict resolution ────────────────────────────────────────────
  const handleConflictReload = useCallback(() => {
    if (!conflictData) return;
    setContent(conflictData.currentContent);
    contentRef.current = conflictData.currentContent;
    setContentHash(conflictData.currentHash);
    hashRef.current = conflictData.currentHash;
    if (conflictData.currentFrontmatter) {
      const currentTitle = conflictData.currentFrontmatter.title ?? "Untitled";
      const currentTags = conflictData.currentFrontmatter.tags ?? [];
      const currentStatus = conflictData.currentFrontmatter.status;
      setTitle(currentTitle);
      titleRef.current = currentTitle;
      setTags(currentTags);
      tagsRef.current = currentTags;
      setNoteStatus(currentStatus);
      noteStatusRef.current = currentStatus;
      durableSnapshotRef.current = {
        content: conflictData.currentContent,
        title: currentTitle.trim() || "Untitled",
        tags: [...currentTags],
        status: currentStatus,
        hash: conflictData.currentHash,
      };
    }
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
        body: JSON.stringify({ content: contentRef.current, title: title.trim() || "Untitled", tags, status: noteStatus }),
      });
      if (res.ok) {
        const data = await res.json();
        setContentHash(data.contentHash);
        hashRef.current = data.contentHash;
        durableSnapshotRef.current = {
          ...snapshotForSave(),
          hash: data.contentHash,
        };
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus((s) => s === "saved" ? "idle" : s), 2000);
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  }, [conflictData, apiBase, apiPath, queryString, snapshotForSave]);

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
        contentRef.current = conflictData.currentContent;
        setContentHash(conflictData.currentHash);
        hashRef.current = conflictData.currentHash;
        if (conflictData.currentFrontmatter) {
          const currentTitle = conflictData.currentFrontmatter.title ?? "Untitled";
          const currentTags = conflictData.currentFrontmatter.tags ?? [];
          const currentStatus = conflictData.currentFrontmatter.status;
          setTitle(currentTitle);
          titleRef.current = currentTitle;
          setTags(currentTags);
          tagsRef.current = currentTags;
          setNoteStatus(currentStatus);
          noteStatusRef.current = currentStatus;
          durableSnapshotRef.current = {
            content: conflictData.currentContent,
            title: currentTitle.trim() || "Untitled",
            tags: [...currentTags],
            status: currentStatus,
            hash: conflictData.currentHash,
          };
        }
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
        const insert = `![](${relativePath})`;
        view.dispatch(view.state.changeByRange((range) => ({
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.cursor(range.from + insert.length),
        })));
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
  const handleAnnotationClick = useCallback((annotationId: string) => {
    setActiveAnnotationId(annotationId);
    setAnnotationsPanelOpen(true);
  }, [setAnnotationsPanelOpen]);

  const focusAnnotationAnchor = useCallback((target: InlineAnnotationAnchorItem) => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({
      selection: { anchor: target.rangeFrom },
      effects: EditorView.scrollIntoView(target.rangeFrom, { y: "center" }),
    });
    view.focus();
    setActiveAnnotationId(target.annotationId);
    setAnnotationsPanelOpen(true);
  }, [setAnnotationsPanelOpen]);

  const navigateToAnnotation = useCallback((annotationId: string) => {
    const target = getAnnotationAnchorById(inlineAnnotationAnchors, annotationId);
    if (!target) return;
    focusAnnotationAnchor(target);
  }, [focusAnnotationAnchor, inlineAnnotationAnchors]);

  const navigateAnnotation = useCallback((direction: "next" | "previous") => {
    const view = editorViewRef.current;
    if (!view) return;
    const target = getRelativeAnnotationAnchor(inlineAnnotationAnchors, view.state.selection.main.head, direction);
    if (target) focusAnnotationAnchor(target);
  }, [focusAnnotationAnchor, inlineAnnotationAnchors]);

  // ── Text selection and annotations ─────────────────────────────────
  const handleSelectionChange = useCallback((view: EditorView) => {
    if (!canCreateRangeAnnotation(view.state.selection)) {
      // Range annotations must never infer an anchor from a primary range.
      setMultipleSelections(view.state.selection.ranges.length > 1);
      setSelectionInfo(null);
      return;
    }
    setMultipleSelections(false);
    const selection = view.state.selection.main;
    if (selection.empty) {
      setSelectionInfo(null);
      return;
    }

    const text = view.state.doc.sliceString(selection.from, selection.to);
    const start = view.coordsAtPos(selection.from);
    const end = view.coordsAtPos(selection.to);
    if (!text.trim() || !start || !end) {
      setSelectionInfo(null);
      return;
    }

    setSelectionInfo({
      text,
      from: selection.from,
      to: selection.to,
      startLine: view.state.doc.lineAt(selection.from).number,
      endLine: view.state.doc.lineAt(selection.to).number,
      rect: {
        top: Math.min(start.top, end.top),
        left: Math.min(start.left, end.left),
        width: Math.max(1, Math.max(start.right, end.right) - Math.min(start.left, end.left)),
      },
    });
  }, []);

  const handleEditWithAgent = useCallback(async (
    selection: NoteSelectionInfo,
  ) => {
    if (preparingAgentEdit || targetInFlight) return;
    setPreparingAgentEdit(true);
    setSelectionStatus({
      kind: "status",
      message: "Saving the exact note state for this selection…",
    });

    const fail = (message: string) => {
      setSelectionStatus({ kind: "error", message });
      setPreparingAgentEdit(false);
      setSelectionInfo(null);
    };
    const view = editorViewRef.current;
    const stableId = noteIdRef.current;
    const projectId = queryParams.projectId;
    const epicId = queryParams.epicId;
    if (!view || !stableId) {
      fail("This selection is not available to the current assistant.");
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const capturedContent = view.state.doc.toString();
    const capturedSnapshot = snapshotForSave(capturedContent);
    const prepared = await saveAndPrepareNoteRangeTarget({
      captured: {
        identity: noteIdentity,
        revision: localRevisionRef.current,
        stableId,
        scope,
        visibility,
        path: apiPath,
        assistantScope,
        projectId,
        epicId,
        snapshot: capturedSnapshot,
        selection,
      },
      save: enqueueSave,
      readCurrent: () => {
        const currentView = editorViewRef.current;
        return {
          identity: noteIdentityRef.current,
          revision: localRevisionRef.current,
          stableId: currentView ? noteIdRef.current : null,
          snapshot: snapshotForSave(
            currentView?.state.doc.toString() ?? contentRef.current,
          ),
        };
      },
    });
    if (!prepared.ok) {
      fail(prepared.reason === "conflict"
        ? "The note changed while preparing the selection. Select it again."
        : prepared.reason === "save"
          ? "The selection could not be saved. Select it again."
          : prepared.reason === "changed"
            ? "The note changed while preparing the selection. Select it again."
            : "This exact selection cannot be sent to the assistant.");
      return;
    }
    const handoff = stageNoteRangeHandoff({
      scope: assistantScope,
      sourceId: handoffSourceRef.current,
      target: prepared.target,
    });
    if (!handoff) {
      fail("This selection is not available to the current assistant.");
      return;
    }

    setPreparingAgentEdit(false);
    setSelectionInfo(null);
    setSelectionStatus({
      kind: "status",
      message: NOTE_RANGE_STAGED_STATUS_MESSAGE,
    });
    useShellStore.getState().openRightPanel("assistant");
  }, [
    apiPath,
    assistantScope,
    enqueueSave,
    noteIdentity,
    preparingAgentEdit,
    queryParams.epicId,
    queryParams.projectId,
    scope,
    snapshotForSave,
    targetInFlight,
    visibility,
  ]);

  const handleCommentFromSelection = useCallback((selection: NoteSelectionInfo) => {
    if (!editorViewRef.current || !canCreateRangeAnnotation(editorViewRef.current.state.selection)) return;
    // The source range itself, not a block hash or a quoted-text search, is
    // sent to the server for atomic marker insertion.
    setPendingAnnotation(selection);
    setAnnotationsPanelOpen(true);
  }, [setAnnotationsPanelOpen]);

  const handleAnnotationMutation = useCallback((result: { content?: string; contentHash?: string }) => {
    invalidateStagedHandoff();
    if (typeof result.content === "string") {
      setContent(result.content);
      contentRef.current = result.content;
      localRevisionRef.current += 1;
    }
    if (result.contentHash) {
      setContentHash(result.contentHash);
      hashRef.current = result.contentHash;
      if (typeof result.content === "string"
        && isCanonicalContentHash(result.contentHash)) {
        durableSnapshotRef.current = {
          ...snapshotForSave(result.content),
          hash: result.contentHash,
        };
      }
    }
    setSelectionInfo(null);
    setPendingAnnotation(null);
    void fetchAnnotations();
  }, [fetchAnnotations, invalidateStagedHandoff, snapshotForSave]);

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
        setSelectedVersion({ version: data.version, content: data.content, markerRanges: data.markerRanges });
      }
    } catch { /* ignore */ }
  }, [apiBase, apiPath, queryString]);

  const handleRestoreVersion = useCallback((versionContent: string) => {
    if (targetInFlight) return;
    invalidateStagedHandoff();
    setContent(versionContent);
    contentRef.current = versionContent;
    localRevisionRef.current += 1;
    setSelectedVersion(null);
    setShowVersions(false);
    // Trigger save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    void saveNote(versionContent, hashRef.current);
  }, [invalidateStagedHandoff, saveNote, targetInFlight]);

  const parentFolderName = useMemo(() => {
    const pathParts = notePath.replace(/\.md$/, "").split("/").filter(Boolean);
    return pathParts.length > 1 ? pathParts[pathParts.length - 2] : null;
  }, [notePath]);
  const backLabel = parentFolderName ?? "Notes";
  const backTitle = parentFolderName ? `Back to ${parentFolderName}` : "Back to notes";

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

  // Fetch backlinks when the note loads.
  useEffect(() => {
    if (noteId) void fetchBacklinks(noteId);
  }, [noteId, fetchBacklinks]);

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
    if (targetInFlight) return;
    invalidateStagedHandoff();
    const newStatus = noteStatus === "ready" ? "draft" : "ready";
    setNoteStatus(newStatus);
    noteStatusRef.current = newStatus;
    localRevisionRef.current += 1;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    void saveNote(contentRef.current, hashRef.current, { status: newStatus });
  }, [invalidateStagedHandoff, noteStatus, saveNote, targetInFlight]);

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
          <button className="codascope-notes-editor-back" onClick={onBack} title={backTitle} type="button">
            <IconArrowLeft size={15} />
            <span>{backLabel}</span>
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
          <button className="codascope-notes-editor-back" onClick={onBack} title={backTitle} type="button">
            <IconArrowLeft size={15} />
            <span>{backLabel}</span>
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
          title={backTitle}
        >
          <IconArrowLeft size={15} />
          <span>{backLabel}</span>
        </button>

        <input
          className="codascope-notes-editor-title-input"
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onBlur={handleTitleBlur}
          disabled={targetInFlight}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Note title…"
        />

        <div className="codascope-notes-editor-tags" aria-label="Note tags">
          {tags.map((tag) => (
            <span className="codascope-notes-editor-tag" key={tag}>
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                title={`Remove ${tag}`}
                onClick={() => saveTags(tags.filter((current) => current !== tag))}
                disabled={targetInFlight}
              >
                <IconClose size={10} />
              </button>
            </span>
          ))}
          <input
            className="codascope-notes-editor-tag-input"
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onBlur={() => addTags(tagInput)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTags(tagInput);
              }
            }}
            placeholder={tags.length === 0 ? "Add tags…" : "+ tag"}
            aria-label="Add tags"
            disabled={targetInFlight}
          />
        </div>

        {/* Visibility chip */}
        <span className={`codascope-notes-visibility-badge codascope-notes-visibility-badge--${visibility}`}>
          {visibilityLabel(visibility, scope)}
        </span>

        {/* Draft/Ready toggle (shared notes only) */}
        {visibility === "shared" && (
          <button
            className={`codascope-notes-status-toggle codascope-notes-status-toggle--${noteStatus ?? "draft"}`}
            onClick={handleStatusToggle}
            disabled={targetInFlight}
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
            {saveStatus === "saved" && <><IconCheckCircle size={12} /> Saved</>}
            {saveStatus === "error" && <><IconWarning size={12} /> Error</>}
          </span>

          {/* Annotations toggle */}
          <button
            className={`codascope-btn codascope-btn-ghost codascope-btn-sm codascope-notes-editor-ann-toggle${showAnnotations ? " codascope-notes-editor-ann-toggle--active" : ""}`}
            onClick={() => setAnnotationsPanelOpen(!showAnnotations)}
            type="button"
            title={showAnnotations ? "Hide annotations" : "Show annotations"}
            aria-pressed={showAnnotations}
            disabled={targetInFlight}
          >
            <IconComment size={14} />
            <span>Annotations</span>
            {openAnnotationCount > 0 && (
              <span className="codascope-notes-editor-ann-badge">{openAnnotationCount}</span>
            )}
          </button>

          <button
            className={`codascope-btn codascope-btn-ghost codascope-btn-sm codascope-notes-editor-documents-toggle${showDocuments ? " codascope-notes-editor-documents-toggle--active" : ""}`}
            onClick={() => setDocumentsPanelOpen(!showDocuments)}
            type="button"
            title={showDocuments ? "Hide documents" : "Show documents"}
            aria-pressed={showDocuments}
            disabled={targetInFlight}
          >
            <IconFile size={14} />
            <span>Documents</span>
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
        disabled={(showVersions && !!selectedVersion) || targetInFlight}
        multipleSelections={multipleSelections}
        onShowVersions={handleShowVersions}
        onMoveNote={() => {
          invalidateStagedHandoff();
          setShowMoveDialog(true);
        }}
        onToggleActivity={() => {
          const opening = !showActivity;
          setShowActivity(opening);
          if (opening) {
            setAnnotationsPanelOpen(false);
            setDocumentsPanelOpen(false);
            void fetchActivity();
          }
        }}
        activityOpen={showActivity}
        onExportNote={() => setShowExport(true)}
        onArchiveNote={() => {
          invalidateStagedHandoff();
          setShowArchiveConfirm(true);
        }}
        archiveDisabled={archiving || targetInFlight}
      />

      {selectionStatus && (
        <p
          className={`codascope-notes-selection-status${selectionStatus.kind === "error"
            ? " codascope-notes-selection-status-error"
            : ""}`}
          role="status"
          aria-live="polite"
        >
          {selectionStatus.message}
        </p>
      )}

      {multipleSelections && !showVersions && (
        <p className="codascope-notes-multi-selection-notice" role="status">
          Multiple selections are active. Annotation and text-color actions require one selection.
        </p>
      )}

      {/* Editor body — split layout when annotation panel is open */}
      <div className={`codascope-notes-editor-body${(showAnnotations || showActivity || showDocuments) ? " codascope-notes-editor-body--split" : ""}`}>
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
                  inlineAnnotationMarkerRanges={selectedVersion.markerRanges}
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
              editable={!targetInFlight}
              additionalExtensions={pinnedRangeExtensions}
              selectedPath={apiPath}
              onImagePaste={handleImagePaste}
              resolveImageUrl={resolveImageUrl}
              showImagePreview
              showInsertionHotzones
              showSlashCommands
              autoContinueLists
              showFootnotes
              onInsertionRequest={handleInsertionRequest}
              inlineAnnotationAnchors={inlineAnnotationAnchors.length > 0 ? inlineAnnotationAnchors : undefined}
              inlineAnnotationMarkerRanges={inlineAnnotationMarkerRanges.length > 0 ? inlineAnnotationMarkerRanges : undefined}
              onAnnotationClick={handleAnnotationClick}
              onEditorView={(view) => {
                editorViewRef.current = view;
                const target = liveSourceHandoff?.target;
                view.dispatch({
                  effects: setPinnedEditorRange.of(target
                    && target.stableId === noteIdRef.current
                    && (liveSourceHandoff.status === "staged"
                      || liveSourceHandoff.status === "in-flight")
                    ? {
                        from: target.selectionStart,
                        to: target.selectionEnd,
                      }
                    : null),
                });
              }}
              onSelectionChange={targetInFlight
                ? undefined
                : handleSelectionChange}
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
            inlineAnnotationAnchors={inlineAnnotationAnchors}
            onAnnotationsChange={fetchAnnotations}
            onAnnotationMutation={handleAnnotationMutation}
            activeAnnotationId={activeAnnotationId}
            pendingAnnotation={pendingAnnotation}
            currentSelection={selectionInfo}
            expectedHash={contentHash}
            onPendingAnnotationDismiss={() => setPendingAnnotation(null)}
            onNavigateAnnotation={navigateAnnotation}
            onNavigateToAnnotation={navigateToAnnotation}
            onClose={() => setAnnotationsPanelOpen(false)}
          />
        )}

        {showDocuments && !showAnnotations && (
          <NoteDocumentPanel
            notePath={apiPath}
            apiBase={apiBase}
            queryString={queryString}
            onClose={() => setDocumentsPanelOpen(false)}
          />
        )}

        {/* Activity panel (right split) */}
        {showActivity && !showAnnotations && !showDocuments && (
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

      {selectionInfo && !showVersions && (
        <NoteSelectionToolbar
          selectionInfo={selectionInfo}
          onDismiss={() => setSelectionInfo(null)}
          onEditWithAgent={(selected) => {
            void handleEditWithAgent(selected);
          }}
          preparingAgentEdit={preparingAgentEdit}
          onComment={handleCommentFromSelection}
        />
      )}

      {/* Backlink control only appears when it has something useful to show. */}
      {backlinks.length > 0 && (
        <div className="codascope-notes-editor-footer">
          <button
            className={`codascope-notes-backlinks-toggle${showBacklinks ? " codascope-notes-backlinks-toggle-active" : ""}`}
            onClick={() => setShowBacklinks((v) => !v)}
            type="button"
          >
            <IconLink size={12} />
            <span>{backlinks.length} backlink{backlinks.length !== 1 ? "s" : ""}</span>
          </button>
        </div>
      )}

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
                disabled={archiving || targetInFlight}
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

      <NoteExportDialog
        open={showExport}
        scope={scope}
        visibility={visibility}
        queryParams={queryParams}
        notePaths={[apiPath]}
        onClose={() => setShowExport(false)}
      />
    </div>
  );
}
