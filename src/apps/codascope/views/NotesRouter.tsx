/* ── CodaScope: NotesRouter ──────────────────────────────────────────
   Route coordinator for Notes views. Determines whether to show the
   NotesBrowser (folder listing) or NoteEditor (single note) based
   on the current URL.

   URL patterns:
     /codascope/notes/<visibility>                     → browser (root, codascope scope)
     /codascope/notes/<visibility>/<folder>/...        → browser (folder)
     /codascope/notes/<visibility>/<...path>           → editor (if path is a note file)
     /codascope/project/:id/notes/<visibility>/...     → project-scope
     /codascope/project/:id/epic/:eid/notes/<visibility>/... → epic-scope
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useMemo, useEffect } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { NotesBrowser } from "./NotesBrowser";
import { NoteEditor } from "./NoteEditor";
import type { NoteScope, NoteVisibility } from "../codaScopeTypes";

/* ── Props ───────────────────────────────────────────────────────────── */

interface NotesRouterProps {
  /** Override the note scope (used when embedded in EpicDetail) */
  scope?: NoteScope;
  /** Override visibility */
  visibility?: NoteVisibility;
  /** Override project ID */
  projectId?: string;
  /** Override epic ID */
  epicId?: string;
}

/* ── Component ───────────────────────────────────────────────────────── */

export function NotesRouter({ scope: propScope, visibility: propVisibility, projectId: propProjectId, epicId: propEpicId }: NotesRouterProps = {}) {
  const { segments, navigate } = useAppSubRoute("codascope");

  // ── Parse URL to determine scope, visibility, path, and whether we're editing ──

  const routeInfo = useMemo(() => {
    // CodaScope-level: /codascope/notes/<visibility>/...
    if (segments[0] === "notes" && segments.length >= 2) {
      const visibility = segments[1] as NoteVisibility;
      const rest = segments.slice(2);
      return {
        scope: "codascope" as NoteScope,
        visibility,
        rest,
        urlPrefix: `notes/${visibility}`,
        queryParams: {} as Record<string, string>,
      };
    }

    // Project-level: /codascope/project/:id/notes/<visibility>/...
    if (segments[0] === "project" && segments[2] === "notes" && segments.length >= 4) {
      const projectId = segments[1];
      const visibility = segments[3] as NoteVisibility;
      const rest = segments.slice(4);
      return {
        scope: "project" as NoteScope,
        visibility,
        rest,
        urlPrefix: `project/${projectId}/notes/${visibility}`,
        queryParams: { projectId },
      };
    }

    // Epic-level: /codascope/project/:id/epic/:eid/notes/<visibility>/...
    if (segments[0] === "project" && segments[2] === "epic" && segments[4] === "notes" && segments.length >= 6) {
      const projectId = segments[1];
      const epicId = segments[3];
      const visibility = segments[5] as NoteVisibility;
      const rest = segments.slice(6);
      return {
        scope: "epic" as NoteScope,
        visibility,
        rest,
        urlPrefix: `project/${projectId}/epic/${epicId}/notes/${visibility}`,
        queryParams: { projectId, epicId },
      };
    }

    return null;
  }, [segments]);

  const scope = propScope ?? routeInfo?.scope ?? "codascope";
  const visibility = propVisibility ?? routeInfo?.visibility ?? "shared";
  const rest = routeInfo?.rest ?? [];
  const urlPrefix = routeInfo?.urlPrefix ?? `notes/${visibility}`;
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
        const res = await fetch(`/api/codascope/notes/${scope}/${visibility}/note/${notePath}?${queryString}`, {
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
  }, [pathString, rest.length, scope, visibility, queryString]);

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
        scope={scope}
        visibility={visibility}
        notePath={pathString}
        queryParams={queryParams}
        onBack={handleBack}
      />
    );
  }

  return (
    <NotesBrowser
      scope={scope}
      visibility={visibility}
      projectId={queryParams.projectId ?? propProjectId}
      epicId={queryParams.epicId ?? propEpicId}
    />
  );
}
