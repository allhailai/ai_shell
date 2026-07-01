/* ── CodaScope: EpicDetail View ──────────────────────────────────────
   Tabbed container for a single epic. Manages tab bar and renders
   the active tab component.

   Tabs (P0 ships Define only — others show placeholder empty states):
   - Define  — definition document viewer (EpicDefine)
   - Scope   — wiki scope & enrichment (P1)
   - Design  — design documents (P2a)
   - History  — version timeline (P2a)
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { EpicDefine } from "./EpicDefine";
import { EpicScope } from "./EpicScope";
import { EpicDesignDocs } from "./EpicDesignDocs";
import { EpicHistory } from "./EpicHistory";
import type { EpicDesignDetail, EpicStatus } from "../codaScopeTypes";

/* ── Status badge helper ─────────────────────────────────────────────── */

const STATUS_LABELS: Record<EpicStatus, string> = {
  defining: "Defining",
  scoping: "Scoping",
  designing: "Designing",
  "in-review": "In Review",
  approved: "Approved",
  archived: "Archived",
};

/* ── Tab definitions ─────────────────────────────────────────────────── */

type EpicTab = "define" | "scope" | "design" | "history";

const TABS: { id: EpicTab; label: string; enabled: boolean }[] = [
  { id: "define", label: "Define", enabled: true },
  { id: "scope", label: "Scope", enabled: true },
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
        </div>
      </div>

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
        {activeTab === "design" && <EpicDesignDocs epic={epic} setEpic={setEpic} />}
        {activeTab === "history" && <EpicHistory epic={epic} setEpic={setEpic} />}
      </div>
    </div>
  );
}


/* ── Placeholder Tab ─────────────────────────────────────────────────── */

function PlaceholderTab({ title, description }: { title: string; description: string }) {
  return (
    <div className="codascope-empty-state">
      <h3>{title}</h3>
      <p style={{ maxWidth: 440, lineHeight: 1.6 }}>{description}</p>
      <span className="codascope-epic-tab-coming-soon" style={{ fontSize: "var(--text-sm)", marginTop: "var(--space-2)" }}>
        Coming in a future phase
      </span>
    </div>
  );
}

