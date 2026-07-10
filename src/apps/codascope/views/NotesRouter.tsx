/* ── CodaScope: NotesRouter ──────────────────────────────────────────
   Route coordinator for Notes views. Determines whether to show the
   NotesBrowser (folder listing) or NoteEditor (single note) based
   on the current URL.

   URL patterns:
     /codascope/notes/<level>                       → browser (root)
     /codascope/notes/<level>/<folder>/...           → browser (folder)
     /codascope/notes/<level>/<...path>              → editor (if path is a note file)
     /codascope/project/:id/notes/...                → project-level
     /codascope/project/:id/epic/:epicId/notes/...   → epic-level
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useMemo, useEffect } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { NotesBrowser } from "./NotesBrowser";
import { NoteEditor } from "./NoteEditor";
import type { NoteLevel } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface NotesRouterProps {
  /** Override the note level (used when embedded in EpicDetail) */
  level?: NoteLevel;
  /** Override project ID */
  projectId?: string;
  /** Override epic ID */
  epicId?: string;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function NotesRouter({ level: propLevel, projectId: propProjectId, epicId: propEpicId }: NotesRouterProps = {}) {
  const { segments, navigate } = useAppSubRoute("codascope");

  // ── Parse URL to determine level, path, and whether we're editing ──

  const routeInfo = useMemo(() => {
    // Codascope-level: /codascope/notes/<level>/...
    if (segments[0] === "notes" && segments.length >= 2) {
      const level = segments[1] as NoteLevel;
      const rest = segments.slice(2);
      return { level, rest, urlPrefix: `notes/${level}`, queryParams: {} as Record<string, string> };
    }

    // Project-level: /codascope/project/:id/notes/...
    if (segments[0] === "project" && segments[2] === "notes") {
      const projectId = segments[1];
      const rest = segments.slice(3);
      return { level: "project" as NoteLevel, rest, urlPrefix: `project/${projectId}/notes`, queryParams: { projectId } };
    }

    // Epic-level: /codascope/project/:id/epic/:epicId/notes/...
    if (segments[0] === "project" && segments[2] === "epic" && segments[4] === "notes") {
      const projectId = segments[1];
      const epicId = segments[3];
      const rest = segments.slice(5);
      return { level: "epic" as NoteLevel, rest, urlPrefix: `project/${projectId}/epic/${epicId}/notes`, queryParams: { projectId, epicId } };
    }

    return null;
  }, [segments]);

  const level = propLevel ?? routeInfo?.level ?? "personal";
  const rest = routeInfo?.rest ?? [];
  const urlPrefix = routeInfo?.urlPrefix ?? "notes/personal";
  // Build STABLE queryParams from primitives — not from routeInfo.queryParams
  // which is a new object every render due to segments array identity changes.
  const effectiveProjectId = propProjectId ?? routeInfo?.queryParams?.projectId;
  const effectiveEpicId = propEpicId ?? routeInfo?.queryParams?.epicId;
  const queryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (effectiveProjectId) params.projectId = effectiveProjectId;
    if (effectiveEpicId) params.epicId = effectiveEpicId;
    return params;
  }, [effectiveProjectId, effectiveEpicId]);

  // Stable string for effect dependencies
  const queryString = useMemo(() => new URLSearchParams(queryParams).toString(), [queryParams]);

  // ── Determine view mode: browser vs editor ─────────────────────────
  // We check if the last path segment looks like a note (ends in .md or
  // can be resolved as a note). We use a state to track this, fetched
  // by checking the API.
  const [viewMode, setViewMode] = useState<"browser" | "editor" | "checking">("browser");
  const pathString = rest.join("/");

  useEffect(() => {
    if (rest.length === 0) {
      setViewMode("browser");
      return;
    }

    // Try to load as a note. If it exists, show editor. Otherwise, show browser (folder).
    let cancelled = false;
    setViewMode("checking");

    const notePath = pathString.endsWith(".md") ? pathString : `${pathString}.md`;
    
    void (async () => {
      try {
        const res = await fetch(`/api/codascope/notes/${level}/note/${notePath}?${queryString}`, {
          method: "HEAD",
        });
        if (cancelled) return;
        // If HEAD isn't supported, try GET
        if (res.ok || res.status === 200) {
          setViewMode("editor");
        } else {
          setViewMode("browser");
        }
      } catch {
        if (!cancelled) setViewMode("browser");
      }
    })();

    return () => { cancelled = true; };
  }, [pathString, rest.length, level, queryString]);

  // ── Navigation callbacks ───────────────────────────────────────────

  const handleBack = useCallback(() => {
    // Navigate to the parent folder
    if (rest.length > 1) {
      const parentPath = rest.slice(0, -1).join("/");
      navigate(`${urlPrefix}/${parentPath}`);
    } else {
      navigate(urlPrefix);
    }
  }, [navigate, urlPrefix, rest]);

  // ── Render ─────────────────────────────────────────────────────────

  if (viewMode === "checking") {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "var(--color-text-tertiary)",
        fontSize: "var(--text-sm)",
      }}>
        Loading…
      </div>
    );
  }

  if (viewMode === "editor" && pathString) {
    return (
      <NoteEditor
        level={level}
        notePath={pathString}
        queryParams={queryParams}
        onBack={handleBack}
      />
    );
  }

  return (
    <NotesBrowser
      level={level}
      projectId={queryParams.projectId ?? propProjectId}
      epicId={queryParams.epicId ?? propEpicId}
    />
  );
}
