/* ── CodaScope: ProjectDashboard View ────────────────────────────────
   Overview dashboard for a selected project with stat cards,
   quick actions, and model picker.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";

const AVAILABLE_MODELS = [
  "claude-sonnet",
  "claude-opus",
  "gpt-4o",
  "gpt-4o-mini",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
];

export function ProjectDashboard() {
  const { navigate } = useAppSubRoute("codascope");
  const {
    projects,
    activeProjectId,
    selectedModel,
    setSelectedModel,
    agentRunning,
    agentStatus,
    setAgentRunning,
    setAgentStatus,
  } = useCodaScopeStore();

  const project = projects.find((p) => p.id === activeProjectId);
  const [runResult, setRunResult] = useState<string | null>(null);

  // ── Load user's last model preference ─────────────────────────────

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/secrets/user/codascope_model");
        if (res.ok) {
          const data = await res.json();
          if (data.value) setSelectedModel(data.value);
        }
      } catch {
        // Use default
      }
    })();
  }, [setSelectedModel]);

  const handleModelChange = useCallback(async (model: string) => {
    setSelectedModel(model);
    try {
      await fetch("/api/secrets/user/codascope_model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: model }),
      });
    } catch {
      // Best effort
    }
  }, [setSelectedModel]);

  // ── Quick actions ─────────────────────────────────────────────────

  const handleQuickAction = useCallback(async (command: string) => {
    if (agentRunning || !activeProjectId) return;
    setAgentRunning(true);
    setAgentStatus(`Running ${command}…`);
    setRunResult(null);
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, model: selectedModel }),
      });
      if (res.ok) {
        const data = await res.json();
        setRunResult(data.message ?? "Agent run started.");
      } else {
        const data = await res.json().catch(() => ({}));
        setRunResult(data.error ?? "Failed to start agent.");
      }
    } catch {
      setRunResult("Network error.");
    } finally {
      setAgentRunning(false);
      setAgentStatus("");
    }
  }, [agentRunning, activeProjectId, selectedModel, setAgentRunning, setAgentStatus]);

  if (!project) {
    return (
      <div className="codascope-empty-state">
        <div className="codascope-empty-state-icon">📁</div>
        <div className="codascope-empty-state-title">No Project Selected</div>
        <div className="codascope-empty-state-text">
          Select a project from the left navigation to view its dashboard.
        </div>
      </div>
    );
  }

  return (
    <div className="codascope-page">
      <div className="codascope-page-header">
        <div>
          <div className="codascope-page-title">{project.name}</div>
          <div className="codascope-page-subtitle">{project.description}</div>
        </div>

        {/* Model picker */}
        <div className="codascope-model-picker">
          <span className="codascope-model-picker-label">Model:</span>
          <select
            className="codascope-model-picker-select"
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
          >
            {AVAILABLE_MODELS.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Stat cards */}
      <div className="codascope-dashboard-grid">
        <div className="codascope-stat-card">
          <div className="codascope-stat-card-icon">📦</div>
          <div className="codascope-stat-card-value">{project.repositories.length}</div>
          <div className="codascope-stat-card-label">Repositories</div>
        </div>
        <div className="codascope-stat-card" onClick={() => navigate(`project/${activeProjectId}/wiki`)} style={{ cursor: "pointer" }}>
          <div className="codascope-stat-card-icon">📖</div>
          <div className="codascope-stat-card-value">{project.wikiPageCount ?? 0}</div>
          <div className="codascope-stat-card-label">Wiki Pages</div>
        </div>
        <div className="codascope-stat-card">
          <div className="codascope-stat-card-icon">📊</div>
          <div className="codascope-stat-card-value">{project.qualityScore ?? "—"}</div>
          <div className="codascope-stat-card-label">Quality Score</div>
        </div>
        <div className="codascope-stat-card" onClick={() => navigate(`project/${activeProjectId}/concepts`)} style={{ cursor: "pointer" }}>
          <div className="codascope-stat-card-icon">🧩</div>
          <div className="codascope-stat-card-value">{project.conceptCount ?? 0}</div>
          <div className="codascope-stat-card-label">Concepts</div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="codascope-page-header" style={{ marginBottom: "var(--space-4)" }}>
        <div className="codascope-page-title" style={{ fontSize: "var(--text-md)" }}>Quick Actions</div>
      </div>
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        <button
          className="codascope-btn codascope-btn-primary"
          onClick={() => handleQuickAction("do_build_full_wiki")}
          disabled={agentRunning}
          type="button"
        >
          📖 Build Full Wiki
        </button>
        <button
          className="codascope-btn codascope-btn-secondary"
          onClick={() => handleQuickAction("do_explore")}
          disabled={agentRunning}
          type="button"
        >
          🔍 Explore Codebase
        </button>
        <button
          className="codascope-btn codascope-btn-secondary"
          onClick={() => navigate(`project/${activeProjectId}/chat`)}
          type="button"
        >
          💬 Chat with Code
        </button>
        <button
          className="codascope-btn codascope-btn-secondary"
          onClick={() => handleQuickAction("do_quality_scan")}
          disabled={agentRunning}
          type="button"
        >
          📊 Run Quality Scan
        </button>
      </div>

      {/* Agent status / result */}
      {agentRunning && (
        <div className="codascope-status-badge codascope-status-badge--running" style={{ marginBottom: "var(--space-3)" }}>
          ● {agentStatus || "Running…"}
        </div>
      )}
      {runResult && !agentRunning && (
        <div style={{
          padding: "var(--space-3) var(--space-4)",
          borderRadius: "var(--radius-md)",
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-primary)",
          fontSize: "var(--text-sm)",
          color: "var(--color-text-secondary)",
          marginBottom: "var(--space-4)",
        }}>
          {runResult}
        </div>
      )}

      {/* Repositories */}
      <div className="codascope-page-header" style={{ marginBottom: "var(--space-3)" }}>
        <div className="codascope-page-title" style={{ fontSize: "var(--text-md)" }}>Repositories</div>
      </div>
      {project.repositories.length === 0 ? (
        <div style={{
          padding: "var(--space-5)",
          textAlign: "center",
          color: "var(--color-text-tertiary)",
          fontSize: "var(--text-sm)",
        }}>
          No repositories added yet. Go to Settings to add code repositories.
        </div>
      ) : (
        <div className="codascope-cards">
          {project.repositories.map((repo) => (
            <div key={repo.id} className="codascope-card" style={{ cursor: "default" }}>
              <div className="codascope-card-title">{repo.name}</div>
              <div className="codascope-card-desc" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
                {repo.path}
              </div>
              {repo.branch && (
                <div className="codascope-card-stats">
                  <div className="codascope-card-stat">
                    <div className="codascope-card-stat-value">{repo.branch}</div>
                    <div className="codascope-card-stat-label">Branch</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
