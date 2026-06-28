/* ── CodaScope: Main Content ──────────────────────────────────────────
   Root content component that routes between views based on URL state.
   
   URL scheme:
     /codascope                           → redirects to /codascope/projects
     /codascope/projects                  → project list / setup
     /codascope/project/:id               → redirects to /project/:id/dashboard
     /codascope/project/:id/dashboard     → project dashboard
     /codascope/project/:id/wiki          → wiki browser (no topic)
     /codascope/project/:id/wiki/:topicId → wiki browser (specific topic)
     /codascope/project/:id/chat          → codebase chat
     /codascope/project/:id/quality       → quality dashboard
     /codascope/project/:id/rules         → golden rules
     /codascope/project/:id/concepts      → concept explorer
     /codascope/project/:id/skills        → skills manager
     /codascope/project/:id/settings      → project settings
   ──────────────────────────────────────────────────────────────────── */

import { useEffect } from "react";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import { useCodaScopeStore } from "./useCodaScopeStore";
import { ProjectList } from "./views/ProjectList";
import { ProjectDashboard } from "./views/ProjectDashboard";
import { WikiBrowser } from "./views/WikiBrowser";
import { ChatView } from "./views/ChatView";
import { SkillsManager } from "./views/SkillsManager";
import { Settings } from "./views/Settings";

export function CodaScopeContent() {
  const { segments, replace } = useAppSubRoute("codascope");
  const { setActiveProject, setActiveTopic } = useCodaScopeStore();

  // Parse route
  const section = segments[0] ?? "";

  // ── Redirect bare /codascope → /codascope/projects ────────────────
  useEffect(() => {
    if (segments.length === 0) {
      replace("projects");
    }
  }, [segments.length, replace]);

  // ── Redirect /codascope/project/:id → /project/:id/dashboard ──────
  useEffect(() => {
    if (section === "project" && segments.length === 2) {
      replace(`project/${segments[1]}/dashboard`);
    }
  }, [section, segments, replace]);

  // ── Sync store with URL-derived project ID ────────────────────────
  const urlProjectId = section === "project" ? (segments[1] ?? null) : null;
  useEffect(() => {
    setActiveProject(urlProjectId);
  }, [urlProjectId, setActiveProject]);

  // ── Sync wiki topic from URL ──────────────────────────────────────
  const urlView = section === "project" ? (segments[2] ?? "") : "";
  const urlTopicId = urlView === "wiki" ? (segments[3] ?? null) : null;
  useEffect(() => {
    if (urlView === "wiki") {
      setActiveTopic(urlTopicId);
    }
  }, [urlView, urlTopicId, setActiveTopic]);

  // ── Route matching ────────────────────────────────────────────────

  if (section === "" || section === "projects") {
    return <ProjectList />;
  }

  if (section === "project") {
    const view = segments[2] ?? "dashboard";
    switch (view) {
      case "dashboard":
        return <ProjectDashboard />;
      case "wiki":
        return <WikiBrowser />;
      case "chat":
        return <ChatView />;
      case "skills":
        return <SkillsManager />;
      case "settings":
        return <Settings />;
      case "quality":
        return (
          <div className="codascope-empty-state">
            <div className="codascope-empty-state-icon">📊</div>
            <div className="codascope-empty-state-title">Quality Dashboard</div>
            <div className="codascope-empty-state-text">
              Quality analysis dashboard coming in Phase 2.
            </div>
          </div>
        );
      case "rules":
        return (
          <div className="codascope-empty-state">
            <div className="codascope-empty-state-icon">📜</div>
            <div className="codascope-empty-state-title">Golden Rules</div>
            <div className="codascope-empty-state-text">
              Golden rules management coming in Phase 2.
            </div>
          </div>
        );
      case "concepts":
        return (
          <div className="codascope-empty-state">
            <div className="codascope-empty-state-icon">🧩</div>
            <div className="codascope-empty-state-title">Concept Explorer</div>
            <div className="codascope-empty-state-text">
              Concept extraction and exploration coming in Phase 3.
            </div>
          </div>
        );
      default:
        return <ProjectDashboard />;
    }
  }

  // Fallback
  return <ProjectList />;
}
