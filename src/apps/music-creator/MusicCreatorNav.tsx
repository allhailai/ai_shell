import { useEffect, useState } from "react";
import { useShellStore } from "../../shell/store";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import { loadStore } from "./storage/storage";
import { tryLeaveStudio } from "./routing/leaveGuard";

const APP_ID = "music-creator";

/**
 * Left nav — Projects link plus studio context when composing.
 * Studio context uses shell `nav-item` classes so collapsed mode shows icon only.
 */
export function MusicCreatorNav() {
  const collapsed = useShellStore((s) => s.leftNavCollapsed);
  const { segments, navigate } = useAppSubRoute(APP_ID);
  const [studioProjectName, setStudioProjectName] = useState<string | null>(null);

  const section = segments[0] ?? "";
  const inStudio = section === "studio";
  const projectId = inStudio ? (segments[1] ?? "") : "";
  const onProjects = section === "projects" || section === "";

  // Resolve display name from store when composing; nav is a separate manifest region.
  useEffect(() => {
    if (!inStudio || !projectId) {
      setStudioProjectName(null);
      return;
    }

    const result = loadStore();
    if (result.ok) {
      setStudioProjectName(result.data.envelope.projects[projectId]?.name ?? null);
      return;
    }

    setStudioProjectName(null);
  }, [inStudio, projectId]);

  const studioLabel =
    studioProjectName ??
    (projectId
      ? `Studio · ${projectId.length > 8 ? `${projectId.slice(0, 8)}…` : projectId}`
      : "Studio");

  return (
    <nav className="music-creator-nav" aria-label="Music Creator">
      <div className="music-creator-nav-content scrollable-y">
        <button
          type="button"
          className={`nav-item${onProjects ? " active" : ""}`}
          aria-current={onProjects ? "page" : undefined}
          title={collapsed ? "Projects" : undefined}
          onClick={() => tryLeaveStudio(() => navigate("projects"))}
        >
          <span className="nav-item-icon" aria-hidden>
            <ProjectsIcon />
          </span>
          <span className="nav-item-label">Projects</span>
        </button>

        {inStudio && projectId ? (
          <>
            <div className="nav-divider" aria-hidden />
            <div
              className="nav-item active"
              aria-current="page"
              title={studioProjectName ? `Studio — ${studioProjectName}` : `Studio — ${projectId}`}
            >
              <span className="nav-item-icon" aria-hidden>
                <StudioIcon />
              </span>
              <span className="nav-item-label">{studioLabel}</span>
            </div>
          </>
        ) : null}
      </div>
    </nav>
  );
}

function ProjectsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function StudioIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  );
}
