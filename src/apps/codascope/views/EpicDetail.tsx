/* ── CodaScope: EpicDetail View ──────────────────────────────────────
   Layout coordinator for a single epic. Manages the collapsible left
   sidebar (EpicSidebar) and routes content to the active section view.

   URL scheme:
     /epic/:epicId/define
     /epic/:epicId/scope
     /epic/:epicId/knowledge/wiki
     /epic/:epicId/knowledge/wiki/:pageId
     /epic/:epicId/knowledge/sources
     /epic/:epicId/knowledge/sources/:sourceId
     /epic/:epicId/knowledge/blocked
     /epic/:epicId/design
     /epic/:epicId/design/:docId
     /epic/:epicId/history
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { EpicDefine } from "./EpicDefine";
import { EpicScope } from "./EpicScope";
import {
  EpicKnowledgeWikiView,
  EpicKnowledgeSourcesView,
  EpicKnowledgeBlockedView,
} from "./EpicKnowledge";
import { EpicDesignDocs } from "./EpicDesignDocs";
import { EpicHistory } from "./EpicHistory";
import { EpicSidebar } from "../components/EpicSidebar";
import { CurationReasonsModal } from "../components/CurationReasonsModal";
import { CurationProgressBanner } from "../components/CurationProgressBanner";
import type {
  EpicDesignDetail,
  EpicStatus,
  CurationReason,
  EpicWikiPage,
  EpicKnowledgeSource,
  BlockedDownload,
} from "../codaScopeTypes";

/* ── Sidebar collapse persistence ────────────────────────────────────── */

const SIDEBAR_COLLAPSED_KEY = "codascope:epicSidebarCollapsed";

function getSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function setSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false");
  } catch {
    /* ignore */
  }
}

/* ── Model ID helper ─────────────────────────────────────────────────── */

const MODEL_STORAGE_KEY = "codascope:lastModel";

function getLastModelId(): string | null {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicDetail() {
  const { segments, navigate, replace } = useAppSubRoute("codascope");
  const { activeProjectId, setActiveEpic } = useCodaScopeStore();

  // Parse URL: /codascope/project/:id/epic/:epicId/:section/:sub/:itemId
  const epicId = segments[3] ?? "";
  const section = segments[4] ?? "define";
  const subSection = segments[5] ?? "";
  const itemId = segments[6] ?? "";

  // Build the active section key.
  // For 'design', subSection is the docId (not a sub-section like knowledge/wiki).
  const activeSection = (section === "design" || !subSection)
    ? section
    : `${section}/${subSection}`;
  const activeSubItemId = section === "design"
    ? (subSection || null)
    : (itemId || null);

  // ── Epic data ────────────────────────────────────────────────────────
  const [epic, setEpic] = useState<EpicDesignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Sidebar state ────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState(getSidebarCollapsed);
  const [knowledgeExpanded, setKnowledgeExpanded] = useState(
    () => section === "knowledge",
  );

  const [curationReasons, setCurationReasons] = useState<CurationReason[]>([]);
  const [isCurating, setIsCurating] = useState(false);
  const [showCurationModal, setShowCurationModal] = useState(false);
  const [curationModelId, setCurationModelId] = useState<string | null>(null);
  const [curationReconnect, setCurationReconnect] = useState(false);
  const fetchReasonsRef = useRef(0);

  // ── Knowledge data (lifted from EpicKnowledge) ───────────────────────
  const [wikiPages, setWikiPages] = useState<EpicWikiPage[]>([]);
  const [sources, setSources] = useState<EpicKnowledgeSource[]>([]);
  const [blockedItems, setBlockedItems] = useState<BlockedDownload[]>([]);

  // Split sources into good (non-error) and error
  const goodSources = useMemo(() => sources.filter((s) => s.status !== "error"), [sources]);
  const errorSources = useMemo(() => sources.filter((s) => s.status === "error"), [sources]);

  // ── Auto-expand Knowledge group when navigating to knowledge section ─
  useEffect(() => {
    if (section === "knowledge") {
      setKnowledgeExpanded(true);
    }
  }, [section]);

  // ── Redirect: /knowledge without sub-section → /knowledge/wiki ───────
  useEffect(() => {
    if (section === "knowledge" && !subSection && activeProjectId && epicId) {
      replace(`project/${activeProjectId}/epic/${epicId}/knowledge/wiki`);
    }
  }, [section, subSection, activeProjectId, epicId, replace]);

  // ── Sync active epic to store ────────────────────────────────────────
  useEffect(() => {
    setActiveEpic(epicId || null);
    return () => setActiveEpic(null);
  }, [epicId, setActiveEpic]);

  // ── Fetch epic detail ────────────────────────────────────────────────
  useEffect(() => {
    if (!activeProjectId || !epicId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/epics/${epicId}`,
        );
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setEpic(data.epic);
        } else {
          setError("Epic not found");
        }
      } catch {
        if (!cancelled) setError("Failed to load epic");
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, epicId]);

  // ── Fetch curation reasons ───────────────────────────────────────────
  const fetchCurationReasons = useCallback(async () => {
    if (!activeProjectId || !epicId) return;
    const gen = ++fetchReasonsRef.current;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/curation/reasons`,
      );
      if (gen !== fetchReasonsRef.current) return;
      if (res.ok) {
        const data = await res.json();
        setCurationReasons(data.reasons ?? []);
      }
    } catch {
      /* Silently fail */
    }
  }, [activeProjectId, epicId]);

  useEffect(() => {
    void fetchCurationReasons();
  }, [fetchCurationReasons]);

  useEffect(() => {
    if (!activeProjectId || !epicId) return;
    const interval = setInterval(() => {
      void fetchCurationReasons();
    }, 60_000);
    return () => clearInterval(interval);
  }, [activeProjectId, epicId, fetchCurationReasons]);

  // ── Fetch knowledge data ─────────────────────────────────────────────
  const fetchWikiPages = useCallback(async () => {
    if (!activeProjectId || !epicId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/knowledge/wiki`,
      );
      if (res.ok) {
        const data = await res.json();
        setWikiPages(data.pages ?? []);
      }
    } catch {
      /* silent */
    }
  }, [activeProjectId, epicId]);

  const fetchSources = useCallback(async () => {
    if (!activeProjectId || !epicId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/knowledge/sources`,
      );
      if (res.ok) {
        const data = await res.json();
        setSources(data.sources ?? []);
      }
    } catch {
      /* silent */
    }
  }, [activeProjectId, epicId]);

  const fetchBlocked = useCallback(async () => {
    if (!activeProjectId || !epicId) return;
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/epics/${epicId}/knowledge/blocked`,
      );
      if (res.ok) {
        const data = await res.json();
        setBlockedItems(
          (data.items ?? []).filter(
            (i: BlockedDownload) => i.status === "blocked",
          ),
        );
      }
    } catch {
      /* silent */
    }
  }, [activeProjectId, epicId]);

  useEffect(() => {
    void fetchWikiPages();
    void fetchSources();
    void fetchBlocked();
  }, [fetchWikiPages, fetchSources, fetchBlocked]);

  // ── Navigation handlers ──────────────────────────────────────────────
  const handleBack = useCallback(() => {
    if (activeProjectId) {
      navigate(`project/${activeProjectId}/epics`);
    }
  }, [navigate, activeProjectId]);

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      setSidebarCollapsed(next);
      return next;
    });
  }, []);

  const handleSidebarNavigate = useCallback(
    (sectionPath: string, subItemId?: string) => {
      if (!activeProjectId || !epicId) return;
      const path = subItemId
        ? `project/${activeProjectId}/epic/${epicId}/${sectionPath}/${subItemId}`
        : `project/${activeProjectId}/epic/${epicId}/${sectionPath}`;
      navigate(path);
    },
    [navigate, activeProjectId, epicId],
  );

  // ── Curation handlers ────────────────────────────────────────────────
  const handleStartCuration = useCallback(() => {
    const modelId = getLastModelId();
    if (!modelId) {
      alert(
        "Please select a model in the chat assistant first (use the model picker).",
      );
      return;
    }
    setCurationModelId(modelId);
    setCurationReconnect(false);
    setIsCurating(true);
    setShowCurationModal(false);
  }, []);

  const handleCurationComplete = useCallback(() => {
    setIsCurating(false);
    setCurationModelId(null);
    setCurationReconnect(false);
    void fetchCurationReasons();
    void fetchWikiPages();
    if (activeProjectId && epicId) {
      void (async () => {
        try {
          const res = await fetch(
            `/api/codascope/projects/${activeProjectId}/epics/${epicId}`,
          );
          if (res.ok) {
            const data = await res.json();
            setEpic(data.epic);
          }
        } catch {
          /* ignore */
        }
      })();
    }
  }, [activeProjectId, epicId, fetchCurationReasons, fetchWikiPages]);

  const handleCurationCancel = useCallback(() => {
    setIsCurating(false);
    setCurationModelId(null);
    setCurationReconnect(false);
  }, []);

  // ── Continuous curation build-status poll (detects agent-triggered runs) ──
  useEffect(() => {
    if (!activeProjectId || !epicId) return;
    // Don't poll while we're running SSE-based curation (user-initiated)
    if (isCurating && !curationReconnect) return;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/codascope/projects/${activeProjectId}/build-status?scope=curation::${epicId}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const build = data.build;

        if (build?.status === "building" && !isCurating) {
          // Curation started externally (e.g. agent tool) — enter reconnect mode
          setCurationModelId(build.modelId ?? null);
          setCurationReconnect(true);
          setIsCurating(true);
        } else if (build?.status !== "building" && isCurating && curationReconnect) {
          // Curation finished while we were in reconnect polling — dismiss
          handleCurationComplete();
        }
      } catch { /* silent */ }
    };

    // Initial check immediately
    void poll();
    const id = setInterval(() => void poll(), 3000);
    return () => clearInterval(id);
  }, [activeProjectId, epicId, isCurating, curationReconnect, handleCurationComplete]);

  // ── Source uploaded callback ──────────────────────────────────────────
  const handleSourceUploaded = useCallback(
    (source: EpicKnowledgeSource) => {
      setSources((prev) => [source, ...prev]);
    },
    [],
  );

  // ── Blocked item callbacks ───────────────────────────────────────────
  const handleBlockedDismissed = useCallback(
    (blockId: string) => {
      setBlockedItems((prev) => prev.filter((i) => i.id !== blockId));
      void fetchBlocked();
    },
    [fetchBlocked],
  );

  const handleBlockedResolved = useCallback(
    (blockId: string) => {
      setBlockedItems((prev) => prev.filter((i) => i.id !== blockId));
      void fetchSources();
    },
    [fetchSources],
  );

  // ── Error source callbacks ────────────────────────────────────────────
  const handleErrorSourceResolved = useCallback(
    (sourceId: string) => {
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
      void fetchSources(); // Refetch — new replacement source will appear
    },
    [fetchSources],
  );

  const handleErrorSourceDeleted = useCallback(
    (sourceId: string) => {
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
    },
    [],
  );

  // ── Loading / Error ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="codascope-page">
        <div className="codascope-empty-state">
          <p>Loading epic…</p>
        </div>
      </div>
    );
  }

  if (error || !epic) {
    return (
      <div className="codascope-page">
        <div className="codascope-empty-state">
          <p>{error ?? "Epic not found"}</p>
          <button
            className="codascope-btn codascope-btn-ghost"
            onClick={handleBack}
            type="button"
          >
            ← Back to Epics
          </button>
        </div>
      </div>
    );
  }

  // ── Render content based on active section ───────────────────────────

  let content: React.ReactNode;
  switch (section) {
    case "define":
      content = <EpicDefine epic={epic} setEpic={setEpic} />;
      break;
    case "scope":
      content = <EpicScope epic={epic} setEpic={setEpic} />;
      break;
    case "knowledge":
      switch (subSection) {
        case "wiki":
          content = (
            <EpicKnowledgeWikiView
              epic={epic}
              pageId={activeSubItemId}
              wikiPages={wikiPages}
              sources={sources}
            />
          );
          break;
        case "sources":
          content = (
            <EpicKnowledgeSourcesView
              epic={epic}
              sourceId={activeSubItemId}
              sources={goodSources}
              onSourceUploaded={handleSourceUploaded}
            />
          );
          break;
        case "failed":
          content = (
            <EpicKnowledgeBlockedView
              epic={epic}
              blockedItems={blockedItems}
              errorSources={errorSources}
              onBlockedDismissed={handleBlockedDismissed}
              onBlockedResolved={handleBlockedResolved}
              onErrorSourceResolved={handleErrorSourceResolved}
              onErrorSourceDeleted={handleErrorSourceDeleted}
            />
          );
          break;
        default:
          // Fallback: will be redirected to knowledge/wiki by useEffect above
          content = null;
      }
      break;
    case "design":
      content = <EpicDesignDocs epic={epic} setEpic={setEpic} docId={activeSubItemId} />;
      break;
    case "history":
      content = <EpicHistory epic={epic} setEpic={setEpic} />;
      break;
    default:
      content = <EpicDefine epic={epic} setEpic={setEpic} />;
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="codascope-epic-detail">
      <EpicSidebar
        epic={epic}
        activeSection={activeSection}
        collapsed={collapsed}
        onToggleCollapse={handleToggleCollapse}
        wikiPages={wikiPages}
        designDocs={epic.designDocs.filter((d) => !d.archivedAt)}
        sources={goodSources}
        errorSources={errorSources}
        blockedItems={blockedItems}
        activeSubItemId={activeSubItemId}
        onNavigate={handleSidebarNavigate}
        curationReasons={curationReasons}
        isCurating={isCurating}
        onStartCuration={handleStartCuration}
        onShowReasons={() => setShowCurationModal(true)}
        knowledgeExpanded={knowledgeExpanded}
        onToggleKnowledge={() => setKnowledgeExpanded((prev) => !prev)}
      />

      <div className="codascope-epic-detail-content">
        {/* Curation progress banner */}
        {isCurating && activeProjectId && curationModelId && (
          <CurationProgressBanner
            projectId={activeProjectId}
            epicId={epic.id}
            modelId={curationModelId}
            onComplete={handleCurationComplete}
            onCancel={handleCurationCancel}
            reconnect={curationReconnect}
          />
        )}

        {content}
      </div>

      {/* Curation reasons modal */}
      {showCurationModal && activeProjectId && (
        <CurationReasonsModal
          epicId={epic.id}
          projectId={activeProjectId}
          reasons={curationReasons}
          onCurate={handleStartCuration}
          onClose={() => setShowCurationModal(false)}
        />
      )}
    </div>
  );
}
