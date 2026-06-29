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
import { ConceptExplorer } from "./views/ConceptExplorer";
import { GoldenRules } from "./views/GoldenRules";
import { QualityDashboard } from "./views/QualityDashboard";
import { SetupBanners } from "./components/SetupBanners";

/**
 * Global data loader — fetches config + projects once on mount,
 * regardless of which route is active. This ensures that navigating
 * directly to /project/:id/dashboard (e.g. via refresh) still has
 * project data available in the store.
 */
function useCodaScopeBootstrap() {
  const { configured, setProjectsRoot, setConfigured, setProjects } = useCodaScopeStore();

  // Load config on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/codascope/config");
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (data.projectsRoot) {
            setProjectsRoot(data.projectsRoot);
            setConfigured(true);
          }
        }
      } catch {
        // Not configured yet
      }
    })();
    return () => { cancelled = true; };
  }, [setProjectsRoot, setConfigured]);

  // Load projects when configured
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/codascope/projects");
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setProjects(data.projects ?? []);
        }
      } catch {
        // Silently fail
      }
    })();
    return () => { cancelled = true; };
  }, [configured, setProjects]);
}

export function CodaScopeContent() {
  const { segments, replace } = useAppSubRoute("codascope");
  const { setActiveProject, setActiveTopic } = useCodaScopeStore();

  // Bootstrap: load config + projects on mount (works for all routes)
  useCodaScopeBootstrap();

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

    // Don't show banners on settings page (user is already there)
    const showBanners = view !== "settings";

    let content: React.ReactNode;
    switch (view) {
      case "dashboard":
        content = <ProjectDashboard />;
        break;
      case "wiki":
        content = <WikiBrowser />;
        break;
      case "chat":
        content = <ChatView />;
        break;
      case "skills":
        content = <SkillsManager />;
        break;
      case "settings":
        content = <Settings />;
        break;
      case "quality":
        content = <QualityDashboard />;
        break;
      case "rules":
        content = <GoldenRules />;
        break;
      case "concepts":
        content = <ConceptExplorer />;
        break;
      default:
        content = <ProjectDashboard />;
    }

    return (
      <>
        {showBanners && <SetupBanners />}
        {content}
      </>
    );
  }

  // Fallback
  return <ProjectList />;
}
