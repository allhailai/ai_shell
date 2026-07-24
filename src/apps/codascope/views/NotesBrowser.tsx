/* ── CodaScope: NotesBrowser View ────────────────────────────────────
   List + folder browser for notes at any scope/visibility.
   URL-driven with breadcrumb navigation.
   Full-text search with highlighted match context.
   Starred notes and recents section.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { IconNotes, IconFolder, IconFile, IconArchive, IconStar, IconStarFilled, IconClock, IconInbox, IconClose, IconTag, IconCheckbox, IconCheckboxChecked, IconDownload, IconUpload, IconDraft, IconCheckCircle, IconMove, IconPlus, IconPin, IconPinFilled } from "../components/CodaScopeIcons";
import { NoteArchiveBrowser } from "./NoteArchiveBrowser";
import { NoteMoveDialog } from "../components/NoteMoveDialog";
import { NoteCreateDialog, type NoteCreateLocation } from "../components/NoteCreateDialog";
import { NoteExportDialog } from "../components/NoteExportDialog";
import { NoteImportDialog } from "../components/NoteImportDialog";
import { ConfirmDialog } from "../../../shared/confirm-dialog/ConfirmDialog";
import type { NoteScope, NoteVisibility, NoteEntry, StarredNoteRef, RecentNoteRef, NoteTagIndexEntry } from "../codaScopeTypes";
import { compareNoteEntriesByPriority } from "../noteEntrySort";

/* ── Relative time formatter ─────────────────────────────────────────── */

function relativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/* ── Scope label helper ──────────────────────────────────────────────── */

function scopeLabel(scope: NoteScope): string {
  switch (scope) {
    case "codascope": return "CodaScope";
    case "project": return "Project";
    case "epic": return "Epic";
    default: return scope;
  }
}

/* ── URL parsing helpers ─────────────────────────────────────────────── */

interface NotesBrowserContext {
  scope: NoteScope;
  visibility: NoteVisibility;
  /** Folder path segments (may be empty for root) */
  folderParts: string[];
  /** Query params for the API */
  queryParams: Record<string, string>;
}

/**
 * Parse the URL segments and props to determine the notes context.
 */
function parseNotesContext(
  segments: string[],
  projectId: string | null,
  epicId?: string | null,
): NotesBrowserContext | null {
  // Case 1: codascope-level notes: /codascope/notes/<visibility>/...
  if (segments[0] === "notes" && segments.length >= 2) {
    const visibility = segments[1] as NoteVisibility;
    if (visibility !== "shared" && visibility !== "private") return null;
    const rest = segments.slice(2);
    return {
      scope: "codascope",
      visibility,
      folderParts: rest,
      queryParams: {},
    };
  }

  // Case 2: project-level: /codascope/project/:id/notes[/<visibility>/...]
  if (segments[0] === "project" && segments[2] === "notes" && projectId) {
    if (segments[3] === "codascope") {
      const explicitVisibility = segments[4] as NoteVisibility | undefined;
      const visibility: NoteVisibility = explicitVisibility === "private" ? "private" : "shared";
      const folderParts = segments.slice(explicitVisibility === "shared" || explicitVisibility === "private" ? 5 : 4);
      return {
        scope: "codascope",
        visibility,
        folderParts,
        queryParams: {},
      };
    }
    const explicitVisibility = segments[3] as NoteVisibility | undefined;
    const hasVisibility = explicitVisibility === "shared" || explicitVisibility === "private";
    const visibility: NoteVisibility = hasVisibility ? explicitVisibility : "shared";
    const rest = segments.slice(hasVisibility ? 4 : 3);
    return {
      scope: "project",
      visibility,
      folderParts: rest,
      queryParams: { projectId },
    };
  }

  // Case 3: epic-level: /codascope/project/:id/epic/:epicId/notes[/shared/...]
  if (segments[0] === "project" && segments[2] === "epic" && segments[4] === "notes" && projectId && epicId) {
    if (segments[5] === "codascope") {
      const explicitVisibility = segments[6] as NoteVisibility | undefined;
      const visibility: NoteVisibility = explicitVisibility === "private" ? "private" : "shared";
      const folderParts = segments.slice(explicitVisibility === "shared" || explicitVisibility === "private" ? 7 : 6);
      return {
        scope: "codascope",
        visibility,
        folderParts,
        queryParams: {},
      };
    }
    const hasVisibility = segments[5] === "shared";
    const visibility: NoteVisibility = "shared";
    const rest = segments.slice(hasVisibility ? 6 : 5);
    return {
      scope: "epic",
      visibility,
      folderParts: rest,
      queryParams: { projectId, epicId },
    };
  }

  return null;
}



/* ── Search result type ──────────────────────────────────────────────── */

interface SearchResult {
  scope: NoteScope;
  path: string;
  title: string;
  matchLine: string;
  lineNumber: number;
}

interface NoteDragPayload {
  notes: Array<Pick<NoteEntry, "path" | "noteId">>;
}

const NOTE_DRAG_DATA_TYPE = "application/x-codascope-notes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface NotesBrowserProps {
  /** Note scope */
  scope?: NoteScope;
  /** Note visibility */
  visibility?: NoteVisibility;
  /** Override project ID */
  projectId?: string;
  /** Override epic ID */
  epicId?: string;
  /** Preserve a project or epic URL shell while browsing CodaScope notes. */
  urlPrefixOverride?: string;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function NotesBrowser({ scope: propScope, visibility: propVisibility, projectId: propProjectId, epicId: propEpicId, urlPrefixOverride }: NotesBrowserProps = {}) {
  const { segments, navigate } = useAppSubRoute("codascope");
  const { activeProjectId } = useCodaScopeStore();

  const effectiveProjectId = propProjectId ?? activeProjectId;

  const urlContext = useMemo(
    () => parseNotesContext(segments, effectiveProjectId ?? null, propEpicId),
    [segments, effectiveProjectId, propEpicId],
  );

  const scope: NoteScope = propScope ?? urlContext?.scope ?? "codascope";
  const visibility: NoteVisibility = propVisibility ?? urlContext?.visibility ?? "shared";
  const folderParts = urlContext?.folderParts ?? [];
  const currentFolder = folderParts.length > 0 ? folderParts.join("/") : undefined;

  // Build a STABLE query string from primitives — avoids infinite re-render
  // loops caused by object-identity changes in urlContext.queryParams.
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (propProjectId) params.set("projectId", propProjectId);
    else if (urlContext?.queryParams?.projectId) params.set("projectId", urlContext.queryParams.projectId);
    if (propEpicId) params.set("epicId", propEpicId);
    else if (urlContext?.queryParams?.epicId) params.set("epicId", urlContext.queryParams.epicId);
    return params.toString();
  }, [propProjectId, propEpicId, urlContext?.queryParams?.projectId, urlContext?.queryParams?.epicId]);

  const scopeQueryParams = useMemo((): Record<string, string> => {
    const params: Record<string, string> = {};
    if (propProjectId) params.projectId = propProjectId;
    else if (urlContext?.queryParams?.projectId) params.projectId = urlContext.queryParams.projectId;
    if (propEpicId) params.epicId = propEpicId;
    else if (urlContext?.queryParams?.epicId) params.epicId = urlContext.queryParams.epicId;
    return params;
  }, [propProjectId, propEpicId, urlContext?.queryParams?.projectId, urlContext?.queryParams?.epicId]);

  // ── State ──────────────────────────────────────────────────────────
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createMode, setCreateMode] = useState<"note" | "folder" | null>(null);
  const [showArchive, setShowArchive] = useState(false);

  // Starred & recents state
  const [starredNotes, setStarredNotes] = useState<StarredNoteRef[]>([]);
  const [recents, setRecents] = useState<RecentNoteRef[]>([]);
  const [showRecents, setShowRecents] = useState(true);
  const [showStarredOnly, setShowStarredOnly] = useState(false);

  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tag browser state
  const [tags, setTags] = useState<NoteTagIndexEntry[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [hiddenTagToast, setHiddenTagToast] = useState<string | null>(null);

  // Bulk selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Map<string, { path: string; title: string }>>(new Map());
  const [bulkArchiving, setBulkArchiving] = useState(false);
  const [showBulkArchiveConfirm, setShowBulkArchiveConfirm] = useState(false);
  const [showBulkMove, setShowBulkMove] = useState(false);
  const [bulkArchiveReason, setBulkArchiveReason] = useState("");
  const [folderToMove, setFolderToMove] = useState<string | null>(null);
  const [folderToArchive, setFolderToArchive] = useState<string | null>(null);
  const [folderArchiving, setFolderArchiving] = useState(false);

  // Native drag state. The ref makes the complete payload available to the
  // drop handler even when React state has not yet flushed.
  const draggedNotesRef = useRef<NoteDragPayload | null>(null);
  const [draggedNotePaths, setDraggedNotePaths] = useState<string[]>([]);
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null);
  const [dragMoveError, setDragMoveError] = useState<string | null>(null);
  const [noteActionError, setNoteActionError] = useState<string | null>(null);

  // Export/Import dialog state
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Read status state (shared notes)
  const [readStatus, setReadStatus] = useState<Record<string, string | null>>({});

  // Every scope with private notes needs a visible switch. Epic is shared-only.
  const showVisibilityTabs = scope !== "epic";

  // ── Fetch notes ────────────────────────────────────────────────────
  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(queryString);
      if (currentFolder) params.set("folder", currentFolder);
      const res = await fetch(`/api/codascope/notes/${scope}/${visibility}?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes ?? []);
      }
    } catch {
      // Silently fail
    }
    setLoading(false);
  }, [scope, visibility, queryString, currentFolder]);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  // ── Fetch tags ──────────────────────────────────────────────────
  const fetchTags = useCallback(async () => {
    try {
      const params = new URLSearchParams(queryString);
      const res = await fetch(`/api/codascope/notes/${scope}/${visibility}/tags?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags ?? []);
      }
    } catch { /* best effort */ }
  }, [scope, visibility, queryString]);

  useEffect(() => {
    void fetchTags();
  }, [fetchTags]);

  // ── Fetch starred ──────────────────────────────────────────────────
  const fetchStarred = useCallback(async () => {
    try {
      const res = await fetch("/api/codascope/notes/starred");
      if (res.ok) {
        const data = await res.json();
        const items: StarredNoteRef[] = data.items ?? [];
        setStarredNotes(items);
      }
    } catch { /* best effort */ }
  }, []);

  // ── Fetch recents ──────────────────────────────────────────────────
  const fetchRecents = useCallback(async () => {
    try {
      const res = await fetch("/api/codascope/notes/recents");
      if (res.ok) {
        const data = await res.json();
        setRecents((data.items ?? []).slice(0, 8));
      }
    } catch { /* best effort */ }
  }, []);

  useEffect(() => {
    void fetchStarred();
    void fetchRecents();
  }, [fetchStarred, fetchRecents]);

  // ── Fetch read status for shared notes ──────────────────────────────
  useEffect(() => {
    if (visibility !== "shared" || notes.length === 0) return;
    // Collect noteIds from the notes list
    const noteIds = notes.filter((n) => !n.isFolder && n.noteId).map((n) => n.noteId!);
    if (noteIds.length === 0) return;

    void (async () => {
      try {
        const params = new URLSearchParams(queryString);
        const res = await fetch(`/api/codascope/notes/${scope}/${visibility}/read-status?${params.toString()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noteIds }),
        });
        if (res.ok) {
          const data = await res.json();
          setReadStatus(data.status ?? {});
        }
      } catch { /* best effort */ }
    })();
  }, [visibility, notes, scope, queryString]);

  // ── Star / unstar handlers ─────────────────────────────────────────
  const handleStar = useCallback(async (noteId: string, noteScope: NoteScope, noteVisibility: NoteVisibility, notePath: string, title: string) => {
    try {
      await fetch(`/api/codascope/notes/starred/${noteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: noteScope, visibility: noteVisibility, path: notePath, title, ...scopeQueryParams }),
      });
      void fetchStarred();
    } catch { /* best effort */ }
  }, [fetchStarred, scopeQueryParams]);

  const handleUnstar = useCallback(async (noteId: string) => {
    try {
      await fetch(`/api/codascope/notes/starred/${noteId}`, { method: "DELETE" });
      void fetchStarred();
    } catch { /* best effort */ }
  }, [fetchStarred]);

  // ── Full-text search (debounced) ──────────────────────────────────
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (search.trim().length < 3) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams(queryString);
        params.set("q", search.trim());
        params.set("scope", scope);
        const res = await fetch(`/api/codascope/notes/search?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results ?? []);
        }
      } catch { /* ignore */ }
      setIsSearching(false);
    }, 400);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search, queryString, scope]);

  // ── Filtered notes (local filter for short queries) ─────────────────
  const filteredNotes = useMemo(() => {
    let result = [...notes];
    const isEntryStarred = (entry: NoteEntry) => Boolean(entry.starred)
      || starredNotes.some((item) => item.noteId === entry.noteId);
    const orderByPriority = (entries: NoteEntry[]) => entries.sort(
      (left, right) => compareNoteEntriesByPriority(left, right, isEntryStarred),
    );

    // Apply starred filter
    if (showStarredOnly) {
      result = result.filter((n) => {
        if (n.isFolder) return false;
        return starredNotes.some((s) => s.path === n.path && s.scope === scope && s.visibility === visibility);
      });
    }

    // Apply tag filter
    if (activeTag) {
      result = result.filter(
        (n) => n.isFolder || n.tags.some((t) => t.toLowerCase() === activeTag.toLowerCase()),
      );
    }

    // Apply tag: search modifier
    const tagSearchMatch = search.trim().match(/^tag:(\S+)$/i);
    if (tagSearchMatch) {
      const tagQuery = tagSearchMatch[1].toLowerCase();
      result = result.filter(
        (n) => n.isFolder || n.tags.some((t) => t.toLowerCase().includes(tagQuery)),
      );
      return orderByPriority(result);
    }

    if (!search.trim() || search.trim().length >= 3) return orderByPriority(result);
    const q = search.toLowerCase();
    return orderByPriority(result.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    ));
  }, [notes, search, showStarredOnly, starredNotes, scope, visibility, activeTag]);

  // Are we showing search results?
  const showSearchResults = search.trim().length >= 3;

  // ── Navigation helpers ─────────────────────────────────────────────

  const contextualCodaScopePrefix = useCallback((targetVisibility: NoteVisibility): string | null => {
    if (!urlPrefixOverride?.includes("/notes/codascope/")) return null;
    return urlPrefixOverride.replace(/\/(shared|private)$/, `/${targetVisibility}`);
  }, [urlPrefixOverride]);

  const getNotesUrlPrefix = useCallback((): string => {
    if (urlPrefixOverride) return urlPrefixOverride;
    if (scope === "codascope") {
      return `notes/${visibility}`;
    }
    if (scope === "epic" && effectiveProjectId && propEpicId) {
      return `project/${effectiveProjectId}/epic/${propEpicId}/notes/${visibility}`;
    }
    if (scope === "project" && effectiveProjectId) {
      return `project/${effectiveProjectId}/notes/${visibility}`;
    }
    return `notes/${visibility}`;
  }, [urlPrefixOverride, scope, visibility, effectiveProjectId, propEpicId]);

  const handleFolderClick = useCallback(
    (folderPath: string) => {
      const prefix = getNotesUrlPrefix();
      navigate(`${prefix}/${folderPath}`);
    },
    [navigate, getNotesUrlPrefix],
  );

  const handleNoteClick = useCallback(
    (notePath: string) => {
      const prefix = getNotesUrlPrefix();
      const cleanPath = notePath.replace(/\.md$/, "");
      navigate(`${prefix}/${cleanPath}`);
    },
    [navigate, getNotesUrlPrefix],
  );

  /** Navigate to a note from a starred/recent ref (may be in a different scope/visibility). */
  const handleRefNoteClick = useCallback(
    (ref: { scope: NoteScope; visibility: NoteVisibility; path: string }) => {
      let prefix: string;
      const contextualPrefix = ref.scope === "codascope" ? contextualCodaScopePrefix(ref.visibility) : null;
      if (contextualPrefix) {
        prefix = contextualPrefix;
      } else if (ref.scope === "codascope") {
        prefix = `notes/${ref.visibility}`;
      } else if (ref.scope === "project" && effectiveProjectId) {
        prefix = `project/${effectiveProjectId}/notes/${ref.visibility}`;
      } else if (ref.scope === "epic" && effectiveProjectId && propEpicId) {
        prefix = `project/${effectiveProjectId}/epic/${propEpicId}/notes/${ref.visibility}`;
      } else {
        prefix = `notes/${ref.visibility}`;
      }
      const cleanPath = ref.path.replace(/\.md$/, "");
      navigate(`${prefix}/${cleanPath}`);
    },
    [navigate, effectiveProjectId, propEpicId, contextualCodaScopePrefix],
  );

  const handleBreadcrumbClick = useCallback(
    (depth: number) => {
      const prefix = getNotesUrlPrefix();
      if (depth < 0) {
        navigate(prefix);
      } else {
        const path = folderParts.slice(0, depth + 1).join("/");
        navigate(`${prefix}/${path}`);
      }
    },
    [navigate, getNotesUrlPrefix, folderParts],
  );

  const handleVisibilitySwitch = useCallback(
    (newVisibility: NoteVisibility) => {
      const contextualPrefix = contextualCodaScopePrefix(newVisibility);
      if (contextualPrefix) {
        navigate(contextualPrefix);
        return;
      }
      if (scope === "codascope") {
        navigate(`notes/${newVisibility}`);
      } else if (scope === "project" && effectiveProjectId) {
        navigate(`project/${effectiveProjectId}/notes/${newVisibility}`);
      } else if (scope === "epic" && effectiveProjectId && propEpicId) {
        navigate(`project/${effectiveProjectId}/epic/${propEpicId}/notes/${newVisibility}`);
      }
    },
    [navigate, scope, effectiveProjectId, propEpicId, contextualCodaScopePrefix],
  );

  const getNotesUrlPrefixFor = useCallback((targetScope: NoteScope, targetVisibility: NoteVisibility, opts: Record<string, string>) => {
    const contextualPrefix = targetScope === "codascope" ? contextualCodaScopePrefix(targetVisibility) : null;
    if (contextualPrefix) return contextualPrefix;
    if (targetScope === "codascope") return `notes/${targetVisibility}`;
    if (targetScope === "project" && opts.projectId) return `project/${opts.projectId}/notes/${targetVisibility}`;
    if (targetScope === "epic" && opts.projectId && opts.epicId) return `project/${opts.projectId}/epic/${opts.epicId}/notes/${targetVisibility}`;
    return `notes/${targetVisibility}`;
  }, [contextualCodaScopePrefix]);

  const handleCreated = useCallback((location: NoteCreateLocation) => {
    setCreateMode(null);
    const prefix = getNotesUrlPrefixFor(location.scope, location.visibility, location.queryParams);
    const destination = location.isFolder ? location.path : location.path.replace(/\.md$/, "");
    navigate(`${prefix}/${destination}`);
  }, [getNotesUrlPrefixFor, navigate]);

  const handleHideTag = useCallback(async (tag: string) => {
    try {
      const res = await fetch(`/api/codascope/notes/tag-suggestions/${encodeURIComponent(tag)}`, { method: "DELETE" });
      if (!res.ok) return;
      setTags((current) => current.filter((entry) => entry.tag !== tag));
      if (activeTag === tag) setActiveTag(null);
      setHiddenTagToast(tag);
    } catch { /* best effort */ }
  }, [activeTag]);

  const handleRestoreTag = useCallback(async () => {
    if (!hiddenTagToast) return;
    try {
      const res = await fetch(`/api/codascope/notes/tag-suggestions/${encodeURIComponent(hiddenTagToast)}/restore`, { method: "POST" });
      if (res.ok) void fetchTags();
    } catch { /* best effort */ }
    setHiddenTagToast(null);
  }, [hiddenTagToast, fetchTags]);

  const handleArchiveFolder = useCallback(async () => {
    if (!folderToArchive) return;
    setFolderArchiving(true);
    try {
      const res = await fetch(`/api/codascope/notes/${scope}/${visibility}/folders/archive?${queryString}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: folderToArchive }),
      });
      if (res.ok) {
        void fetchNotes();
        void fetchTags();
        setFolderToArchive(null);
      }
    } catch { /* best effort */ }
    setFolderArchiving(false);
  }, [folderToArchive, scope, visibility, queryString, fetchNotes, fetchTags]);

  // ── Bulk selection handlers ─────────────────────────────────────
  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedNoteIds(new Map());
  }, []);

  const toggleNoteSelection = useCallback(async (entry: NoteEntry) => {
    const noteId = entry.noteId;
    if (!noteId) return;

    setSelectedNoteIds((prev) => {
      const next = new Map(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.set(noteId, { path: entry.path, title: entry.title });
      }
      return next;
    });
  }, []);

  const handleBulkArchive = useCallback(async () => {
    setBulkArchiving(true);
    try {
      const params = new URLSearchParams(queryString);
      const res = await fetch(`/api/codascope/notes/${scope}/${visibility}/bulk/archive?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteIds: Array.from(selectedNoteIds.keys()),
          reason: bulkArchiveReason.trim() || undefined,
        }),
      });
      if (res.ok) {
        exitSelectionMode();
        setShowBulkArchiveConfirm(false);
        setBulkArchiveReason("");
        void fetchNotes();
        void fetchTags();
      }
    } catch { /* best effort */ }
    setBulkArchiving(false);
  }, [scope, visibility, queryString, selectedNoteIds, bulkArchiveReason, exitSelectionMode, fetchNotes, fetchTags]);

  const handleBulkMoved = useCallback(() => {
    exitSelectionMode();
    setShowBulkMove(false);
    void fetchNotes();
  }, [exitSelectionMode, fetchNotes]);

  // ── Drag notes into folders ────────────────────────────────────────
  const clearNoteDrag = useCallback(() => {
    draggedNotesRef.current = null;
    setDraggedNotePaths([]);
    setDropTargetFolder(null);
  }, []);

  const handleNoteDragStart = useCallback((entry: NoteEntry, event: React.DragEvent<HTMLButtonElement>) => {
    const selectedEntries = selectionMode && entry.noteId && selectedNoteIds.has(entry.noteId)
      ? Array.from(selectedNoteIds.entries()).map(([noteId, note]) => ({ path: note.path, noteId }))
      : [{ path: entry.path, noteId: entry.noteId }];

    draggedNotesRef.current = { notes: selectedEntries };
    setDraggedNotePaths(selectedEntries.map((note) => note.path));
    setDragMoveError(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", selectedEntries.map((note) => note.path).join("\n"));
    event.dataTransfer.setData(NOTE_DRAG_DATA_TYPE, JSON.stringify({ notes: selectedEntries }));
  }, [selectionMode, selectedNoteIds]);

  const handleDropTargetDragOver = useCallback((folderPath: string, event: React.DragEvent<HTMLElement>) => {
    if (!draggedNotesRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetFolder(folderPath);
  }, []);

  const handleDropTargetDragLeave = useCallback((folderPath: string, event: React.DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropTargetFolder((current) => current === folderPath ? null : current);
  }, []);

  const handleDropTargetDrop = useCallback(async (targetFolder: string, event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    let payload = draggedNotesRef.current;
    if (!payload) {
      try {
        const parsed = JSON.parse(event.dataTransfer.getData(NOTE_DRAG_DATA_TYPE)) as NoteDragPayload;
        if (Array.isArray(parsed.notes) && parsed.notes.every((note) => typeof note.path === "string")) {
          payload = parsed;
        }
      } catch { /* not a CodaScope note drag */ }
    }
    clearNoteDrag();
    if (!payload || payload.notes.length === 0) return;

    // A note already inside the destination needs no move. This also avoids
    // accidental duplicate-name errors if a future list view surfaces it.
    const notesToMove = payload.notes.filter((note) => note.path.split("/").slice(0, -1).join("/") !== targetFolder);
    if (notesToMove.length === 0) return;

    try {
      if (notesToMove.length === 1) {
        const sourcePath = notesToMove[0].path;
        const filename = sourcePath.split("/").pop();
        if (!filename) return;

        const res = await fetch("/api/codascope/notes/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromScope: scope,
            fromVisibility: visibility,
            fromPath: sourcePath,
            fromOpts: scopeQueryParams,
            toScope: scope,
            toVisibility: visibility,
            toPath: targetFolder ? `${targetFolder}/${filename}` : filename,
            toOpts: scopeQueryParams,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.moved) {
          throw new Error(data.message ?? "Could not move this note.");
        }
      } else {
        const noteIds = notesToMove.map((note) => note.noteId).filter((noteId): noteId is string => Boolean(noteId));
        if (noteIds.length !== notesToMove.length) {
          throw new Error("Could not move every selected note. Refresh the list and try again.");
        }

        const res = await fetch("/api/codascope/notes/bulk/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            noteIds,
            fromScope: scope,
            fromVisibility: visibility,
            fromOpts: scopeQueryParams,
            toScope: scope,
            toVisibility: visibility,
            toOpts: scopeQueryParams,
            toFolder: targetFolder,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message ?? "Could not move the selected notes.");
        if (data.failed?.length) {
          throw new Error(`Moved ${data.moved ?? 0} of ${notesToMove.length} notes. Try the remaining notes again.`);
        }
      }

      if (selectionMode && notesToMove.some((note) => note.noteId && selectedNoteIds.has(note.noteId))) {
        exitSelectionMode();
      }
      void fetchNotes();
      void fetchTags();
    } catch (error) {
      setDragMoveError(error instanceof Error ? error.message : "Could not move the notes.");
    }
  }, [clearNoteDrag, exitSelectionMode, fetchNotes, fetchTags, scope, scopeQueryParams, selectedNoteIds, selectionMode, visibility]);

  // ── Highlight match in text ────────────────────────────────────────
  const highlightMatch = useCallback((text: string, query: string): React.ReactNode => {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="codascope-notes-search-highlight">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    );
  }, []);

  // ── Check if a note entry is starred by path ──────────────────────
  const isNoteStarred = useCallback((entry: NoteEntry): boolean => {
    return Boolean(entry.starred) || starredNotes.some(
      (s) => s.path === entry.path && s.scope === scope && s.visibility === visibility,
    );
  }, [starredNotes, scope, visibility]);

  // ── Get a starred note ID for a note entry ─────────────────────────
  const getStarredId = useCallback((entry: NoteEntry): string | null => {
    const found = starredNotes.find(
      (s) => s.path === entry.path && s.scope === scope && s.visibility === visibility,
    );
    return found?.noteId ?? null;
  }, [starredNotes, scope, visibility]);

  // ── Star toggle handler for a note entry ──────────────────────────
  const handleStarToggle = useCallback(async (entry: NoteEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const existingId = getStarredId(entry);
    if (existingId) {
      // Already starred — unstar
      await handleUnstar(existingId);
    } else {
      // Need to fetch the note to get its ID
      try {
        const params = new URLSearchParams(queryString);
        const res = await fetch(`/api/codascope/notes/${scope}/${visibility}/note/${entry.path}?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          const noteId = data.frontmatter?.id;
          if (noteId) {
            await handleStar(noteId, scope, visibility, entry.path, entry.title);
          }
        }
      } catch { /* best effort */ }
    }
  }, [getStarredId, handleUnstar, handleStar, scope, visibility, queryString]);

  const handlePinToggle = useCallback(async (entry: NoteEntry, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!entry.noteId) return;
    const priorPinned = Boolean(entry.pinned);
    setNoteActionError(null);
    setNotes((current) => current.map((item) => item.noteId === entry.noteId ? { ...item, pinned: !priorPinned } : item));
    try {
      const response = await fetch(`/api/codascope/notes/${scope}/${visibility}/note/${entry.path}/pin?${queryString}`, {
        method: priorPinned ? "DELETE" : "PUT",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Unable to update shared pin.");
      setNotes((current) => current.map((item) => item.noteId === entry.noteId ? {
        ...item,
        pinned: Boolean(payload.pinned),
        pinnedAt: payload.note?.pinnedAt,
        pinnedBy: payload.note?.pinnedBy,
      } : item));
    } catch (cause) {
      setNotes((current) => current.map((item) => item.noteId === entry.noteId ? { ...item, pinned: priorPinned } : item));
      setNoteActionError(cause instanceof Error ? cause.message : "Unable to update shared pin.");
    }
  }, [scope, visibility, queryString]);

  // ── Inbox note count (for badge) ──────────────────────────────────
  const inboxCount = useMemo(() => {
    const inbox = notes.find((n) => n.isFolder && n.path === "_inbox");
    return inbox?.childCount ?? 0;
  }, [notes]);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className={`codascope-notes-browser${visibility === "private" ? " codascope-notes-browser--private" : ""}`}>
      {/* Header */}
      <div className="codascope-notes-browser-header">
        <div className="codascope-notes-browser-header-left">
          <IconNotes size={16} />
          <span className="codascope-notes-browser-title">Notes</span>

          {showVisibilityTabs && (
            <div className="codascope-notes-header-visibility" role="group" aria-label="Note visibility">
              <button
                className={`codascope-notes-header-visibility-btn${visibility === "shared" ? " codascope-notes-header-visibility-btn--active" : ""}`}
                onClick={() => handleVisibilitySwitch("shared")}
                type="button"
              >
                Shared
              </button>
              <button
                className={`codascope-notes-header-visibility-btn${visibility === "private" ? " codascope-notes-header-visibility-btn--active codascope-notes-header-visibility-btn--private" : ""}`}
                onClick={() => handleVisibilitySwitch("private")}
                type="button"
              >
                Private
              </button>
            </div>
          )}

          {/* Breadcrumb */}
          <div className="codascope-notes-breadcrumb">
            <span
              className={`codascope-notes-breadcrumb-target${folderParts.length > 0 ? " codascope-notes-breadcrumb-target--droppable" : ""}${folderParts.length > 0 && dropTargetFolder === "" ? " codascope-notes-breadcrumb-target--drop-target" : ""}`}
              onDragEnter={folderParts.length > 0 ? (event) => handleDropTargetDragOver("", event) : undefined}
              onDragOver={folderParts.length > 0 ? (event) => handleDropTargetDragOver("", event) : undefined}
              onDragLeave={folderParts.length > 0 ? (event) => handleDropTargetDragLeave("", event) : undefined}
              onDrop={folderParts.length > 0 ? (event) => void handleDropTargetDrop("", event) : undefined}
              title={folderParts.length > 0 ? "Drop notes here to move them to the root" : undefined}
            >
              <span className="codascope-notes-breadcrumb-sep">/</span>
              <button
                className={`codascope-notes-breadcrumb-item${folderParts.length === 0 ? " codascope-notes-breadcrumb-item--current" : ""}`}
                onClick={() => handleBreadcrumbClick(-1)}
                type="button"
              >
                {scopeLabel(scope)}
              </button>
            </span>
            {folderParts.map((part, i) => {
              const folderPath = folderParts.slice(0, i + 1).join("/");
              const isCurrentFolder = i === folderParts.length - 1;
              const canReceiveDrop = !isCurrentFolder;
              return (
                <span
                  key={folderPath}
                  className={`codascope-notes-breadcrumb-target${canReceiveDrop ? " codascope-notes-breadcrumb-target--droppable" : ""}${canReceiveDrop && dropTargetFolder === folderPath ? " codascope-notes-breadcrumb-target--drop-target" : ""}`}
                  onDragEnter={canReceiveDrop ? (event) => handleDropTargetDragOver(folderPath, event) : undefined}
                  onDragOver={canReceiveDrop ? (event) => handleDropTargetDragOver(folderPath, event) : undefined}
                  onDragLeave={canReceiveDrop ? (event) => handleDropTargetDragLeave(folderPath, event) : undefined}
                  onDrop={canReceiveDrop ? (event) => void handleDropTargetDrop(folderPath, event) : undefined}
                  title={canReceiveDrop ? `Drop notes here to move them to ${part}` : undefined}
                >
                  <span className="codascope-notes-breadcrumb-sep">/</span>
                  <button
                    className={`codascope-notes-breadcrumb-item${isCurrentFolder ? " codascope-notes-breadcrumb-item--current" : ""}`}
                    onClick={() => handleBreadcrumbClick(i)}
                    type="button"
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </div>
        </div>

        {/* Header actions */}
        <div className="codascope-notes-header-actions">
          {/* Starred filter toggle */}
          <button
            className={`codascope-notes-star-filter${showStarredOnly ? " codascope-notes-star-filter-active" : ""}`}
            onClick={() => setShowStarredOnly((v) => !v)}
            title={showStarredOnly ? "Show all notes" : "Show starred only"}
            type="button"
          >
            {showStarredOnly ? <IconStarFilled size={14} /> : <IconStar size={14} />}
          </button>

          {/* Bulk select toggle */}
          <button
            className={`codascope-notes-select-btn${selectionMode ? " codascope-notes-select-btn-active" : ""}`}
            onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
            title={selectionMode ? "Exit selection" : "Select notes"}
            type="button"
          >
            {selectionMode ? <IconCheckboxChecked size={14} /> : <IconCheckbox size={14} />}
            <span>{selectionMode ? "Done" : "Select"}</span>
          </button>

          {/* Export button */}
          <button
            className="codascope-notes-export-btn"
            onClick={() => setShowExport(true)}
            title="Export notes as ZIP"
            type="button"
          >
            <IconDownload size={14} />
          </button>

          {/* Import button */}
          <button
            className="codascope-notes-import-btn"
            onClick={() => setShowImport(true)}
            title="Import notes from ZIP"
            type="button"
          >
            <IconUpload size={14} />
          </button>

          {/* Explicit placement makes Shared vs Private a deliberate choice. */}
          <button
            className="codascope-btn codascope-btn-ghost"
            style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
            onClick={() => setCreateMode("folder")}
            type="button"
            title="New folder"
          >
            <IconFolder size={14} />
            <span>Folder</span>
          </button>
          <button
            className="codascope-notes-create-note-btn"
            onClick={() => setCreateMode("note")}
            title="Create a new note"
            type="button"
          >
            <IconPlus size={14} />
            <span>Note</span>
          </button>
        </div>
      </div>

      {/* Tag browser bar */}
      {tags.length > 0 && !showSearchResults && (
        <div className="codascope-notes-tag-bar">
          <IconTag size={12} />
          {tags.map((t) => (
            <span key={t.tag} className="codascope-notes-tag-suggestion">
              <button
                className={`codascope-notes-tag-pill${activeTag === t.tag ? " codascope-notes-tag-pill-active" : ""}`}
                onClick={() => setActiveTag((prev) => prev === t.tag ? null : t.tag)}
                type="button"
              >
                <span>{t.tag}</span>
                <span className="codascope-notes-tag-pill-count">{t.count}</span>
              </button>
              <button
                className="codascope-notes-tag-hide"
                onClick={() => void handleHideTag(t.tag)}
                title={`Hide ${t.tag} from shared tag suggestions`}
                aria-label={`Hide ${t.tag} from shared tag suggestions`}
                type="button"
              >
                <IconClose size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="codascope-notes-search">
        <input
          className="codascope-notes-search-input"
          type="text"
          placeholder="Search notes… (3+ chars for full-text search)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Recents section (collapsible) */}
      {!showSearchResults && !showStarredOnly && recents.length > 0 && !currentFolder && (
        <div className="codascope-notes-recents-section">
          <button
            className="codascope-notes-recents-toggle"
            onClick={() => setShowRecents((v) => !v)}
            aria-expanded={showRecents}
            type="button"
          >
            <IconClock size={13} />
            <span>Recent</span>
            <span className="codascope-notes-recents-count">{recents.length}</span>
            <span className="codascope-notes-archive-chevron">{showRecents ? "▴" : "▾"}</span>
          </button>
          {showRecents && (
            <div className="codascope-notes-recents-list">
              {recents.map((r) => (
                <button
                  key={r.noteId}
                  className="codascope-notes-recent-card"
                  onClick={() => handleRefNoteClick(r)}
                  type="button"
                >
                  <IconFile size={12} />
                  <span className="codascope-notes-recent-title">{r.title}</span>
                  <span className="codascope-notes-recent-time">{relativeTime(r.viewedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Notes list / Search results */}
      <div className="codascope-notes-list">
        {showSearchResults ? (
          /* Full-text search results */
          isSearching ? (
            <div className="codascope-notes-list-empty">
              <span>Searching…</span>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="codascope-notes-list-empty">
              <span>No results found for "{search}"</span>
            </div>
          ) : (
            searchResults.map((result, i) => (
              <button
                key={`${result.scope}:${result.path}:${i}`}
                className="codascope-notes-item codascope-notes-search-result"
                onClick={() => handleNoteClick(result.path)}
                type="button"
              >
                <div className="codascope-notes-item-icon">
                  <IconFile size={14} />
                </div>
                <div className="codascope-notes-item-content">
                  <div className="codascope-notes-item-title">
                    {highlightMatch(result.title, search)}
                  </div>
                  <div className="codascope-notes-search-context">
                    <span className="codascope-notes-search-level">{result.scope}</span>
                    <span className="codascope-notes-search-line">L{result.lineNumber}</span>
                    <span className="codascope-notes-search-match">
                      {highlightMatch(result.matchLine, search)}
                    </span>
                  </div>
                </div>
              </button>
            ))
          )
        ) : loading ? (
          <div className="codascope-notes-list-empty">
            <span>Loading…</span>
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="codascope-notes-list-empty">
            <div className="codascope-notes-list-empty-icon">
              {showStarredOnly ? <IconStar size={32} /> : <IconNotes size={32} />}
            </div>
            <span>
              {showStarredOnly
                  ? "No starred notes. Click the star icon on a note to bookmark it."
                  : notes.length === 0
                  ? "No notes yet. Use Note to choose where to create one."
                  : "No matching notes."}
            </span>
          </div>
        ) : (
          filteredNotes.map((entry) =>
            entry.isFolder ? (
              <div
                key={`folder:${entry.path}`}
                className={`codascope-notes-item codascope-notes-item--folder${entry.path === "_inbox" ? " codascope-notes-item--inbox" : ""}${dropTargetFolder === entry.path ? " codascope-notes-item--drop-target" : ""}`}
                onDragEnter={(event) => handleDropTargetDragOver(entry.path, event)}
                onDragOver={(event) => handleDropTargetDragOver(entry.path, event)}
                onDragLeave={(event) => handleDropTargetDragLeave(entry.path, event)}
                onDrop={(event) => void handleDropTargetDrop(entry.path, event)}
              >
                <button className="codascope-notes-folder-open" onClick={() => handleFolderClick(entry.path)} type="button">
                  <div className="codascope-notes-item-icon">
                    {entry.path === "_inbox" ? <IconInbox size={14} /> : <IconFolder size={14} />}
                  </div>
                  <div className="codascope-notes-item-content">
                    <div className="codascope-notes-item-title">
                      {entry.path === "_inbox" ? "Inbox" : entry.title}
                    </div>
                    <div className="codascope-notes-item-meta">
                      <span className="codascope-notes-folder-count">
                        {entry.childCount ?? 0} note{(entry.childCount ?? 0) !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  {entry.path === "_inbox" && inboxCount > 0 && <span className="codascope-notes-inbox-badge">{inboxCount}</span>}
                </button>
                <div className="codascope-notes-folder-actions">
                  <button className="codascope-notes-folder-action" onClick={() => setFolderToMove(entry.path)} title="Move folder" type="button">
                    <IconMove size={14} />
                  </button>
                  <button className="codascope-notes-folder-action" onClick={() => setFolderToArchive(entry.path)} title="Archive folder and its contents" type="button">
                    <IconArchive size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={entry.path}
                className={`codascope-notes-item${selectionMode && entry.noteId && selectedNoteIds.has(entry.noteId) ? " codascope-notes-item-selected" : ""}${draggedNotePaths.includes(entry.path) ? " codascope-notes-item--dragging" : ""}`}
              >
                <button
                  className="codascope-notes-note-open"
                  onClick={() => selectionMode ? void toggleNoteSelection(entry) : handleNoteClick(entry.path)}
                  onDragStart={(event) => handleNoteDragStart(entry, event)}
                  onDragEnd={clearNoteDrag}
                  draggable
                  title={selectionMode && entry.noteId && selectedNoteIds.has(entry.noteId) ? "Drag selected notes to a folder" : "Drag note to a folder"}
                  type="button"
                >
                  {/* Selection checkbox */}
                  {selectionMode && (
                    <div className="codascope-notes-item-checkbox">
                      {entry.noteId && selectedNoteIds.has(entry.noteId) ? (
                        <IconCheckboxChecked size={14} />
                      ) : (
                        <IconCheckbox size={14} />
                      )}
                    </div>
                  )}
                  <div className="codascope-notes-item-icon">
                    <IconFile size={14} />
                  </div>
                  <div className="codascope-notes-item-content">
                    <div className="codascope-notes-item-title codascope-notes-note-title">
                      <span className="codascope-notes-note-title-text">{entry.title}</span>
                      {/* Unread dot (shared notes) */}
                      {visibility === "shared" && entry.noteId && (
                        readStatus[entry.noteId] === null || (readStatus[entry.noteId] && entry.lastEditedAt && readStatus[entry.noteId]! < entry.lastEditedAt)
                      ) && (
                        <span className="codascope-notes-unread-dot" title="Unread or updated" />
                      )}
                    </div>
                    <div className="codascope-notes-item-meta">
                      {/* Draft/Ready badge (shared notes only) */}
                      {visibility === "shared" && entry.status && (
                        <span className={`codascope-notes-${entry.status}-badge`}>
                          {entry.status === "draft" ? <IconDraft size={10} /> : <IconCheckCircle size={10} />}
                          <span>{entry.status === "draft" ? "Draft" : "Ready"}</span>
                        </span>
                      )}
                      {entry.tags.length > 0 && (
                        <div className="codascope-notes-tags">
                          {entry.tags.map((tag) => (
                            <span key={tag} className="codascope-notes-tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <span className="codascope-notes-item-time">
                        {relativeTime(entry.updated)}
                      </span>
                    </div>
                  </div>
                </button>
                <button
                  className="codascope-notes-star-toggle"
                  onClick={(event) => void handlePinToggle(entry, event)}
                  title={entry.pinned ? "Unpin for everyone" : "Pin for everyone"}
                  aria-label={entry.pinned ? "Unpin note for everyone" : "Pin note for everyone"}
                  type="button"
                >
                  {entry.pinned ? (
                    <IconPinFilled size={14} className="codascope-notes-pin-active" />
                  ) : (
                    <IconPin size={14} />
                  )}
                </button>
                {/* Star toggle */}
                <button
                  className="codascope-notes-star-toggle"
                  onClick={(e) => void handleStarToggle(entry, e)}
                  title={isNoteStarred(entry) ? "Unstar" : "Star"}
                  type="button"
                >
                  {isNoteStarred(entry) ? (
                    <IconStarFilled size={14} className="codascope-notes-star-active" />
                  ) : (
                    <IconStar size={14} />
                  )}
                </button>
              </div>
            ),
          )
        )}
      </div>

      {/* Bulk action bar */}
      {selectionMode && selectedNoteIds.size > 0 && (
        <div className="codascope-notes-bulk-bar">
          <span className="codascope-notes-bulk-bar-count">
            {selectedNoteIds.size} selected
          </span>
          <div className="codascope-notes-bulk-bar-actions">
            <button
              className="codascope-btn codascope-btn-primary codascope-btn-sm"
              onClick={() => setShowBulkArchiveConfirm(true)}
              type="button"
            >
              <IconArchive size={12} />
              Archive
            </button>
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-sm"
              onClick={() => setShowBulkMove(true)}
              type="button"
            >
              Move
            </button>
            <button
              className="codascope-btn codascope-btn-ghost codascope-btn-sm"
              onClick={exitSelectionMode}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Archive section (collapsible) */}
      {!showSearchResults && (
        <div className="codascope-notes-archive-section">
          <button
            className="codascope-notes-archive-toggle"
            onClick={() => setShowArchive((v) => !v)}
            type="button"
          >
            <IconArchive size={14} />
            <span>Archive</span>
            <span className="codascope-notes-archive-chevron">{showArchive ? "▴" : "▾"}</span>
          </button>
          {showArchive && (
            <NoteArchiveBrowser
              scope={scope}
              visibility={visibility}
              queryString={queryString}
            />
          )}
        </div>
      )}

      {/* Bulk Archive Confirmation Dialog */}
      {showBulkArchiveConfirm && (
        <div className="codascope-notes-archive-dialog-overlay" onClick={() => { setShowBulkArchiveConfirm(false); setBulkArchiveReason(""); }}>
          <div className="codascope-notes-archive-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="codascope-notes-archive-dialog-header">
              <IconArchive size={16} />
              <span>Archive {selectedNoteIds.size} Note{selectedNoteIds.size !== 1 ? "s" : ""}?</span>
            </div>
            <p className="codascope-notes-archive-dialog-message">
              {selectedNoteIds.size} note{selectedNoteIds.size !== 1 ? "s" : ""} will be moved to the archive. You can restore them at any time.
            </p>
            <div className="codascope-notes-archive-dialog-reason">
              <label htmlFor="bulk-archive-reason">Reason (optional)</label>
              <input
                id="bulk-archive-reason"
                type="text"
                className="codascope-notes-archive-reason-input"
                placeholder="e.g. No longer relevant"
                value={bulkArchiveReason}
                onChange={(e) => setBulkArchiveReason(e.target.value)}
                autoFocus
              />
            </div>
            <div className="codascope-notes-archive-dialog-actions">
              <button
                className="codascope-btn codascope-btn-ghost codascope-btn-sm"
                onClick={() => { setShowBulkArchiveConfirm(false); setBulkArchiveReason(""); }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="codascope-btn codascope-btn-primary codascope-btn-sm"
                onClick={handleBulkArchive}
                disabled={bulkArchiving}
                type="button"
              >
                {bulkArchiving ? "Archiving…" : "Archive"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Move Dialog */}
      {showBulkMove && (
        <NoteMoveDialog
          open={showBulkMove}
          fromScope={scope}
          fromVisibility={visibility}
          fromPath=""
          fromOpts={scopeQueryParams}
          onMoved={handleBulkMoved}
          onClose={() => setShowBulkMove(false)}
          bulkNoteIds={Array.from(selectedNoteIds.keys())}
        />
      )}

      {folderToMove && (
        <NoteMoveDialog
          open={!!folderToMove}
          fromScope={scope}
          fromVisibility={visibility}
          fromPath=""
          fromFolder={folderToMove}
          fromOpts={scopeQueryParams}
          onMoved={() => { setFolderToMove(null); void fetchNotes(); void fetchTags(); }}
          onClose={() => setFolderToMove(null)}
        />
      )}

      <NoteCreateDialog
        open={createMode !== null}
        mode={createMode ?? "note"}
        initialScope={scope}
        initialVisibility={visibility}
        initialQueryParams={scopeQueryParams}
        initialFolder={currentFolder}
        onClose={() => setCreateMode(null)}
        onCreated={handleCreated}
      />

      <ConfirmDialog
        open={!!folderToArchive}
        title="Archive folder?"
        message={`Archive "${folderToArchive ?? ""}" and every note, nested folder, attachment, and version inside it? You can restore the full tree later.`}
        confirmLabel={folderArchiving ? "Archiving…" : "Archive folder"}
        cancelLabel="Cancel"
        onConfirm={() => void handleArchiveFolder()}
        onCancel={() => { if (!folderArchiving) setFolderToArchive(null); }}
      />

      {hiddenTagToast && (
        <div className="codascope-notes-tag-toast" role="status">
          <span>“{hiddenTagToast}” hidden from shared suggestions.</span>
          <button onClick={() => void handleRestoreTag()} type="button">Undo</button>
          <button onClick={() => setHiddenTagToast(null)} aria-label="Dismiss" type="button"><IconClose size={12} /></button>
        </div>
      )}

      {dragMoveError && (
        <div className="codascope-notes-drag-error" role="status">
          <span>{dragMoveError}</span>
          <button onClick={() => setDragMoveError(null)} aria-label="Dismiss" type="button"><IconClose size={12} /></button>
        </div>
      )}
      {noteActionError && (
        <div className="codascope-notes-drag-error" role="alert">
          <span>{noteActionError}</span>
          <button onClick={() => setNoteActionError(null)} aria-label="Dismiss" type="button"><IconClose size={12} /></button>
        </div>
      )}

      {/* Export Dialog */}
      <NoteExportDialog
        open={showExport}
        scope={scope}
        visibility={visibility}
        queryParams={scopeQueryParams}
        onClose={() => setShowExport(false)}
      />

      {/* Import Dialog */}
      <NoteImportDialog
        open={showImport}
        scope={scope}
        visibility={visibility}
        queryParams={scopeQueryParams}
        onClose={() => setShowImport(false)}
        onImported={() => void fetchNotes()}
      />
    </div>
  );
}
