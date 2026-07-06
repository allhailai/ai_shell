/* ── CodaScope: Setup Banners ─────────────────────────────────────────
   Inline banners that appear at the top of CodaScope content views
   when required setup is incomplete. Guides users to configure:
   
   1. Cursor API key — needed for all agent/assistant features
   2. Repositories — needed for a project to be useful
   3. Unmapped repositories — repos from an imported project that
      don't exist on this machine
   
   Each banner is clickable and navigates to the appropriate settings.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, type ReactNode } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { IconKey, IconPackage, IconWarning } from "./CodaScopeIcons";

interface SetupStatus {
  hasApiKey: boolean;
  hasRepos: boolean;
  unmappedRepos: Array<{ id: string; name: string; path: string }>;
  loading: boolean;
}

function useSetupStatus(): SetupStatus {
  const { activeProjectId, projects } = useCodaScopeStore();
  const [hasApiKey, setHasApiKey] = useState(true); // Assume configured until proven otherwise
  const [unmappedRepos, setUnmappedRepos] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [loading, setLoading] = useState(true);

  const project = projects.find((p) => p.id === activeProjectId);
  const hasRepos = (project?.repositories?.length ?? 0) > 0;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/secrets/app/codascope/cursor_api_key");
        if (cancelled) return;

        if (res.status === 404) {
          setHasApiKey(false);
        } else if (res.ok) {
          const data = await res.json();
          setHasApiKey(!!data.value);
        } else {
          setHasApiKey(false);
        }
      } catch {
        if (!cancelled) setHasApiKey(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Check for unmapped repos
  useEffect(() => {
    if (!activeProjectId || !hasRepos) {
      setUnmappedRepos([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`/api/codascope/projects/${activeProjectId}/validate-repos`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setUnmappedRepos(data.unmappedRepos ?? []);
        }
      } catch {
        if (!cancelled) setUnmappedRepos([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, hasRepos]);

  return { hasApiKey, hasRepos, unmappedRepos, loading };
}

export function SetupBanners() {
  const { navigate } = useAppSubRoute("codascope");
  const { activeProjectId } = useCodaScopeStore();
  const { hasApiKey, hasRepos, unmappedRepos, loading } = useSetupStatus();

  if (loading) return null;

  const banners: Array<{
    key: string;
    icon: ReactNode;
    text: string;
    action: string;
    onClick: () => void;
    variant: "warning" | "info";
  }> = [];

  if (!hasApiKey) {
    banners.push({
      key: "api-key",
      icon: <IconKey size={14} />,
      text: "Cursor API key not configured — agent features are disabled",
      action: "Add API Key",
      onClick: () => {
        if (activeProjectId) {
          navigate(`project/${activeProjectId}/settings`);
          // Scroll to the API key section after a brief delay for rendering
          setTimeout(() => {
            document.getElementById("api-key-section")?.scrollIntoView({ behavior: "smooth" });
          }, 100);
        }
      },
      variant: "warning",
    });
  }

  if (activeProjectId && !hasRepos) {
    banners.push({
      key: "repos",
      icon: <IconPackage size={14} />,
      text: "No repositories added to this project",
      action: "Add Repositories",
      onClick: () => navigate(`project/${activeProjectId}/settings`),
      variant: "info",
    });
  }

  if (activeProjectId && unmappedRepos.length > 0) {
    const count = unmappedRepos.length;
    banners.push({
      key: "unmapped-repos",
      icon: <IconWarning size={14} />,
      text: `${count} repositor${count === 1 ? "y has" : "ies have"} unmapped paths — some features are disabled`,
      action: "Fix Repository Mapping",
      onClick: () => {
        navigate(`project/${activeProjectId}/settings`);
        setTimeout(() => {
          document.getElementById("repos-section")?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      },
      variant: "warning",
    });
  }

  if (banners.length === 0) return null;

  return (
    <div className="codascope-setup-banners">
      {banners.map((b) => (
        <button
          key={b.key}
          className={`codascope-setup-banner codascope-setup-banner--${b.variant}`}
          onClick={b.onClick}
          type="button"
        >
          <span className="codascope-setup-banner-icon">{b.icon}</span>
          <span className="codascope-setup-banner-text">{b.text}</span>
          <span className="codascope-setup-banner-action">
            {b.action}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </button>
      ))}
    </div>
  );
}

