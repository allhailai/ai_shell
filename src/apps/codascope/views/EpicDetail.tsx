/* ── CodaScope: EpicDetail View ──────────────────────────────────────
   Tabbed container for a single epic. Manages tab bar and renders
   the active tab component.

   Tabs:
   - Define     — definition document viewer (EpicDefine)
   - Scope      — wiki scope & enrichment
   - Knowledge  — research sources, epic wiki, blocked downloads
   - Design     — design documents
   - History    — version timeline + curation history
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { EpicDefine } from "./EpicDefine";
import { EpicScope } from "./EpicScope";
import { EpicKnowledge } from "./EpicKnowledge";
import { EpicDesignDocs } from "./EpicDesignDocs";
import { EpicHistory } from "./EpicHistory";
import { EpicBriefExport } from "../components/EpicBriefExport";
import { CurateButton } from "../components/CurateButton";
import { CurationReasonsModal } from "../components/CurationReasonsModal";
import { CurationProgressBanner } from "../components/CurationProgressBanner";
import type { EpicDesignDetail, EpicStatus, CurationReason } from "../codaScopeTypes";

/* ── Status badge helper ─────────────────────────────────────────────── */

const STATUS_LABELS: Record<EpicStatus, string> = {
  defining: "Defining",
  curating: "Curating",
  designing: "Designing",
  "in-review": "In Review",
  approved: "Approved",
  archived: "Archived",
};

/* ── Model ID helper ─────────────────────────────────────────────────── */

const MODEL_STORAGE_KEY = "codascope:lastModel";

function getLastModelId(): string | null {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

/* ── Tab definitions ─────────────────────────────────────────────────── */

type EpicTab = "define" | "scope" | "knowledge" | "design" | "history";

const TABS: { id: EpicTab; label: string; enabled: boolean }[] = [
  { id: "define", label: "Define", enabled: true },
  { id: "scope", label: "Scope", enabled: true },
  { id: "knowledge", label: "Knowledge", enabled: true },
  { id: "design", label: "Design", enabled: true },
  { id: "history", label: "History", enabled: true },
];

/* ── Component ───────────────────────────────────────────────────────── */

export function EpicDetail() {
  const { segments, navigate } = useAppSubRoute("codascope");
  const { activeProjectId, setActiveEpic } = useCodaScopeStore();

  // Parse URL: /codascope/project/:id/epic/:epicId/:tab
  const epicId = segments[3] ?? "";
  const activeTab = (segments[4] ?? "define") as EpicTab;

  const [epic, setEpic] = useState<EpicDesignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Curation state
  const [curationReasons, setCurationReasons] = useState<CurationReason[]>([]);
  const [isCurating, setIsCurating] = useState(false);
  const [showCurationModal, setShowCurationModal] = useState(false);
  const [curationModelId, setCurationModelId] = useState<string | null>(null);
  const fetchReasonsRef = useRef(0); // generation counter to avoid stale fetches

  // Sync active epic to store
  useEffect(() => {
    setActiveEpic(epicId || null);
    return () => setActiveEpic(null);
  }, [epicId, setActiveEpic]);

  // Fetch epic detail
  useEffect(() => {
    if (!activeProjectId || !epicId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/codascope/projects/${activeProjectId}/epics/${epicId}`);
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
    return () => { cancelled = true; };
  }, [activeProjectId, epicId]);

  // Fetch curation reasons
  const fetchCurationReasons = useCallback(async () => {
    if (!activeProjectId || !epicId) return;
    const gen = ++fetchReasonsRef.current;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/epics/${epicId}/curation/reasons`);
      if (gen !== fetchReasonsRef.current) return;
      if (res.ok) {
        const data = await res.json();
        setCurationReasons(data.reasons ?? []);
      }
    } catch {
      // Silently fail — reasons are non-critical
    }
  }, [activeProjectId, epicId]);

  useEffect(() => {
    void fetchCurationReasons();
  }, [fetchCurationReasons]);

  // Periodically refresh reasons (every 60 seconds)
  useEffect(() => {
    if (!activeProjectId || !epicId) return;
    const interval = setInterval(() => {
      void fetchCurationReasons();
    }, 60_000);
    return () => clearInterval(interval);
  }, [activeProjectId, epicId, fetchCurationReasons]);

  const handleTabChange = useCallback((tab: EpicTab) => {
    if (activeProjectId && epicId) {
      navigate(`project/${activeProjectId}/epic/${epicId}/${tab}`);
    }
  }, [navigate, activeProjectId, epicId]);

  const handleBack = useCallback(() => {
    if (activeProjectId) {
      navigate(`project/${activeProjectId}/epics`);
    }
  }, [navigate, activeProjectId]);

  // ── Curation handlers ───────────────────────────────────────────────

  const handleStartCuration = useCallback(() => {
    const modelId = getLastModelId();
    if (!modelId) {
      // Fallback: open chat panel to let user select a model first
      // For now, we'll still try — the backend will return an error if no model
      alert("Please select a model in the chat assistant first (use the model picker).");
      return;
    }
    setCurationModelId(modelId);
    setIsCurating(true);
    setShowCurationModal(false);
  }, []);

  const handleCurationComplete = useCallback(() => {
    setIsCurating(false);
    setCurationModelId(null);
    // Refresh epic data and curation reasons
    void fetchCurationReasons();
    if (activeProjectId && epicId) {
      void (async () => {
        try {
          const res = await fetch(`/api/codascope/projects/${activeProjectId}/epics/${epicId}`);
          if (res.ok) {
            const data = await res.json();
            setEpic(data.epic);
          }
        } catch { /* ignore */ }
      })();
    }
  }, [activeProjectId, epicId, fetchCurationReasons]);

  const handleCurationCancel = useCallback(() => {
    setIsCurating(false);
    setCurationModelId(null);
  }, []);

  // ── Loading / Error ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="codascope-page">
        <div className="codascope-empty-state"><p>Loading epic…</p></div>
      </div>
    );
  }

  if (error || !epic) {
    return (
      <div className="codascope-page">
        <div className="codascope-empty-state">
          <p>{error ?? "Epic not found"}</p>
          <button className="codascope-btn codascope-btn-ghost" onClick={handleBack} type="button">
            ← Back to Epics
          </button>
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="codascope-page codascope-epic-detail">
      {/* Breadcrumb header */}
      <div className="codascope-epic-detail-header">
        <button className="codascope-btn codascope-btn-ghost codascope-epic-back-btn" onClick={handleBack} type="button">
          ← Epics
        </button>
        <div className="codascope-epic-detail-title-row">
          <h1 className="codascope-page-title">{epic.title}</h1>
          <span className={`codascope-epic-status-badge codascope-epic-status-badge--${epic.status}`}>
            {STATUS_LABELS[epic.status]}
          </span>
          <CurateButton
            epicId={epic.id}
            reasonCount={curationReasons.length}
            onCurate={handleStartCuration}
            onShowReasons={() => setShowCurationModal(true)}
            curating={isCurating}
          />
          <EpicBriefExport epicId={epic.id} />
        </div>
      </div>

      {/* Curation progress banner */}
      {isCurating && activeProjectId && curationModelId && (
        <CurationProgressBanner
          projectId={activeProjectId}
          epicId={epic.id}
          modelId={curationModelId}
          onComplete={handleCurationComplete}
          onCancel={handleCurationCancel}
        />
      )}

      {/* Tab Bar */}
      <div className="codascope-epic-tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`codascope-epic-tab ${activeTab === tab.id ? "codascope-epic-tab--active" : ""} ${!tab.enabled ? "codascope-epic-tab--disabled" : ""}`}
            onClick={() => tab.enabled && handleTabChange(tab.id)}
            disabled={!tab.enabled}
            type="button"
          >
            {tab.label}
            {!tab.enabled && <span className="codascope-epic-tab-coming-soon">Soon</span>}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="codascope-epic-tab-content">
        {activeTab === "define" && <EpicDefine epic={epic} setEpic={setEpic} />}
        {activeTab === "scope" && <EpicScope epic={epic} setEpic={setEpic} />}
        {activeTab === "knowledge" && <EpicKnowledge epic={epic} setEpic={setEpic} />}
        {activeTab === "design" && <EpicDesignDocs epic={epic} setEpic={setEpic} />}
        {activeTab === "history" && <EpicHistory epic={epic} setEpic={setEpic} />}
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
