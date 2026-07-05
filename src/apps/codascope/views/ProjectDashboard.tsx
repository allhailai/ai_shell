/* ── CodaScope: ProjectDashboard View ────────────────────────────────
   Overview dashboard for a selected project with stat cards,
   unified Analyze panel with toggles, build state persistence,
   pipeline progress tracking, and model picker.

   Build state features:
   - Button disables and shows progress during analysis
   - Checks server build status on mount (survives refresh)
   - Reconnects to SSE stream on refresh to resume live output
   - Shows build history with auto-generated summaries
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { ModelPicker } from "../components/ModelPicker";
import {
  IconCodeMap,
  IconWiki,
  IconQuality,
  IconFolder,
  IconSearch,
  IconPackage,
  IconConcepts,
  IconChat,
  IconRules,
} from "../components/CodaScopeIcons";
import { useDashboardBuildState } from "../hooks/useDashboardBuildState";
import type { PipelineStepStatus } from "../codaScopeTypes";

/** Format a relative timestamp (e.g., "2m 15s ago") */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m ago`;
}

/* ── Step Icon helpers ───────────────────────────────────────────────── */

function stepIcon(status: PipelineStepStatus): string {
  switch (status) {
    case "running": return "⟳";
    case "complete": return "✓";
    case "skipped": return "—";
    case "error": return "✕";
    default: return "○";
  }
}

/* ── Component ───────────────────────────────────────────────────────── */

export function ProjectDashboard() {
  const { navigate } = useAppSubRoute("codascope");
  const {
    projects,
    activeProjectId,
    selectedModel,
    setSelectedModel,
    agentRunning,
    setAgentRunning,
    setAgentStatus,
  } = useCodaScopeStore();

  const project = projects.find((p) => p.id === activeProjectId);

  // ── Extracted build state hook ─────────────────────────────────────
  const build = useDashboardBuildState(
    activeProjectId,
    setAgentRunning,
    setAgentStatus,
    agentRunning,
    selectedModel,
  );

  // ── Analyze toggle state ──────────────────────────────────────────
  const [wikiEnabled, setWikiEnabled] = useState(true);
  const [wikiMode, setWikiMode] = useState<"auto" | "full">("auto");
  const [qualityEnabled, setQualityEnabled] = useState(true);
  const [scope, setScope] = useState("full");

  // ── Unified Analyze action ────────────────────────────────────────

  const handleAnalyze = useCallback(() => {
    build.startBuildStream({
      target: {
        url: `/api/codascope/projects/${activeProjectId}/analyze`,
        method: "POST",
        body: {
          modelId: selectedModel,
          wiki: wikiEnabled ? wikiMode : false,
          quality: qualityEnabled,
          scope,
        },
      },
      command: "analyze",
      showPipeline: true,
    });
  }, [activeProjectId, selectedModel, wikiEnabled, wikiMode, qualityEnabled, scope, build]);

  // ── Quick action (for individual commands like do_explore) ────────

  const handleQuickAction = useCallback((command: string) => {
    build.startBuildStream({
      target: {
        url: `/api/codascope/projects/${activeProjectId}/runs`,
        method: "POST",
        body: { command, modelId: selectedModel },
      },
      command,
      showPipeline: false,
    });
  }, [activeProjectId, selectedModel, build]);

  if (!project) {
    return (
      <div className="codascope-empty-state">
        <div className="codascope-empty-state-icon"><IconFolder size={32} /></div>
        <div className="codascope-empty-state-title">No Project Selected</div>
        <div className="codascope-empty-state-text">
          Select a project from the left navigation to view its dashboard.
        </div>
      </div>
    );
  }

  /* ── Button label for Analyze ────────────────────────────────── */

  const analyzeButtonLabel = build.isAnalyzing
    ? `⟳ Analyzing… (${build.elapsed})`
    : "Run ▶";

  return (
    <div className="codascope-page">
      <div className="codascope-page-header">
        <div>
          <div className="codascope-page-title">{project.name}</div>
          <div className="codascope-page-subtitle">{project.description}</div>
        </div>

        {/* Model picker — fetches from Cursor SDK */}
        <ModelPicker value={selectedModel} onChange={setSelectedModel} compact />
      </div>

      {/* Stat cards */}
      <div className="codascope-dashboard-grid">
        <div className="codascope-stat-card">
          <div className="codascope-stat-card-icon"><IconPackage size={20} /></div>
          <div className="codascope-stat-card-value">{project.repositories.length}</div>
          <div className="codascope-stat-card-label">Repositories</div>
        </div>
        <div className="codascope-stat-card codascope-stat-card--clickable" onClick={() => navigate(`project/${activeProjectId}/wiki`)}>
          <div className="codascope-stat-card-icon"><IconWiki size={20} /></div>
          <div className="codascope-stat-card-value">{project.wikiPageCount ?? 0}</div>
          <div className="codascope-stat-card-label">Wiki Pages</div>
        </div>
        <div className="codascope-stat-card codascope-stat-card--clickable" onClick={() => navigate(`project/${activeProjectId}/quality`)}>
          <div className="codascope-stat-card-icon"><IconQuality size={20} /></div>
          <div className="codascope-stat-card-value">{project.qualityScore ?? "—"}</div>
          <div className="codascope-stat-card-label">Quality Score</div>
        </div>
        <div className="codascope-stat-card codascope-stat-card--clickable" onClick={() => navigate(`project/${activeProjectId}/concepts`)}>
          <div className="codascope-stat-card-icon"><IconConcepts size={20} /></div>
          <div className="codascope-stat-card-value">{project.conceptCount ?? 0}</div>
          <div className="codascope-stat-card-label">Concepts</div>
        </div>
      </div>

      {/* ── Unified Analyze Panel ──────────────────────────────────── */}
      <div className={`codascope-analyze-panel ${build.isAnalyzing ? "codascope-analyze-panel--running" : ""}`} id="analyze-panel">
        <div className="codascope-analyze-header">
          <div className="codascope-analyze-title">
            <span className="codascope-analyze-title-icon"><IconSearch size={16} /></span>
            Analyze Codebase
          </div>
          {agentRunning ? (
            <button
              className="codascope-analyze-run-btn codascope-analyze-run-btn--stop"
              onClick={build.cancelBuild}
              type="button"
              id="analyze-stop-btn"
            >
              ■ Stop
            </button>
          ) : (
            <button
              className={`codascope-analyze-run-btn ${build.isAnalyzing ? "codascope-analyze-run-btn--running" : ""}`}
              onClick={handleAnalyze}
              disabled={!selectedModel}
              type="button"
              id="analyze-run-btn"
            >
              {analyzeButtonLabel}
            </button>
          )}
        </div>

        <div className="codascope-analyze-body">
          {/* Code Map — always on */}
          <div className="codascope-analyze-toggles">
            <div className="codascope-analyze-toggle-row">
              <div className="codascope-analyze-toggle-label">
                <span className="codascope-analyze-toggle-icon"><IconCodeMap size={16} /></span>
                <span className="codascope-analyze-toggle-text">
                  Code Map
                  <span className="codascope-analyze-toggle-sub">always</span>
                </span>
              </div>
              <div className="codascope-analyze-toggle-right">
                <span className="codascope-analyze-toggle-fixed">auto-skips if fresh</span>
              </div>
            </div>

            {/* Wiki toggle */}
            <div className="codascope-analyze-toggle-row">
              <div className="codascope-analyze-toggle-label">
                <span className="codascope-analyze-toggle-icon"><IconWiki size={16} /></span>
                <span className="codascope-analyze-toggle-text">Wiki</span>
              </div>
              <div className="codascope-analyze-toggle-right">
                {wikiEnabled && (
                  <select
                    className="codascope-analyze-mode-select"
                    value={wikiMode}
                    onChange={(e) => setWikiMode(e.target.value as "auto" | "full")}
                    disabled={agentRunning}
                    id="wiki-mode-select"
                  >
                    <option value="auto">Auto</option>
                    <option value="full">Full Rebuild</option>
                  </select>
                )}
                <label className="codascope-rule-toggle codascope-analyze-toggle">
                  <input
                    type="checkbox"
                    checked={wikiEnabled}
                    onChange={(e) => setWikiEnabled(e.target.checked)}
                    disabled={agentRunning}
                  />
                  <span className="codascope-rule-toggle-track" />
                </label>
              </div>
            </div>

            {/* Quality toggle */}
            <div className="codascope-analyze-toggle-row">
              <div className="codascope-analyze-toggle-label">
                <span className="codascope-analyze-toggle-icon"><IconQuality size={16} /></span>
                <span className="codascope-analyze-toggle-text">Quality</span>
              </div>
              <div className="codascope-analyze-toggle-right">
                <label className="codascope-rule-toggle codascope-analyze-toggle">
                  <input
                    type="checkbox"
                    checked={qualityEnabled}
                    onChange={(e) => setQualityEnabled(e.target.checked)}
                    disabled={agentRunning}
                  />
                  <span className="codascope-rule-toggle-track" />
                </label>
              </div>
            </div>
          </div>

          {/* Scope selector */}
          <div className="codascope-analyze-scope-row">
            <span className="codascope-analyze-scope-label">Scope</span>
            <select
              className="codascope-analyze-scope-select"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={agentRunning}
              id="analyze-scope-select"
            >
              <option value="full">Full Repository</option>
              <option value="backend">Backend Only</option>
              <option value="frontend">Frontend Only</option>
              <option value="security">Security Focus</option>
            </select>
          </div>
        </div>

        {/* Footer with Code Map freshness info */}
        <div className="codascope-analyze-footer">
          <div className="codascope-analyze-footer-info">
            <span className="codascope-analyze-footer-info-icon">ⓘ</span>
            <span>Code Map auto-rebuilds when repository HEAD changes</span>
          </div>
        </div>
      </div>

      {/* ── Pipeline Progress ────────────────────────────────────────── */}
      {build.showPipeline && build.pipelineSteps.length > 0 && (
        <div className="codascope-pipeline-progress" id="pipeline-progress">
          <div className="codascope-pipeline-header">
            <div className="codascope-pipeline-title">
              {build.isAnalyzing ? "⟳" : "✓"} Analysis Pipeline
            </div>
            {build.isAnalyzing && (
              <span className="codascope-pipeline-elapsed">{build.elapsed}</span>
            )}
            {!build.isAnalyzing && (
              <button
                className="codascope-btn codascope-btn-ghost codascope-pipeline-dismiss-btn"
                onClick={build.clearPipeline}
                type="button"
              >
                Dismiss
              </button>
            )}
          </div>
          <div className="codascope-pipeline-steps">
            {build.pipelineSteps.map((step) => (
              <div
                key={step.id}
                className={`codascope-pipeline-step codascope-pipeline-step--${step.status}`}
              >
                <div className="codascope-pipeline-step-icon">
                  {stepIcon(step.status as PipelineStepStatus)}
                </div>
                <div className="codascope-pipeline-step-label">{step.label}</div>
                {step.detail && (
                  <div className="codascope-pipeline-step-detail">{step.detail}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick Links ──────────────────────────────────────────────── */}
      <div className="codascope-quick-links">
        <button
          className="codascope-quick-link"
          onClick={() => navigate(`project/${activeProjectId}/chat`)}
          type="button"
        >
          <IconChat size={14} /> Chat with Code
        </button>
        <button
          className="codascope-quick-link"
          onClick={() => navigate(`project/${activeProjectId}/wiki`)}
          type="button"
        >
          <IconWiki size={14} /> Browse Wiki
        </button>
        <button
          className="codascope-quick-link"
          onClick={() => navigate(`project/${activeProjectId}/quality`)}
          type="button"
        >
          <IconQuality size={14} /> Quality Dashboard
        </button>
        <button
          className="codascope-quick-link"
          onClick={() => navigate(`project/${activeProjectId}/rules`)}
          type="button"
        >
          <IconRules size={14} /> Golden Rules
        </button>
        <button
          className="codascope-quick-link"
          onClick={() => navigate(`project/${activeProjectId}/concepts`)}
          type="button"
        >
          <IconConcepts size={14} /> Concepts
        </button>
        <button
          className="codascope-quick-link"
          onClick={() => handleQuickAction("do_explore")}
          disabled={agentRunning || !selectedModel}
          type="button"
        >
          <IconSearch size={14} /> Explore Only
        </button>
      </div>

      {/* Build status banner */}
      {build.buildSummary && !agentRunning && (
        <div className="codascope-alert codascope-alert--success codascope-dashboard-alert">
          <span className="codascope-alert-icon">✓</span>
          <span>{build.buildSummary}</span>
          <button
            className="codascope-alert-dismiss"
            onClick={() => build.setBuildSummary(null)}
            type="button"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error alert */}
      {build.runError && !agentRunning && (
        <div className="codascope-alert codascope-alert--danger codascope-dashboard-alert">
          <span className="codascope-alert-icon">⚠</span>
          <span>{build.runError}</span>
          <button
            className="codascope-alert-dismiss"
            onClick={() => build.setRunError("")}
            type="button"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Run output log */}
      {(build.runOutput || agentRunning) && (
        <div className="codascope-build-log codascope-dashboard-build-log">
          <div className="codascope-build-log-header">
            <span>
              {agentRunning
                ? `⟳ Agent Output — ${build.elapsed}`
                : "✓ Complete"}
            </span>
            {!agentRunning && (
              <button
                className="codascope-btn codascope-btn-ghost codascope-pipeline-dismiss-btn"
                onClick={build.clearRunOutput}
                type="button"
              >
                Dismiss
              </button>
            )}
          </div>
          <pre className="codascope-build-log-content">
            {build.runOutput || (agentRunning ? "Connecting to build stream…\n" : "")}
            <div ref={build.logEndRef} />
          </pre>
        </div>
      )}

      {/* Build History */}
      {build.buildLogs.length > 0 && (
        <>
          <div className="codascope-page-header codascope-dashboard-section-header">
            <div className="codascope-page-title codascope-dashboard-section-title">
              Build History
            </div>
          </div>
          <div className="codascope-dashboard-build-history">
            {build.buildLogs.map((log, i) => (
              <div
                key={log.runId}
                className={`codascope-dashboard-build-history-row${i < build.buildLogs.length - 1 ? "" : " codascope-dashboard-build-history-row--last"}`}
              >
                <div className="codascope-dashboard-build-history-left">
                  <span className={`codascope-dashboard-build-history-status codascope-dashboard-build-history-status--${log.status}`}>
                    {log.status === "complete" ? "✓" : log.status === "error" ? "✕" : "●"}
                  </span>
                  <span>{log.summary ?? log.command}</span>
                </div>
                <span className="codascope-dashboard-build-history-time">
                  {log.startedAt ? timeAgo(log.startedAt) : ""}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Repositories */}
      <div className="codascope-page-header codascope-dashboard-section-header">
        <div className="codascope-page-title codascope-dashboard-section-title">Repositories</div>
      </div>
      {project.repositories.length === 0 ? (
        <div className="codascope-dashboard-empty-repos">
          No repositories added yet. Go to Settings to add code repositories.
        </div>
      ) : (
        <div className="codascope-cards">
          {project.repositories.map((repo) => (
            <div key={repo.id} className="codascope-card codascope-card--static">
              <div className="codascope-card-title">{repo.name}</div>
              <div className="codascope-card-desc codascope-card-desc--mono">
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
