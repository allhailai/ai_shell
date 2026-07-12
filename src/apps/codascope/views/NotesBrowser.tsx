/* ── CodaScope: NotesBrowser View ────────────────────────────────────
   List + folder browser for notes at any scope/visibility.
   URL-driven with breadcrumb navigation.
   Full-text search with highlighted match context.
   Starred notes, recents section, quick capture.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { IconNotes, IconFolder, IconFile, IconArchive, IconStar, IconStarFilled, IconClock, IconInbox, IconCapture, IconClose } from "../components/CodaScopeIcons";
import { NoteArchiveBrowser } from "./NoteArchiveBrowser";
import type { NoteScope, NoteVisibility, NoteEntry, StarredNoteRef, RecentNoteRef } from "../codaScopeTypes";

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

  // Case 2: project-level: /codascope/project/:id/notes/<visibility>/...
  if (segments[0] === "project" && segments[2] === "notes" && projectId && segments.length >= 4) {
    const visibility = segments[3] as NoteVisibility;
    const rest = segments.slice(4);
    return {
      scope: "project",
      visibility,
      folderParts: rest,
      queryParams: { projectId },
    };
  }

  // Case 3: epic-level: /codascope/project/:id/epic/:epicId/notes/<visibility>/...
  if (segments[0] === "project" && segments[2] === "epic" && segments[4] === "notes" && projectId && epicId && segments.length >= 6) {
    const visibility = segments[5] as NoteVisibility;
    const rest = segments.slice(6);
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
}

/* ── Component ───────────────────────────────────────────────────────── */

export function NotesBrowser({ scope: propScope, visibility: propVisibility, projectId: propProjectId, epicId: propEpicId }: NotesBrowserProps = {}) {
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

  // ── State ──────────────────────────────────────────────────────────
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [showArchive, setShowArchive] = useState(false);

  // Starred & recents state
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [starredNotes, setStarredNotes] = useState<StarredNoteRef[]>([]);
  const [recents, setRecents] = useState<RecentNoteRef[]>([]);
  const [showRecents, setShowRecents] = useState(true);
  const [showStarredOnly, setShowStarredOnly] = useState(false);

  // Quick capture state
  const [showCapture, setShowCapture] = useState(false);
  const [captureText, setCaptureText] = useState("");
  const [capturing, setCapturing] = useState(false);

  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Visibility tabs for codascope-level notes (shared/private)
  const showVisibilityTabs = !propVisibility && scope === "codascope";

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

  // ── Fetch starred ──────────────────────────────────────────────────
  const fetchStarred = useCallback(async () => {
    try {
      const res = await fetch("/api/codascope/notes/starred");
      if (res.ok) {
        const data = await res.json();
        const items: StarredNoteRef[] = data.items ?? [];
        setStarredNotes(items);
        setStarredIds(new Set(items.map((s) => s.noteId)));
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

  // ── Star / unstar handlers ─────────────────────────────────────────
  const handleStar = useCallback(async (noteId: string, noteScope: NoteScope, noteVisibility: NoteVisibility, notePath: string, title: string) => {
    try {
      await fetch(`/api/codascope/notes/starred/${noteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: noteScope, visibility: noteVisibility, path: notePath, title }),
      });
      void fetchStarred();
    } catch { /* best effort */ }
  }, [fetchStarred]);

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
    let result = notes;

    // Apply starred filter
    if (showStarredOnly) {
      result = result.filter((n) => {
        // For folders, never hide them in starred mode
        if (n.isFolder) return false;
        // We need the noteId — notes in the list don't have it directly,
        // so we check against the starredNotes by path match
        return starredNotes.some((s) => s.path === n.path && s.scope === scope && s.visibility === visibility);
      });
    }

    if (!search.trim() || search.trim().length >= 3) return result;
    const q = search.toLowerCase();
    return result.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [notes, search, showStarredOnly, starredNotes, scope, visibility]);

  // Are we showing search results?
  const showSearchResults = search.trim().length >= 3;

  // ── Quick Capture ──────────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    if (!captureText.trim()) return;
    setCapturing(true);
    try {
      const res = await fetch("/api/codascope/notes/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: captureText.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setCaptureText("");
        setShowCapture(false);
        // Refresh lists
        void fetchNotes();
        void fetchRecents();
        // Navigate to the captured note
        const notePath = data.path?.replace(/\.md$/, "") ?? "";
        if (notePath) {
          navigate(`notes/private/${notePath}`);
        }
      }
    } catch { /* best effort */ }
    setCapturing(false);
  }, [captureText, fetchNotes, fetchRecents, navigate]);

  // ── Navigation helpers ─────────────────────────────────────────────

  const getNotesUrlPrefix = useCallback((): string => {
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
  }, [scope, visibility, effectiveProjectId, propEpicId]);

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
      if (ref.scope === "codascope") {
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
    [navigate, effectiveProjectId, propEpicId],
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
      if (scope === "codascope") {
        navigate(`notes/${newVisibility}`);
      } else if (scope === "project" && effectiveProjectId) {
        navigate(`project/${effectiveProjectId}/notes/${newVisibility}`);
      } else if (scope === "epic" && effectiveProjectId && propEpicId) {
        navigate(`project/${effectiveProjectId}/epic/${propEpicId}/notes/${newVisibility}`);
      }
    },
    [navigate, scope, effectiveProjectId, propEpicId],
  );

  // ── Create note ────────────────────────────────────────────────────
  const handleCreateNote = useCallback(async () => {
    setCreating(true);
    try {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const filename = `Untitled ${dateStr}.md`;
      const fullPath = currentFolder ? `${currentFolder}/${filename}` : filename;

      const params = new URLSearchParams(queryString);

      const res = await fetch(`/api/codascope/notes/${scope}/${visibility}/note/${fullPath}?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        const data = await res.json();
        const notePath = data.path ?? fullPath;
        handleNoteClick(notePath);
      }
    } catch {
      // Silently fail
    }
    setCreating(false);
  }, [scope, visibility, queryString, currentFolder, handleNoteClick]);

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
    return starredNotes.some(
      (s) => s.path === entry.path && s.scope === scope && s.visibility === visibility,
    );
  }, [starredNotes, scope, visibility]);

  // ── Get noteId from entry (need to fetch) ─────────────────────────
  // Since NoteEntry doesn't carry the noteId, star/unstar uses the starred
  // list to find the noteId by path, or falls back to fetching the note.
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

  // ── Inbox note count (for badge) ──────────────────────────────────
  const inboxCount = useMemo(() => {
    const inbox = notes.find((n) => n.isFolder && n.path === "_inbox");
    return inbox?.childCount ?? 0;
  }, [notes]);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="codascope-notes-browser">
      {/* Header */}
      <div className="codascope-notes-browser-header">
        <div className="codascope-notes-browser-header-left">
          <IconNotes size={16} />
          <span className="codascope-notes-browser-title">Notes</span>

          {/* Visibility badge */}
          <span className={`codascope-notes-visibility-badge codascope-notes-visibility-badge--${visibility}`}>
            {visibility === "shared" ? "Shared" : "Private"}
          </span>

          {/* Breadcrumb */}
          <div className="codascope-notes-breadcrumb">
            <span className="codascope-notes-breadcrumb-sep">/</span>
            <button
              className={`codascope-notes-breadcrumb-item${folderParts.length === 0 ? " codascope-notes-breadcrumb-item--current" : ""}`}
              onClick={() => handleBreadcrumbClick(-1)}
              type="button"
            >
              {scopeLabel(scope)}
            </button>
            {folderParts.map((part, i) => (
              <span key={i}>
                <span className="codascope-notes-breadcrumb-sep">/</span>
                <button
                  className={`codascope-notes-breadcrumb-item${i === folderParts.length - 1 ? " codascope-notes-breadcrumb-item--current" : ""}`}
                  onClick={() => handleBreadcrumbClick(i)}
                  type="button"
                >
                  {part}
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Header actions */}
        <div className="codascope-notes-header-actions">
          {/* Quick capture button */}
          <button
            className="codascope-notes-capture-btn"
            onClick={() => setShowCapture(true)}
            title="Quick Capture"
            type="button"
          >
            <IconCapture size={14} />
            <span>Capture</span>
          </button>

          {/* Starred filter toggle */}
          <button
            className={`codascope-notes-star-filter${showStarredOnly ? " codascope-notes-star-filter-active" : ""}`}
            onClick={() => setShowStarredOnly((v) => !v)}
            title={showStarredOnly ? "Show all notes" : "Show starred only"}
            type="button"
          >
            {showStarredOnly ? <IconStarFilled size={14} /> : <IconStar size={14} />}
          </button>

          {/* Create note button */}
          <button
            className="codascope-btn codascope-btn-primary"
            style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
            onClick={() => void handleCreateNote()}
            disabled={creating}
            type="button"
          >
            {creating ? "Creating…" : "+ Note"}
          </button>
        </div>
      </div>

      {/* Visibility tabs (for codascope-level notes) */}
      {showVisibilityTabs && (
        <div className="codascope-notes-level-tabs">
          <button
            className={`codascope-notes-level-tab${visibility === "shared" ? " codascope-notes-level-tab--active" : ""}`}
            onClick={() => handleVisibilitySwitch("shared")}
            type="button"
          >
            Shared
          </button>
          <button
            className={`codascope-notes-level-tab${visibility === "private" ? " codascope-notes-level-tab--active" : ""}`}
            onClick={() => handleVisibilitySwitch("private")}
            type="button"
          >
            Private
          </button>
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
                  ? "No notes yet. Click + Note to create one."
                  : "No matching notes."}
            </span>
          </div>
        ) : (
          filteredNotes.map((entry) =>
            entry.isFolder ? (
              <button
                key={`folder:${entry.path}`}
                className={`codascope-notes-item codascope-notes-item--folder${entry.path === "_inbox" ? " codascope-notes-item--inbox" : ""}`}
                onClick={() => handleFolderClick(entry.path)}
                type="button"
              >
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
                {/* Inbox badge */}
                {entry.path === "_inbox" && (entry.childCount ?? 0) > 0 && (
                  <span className="codascope-notes-inbox-badge">{entry.childCount}</span>
                )}
              </button>
            ) : (
              <button
                key={entry.path}
                className="codascope-notes-item"
                onClick={() => handleNoteClick(entry.path)}
                type="button"
              >
                <div className="codascope-notes-item-icon">
                  <IconFile size={14} />
                </div>
                <div className="codascope-notes-item-content">
                  <div className="codascope-notes-item-title">{entry.title}</div>
                  <div className="codascope-notes-item-meta">
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
              </button>
            ),
          )
        )}
      </div>

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

      {/* Quick Capture Dialog */}
      {showCapture && (
        <div className="codascope-notes-capture-overlay" onClick={() => setShowCapture(false)}>
          <div className="codascope-notes-capture-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="codascope-notes-capture-header">
              <IconCapture size={16} />
              <span>Quick Capture</span>
              <button
                className="codascope-notes-capture-close"
                onClick={() => setShowCapture(false)}
                type="button"
              >
                <IconClose size={14} />
              </button>
            </div>
            <textarea
              className="codascope-notes-capture-textarea"
              placeholder="Jot down a quick note…"
              value={captureText}
              onChange={(e) => setCaptureText(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  void handleCapture();
                }
              }}
            />
            <div className="codascope-notes-capture-footer">
              <span className="codascope-notes-capture-hint">
                Saves to Private / _inbox. {"\u2318"}+Enter to capture.
              </span>
              <button
                className="codascope-btn codascope-btn-primary"
                onClick={() => void handleCapture()}
                disabled={capturing || !captureText.trim()}
                type="button"
              >
                {capturing ? "Saving…" : "Capture"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
