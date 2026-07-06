/* ── CodaScope: Left Navigation ───────────────────────────────────────
   Left nav component with project picker and feature sections.
   All navigation is URL-driven via useAppSubRoute.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, type ComponentType } from "react";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import { useRightPanel } from "../../shell/hooks";
import { useCodaScopeStore } from "./useCodaScopeStore";
import {
  IconDashboard,
  IconWiki,
  IconChat,
  IconSkills,
  IconSettings,
  IconFolder,
  IconLaunch,
  IconEpic,
} from "./components/CodaScopeIcons";

type CodaScopeView = "dashboard" | "epics" | "wiki" | "skills" | "settings";

const NAV_ITEMS: { view: CodaScopeView; icon: ComponentType<{ size?: number }>; label: string }[] = [
  { view: "dashboard", icon: IconDashboard, label: "Dashboard" },
  { view: "epics", icon: IconEpic, label: "Epics" },
  { view: "wiki", icon: IconWiki, label: "Wiki" },
  { view: "skills", icon: IconSkills, label: "Skills" },
  { view: "settings", icon: IconSettings, label: "Settings" },
];

export function CodaScopeNav() {
  const { segments, navigate } = useAppSubRoute("codascope");
  const {
    projects,
    configured,
    agentRunning,
    agentStatus,
    activeProjectId,
    setAgentRunning,
    setAgentStatus,
  } = useCodaScopeStore();
  const { isOpen: isAssistantOpen, toggle: toggleAssistant } = useRightPanel("assistant");

  // Derive current view from URL
  const section = segments[0] ?? "";
  const urlProjectId = section === "project" ? (segments[1] ?? null) : null;
  const currentView = section === "project" ? (segments[2] ?? "dashboard") : null;

  const handleProjectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const projectId = e.target.value;
    if (projectId) {
      navigate(`project/${projectId}/dashboard`);
    } else {
      navigate("projects");
    }
  }, [navigate]);

  const handleNavClick = useCallback((view: CodaScopeView) => {
    if (urlProjectId) {
      navigate(`project/${urlProjectId}/${view}`);
    }
  }, [navigate, urlProjectId]);

  // ── Poll build status when agentRunning is true ──────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Determine the project to poll: URL project or active project
    const projectId = urlProjectId ?? activeProjectId;
    if (!agentRunning || !projectId) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/codascope/projects/${projectId}/build-status`);
        if (!res.ok) return;
        const { build } = await res.json();
        if (!build) return;

        if (build.status !== "building") {
          setAgentRunning(false);
          setAgentStatus("");
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      } catch { /* ignore */ }
    };

    pollRef.current = setInterval(poll, 5000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [agentRunning, urlProjectId, activeProjectId, setAgentRunning, setAgentStatus]);

  if (!configured) {
    return (
      <div className="codascope-nav">
        <div className="codascope-nav-section">
          <div className="codascope-nav-section-label">CodaScope</div>
          <button
            className="codascope-nav-item codascope-nav-item--active"
            onClick={() => navigate("projects")}
            type="button"
          >
            <span className="codascope-nav-icon"><IconLaunch size={14} /></span>
            Setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="codascope-nav">
      {/* Project picker */}
      <div className="codascope-nav-project-picker">
        <select
          className="codascope-nav-project-select"
          value={urlProjectId ?? ""}
          onChange={handleProjectChange}
        >
          <option value="">— All Projects —</option>
          {projects.filter((p) => !p.archived).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Main navigation */}
      <div className="codascope-nav-section">
        <div className="codascope-nav-section-label">Navigation</div>
        <button
          className={`codascope-nav-item ${section === "projects" || section === "" ? "codascope-nav-item--active" : ""}`}
          onClick={() => navigate("projects")}
          type="button"
        >
          <span className="codascope-nav-icon"><IconFolder size={14} /></span>
          Projects
        </button>

        {urlProjectId && (
          <>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.view}
                className={`codascope-nav-item ${currentView === item.view ? "codascope-nav-item--active" : ""}`}
                onClick={() => handleNavClick(item.view)}
                type="button"
              >
                <span className="codascope-nav-icon"><item.icon size={14} /></span>
                {item.label}
              </button>
            ))}

            {/* Chat opens the right-panel assistant instead of navigating */}
            <button
              className={`codascope-nav-item ${isAssistantOpen ? "codascope-nav-item--active" : ""}`}
              onClick={toggleAssistant}
              type="button"
            >
              <span className="codascope-nav-icon"><IconChat size={14} /></span>
              Chat
            </button>
          </>
        )}
      </div>

      {/* Agent status */}
      {agentRunning && (
        <div className="codascope-nav-section" style={{ marginTop: "auto" }}>
          <div className="codascope-nav-section-label">Agent</div>
          <div className="codascope-nav-item">
            <span className="codascope-status-badge codascope-status-badge--running">
              ● Running
            </span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
              {agentStatus}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
