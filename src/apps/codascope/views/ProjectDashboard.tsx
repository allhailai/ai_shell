/* ── CodaScope: ProjectDashboard View ────────────────────────────────
   Overview dashboard for a selected project with stat cards,
   quick actions, build state persistence, and model picker.

   Build state features:
   - Button disables and shows "Building Wiki…" during builds
   - Checks server build status on mount (survives refresh)
   - Reconnects to SSE stream on refresh to resume live output
   - Shows build history with auto-generated summaries
   ──────────────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useRef } from "react";
import { useAppSubRoute } from "../../../shell/useAppSubRoute";
import { useCodaScopeStore } from "../useCodaScopeStore";
import { ModelPicker } from "../components/ModelPicker";

/* ── Types ──────────────────────────────────────────────────────────── */

interface BuildState {
  runId: string;
  status: "idle" | "building" | "complete" | "error";
  command: string;
  modelId: string;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  error: string | null;
}

interface BuildLogEntry {
  runId: string;
  command: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  error: string | null;
  durationMs: number | null;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Parse SSE lines from a streaming response. */
function parseSseChunk(chunk: string, handler: (event: string, data: string) => void): string {
  const lines = chunk.split("\n");
  const remainder = lines.pop() ?? "";
  let currentEvent = "message";

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      handler(currentEvent, line.slice(6));
      currentEvent = "message";
    }
  }

  return remainder;
}

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

/* ── SSE Stream Handler ──────────────────────────────────────────────── */

function connectToSseStream(
  url: string | { url: string; method: "POST"; body: Record<string, unknown> },
  callbacks: {
    onText: (text: string) => void;
    onRunStarted?: (runId: string) => void;
    onDone: (summary: string | null) => void;
    onError: (error: string) => void;
    onWikiRefresh?: (topics: unknown[]) => void;
  },
): AbortController {
  const controller = new AbortController();

  const fetchOpts: RequestInit = {
    signal: controller.signal,
  };

  let fetchUrl: string;
  if (typeof url === "string") {
    fetchUrl = url;
  } else {
    fetchUrl = url.url;
    fetchOpts.method = url.method;
    fetchOpts.headers = { "Content-Type": "application/json" };
    fetchOpts.body = JSON.stringify(url.body);
  }

  void (async () => {
    try {
      const res = await fetch(fetchUrl, fetchOpts);

      if (!res.ok || !res.body) {
        let errorText = "Failed to connect.";
        try {
          const data = await res.json();
          errorText = data.error ?? data.message ?? errorText;
        } catch {
          errorText = await res.text();
        }
        callbacks.onError(errorText);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        buffer = parseSseChunk(buffer, (event, data) => {
          if (event === "run-started") {
            try {
              const parsed = JSON.parse(data);
              callbacks.onRunStarted?.(parsed.runId);
            } catch { /* skip */ }
          } else if (event === "done") {
            try {
              const parsed = JSON.parse(data);
              callbacks.onDone(parsed.buildSummary ?? null);
            } catch {
              callbacks.onDone(null);
            }
          } else if (event === "error") {
            try {
              const parsed = JSON.parse(data);
              callbacks.onError(parsed.error ?? "Unknown error");
            } catch {
              callbacks.onError("Unknown error");
            }
          } else if (event === "wiki-refresh") {
            try {
              const parsed = JSON.parse(data);
              callbacks.onWikiRefresh?.(parsed.topics ?? []);
            } catch { /* skip */ }
          } else {
            // Regular data message
            try {
              const msg = JSON.parse(data);
              if (msg.type === "assistant" && msg.message?.content) {
                for (const block of msg.message.content) {
                  if (block.type === "text" && block.text) {
                    callbacks.onText(block.text);
                  }
                }
              }
            } catch { /* skip malformed */ }
          }
        });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : "Network error.";
        callbacks.onError(message);
      }
    }
  })();

  return controller;
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

          const controller = connectToSseStream(
            `/api/codascope/projects/${activeProjectId}/build-log/${build.runId}/stream`,
            {
              onText: (text) => setRunOutput((prev) => prev + text),
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

  // ── Quick actions — SSE streaming ────────────────────────────────

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
          // runId received — could store for manual reconnect
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
        <div className="codascope-empty-state-icon">📁</div>
        <div className="codascope-empty-state-title">No Project Selected</div>
        <div className="codascope-empty-state-text">
          Select a project from the left navigation to view its dashboard.
        </div>
      </div>
    );
  }

  /* ── Button labels based on build state ────────────────────────── */

  const buildButtonLabel =
    runningCommand === "do_build_full_wiki"
      ? `📖 Building Wiki… (${elapsed})`
      : "📖 Build Full Wiki";

  const exploreButtonLabel =
    runningCommand === "do_explore"
      ? `🔍 Exploring… (${elapsed})`
      : "🔍 Explore Codebase";

  const qualityButtonLabel =
    runningCommand === "do_quality_scan"
      ? `📊 Scanning… (${elapsed})`
      : "📊 Run Quality Scan";

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
          className={`codascope-btn ${runningCommand === "do_build_full_wiki" ? "codascope-btn-building" : "codascope-btn-primary"}`}
          onClick={() => handleQuickAction("do_build_full_wiki")}
          disabled={agentRunning || !selectedModel}
          type="button"
        >
          {buildButtonLabel}
        </button>
        <button
          className={`codascope-btn ${runningCommand === "do_explore" ? "codascope-btn-building" : "codascope-btn-secondary"}`}
          onClick={() => handleQuickAction("do_explore")}
          disabled={agentRunning || !selectedModel}
          type="button"
        >
          {exploreButtonLabel}
        </button>
        <button
          className="codascope-btn codascope-btn-secondary"
          onClick={() => navigate(`project/${activeProjectId}/chat`)}
          type="button"
        >
          💬 Chat with Code
        </button>
        <button
          className={`codascope-btn ${runningCommand === "do_quality_scan" ? "codascope-btn-building" : "codascope-btn-secondary"}`}
          onClick={() => handleQuickAction("do_quality_scan")}
          disabled={agentRunning || !selectedModel}
          type="button"
        >
          {qualityButtonLabel}
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
