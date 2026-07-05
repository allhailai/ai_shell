/* ── CodaScope: ProjectDashboard View ────────────────────────────────
   Overview dashboard for a selected project with stat cards,
   repository status panel, unified Analyze panel with toggles,
   build state persistence, pipeline progress tracking, and model picker.

   Build state features:
   - Button disables and shows progress during analysis
   - Checks server build status on mount (survives refresh)
   - Reconnects to SSE stream on refresh to resume live output
   - Shows build history with auto-generated summaries
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect } from "react";
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
  IconGitPull,
  IconCheck,
  IconRefresh,
  IconWarning,
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

/* ── Repo status types ───────────────────────────────────────────────── */

interface RepoStatus {
  status: "current" | "behind" | "ahead" | "diverged" | "unknown";
  behind: number;
  ahead: number;
  branch: string | null;
  error?: string;
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

  // ── Repo status state ─────────────────────────────────────────────
  const [repoStatuses, setRepoStatuses] = useState<Record<string, RepoStatus>>({});
  const [checkingRepoId, setCheckingRepoId] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [pullingRepoId, setPullingRepoId] = useState<string | null>(null);
  const [pullResult, setPullResult] = useState<{
    repoId: string;
    success: boolean;
    message: string;
  } | null>(null);

  // ── Check status for a single repo ─────────────────────────────────
  const checkRepoStatus = useCallback(async (repoId: string) => {
    if (!activeProjectId) return;
    setCheckingRepoId(repoId);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/repositories/${repoId}/status`
      );
      const data = await res.json() as RepoStatus;
      setRepoStatuses((prev) => ({ ...prev, [repoId]: data }));
    } catch {
      setRepoStatuses((prev) => ({
        ...prev,
        [repoId]: { status: "unknown", behind: 0, ahead: 0, branch: null, error: "Network error." },
      }));
    } finally {
      setCheckingRepoId(null);
    }
  }, [activeProjectId]);

  // ── Check all repos on mount ──────────────────────────────────────
  useEffect(() => {
    if (!activeProjectId || !project?.repositories.length) return;
    setCheckingAll(true);
    let cancelled = false;

    (async () => {
      for (const repo of project.repositories) {
        if (cancelled) break;
        try {
          const res = await fetch(
            `/api/codascope/projects/${activeProjectId}/repositories/${repo.id}/status`
          );
          const data = await res.json() as RepoStatus;
          if (!cancelled) {
            setRepoStatuses((prev) => ({ ...prev, [repo.id]: data }));
          }
        } catch {
          if (!cancelled) {
            setRepoStatuses((prev) => ({
              ...prev,
              [repo.id]: { status: "unknown", behind: 0, ahead: 0, branch: null, error: "Network error." },
            }));
          }
        }
      }
      if (!cancelled) setCheckingAll(false);
    })();

    return () => { cancelled = true; };
  }, [activeProjectId, project?.repositories.length]);

  // ── Git pull handler ──────────────────────────────────────────────
  const handleGitPull = useCallback(async (repoId: string) => {
    if (!activeProjectId || pullingRepoId) return;
    setPullingRepoId(repoId);
    setPullResult(null);
    try {
      const res = await fetch(
        `/api/codascope/projects/${activeProjectId}/repositories/${repoId}/pull`,
        { method: "POST" }
      );
      const data = await res.json();
      if (data.success) {
        setPullResult({ repoId, success: true, message: data.output || "Already up to date." });
        // Refresh project to pick up any branch changes
        const projRes = await fetch(`/api/codascope/projects/${activeProjectId}`);
        if (projRes.ok) {
          const projData = await projRes.json();
          useCodaScopeStore.getState().setProjects(
            projects.map((p) => (p.id === activeProjectId ? projData.project : p))
          );
        }
        // Update status to current after successful pull
        setRepoStatuses((prev) => ({
          ...prev,
          [repoId]: { status: "current", behind: 0, ahead: 0, branch: data.branch ?? prev[repoId]?.branch ?? null },
        }));
      } else {
        setPullResult({ repoId, success: false, message: data.error || "Pull failed." });
      }
    } catch (err) {
      setPullResult({
        repoId,
        success: false,
        message: err instanceof Error ? err.message : "Network error.",
      });
    } finally {
      setPullingRepoId(null);
      setTimeout(() => setPullResult(null), 5000);
    }
  }, [activeProjectId, pullingRepoId, projects]);

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

  /* ── Repo status badge helper ────────────────────────────────── */

  const hasAnyBehind = project.repositories.some((r) => repoStatuses[r.id]?.status === "behind");

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

      {/* ── Repositories Panel ───────────────────────────────────────── */}
      {project.repositories.length > 0 && (
        <div className="codascope-repo-panel" id="repo-panel">
          <div className="codascope-repo-panel-header">
            <div className="codascope-repo-panel-title">
              <IconPackage size={14} />
              Repositories
            </div>
            <button
              className="codascope-btn codascope-btn-sm codascope-btn-ghost"
              onClick={() => {
                setCheckingAll(true);
                setRepoStatuses({});
                (async () => {
                  for (const repo of project.repositories) {
                    try {
                      const res = await fetch(
                        `/api/codascope/projects/${activeProjectId}/repositories/${repo.id}/status`
                      );
                      const data = await res.json() as RepoStatus;
                      setRepoStatuses((prev) => ({ ...prev, [repo.id]: data }));
                    } catch { /* ignore */ }
                  }
                  setCheckingAll(false);
                })();
              }}
              disabled={checkingAll || !!pullingRepoId}
              title="Refresh remote status"
              type="button"
            >
              <IconRefresh size={12} className={checkingAll ? "codascope-spin" : ""} />
              {checkingAll ? "Checking…" : "Check Remote"}
            </button>
          </div>

          <div className="codascope-repo-list">
            {project.repositories.map((repo) => {
              const st = repoStatuses[repo.id];
              const isChecking = checkingRepoId === repo.id || (!st && checkingAll);
              const isPulling = pullingRepoId === repo.id;
              const result = pullResult?.repoId === repo.id ? pullResult : null;

              return (
                <div key={repo.id} className="codascope-repo-row">
                  {/* Name */}
                  <div className="codascope-repo-row-name" title={repo.path}>
                    {repo.name}
                  </div>

                  {/* Branch */}
                  <div className="codascope-repo-row-branch">
                    {repo.branch ?? "—"}
                  </div>

                  {/* Status badge */}
                  <div className="codascope-repo-row-status">
                    {isChecking ? (
                      <span className="codascope-repo-badge codascope-repo-badge-checking">
                        <IconRefresh size={11} className="codascope-spin" /> Checking…
                      </span>
                    ) : isPulling ? (
                      <span className="codascope-repo-badge codascope-repo-badge-pulling">
                        <IconGitPull size={11} className="codascope-spin" /> Pulling…
                      </span>
                    ) : result?.success ? (
                      <span className="codascope-repo-badge codascope-repo-badge-current">
                        <IconCheck size={11} /> Pulled
                      </span>
                    ) : result && !result.success ? (
                      <span className="codascope-repo-badge codascope-repo-badge-error" title={result.message}>
                        <IconWarning size={11} /> Failed
                      </span>
                    ) : st?.status === "current" ? (
                      <span className="codascope-repo-badge codascope-repo-badge-current">
                        <IconCheck size={11} /> Up to date
                      </span>
                    ) : st?.status === "behind" ? (
                      <span className="codascope-repo-badge codascope-repo-badge-behind">
                        <IconGitPull size={11} /> {st.behind} commit{st.behind !== 1 ? "s" : ""} behind
                      </span>
                    ) : st?.status === "ahead" ? (
                      <span className="codascope-repo-badge codascope-repo-badge-ahead">
                        {st.ahead} ahead
                      </span>
                    ) : st?.status === "diverged" ? (
                      <span className="codascope-repo-badge codascope-repo-badge-diverged">
                        <IconWarning size={11} /> {st.behind}↓ {st.ahead}↑
                      </span>
                    ) : st?.error ? (
                      <span className="codascope-repo-badge codascope-repo-badge-unknown" title={st.error}>
                        {st.error}
                      </span>
                    ) : (
                      <span className="codascope-repo-badge codascope-repo-badge-unknown">
                        —
                      </span>
                    )}
                  </div>

                  {/* Pull button — only show when behind */}
                  <div className="codascope-repo-row-action">
                    {st?.status === "behind" && !isPulling && !result?.success && (
                      <button
                        className="codascope-btn codascope-btn-sm codascope-repo-pull-action"
                        onClick={() => handleGitPull(repo.id)}
                        disabled={!!pullingRepoId || agentRunning}
                        title={`Pull ${st.behind} commit${st.behind !== 1 ? "s" : ""} from remote`}
                        type="button"
                      >
                        <IconGitPull size={12} /> Pull
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hint if repos are behind */}
          {hasAnyBehind && (
            <div className="codascope-repo-panel-hint">
              Pull remote changes before analyzing to ensure your wiki and quality scans reflect the latest code.
            </div>
          )}
        </div>
      )}

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
    </div>
  );
}

