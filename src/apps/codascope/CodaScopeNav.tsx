/* ── CodaScope: Left Navigation ───────────────────────────────────────
   Left nav component with project picker and feature sections.
   All navigation is URL-driven via useAppSubRoute.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback } from "react";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import { useCodaScopeStore } from "./useCodaScopeStore";

type CodaScopeView = "dashboard" | "wiki" | "chat" | "quality" | "rules" | "concepts" | "skills" | "settings";

const NAV_ITEMS: { view: CodaScopeView; icon: string; label: string }[] = [
  { view: "dashboard", icon: "🏠", label: "Dashboard" },
  { view: "wiki", icon: "📖", label: "Wiki" },
  { view: "chat", icon: "💬", label: "Chat" },
  { view: "quality", icon: "📊", label: "Quality" },
  { view: "rules", icon: "📜", label: "Golden Rules" },
  { view: "concepts", icon: "🧩", label: "Concepts" },
  { view: "skills", icon: "🔧", label: "Skills" },
  { view: "settings", icon: "⚙️", label: "Settings" },
];

export function CodaScopeNav() {
  const { segments, navigate } = useAppSubRoute("codascope");
  const {
    projects,
    configured,
    agentRunning,
    agentStatus,
  } = useCodaScopeStore();

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
            <span className="codascope-nav-icon">🚀</span>
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
          {projects.map((p) => (
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
          <span className="codascope-nav-icon">📁</span>
          Projects
        </button>

        {urlProjectId && NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            className={`codascope-nav-item ${currentView === item.view ? "codascope-nav-item--active" : ""}`}
            onClick={() => handleNavClick(item.view)}
            type="button"
          >
            <span className="codascope-nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
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
