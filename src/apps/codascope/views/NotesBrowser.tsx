/* ── CodaScope: NotesBrowser View ────────────────────────────────────
   List + folder browser for notes at any level (personal, public,
   project, epic). URL-driven with breadcrumb navigation.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useMemo } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { IconNotes, IconFolder, IconFile } from "../components/CodaScopeIcons";
import type { NoteLevel, NoteEntry } from "../codaScopeTypes";

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

/* ── URL parsing helpers ─────────────────────────────────────────────── */

interface NotesBrowserContext {
  level: NoteLevel;
  /** Folder path segments (may be empty for root) */
  folderParts: string[];
  /** The note filename if viewing a specific note (null for folder listing) */
  notePath: string | null;
  /** Query params for the API */
  queryParams: Record<string, string>;
}

/**
 * Parse the URL segments and props to determine the notes context.
 *
 * URL patterns matched:
 *   /codascope/notes/<level>/<...folderPath>
 *   /codascope/project/:projectId/notes/<...folderPath>
 *   /codascope/project/:projectId/epic/:epicId/notes/<...folderPath>
 */
function parseNotesContext(
  segments: string[],
  projectId: string | null,
  epicId?: string | null,
): NotesBrowserContext | null {
  // Case 1: codascope-level notes: /codascope/notes/<level>/...
  if (segments[0] === "notes" && segments.length >= 2) {
    const level = segments[1] as NoteLevel;
    if (level !== "personal" && level !== "public") return null;
    const rest = segments.slice(2);
    return {
      level,
      folderParts: rest,
      notePath: null,
      queryParams: {},
    };
  }

  // Case 2: project-level: /codascope/project/:id/notes/...
  if (segments[0] === "project" && segments[2] === "notes" && projectId) {
    const rest = segments.slice(3);
    return {
      level: "project",
      folderParts: rest,
      notePath: null,
      queryParams: { projectId },
    };
  }

  // Case 3: epic-level: /codascope/project/:id/epic/:epicId/notes/...
  if (segments[0] === "project" && segments[2] === "epic" && segments[4] === "notes" && projectId && epicId) {
    const rest = segments.slice(5);
    return {
      level: "epic",
      folderParts: rest,
      notePath: null,
      queryParams: { projectId, epicId },
    };
  }

  return null;
}

/* ── Props ───────────────────────────────────────────────────────────── */

interface NotesBrowserProps {
  /** Override the note level (used when embedded in EpicDetail) */
  level?: NoteLevel;
  /** Override project ID */
  projectId?: string;
  /** Override epic ID */
  epicId?: string;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function NotesBrowser({ level: propLevel, projectId: propProjectId, epicId: propEpicId }: NotesBrowserProps = {}) {
  const { segments, navigate } = useAppSubRoute("codascope");
  const { activeProjectId } = useCodaScopeStore();

  // Resolve effective project/epic from props or URL
  const effectiveProjectId = propProjectId ?? activeProjectId;

  // Parse context from URL or props
  const urlContext = useMemo(
    () => parseNotesContext(segments, effectiveProjectId ?? null, propEpicId),
    [segments, effectiveProjectId, propEpicId],
  );

  const level: NoteLevel = propLevel ?? urlContext?.level ?? "personal";
  const folderParts = urlContext?.folderParts ?? [];
  const currentFolder = folderParts.length > 0 ? folderParts.join("/") : undefined;
  const queryParams: Record<string, string> = useMemo(() => {
    const base = urlContext?.queryParams ?? {};
    if (propProjectId) base.projectId = propProjectId;
    if (propEpicId) base.epicId = propEpicId;
    return base;
  }, [urlContext?.queryParams, propProjectId, propEpicId]);

  // ── State ──────────────────────────────────────────────────────────
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  // Level tabs for codascope-level notes (personal/public)
  const showLevelTabs = !propLevel && level !== "project" && level !== "epic";

  // ── Fetch notes ────────────────────────────────────────────────────
  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(queryParams);
      if (currentFolder) params.set("folder", currentFolder);
      const res = await fetch(`/api/codascope/notes/${level}?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes ?? []);
      }
    } catch {
      // Silently fail
    }
    setLoading(false);
  }, [level, queryParams, currentFolder]);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  // ── Filtered notes ─────────────────────────────────────────────────
  const filteredNotes = useMemo(() => {
    if (!search.trim()) return notes;
    const q = search.toLowerCase();
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [notes, search]);

  // ── Navigation helpers ─────────────────────────────────────────────

  /** Build the URL prefix for notes at the current level. */
  const getNotesUrlPrefix = useCallback((): string => {
    if (level === "personal" || level === "public") {
      return `notes/${level}`;
    }
    if (level === "epic" && effectiveProjectId && propEpicId) {
      return `project/${effectiveProjectId}/epic/${propEpicId}/notes`;
    }
    if (level === "project" && effectiveProjectId) {
      return `project/${effectiveProjectId}/notes`;
    }
    return "notes/personal";
  }, [level, effectiveProjectId, propEpicId]);

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
      // Strip .md extension for cleaner URLs
      const cleanPath = notePath.replace(/\.md$/, "");
      navigate(`${prefix}/${cleanPath}`);
    },
    [navigate, getNotesUrlPrefix],
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

  const handleLevelSwitch = useCallback(
    (newLevel: NoteLevel) => {
      navigate(`notes/${newLevel}`);
    },
    [navigate],
  );

  // ── Create note ────────────────────────────────────────────────────
  const handleCreateNote = useCallback(async () => {
    setCreating(true);
    try {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const filename = `Untitled ${dateStr}.md`;
      const fullPath = currentFolder ? `${currentFolder}/${filename}` : filename;

      const params = new URLSearchParams(queryParams);
      const res = await fetch(`/api/codascope/notes/${level}/note/${fullPath}?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        const data = await res.json();
        // Navigate to the newly created note
        const notePath = data.path ?? fullPath;
        handleNoteClick(notePath);
      }
    } catch {
      // Silently fail
    }
    setCreating(false);
  }, [level, queryParams, currentFolder, handleNoteClick]);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="codascope-notes-browser">
      {/* Header */}
      <div className="codascope-notes-browser-header">
        <div className="codascope-notes-browser-header-left">
          <IconNotes size={16} />
          <span className="codascope-notes-browser-title">Notes</span>

          {/* Breadcrumb */}
          <div className="codascope-notes-breadcrumb">
            <span className="codascope-notes-breadcrumb-sep">/</span>
            <button
              className={`codascope-notes-breadcrumb-item${folderParts.length === 0 ? " codascope-notes-breadcrumb-item--current" : ""}`}
              onClick={() => handleBreadcrumbClick(-1)}
              type="button"
            >
              {level === "personal" ? "Personal" : level === "public" ? "Public" : level === "project" ? "Project" : "Epic"}
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

        {/* Create note button */}
        <button
          className="codascope-btn codascope-btn-primary"
          style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
          onClick={handleCreateNote}
          disabled={creating}
          type="button"
        >
          {creating ? "Creating…" : "+ Note"}
        </button>
      </div>

      {/* Level tabs for codascope-level notes */}
      {showLevelTabs && (
        <div className="codascope-notes-level-tabs">
          <button
            className={`codascope-notes-level-tab${level === "personal" ? " codascope-notes-level-tab--active" : ""}`}
            onClick={() => handleLevelSwitch("personal")}
            type="button"
          >
            Personal
          </button>
          <button
            className={`codascope-notes-level-tab${level === "public" ? " codascope-notes-level-tab--active" : ""}`}
            onClick={() => handleLevelSwitch("public")}
            type="button"
          >
            Public
          </button>
        </div>
      )}

      {/* Search */}
      <div className="codascope-notes-search">
        <input
          className="codascope-notes-search-input"
          type="text"
          placeholder="Search notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Notes list */}
      <div className="codascope-notes-list">
        {loading ? (
          <div className="codascope-notes-list-empty">
            <span>Loading…</span>
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="codascope-notes-list-empty">
            <div className="codascope-notes-list-empty-icon">
              <IconNotes size={32} />
            </div>
            <span>
              {notes.length === 0
                ? "No notes yet. Click + Note to create one."
                : "No matching notes."}
            </span>
          </div>
        ) : (
          filteredNotes.map((entry) =>
            entry.isFolder ? (
              <button
                key={`folder:${entry.path}`}
                className="codascope-notes-item codascope-notes-item--folder"
                onClick={() => handleFolderClick(entry.path)}
                type="button"
              >
                <div className="codascope-notes-item-icon">
                  <IconFolder size={14} />
                </div>
                <div className="codascope-notes-item-content">
                  <div className="codascope-notes-item-title">{entry.title}</div>
                  <div className="codascope-notes-item-meta">
                    <span className="codascope-notes-folder-count">
                      {entry.childCount ?? 0} note{(entry.childCount ?? 0) !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
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
              </button>
            ),
          )
        )}
      </div>
    </div>
  );
}
