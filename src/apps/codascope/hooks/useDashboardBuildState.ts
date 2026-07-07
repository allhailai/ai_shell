/* ── useDashboardBuildState ─────────────────────────────────────────
   Encapsulates the build lifecycle for the ProjectDashboard:
   - Checks server build status on mount (survives refresh)
   - Reconnects to SSE stream if a build is currently running
   - Tracks elapsed time during builds
   - Manages pipeline step progress
   - Provides startBuildStream() for unified analyze/quick-action

   Extracted from ProjectDashboard to reduce component complexity.
   ──────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback, useRef } from "react";
import { connectToSseStream, type SseStreamTarget } from "../codaScopeSseClient";
import type { BuildState, BuildLogEntry, PipelineStepStatus, PipelineStepRecord } from "../codaScopeTypes";

// Local alias for template simplicity
type PipelineStep = PipelineStepRecord;

/* ── Helpers ─────────────────────────────────────────────────────── */

/** Format elapsed time from a start timestamp */
function elapsedSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

/** Update pipeline steps array from an SSE event */
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
      // Deep Run pipeline steps
      "deep-code-map": "Code Map (Deep)",
      "deep-outline": "Outline Build",
      "deep-cross-ref": "Cross-References",
      "deep-index": "Index Regeneration",
      "deep-finalize": "Finalize Sync",
    };

    // Handle dynamic deep-topic-* steps: render the topic name as the label
    let resolvedLabel = labelMap[stepId];
    if (!resolvedLabel && stepId.startsWith("deep-topic-")) {
      // The topic name is in the "topic" field or derive from the step ID
      const topicSlug = stepId.slice("deep-topic-".length);
      resolvedLabel = topic || topicSlug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      if (progress) resolvedLabel = `${resolvedLabel} — ${progress}`;
    }
    next.push({
      id: stepId,
      label: resolvedLabel ?? stepId,
      status: status as PipelineStepStatus,
      detail,
    });
  }

  return next;
}

/* ── Types ───────────────────────────────────────────────────────── */

export interface UseDashboardBuildStateResult {
  /** Current run output text */
  runOutput: string;
  /** Current run error text */
  runError: string;
  setRunError: (error: string) => void;
  /** Command currently running, or null */
  runningCommand: string | null;
  /** Build summary text after completion */
  buildSummary: string | null;
  setBuildSummary: (summary: string | null) => void;
  /** Build logs (history) */
  buildLogs: BuildLogEntry[];
  /** Formatted elapsed time during a build */
  elapsed: string;
  /** Ref for auto-scrolling the log output */
  logEndRef: React.RefObject<HTMLDivElement | null>;
  /** Pipeline steps for progress visualization */
  pipelineSteps: PipelineStep[];
  /** Whether to show the pipeline progress panel */
  showPipeline: boolean;
  setShowPipeline: (show: boolean) => void;
  /** Clear pipeline steps */
  clearPipeline: () => void;
  /** Refresh build logs from server */
  refreshBuildLogs: () => Promise<void>;
  /** Clear output text */
  clearRunOutput: () => void;
  /** Start a build stream (unified analyze + quick action) */
  startBuildStream: (opts: {
    target: SseStreamTarget;
    command: string;
    showPipeline?: boolean;
  }) => void;
  /** Cancel the current build */
  cancelBuild: () => Promise<void>;
  /** Whether analyzing (command === "analyze") */
  isAnalyzing: boolean;
  /** The build type of the current or last build ("analyze" | "deep-run") */
  buildType: "analyze" | "deep-run" | null;
  /** Whether a deep run is currently in progress */
  isDeepRunning: boolean;
}

/* ── Hook ────────────────────────────────────────────────────────── */

export function useDashboardBuildState(
  activeProjectId: string | null,
  setAgentRunning: (running: boolean) => void,
  setAgentStatus: (status: string) => void,
  agentRunning: boolean,
  selectedModel: string | null,
): UseDashboardBuildStateResult {
  const [runOutput, setRunOutput] = useState("");
  const [runError, setRunError] = useState("");
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [buildType, setBuildType] = useState<"analyze" | "deep-run" | null>(null);
  const [buildStartedAt, setBuildStartedAt] = useState<string | null>(null);
  const [buildSummary, setBuildSummary] = useState<string | null>(null);
  const [buildLogs, setBuildLogs] = useState<BuildLogEntry[]>([]);
  const [elapsed, setElapsed] = useState("");
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<AbortController | null>(null);

  // Pipeline progress
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
          setBuildType(build.buildType ?? "analyze");
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

  // ── Load build logs ───────────────────────────────────────────────

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

  // ── Unified start build stream ────────────────────────────────────

  const startBuildStream = useCallback((opts: {
    target: SseStreamTarget;
    command: string;
    showPipeline?: boolean;
  }) => {
    if (agentRunning || !activeProjectId || !selectedModel) return;
    setAgentRunning(true);
    setAgentStatus(`Running ${opts.command}…`);
    setRunningCommand(opts.command);
    setRunOutput("");
    setRunError("");
    setBuildSummary(null);
    setBuildStartedAt(new Date().toISOString());
    if (opts.showPipeline !== false) {
      setShowPipeline(true);
      setPipelineSteps([]);
    }

    const controller = connectToSseStream(opts.target, {
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
    });
    streamRef.current = controller;
  }, [agentRunning, activeProjectId, selectedModel, setAgentRunning, setAgentStatus, refreshBuildLogs]);

  // ── Cancel Build ─────────────────────────────────────────────────

  const cancelBuild = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      await fetch(`/api/codascope/projects/${activeProjectId}/build/cancel`, { method: "POST" });
      streamRef.current?.abort();
      setAgentRunning(false);
      setAgentStatus("");
      setRunError("");
      setBuildSummary("Build cancelled");
      setRunningCommand(null);
      void refreshBuildLogs();
    } catch {
      // ignore
    }
  }, [activeProjectId, setAgentRunning, setAgentStatus, refreshBuildLogs]);

  const clearPipeline = useCallback(() => {
    setShowPipeline(false);
    setPipelineSteps([]);
  }, []);

  const clearRunOutput = useCallback(() => {
    setRunOutput("");
  }, []);

  return {
    runOutput,
    runError,
    setRunError,
    runningCommand,
    buildSummary,
    setBuildSummary,
    buildLogs,
    elapsed,
    logEndRef,
    pipelineSteps,
    showPipeline,
    setShowPipeline,
    clearPipeline,
    refreshBuildLogs,
    clearRunOutput,
    startBuildStream,
    cancelBuild,
    isAnalyzing: runningCommand === "analyze" || runningCommand === "deep-run",
    buildType,
    isDeepRunning: buildType === "deep-run" && runningCommand != null,
  };
}
