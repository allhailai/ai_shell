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

import { useState, useCallback, useEffect, useRef } from "react";
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
import { connectToSseStream } from "../codaScopeSseClient";
import type { BuildState, BuildLogEntry, PipelineStepStatus, PipelineStepRecord } from "../codaScopeTypes";

// Local alias for template simplicity
type PipelineStep = PipelineStepRecord;



/** Format a relative timestamp (e.g., "2m 15s ago") */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m ago`;
}

/** Format elapsed time from a start timestamp */
function elapsedSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
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
  const [runOutput, setRunOutput] = useState("");
  const [runError, setRunError] = useState("");
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [buildStartedAt, setBuildStartedAt] = useState<string | null>(null);
  const [buildSummary, setBuildSummary] = useState<string | null>(null);
  const [buildLogs, setBuildLogs] = useState<BuildLogEntry[]>([]);
  const [elapsed, setElapsed] = useState("");
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<AbortController | null>(null);

  // ── Analyze toggle state ──────────────────────────────────────────
  const [wikiEnabled, setWikiEnabled] = useState(true);
  const [wikiMode, setWikiMode] = useState<"auto" | "full">("auto");
  const [qualityEnabled, setQualityEnabled] = useState(true);
  const [scope, setScope] = useState("full");

  // ── Pipeline progress ─────────────────────────────────────────────
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([]);
  const [showPipeline, setShowPipeline] = useState(false);

  // ── Check build status on mount ──────────────────────────────────

  useEffect(() => {
    if (!activeProjectId) return;

    void (async () => {
      try {
        const res = await fetch(`/api/codascope/projects/${activeProjectId}/build-status`);
        if (!res.ok) return;
        const { build } = await res.json() as { build: BuildState | null };

        if (build && build.status === "building") {
          // A build is running! Reconnect to the stream
          setRunningCommand(build.command);
          setBuildStartedAt(build.startedAt);
          setAgentRunning(true);
          setAgentStatus(`Resuming ${build.command}…`);
          setShowPipeline(true);

          // Restore persisted pipeline steps immediately
          if (build.pipelineSteps && build.pipelineSteps.length > 0) {
            setPipelineSteps(build.pipelineSteps.map((s) => ({
              id: s.id,
              label: s.label,
              status: s.status as PipelineStepStatus,
              detail: s.detail,
            })));
          }

          const controller = connectToSseStream(
            `/api/codascope/projects/${activeProjectId}/build-log/${build.runId}/stream`,
            {
              onText: (text) => setRunOutput((prev) => prev + text),
              onPipelineStep: (step) => {
                setPipelineSteps((prev) => updatePipelineSteps(prev, step));
              },
              onDone: (summary) => {
                setAgentRunning(false);
                setAgentStatus("");
                setRunningCommand(null);
                setBuildSummary(summary);
                refreshBuildLogs();
              },
              onError: (error) => {
                setRunError(error);
                setAgentRunning(false);
                setAgentStatus("");
                setRunningCommand(null);
              },
            },
          );
          streamRef.current = controller;
        } else if (build && (build.status === "complete" || build.status === "error")) {
          // Show last build result
          setBuildSummary(build.summary);
          if (build.error) setRunError(build.error);
          // Restore pipeline steps from completed/errored build
          if (build.pipelineSteps && build.pipelineSteps.length > 0) {
            setPipelineSteps(build.pipelineSteps.map((s) => ({
              id: s.id,
              label: s.label,
              status: s.status as PipelineStepStatus,
              detail: s.detail,
            })));
            setShowPipeline(true);
          }
        }
      } catch {
        // Ignore — server may not be ready
      }
    })();

    return () => {
      streamRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // ── Load build logs on mount ──────────────────────────────────────

  const refreshBuildLogs = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(`/api/codascope/projects/${activeProjectId}/build-logs?limit=10`);
      if (res.ok) {
        const data = await res.json();
        setBuildLogs(data.logs ?? []);
      }
    } catch { /* ignore */ }
  }, [activeProjectId]);

  useEffect(() => {
    void refreshBuildLogs();
  }, [refreshBuildLogs]);

  // ── Elapsed timer during builds ───────────────────────────────────

  useEffect(() => {
    if (!buildStartedAt || !runningCommand) return;
    setElapsed(elapsedSince(buildStartedAt));
    const interval = setInterval(() => {
      setElapsed(elapsedSince(buildStartedAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [buildStartedAt, runningCommand]);

  // ── Pipeline step updater ─────────────────────────────────────────

  function updatePipelineSteps(
    prev: PipelineStep[],
    event: { step: string; status: string; repo?: string; topic?: string; progress?: string; reason?: string; error?: string; mode?: string },
  ): PipelineStep[] {
    const { step: stepId, status, repo, topic, progress, reason, error, mode } = event;
    const next = [...prev];

    // Build a detail string
    let detail = "";
    if (repo) detail = repo;
    if (topic) detail = topic;
    if (progress) detail = progress;
    if (reason) detail = reason;
    if (error) detail = `Error: ${error}`;
    if (mode) detail = mode;

    // Find and update existing step, or add a new one
    const existing = next.findIndex((s) => s.id === stepId);
    if (existing >= 0) {
      next[existing] = {
        ...next[existing],
        status: status as PipelineStepStatus,
        detail: detail || next[existing].detail,
      };
    } else {
      const labelMap: Record<string, string> = {
        "code-map": "Code Map",
        "wiki": "Wiki",
        "wiki-draft": "Wiki (Draft)",
        "wiki-enrich": "Wiki (Enrichment)",
        "wiki-outline": "Wiki (Outline)",
        "wiki-delta": "Wiki (Delta)",
        "wiki-state": "Wiki State",
        "quality": "Quality Scan",
      };
      next.push({
        id: stepId,
        label: labelMap[stepId] ?? stepId,
        status: status as PipelineStepStatus,
        detail,
      });
    }

    return next;
  }

  // ── Unified Analyze action — SSE streaming ───────────────────────

  const handleAnalyze = useCallback(async () => {
    if (agentRunning || !activeProjectId || !selectedModel) return;
    setAgentRunning(true);
    setAgentStatus("Running analysis…");
    setRunningCommand("analyze");
    setRunOutput("");
    setRunError("");
    setBuildSummary(null);
    setBuildStartedAt(new Date().toISOString());
    setShowPipeline(true);
    setPipelineSteps([]);

    const controller = connectToSseStream(
      {
        url: `/api/codascope/projects/${activeProjectId}/analyze`,
        method: "POST",
        body: {
          modelId: selectedModel,
          wiki: wikiEnabled ? wikiMode : false,
          quality: qualityEnabled,
          scope,
        },
      },
      {
        onText: (text) => setRunOutput((prev) => prev + text),
        onRunStarted: (_runId) => {
          // Pipeline started
        },
        onPipelineStep: (step) => {
          setPipelineSteps((prev) => updatePipelineSteps(prev, step));
        },
        onDone: (summary) => {
          setAgentRunning(false);
          setAgentStatus("");
          setRunningCommand(null);
          setBuildSummary(summary);
          void refreshBuildLogs();
        },
        onError: (error) => {
          setRunError(error);
          setAgentRunning(false);
          setAgentStatus("");
          setRunningCommand(null);
        },
      },
    );
    streamRef.current = controller;
  }, [agentRunning, activeProjectId, selectedModel, wikiEnabled, wikiMode, qualityEnabled, scope, setAgentRunning, setAgentStatus, refreshBuildLogs]);

  // ── Cancel Build ─────────────────────────────────────────────────

  const handleCancelBuild = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      await fetch(`/api/codascope/projects/${activeProjectId}/build/cancel`, { method: "POST" });
      streamRef.current?.abort();
      setAgentRunning(false);
      setAgentStatus("");
      setRunError("");
      setBuildSummary("Build cancelled");
      setRunningCommand(null);
      refreshBuildLogs();
    } catch {
      // ignore
    }
  }, [activeProjectId, setAgentRunning, setAgentStatus, refreshBuildLogs]);

  // ── Legacy quick action (for individual commands like do_explore) ──

  const handleQuickAction = useCallback(async (command: string) => {
    if (agentRunning || !activeProjectId || !selectedModel) return;
    setAgentRunning(true);
    setAgentStatus(`Running ${command}…`);
    setRunningCommand(command);
    setRunOutput("");
    setRunError("");
    setBuildSummary(null);
    setBuildStartedAt(new Date().toISOString());

    const controller = connectToSseStream(
      {
        url: `/api/codascope/projects/${activeProjectId}/runs`,
        method: "POST",
        body: { command, modelId: selectedModel },
      },
      {
        onText: (text) => setRunOutput((prev) => prev + text),
        onRunStarted: (_runId) => {
          // runId received
        },
        onDone: (summary) => {
          setAgentRunning(false);
          setAgentStatus("");
          setRunningCommand(null);
          setBuildSummary(summary);
          void refreshBuildLogs();
        },
        onError: (error) => {
          setRunError(error);
          setAgentRunning(false);
          setAgentStatus("");
          setRunningCommand(null);
        },
      },
    );
    streamRef.current = controller;
  }, [agentRunning, activeProjectId, selectedModel, setAgentRunning, setAgentStatus, refreshBuildLogs]);

  // ── Auto-scroll log ───────────────────────────────────────────────

  useEffect(() => {
    if (logEndRef.current && runOutput) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [runOutput]);

  // ── Cleanup on unmount ────────────────────────────────────────────

  useEffect(() => {
    return () => {
      streamRef.current?.abort();
    };
  }, []);

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

  const isAnalyzing = runningCommand === "analyze";
  const analyzeButtonLabel = isAnalyzing
    ? `⟳ Analyzing… (${elapsed})`
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
        <div className="codascope-stat-card" onClick={() => navigate(`project/${activeProjectId}/wiki`)} style={{ cursor: "pointer" }}>
          <div className="codascope-stat-card-icon"><IconWiki size={20} /></div>
          <div className="codascope-stat-card-value">{project.wikiPageCount ?? 0}</div>
          <div className="codascope-stat-card-label">Wiki Pages</div>
        </div>
        <div className="codascope-stat-card" onClick={() => navigate(`project/${activeProjectId}/quality`)} style={{ cursor: "pointer" }}>
          <div className="codascope-stat-card-icon"><IconQuality size={20} /></div>
          <div className="codascope-stat-card-value">{project.qualityScore ?? "—"}</div>
          <div className="codascope-stat-card-label">Quality Score</div>
        </div>
        <div className="codascope-stat-card" onClick={() => navigate(`project/${activeProjectId}/concepts`)} style={{ cursor: "pointer" }}>
          <div className="codascope-stat-card-icon"><IconConcepts size={20} /></div>
          <div className="codascope-stat-card-value">{project.conceptCount ?? 0}</div>
          <div className="codascope-stat-card-label">Concepts</div>
        </div>
      </div>

      {/* ── Unified Analyze Panel ──────────────────────────────────── */}
      <div className={`codascope-analyze-panel ${isAnalyzing ? "codascope-analyze-panel--running" : ""}`} id="analyze-panel">
        <div className="codascope-analyze-header">
          <div className="codascope-analyze-title">
            <span className="codascope-analyze-title-icon"><IconSearch size={16} /></span>
            Analyze Codebase
          </div>
          {agentRunning ? (
            <button
              className="codascope-analyze-run-btn codascope-analyze-run-btn--stop"
              onClick={handleCancelBuild}
              type="button"
              id="analyze-stop-btn"
            >
              ■ Stop
            </button>
          ) : (
            <button
              className={`codascope-analyze-run-btn ${isAnalyzing ? "codascope-analyze-run-btn--running" : ""}`}
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
      {showPipeline && pipelineSteps.length > 0 && (
        <div className="codascope-pipeline-progress" id="pipeline-progress">
          <div className="codascope-pipeline-header">
            <div className="codascope-pipeline-title">
              {isAnalyzing ? "⟳" : "✓"} Analysis Pipeline
            </div>
            {isAnalyzing && (
              <span className="codascope-pipeline-elapsed">{elapsed}</span>
            )}
            {!isAnalyzing && (
              <button
                className="codascope-btn codascope-btn-ghost"
                style={{ fontSize: "var(--text-xs)", padding: "2px 6px" }}
                onClick={() => { setShowPipeline(false); setPipelineSteps([]); }}
                type="button"
              >
                Dismiss
              </button>
            )}
          </div>
          <div className="codascope-pipeline-steps">
            {pipelineSteps.map((step) => (
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
      {buildSummary && !agentRunning && (
        <div className="codascope-alert codascope-alert--success" style={{ marginBottom: "var(--space-4)" }}>
          <span className="codascope-alert-icon">✓</span>
          <span>{buildSummary}</span>
          <button
            className="codascope-alert-dismiss"
            onClick={() => setBuildSummary(null)}
            type="button"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error alert */}
      {runError && !agentRunning && (
        <div className="codascope-alert codascope-alert--danger" style={{ marginBottom: "var(--space-4)" }}>
          <span className="codascope-alert-icon">⚠</span>
          <span>{runError}</span>
          <button
            className="codascope-alert-dismiss"
            onClick={() => setRunError("")}
            type="button"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Run output log */}
      {(runOutput || agentRunning) && (
        <div className="codascope-build-log" style={{ marginBottom: "var(--space-4)" }}>
          <div className="codascope-build-log-header">
            <span>
              {agentRunning
                ? `⟳ Agent Output — ${elapsed}`
                : "✓ Complete"}
            </span>
            {!agentRunning && (
              <button
                className="codascope-btn codascope-btn-ghost"
                style={{ fontSize: "var(--text-xs)", padding: "2px 6px" }}
                onClick={() => setRunOutput("")}
                type="button"
              >
                Dismiss
              </button>
            )}
          </div>
          <pre className="codascope-build-log-content">
            {runOutput || (agentRunning ? "Connecting to build stream…\n" : "")}
            <div ref={logEndRef} />
          </pre>
        </div>
      )}

      {/* Build History */}
      {buildLogs.length > 0 && (
        <>
          <div className="codascope-page-header" style={{ marginBottom: "var(--space-3)" }}>
            <div className="codascope-page-title" style={{ fontSize: "var(--text-md)" }}>
              Build History
            </div>
          </div>
          <div style={{
            marginBottom: "var(--space-4)",
            borderRadius: "var(--radius-lg)",
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-primary)",
            overflow: "hidden",
          }}>
            {buildLogs.map((log, i) => (
              <div
                key={log.runId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "var(--space-3) var(--space-4)",
                  borderBottom: i < buildLogs.length - 1 ? "1px solid var(--color-border-primary)" : "none",
                  fontSize: "var(--text-sm)",
                  color: "var(--color-text-secondary)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <span style={{
                    color: log.status === "complete" ? "var(--color-success)" : log.status === "error" ? "var(--color-danger)" : "var(--color-text-tertiary)",
                  }}>
                    {log.status === "complete" ? "✓" : log.status === "error" ? "✕" : "●"}
                  </span>
                  <span>{log.summary ?? log.command}</span>
                </div>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                  {log.startedAt ? timeAgo(log.startedAt) : ""}
                </span>
              </div>
            ))}
          </div>
        </>
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
