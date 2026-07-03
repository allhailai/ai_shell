/* ── CodaScope: Main Content ──────────────────────────────────────────
   Root content component that routes between views based on URL state.
   
   URL scheme:
     /codascope                                      → redirects to /codascope/projects
     /codascope/projects                             → project list / setup
     /codascope/project/:id                          → redirects to /project/:id/dashboard
     /codascope/project/:id/dashboard                → project dashboard
     /codascope/project/:id/wiki                     → wiki browser (no topic)
     /codascope/project/:id/wiki/:topicId            → wiki browser (specific topic)
     /codascope/project/:id/chat                     → redirects to dashboard (chat is in right panel)
     /codascope/project/:id/quality                  → quality dashboard
     /codascope/project/:id/rules                    → golden rules
     /codascope/project/:id/concepts                 → concept explorer
     /codascope/project/:id/skills                   → skills manager
     /codascope/project/:id/settings                 → project settings
     /codascope/project/:id/epics                    → epic list
     /codascope/project/:id/epic/:epicId             → redirects to .../define
     /codascope/project/:id/epic/:epicId/define      → epic define (sidebar layout)
     /codascope/project/:id/epic/:epicId/scope       → epic scope
     /codascope/project/:id/epic/:epicId/knowledge   → redirects to .../knowledge/wiki
     /codascope/project/:id/epic/:epicId/knowledge/wiki              → wiki overview
     /codascope/project/:id/epic/:epicId/knowledge/wiki/:pageId      → wiki page viewer
     /codascope/project/:id/epic/:epicId/knowledge/sources           → sources overview
     /codascope/project/:id/epic/:epicId/knowledge/sources/:sourceId → source viewer
     /codascope/project/:id/epic/:epicId/knowledge/failed           → failed sources
     /codascope/project/:id/epic/:epicId/design      → epic design docs
     /codascope/project/:id/epic/:epicId/history     → epic history
   ──────────────────────────────────────────────────────────────────── */

import { useEffect } from "react";
import { useAppSubRoute } from "../../shell/useAppSubRoute";
import { useCodaScopeStore } from "./useCodaScopeStore";
import { ProjectList } from "./views/ProjectList";
import { ProjectDashboard } from "./views/ProjectDashboard";
import { WikiBrowser } from "./views/WikiBrowser";
import { SkillsManager } from "./views/SkillsManager";
import { Settings } from "./views/Settings";
import { ConceptExplorer } from "./views/ConceptExplorer";
import { GoldenRules } from "./views/GoldenRules";
import { QualityDashboard } from "./views/QualityDashboard";
import { SetupBanners } from "./components/SetupBanners";
import { EpicList } from "./views/EpicList";
import { EpicDetail } from "./views/EpicDetail";

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
    // Redirect /project/:id/epic/:epicId → /project/:id/epic/:epicId/define
    if (section === "project" && segments[2] === "epic" && segments.length === 4) {
      replace(`project/${segments[1]}/epic/${segments[3]}/define`);
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
        // Chat is now handled by the right-panel assistant.
        // Redirect any stale /chat URLs to dashboard.
        content = <ProjectDashboard />;
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
      case "epics":
        content = <EpicList />;
        break;
      case "epic":
        content = <EpicDetail />;
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
